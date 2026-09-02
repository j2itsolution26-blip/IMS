'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { voidSale } from '@/server/services/sale-service';
import { createSaleReturn } from '@/server/services/return-service';

/** Sale-level actions that go beyond the till: voiding and returns. */

const voidSchema = z.object({
  saleId: z.string().min(1),
  reason: z.string().trim().min(4, 'Give a reason of at least 4 characters.').max(200),
});

export async function voidSaleAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    // Voiding reverses stock and revenue, so it is gated behind delete rights
    // rather than the broader update permission.
    const user = await authorize('sales.delete');
    const values = parseInput(voidSchema, input);

    await voidSale(values.saleId, user.id, values.reason);

    revalidatePath('/sales');
    revalidatePath(`/sales/${values.saleId}`);
    revalidatePath('/dashboard');
    revalidatePath('/inventory');
  });
}

const returnSchema = z.object({
  saleId: z.string().min(1),
  reason: z.string().trim().min(4, 'Give a reason of at least 4 characters.').max(200),
  restock: z.boolean().default(true),
  refundMethod: z.enum(['CASH', 'GCASH', 'CARD', 'OTHER']).default('CASH'),
  lines: z
    .array(z.object({ saleItemId: z.string().min(1), quantity: z.number().min(0) }))
    .min(1, 'Select at least one line to return.'),
});

export async function createReturnAction(
  input: unknown,
): Promise<ActionResult<{ id: string; returnNumber: string; total: number }>> {
  return runAction(async () => {
    const user = await authorize('returns.create');
    const values = parseInput(returnSchema, input);

    const result = await createSaleReturn({
      saleId: values.saleId,
      reason: values.reason,
      restock: values.restock,
      refundMethod: values.refundMethod,
      lines: values.lines.filter((line) => line.quantity > 0),
      userId: user.id,
    });

    revalidatePath('/sales');
    revalidatePath(`/sales/${values.saleId}`);
    revalidatePath('/returns');
    revalidatePath('/dashboard');
    revalidatePath('/inventory');

    return { id: result.id, returnNumber: result.returnNumber, total: result.total };
  });
}
