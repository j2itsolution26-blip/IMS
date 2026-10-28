'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { recordWalletTransaction, reverseWalletTransaction, type RecordedWallet } from '@/server/services/wallet-service';

/**
 * GCash cash-in / cash-out actions. The cashier is always the signed-in
 * user; amounts are re-checked in the service and the database.
 */

const recordSchema = z.object({
  type: z.enum(['CASH_IN', 'CASH_OUT']),
  amount: z.number().finite(),
  fee: z.number().finite().default(0),
  gcashReference: z.string().trim().max(80),
  customerMobile: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(300).optional(),
  // The cashier saw the transfer go out of / arrive in the store GCash.
  confirmed: z.boolean(),
  clientRequestId: z.string().uuid().optional(),
});

function refresh() {
  revalidatePath('/pos');
  revalidatePath('/dashboard');
  revalidatePath('/gcash-services');
  revalidatePath('/shifts', 'layout');
}

export async function recordWalletAction(input: unknown): Promise<ActionResult<RecordedWallet>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    checkRateLimit(`wallet:${user.id}`, RATE_LIMITS.mutation);
    const values = parseInput(recordSchema, input);
    const result = await recordWalletTransaction({ ...values, userId: user.id });
    refresh();
    return result;
  });
}

const reverseSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(3, 'Give a short reason.').max(200),
});

export async function reverseWalletAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    const values = parseInput(reverseSchema, input);
    await reverseWalletTransaction({ id: values.id, actorId: user.id, isOwner: userCan(user, FINANCIAL_PERMISSION), reason: values.reason });
    refresh();
  });
}
