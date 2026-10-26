'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ForbiddenError } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { isStoreOwner, selectPlan, submitPayment, withdrawInvoice, type Owner } from '@/server/platform/billing-service';
import { checkReceipt, removeBillingFiles, storeReceipt } from '@/server/platform/billing-storage';

/**
 * The owner's billing actions: choose a plan (accepting the terms), withdraw
 * an unpaid choice, and report a payment with its receipt. Each requires
 * `billing.manage` and the store's owner account, and acts only on the
 * signed-in user's own store — the store id is taken from the session, never
 * from the request. Verification is not here: only the platform
 * administrator can mark a payment verified.
 */

async function requireOwner(): Promise<Owner> {
  const user = await authorize('billing.manage');
  if (!user.store) throw new ForbiddenError('This account does not belong to a store.');
  // Checked again under the store's row lock in the billing service; here it
  // refuses a staff account before anything is uploaded.
  if (!(await isStoreOwner(user.id, user.store.id))) {
    throw new ForbiddenError('Only the store owner can choose a plan or submit a payment.');
  }
  return { id: user.id, name: user.name, storeId: user.store.id };
}

function refresh() {
  revalidatePath('/settings/subscription');
}

const selectSchema = z.object({
  plan: z.enum(['BASIC', 'BUSINESS', 'ENTERPRISE']),
  interval: z.enum(['MONTHLY', 'ANNUAL']),
  termsVersion: z.coerce.number().int().positive(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'Accept the billing terms to choose a plan.' }) }),
});
export async function selectPlanAction(input: unknown): Promise<ActionResult<{ invoiceId: string; number: string }>> {
  return runAction(async () => {
    const owner = await requireOwner();
    const values = parseInput(selectSchema, input);
    const result = await selectPlan(owner, values);
    refresh();
    return result;
  });
}

const withdrawSchema = z.object({ invoiceId: z.string().trim().min(1).max(64) });
export async function withdrawInvoiceAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const owner = await requireOwner();
    const values = parseInput(withdrawSchema, input);
    await withdrawInvoice(owner, values);
    refresh();
  });
}

const submitSchema = z.object({
  invoiceId: z.string().trim().min(1).max(64),
  method: z.enum(['GCASH', 'BANK_TRANSFER', 'OTHER']),
  reference: z
    .string()
    .trim()
    .min(4, 'Enter the full reference number.')
    .max(64)
    .regex(/^[A-Za-z0-9 -]+$/, 'Use only the letters and numbers of the reference.'),
  paidAt: z
    .coerce.date({ errorMap: () => ({ message: 'Enter the date you paid.' }) })
    .refine((date) => date.getTime() > Date.now() - 90 * 86_400_000, 'That date is more than 90 days ago.'),
  notes: z.string().trim().max(500).optional(),
});

/** A few corrected attempts are normal; a stream of uploads is not. */
const SUBMIT_LIMIT = { limit: 6, windowMs: 10 * 60_000 };

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
};

/**
 * The owner reports a payment with its receipt. The receipt is checked (real
 * image type, size) and uploaded into the store's private folder first; if
 * the submission is then refused, the upload is removed again.
 */
export async function submitPaymentAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const owner = await requireOwner();
    checkRateLimit(`billing:submit:${owner.id}`, SUBMIT_LIMIT);
    const values = parseInput(submitSchema, {
      invoiceId: text(form, 'invoiceId'),
      method: text(form, 'method'),
      reference: text(form, 'reference'),
      paidAt: text(form, 'paidAt'),
      notes: text(form, 'notes') || undefined,
    });
    const image = await checkReceipt(form.get('receipt'));
    const receipt = await storeReceipt(owner.storeId, image);
    try {
      const result = await submitPayment(owner, { ...values, receipt });
      refresh();
      return result;
    } catch (error) {
      await removeBillingFiles([receipt.storagePath]);
      throw error;
    }
  });
}
