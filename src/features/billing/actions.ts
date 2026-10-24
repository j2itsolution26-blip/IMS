'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ForbiddenError } from '@/lib/errors';
import { selectPlan, submitPayment, withdrawInvoice, type Owner } from '@/server/platform/billing-service';

/**
 * The owner's billing actions: choose a plan (accepting the terms), withdraw
 * an unpaid choice, and report a payment. Each requires `billing.manage` and
 * acts only on the signed-in user's own store — the store id is taken from
 * the session, never from the request. Verification is not here: only the
 * platform administrator can mark a payment verified.
 */

async function requireOwner(): Promise<Owner> {
  const user = await authorize('billing.manage');
  if (!user.store) throw new ForbiddenError('This account does not belong to a store.');
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
  reference: z.string().trim().min(4, 'Enter the full reference number.').max(64),
  paidAt: z
    .coerce.date({ errorMap: () => ({ message: 'Enter the date you paid.' }) })
    .refine((date) => date.getTime() > Date.now() - 90 * 86_400_000, 'That date is more than 90 days ago.'),
  notes: z.string().trim().max(500).optional(),
});
export async function submitPaymentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const owner = await requireOwner();
    const values = parseInput(submitSchema, input);
    const result = await submitPayment(owner, values);
    refresh();
    return result;
  });
}
