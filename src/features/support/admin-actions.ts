'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { parseInput, runAction, type ActionResult } from '@/lib/action';
import { RATE_LIMITS, checkRateLimit } from '@/lib/rate-limit';
import { NotFoundError } from '@/lib/errors';
import { SUPPORT_PRIORITIES, SUPPORT_STATUSES, isTicketNumber, replySchema, ticketNumberSchema } from '@/lib/support';
import { SUPPORT_MAX_FILES } from '@/lib/support-files';
import { checkFiles } from '@/server/support/support-storage';
import {
  addInternalNote,
  assignTicket,
  changeStatus,
  replyAsAdmin,
  setPriority,
} from '@/server/support/support-admin-service';

/**
 * The Support Inbox's changes. Each one needs `platform.manage` from the
 * session; store owners and staff never hold it (no store role may). The
 * acting administrator is the session's account.
 */

async function admin() {
  const user = await authorize('platform.manage');
  checkRateLimit(`support:admin:${user.id}`, RATE_LIMITS.mutation);
  return { id: user.id, name: user.name };
}

function refresh(number: string) {
  revalidatePath(`/system-admin/support/${number}`);
  revalidatePath('/system-admin/support');
}

function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
}

export async function adminReplyAction(number: string, form: FormData): Promise<ActionResult<{ status: string }>> {
  return runAction(async () => {
    const actor = await admin();
    if (!isTicketNumber(number)) throw new NotFoundError('Ticket');
    const { message } = parseInput(replySchema, { message: text(form, 'message') });
    const files = form.getAll('attachments').filter((value): value is File => typeof value === 'object' && value !== null);
    const checked = await checkFiles(files, SUPPORT_MAX_FILES);
    const result = await replyAsAdmin(actor, number, message, { waitForUser: text(form, 'waitForUser') === '1', files: checked });
    refresh(number);
    return result;
  });
}

export async function adminNoteAction(number: string, form: FormData): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await admin();
    if (!isTicketNumber(number)) throw new NotFoundError('Ticket');
    const { message } = parseInput(replySchema, { message: text(form, 'message') });
    await addInternalNote(actor, number, message);
    refresh(number);
  });
}

const statusSchema = z.object({
  number: ticketNumberSchema,
  to: z.enum(SUPPORT_STATUSES),
  from: z.enum(SUPPORT_STATUSES),
});

export async function changeTicketStatusAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await admin();
    const { number, to, from } = parseInput(statusSchema, input);
    await changeStatus(actor, number, to, from);
    refresh(number);
  });
}

const prioritySchema = z.object({ number: ticketNumberSchema, priority: z.enum(SUPPORT_PRIORITIES) });

export async function setTicketPriorityAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await admin();
    const { number, priority } = parseInput(prioritySchema, input);
    await setPriority(actor, number, priority);
    refresh(number);
  });
}

const assignSchema = z.object({ number: ticketNumberSchema, assigneeId: z.string().min(1).max(64).nullable() });

export async function assignTicketAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await admin();
    const { number, assigneeId } = parseInput(assignSchema, input);
    await assignTicket(actor, number, assigneeId);
    refresh(number);
  });
}
