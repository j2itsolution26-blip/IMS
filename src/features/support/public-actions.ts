'use server';

import { getCurrentUser, getRequestContext, userCan } from '@/lib/session';
import { parseInput, runAction, type ActionResult } from '@/lib/action';
import { checkRateLimit } from '@/lib/rate-limit';
import { createTicketSchema, publicTicketSchema } from '@/lib/support';
import { isHoneypotTripped } from '@/lib/support-abuse-rules';
import { SUPPORT_MAX_FILES_PUBLIC } from '@/lib/support-files';
import { ValidationError } from '@/lib/errors';
import { hashIp, verifyFormToken } from '@/server/support/support-abuse';
import { checkFiles } from '@/server/support/support-storage';
import { createPublicTicket, createTicket } from '@/server/support/support-service';

/**
 * The Help page's one action, reachable without signing in.
 *
 * Every outcome a visitor can see is the same whatever email they type: no
 * account is looked up by it, so this cannot be used to learn whether an
 * address is registered. A visitor who is in fact signed in (and allowed to
 * contact support) gets an ordinary ticket on their own account, decided from
 * the session cookie on the server, never from the form.
 */

const PUBLIC_LIMIT = { limit: 3, windowMs: 10 * 60_000 };

function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
}

export interface PublicTicketResult {
  /** Null only when the submission was discarded as automated. */
  number: string | null;
  signedIn: boolean;
}

export async function submitPublicTicketAction(form: FormData): Promise<ActionResult<PublicTicketResult>> {
  return runAction(async () => {
    const { ipAddress } = await getRequestContext();
    const ipHash = hashIp(ipAddress);
    checkRateLimit(`support:public:${ipHash ?? 'unknown'}`, PUBLIC_LIMIT);

    // A bot that filled the hidden field is told "sent"; nothing is stored.
    if (isHoneypotTripped(form.get('website'))) return { number: null, signedIn: false };
    if (!verifyFormToken(text(form, 'formToken'))) {
      throw new ValidationError('This form has expired or was sent too quickly. Please wait a moment and send it again.');
    }

    const attachments = form.getAll('attachments').filter((value): value is File => typeof value === 'object' && value !== null);

    const user = await getCurrentUser().catch(() => null);
    if (user && !user.mustChangePassword && !user.isLocked && userCan(user, 'support.create')) {
      const input = parseInput(createTicketSchema, {
        category: text(form, 'category'),
        subject: text(form, 'subject'),
        description: text(form, 'description'),
        submissionKey: text(form, 'submissionKey'),
      });
      const checked = await checkFiles(attachments, SUPPORT_MAX_FILES_PUBLIC);
      const result = await createTicket(user, input, { ipHash, files: checked });
      return { number: result.number, signedIn: true };
    }

    const input = parseInput(publicTicketSchema, {
      name: text(form, 'name'),
      email: text(form, 'email'),
      category: text(form, 'category'),
      subject: text(form, 'subject'),
      description: text(form, 'description'),
      submissionKey: text(form, 'submissionKey'),
    });
    const checked = await checkFiles(attachments, SUPPORT_MAX_FILES_PUBLIC);
    const result = await createPublicTicket(input, { ipHash, files: checked });
    return { number: result.number, signedIn: false };
  });
}
