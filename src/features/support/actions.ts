'use server';

import { revalidatePath } from 'next/cache';
import { authorize, getRequestContext } from '@/lib/session';
import { parseInput, runAction, type ActionResult } from '@/lib/action';
import { checkRateLimit } from '@/lib/rate-limit';
import { createTicketSchema, isTicketNumber, replySchema } from '@/lib/support';
import { SUPPORT_MAX_FILES } from '@/lib/support-files';
import { NotFoundError } from '@/lib/errors';
import { hashIp } from '@/server/support/support-abuse';
import { checkFiles } from '@/server/support/support-storage';
import { createTicket, replyToMyTicket, type CreatedTicket } from '@/server/support/support-service';

/**
 * A signed-in account's support actions. The requester is always the session's
 * account and the store its own; nothing in the form can name another. Works
 * for a suspended or read-only store, since none of it uses the store client.
 */

const CREATE_LIMIT = { limit: 5, windowMs: 10 * 60_000 };
const REPLY_LIMIT = { limit: 20, windowMs: 60_000 };

function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
}

function files(form: FormData): File[] {
  return form.getAll('attachments').filter((value): value is File => typeof value === 'object' && value !== null);
}

export async function createSupportTicketAction(form: FormData): Promise<ActionResult<CreatedTicket>> {
  return runAction(async () => {
    const user = await authorize('support.create');
    checkRateLimit(`support:create:${user.id}`, CREATE_LIMIT);
    const input = parseInput(createTicketSchema, {
      category: text(form, 'category'),
      subject: text(form, 'subject'),
      description: text(form, 'description'),
      submissionKey: text(form, 'submissionKey'),
    });
    const checked = await checkFiles(files(form), SUPPORT_MAX_FILES);
    const { ipAddress } = await getRequestContext();
    const result = await createTicket(user, input, { ipHash: hashIp(ipAddress), files: checked });
    revalidatePath('/support');
    return result;
  });
}

export async function replyToSupportTicketAction(
  number: string,
  form: FormData,
): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const user = await authorize('support.create');
    checkRateLimit(`support:reply:${user.id}`, REPLY_LIMIT);
    if (!isTicketNumber(number)) throw new NotFoundError('Ticket');
    const { message } = parseInput(replySchema, { message: text(form, 'message') });
    const checked = await checkFiles(files(form), SUPPORT_MAX_FILES);
    const result = await replyToMyTicket(user, number, message, checked);
    revalidatePath(`/support/${number}`);
    revalidatePath('/support');
    return result;
  });
}
