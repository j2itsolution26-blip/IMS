'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertPasswordSettled, getCurrentUser, type CurrentUser } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { LOCKED_MESSAGE } from '@/lib/session';
import { normalizeUsername, usernameProblem } from '@/lib/username';
import { MAX_TRIAL_EXTENSION_DAYS, PAYMENT_MONTHS } from '@/lib/subscription';
import { recordAuditFor } from '@/server/services/audit-service';
import {
  changePlan,
  createStore,
  extendTrial,
  recordManualPayment,
  setStoreStatus,
  voidPayment,
  type Actor,
} from '@/server/platform/subscription-service';

/**
 * Subscription administration: only a platform administrator holding
 * `platform.manage` may change a plan, a status or a trial, or confirm a
 * payment. A refused attempt is itself audited, in the caller's own trail.
 * All values are validated here; the service re-checks state under a lock.
 */

async function requireManager(attempt: string): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  assertPasswordSettled(user);
  if (user.isLocked) throw new ForbiddenError(LOCKED_MESSAGE);
  if (!user.permissions.has('platform.manage')) {
    await denied(user, attempt);
    throw new ForbiddenError('Only the platform administrator can manage subscriptions.');
  }
  return { id: user.id, name: user.name };
}

async function denied(user: CurrentUser, attempt: string) {
  await recordAuditFor(user, {
    action: 'SUBSCRIPTION',
    entity: 'Store',
    summary: `Denied: ${user.name} tried to ${attempt} without platform permission`,
    changes: { denied: true, attempt },
    userId: user.id,
  }).catch((error) => console.error('[platform] could not audit a denied attempt', error));
}

function refresh(storeId?: string) {
  revalidatePath('/system-admin');
  revalidatePath('/system-admin/stores');
  if (storeId) revalidatePath(`/system-admin/stores/${storeId}`);
}

const id = z.string().trim().min(1).max(64);
const reason = z.string().trim().min(3, 'Give a short reason (it goes in the audit log).').max(300);
const plan = z.enum(['BASIC', 'BUSINESS', 'ENTERPRISE']);

const planSchema = z.object({ storeId: id, plan, reason });
export async function changePlanAction(input: unknown): Promise<ActionResult<{ overLimits: string[] }>> {
  return runAction(async () => {
    const actor = await requireManager('change a store plan');
    const values = parseInput(planSchema, input);
    const result = await changePlan(actor, values);
    refresh(values.storeId);
    return result;
  });
}

const statusSchema = z.object({ storeId: id, status: z.enum(['ACTIVE', 'PAST_DUE', 'SUSPENDED']), reason });
export async function setStoreStatusAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireManager('change a store status');
    const values = parseInput(statusSchema, input);
    await setStoreStatus(actor, values);
    refresh(values.storeId);
  });
}

const trialSchema = z.object({ storeId: id, days: z.coerce.number().int().min(1).max(MAX_TRIAL_EXTENSION_DAYS), reason });
export async function extendTrialAction(input: unknown): Promise<ActionResult<{ trialEndsAt: Date }>> {
  return runAction(async () => {
    const actor = await requireManager('extend a trial');
    const values = parseInput(trialSchema, input);
    const result = await extendTrial(actor, values);
    refresh(values.storeId);
    return result;
  });
}

const paymentSchema = z.object({
  storeId: id,
  plan,
  // Pesos as typed, at most two decimals; parsed only after the format is checked.
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter the amount in pesos, e.g. 499 or 499.50.')
    .transform(Number)
    .refine((n) => n > 0 && n <= 1_000_000, 'Enter the amount received (up to ₱1,000,000).'),
  method: z.enum(['GCASH', 'BANK_TRANSFER', 'OTHER']),
  reference: z.string().trim().min(4, 'Enter the full reference number.').max(64),
  paidAt: z.coerce.date({ errorMap: () => ({ message: 'Enter the date the payment arrived.' }) })
    .refine((d) => d.getTime() > Date.now() - 366 * 86_400_000, 'That date is more than a year ago.'),
  months: z.coerce.number().int().refine((n) => (PAYMENT_MONTHS as readonly number[]).includes(n), 'Choose 1, 3, 6 or 12 months.'),
  notes: z.string().trim().max(300).optional(),
  // The form's explicit "I have checked the money arrived" box.
  confirmed: z.literal(true, { errorMap: () => ({ message: 'Confirm that you have checked the payment was received.' }) }),
});
export async function recordPaymentAction(input: unknown): Promise<ActionResult<{ id: string; periodEnd: Date }>> {
  return runAction(async () => {
    const actor = await requireManager('record a subscription payment');
    const { confirmed: _confirmed, ...values } = parseInput(paymentSchema, input);
    const result = await recordManualPayment(actor, values);
    refresh(values.storeId);
    return result;
  });
}

const voidSchema = z.object({ paymentId: id, storeId: id, reason });
export async function voidPaymentAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const actor = await requireManager('void a subscription payment');
    const values = parseInput(voidSchema, input);
    await voidPayment(actor, values);
    refresh(values.storeId);
  });
}

const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .regex(/[a-z]/, 'Include a lowercase letter.')
  .regex(/[A-Z]/, 'Include an uppercase letter.')
  .regex(/[0-9]/, 'Include a number.')
  .regex(/[^A-Za-z0-9]/, 'Include a special character.');

const storeSchema = z.object({
  storeName: z.string().trim().min(2, 'Enter the store name.').max(80),
  name: z.string().trim().min(2, 'Enter the owner’s full name.').max(80),
  username: z
    .string()
    .transform(normalizeUsername)
    .superRefine((value, ctx) => {
      const problem = usernameProblem(value);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password,
  phone: z.string().trim().max(40).optional(),
  allowSimilar: z.boolean().default(false),
});
export async function createStoreAction(input: unknown): Promise<ActionResult<{ storeId: string }>> {
  return runAction(async () => {
    const actor = await requireManager('create a store');
    const values = parseInput(storeSchema, input);
    const { storeId } = await createStore(actor, {
      storeName: values.storeName,
      owner: { name: values.name, username: values.username, email: values.email, password: values.password, phone: values.phone },
      allowSimilar: values.allowSimilar,
    });
    refresh();
    revalidatePath('/system-admin/owners');
    return { storeId };
  });
}
