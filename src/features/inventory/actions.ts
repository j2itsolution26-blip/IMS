'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { createAdjustment, createTransfer } from '@/server/services/stock-movement-service';

/** Manual stock operations: counts, write-offs, and inter-warehouse transfers. */

const adjustmentSchema = z.object({
  warehouseId: z.string().min(1, 'Choose a warehouse.'),
  mode: z.enum(['ABSOLUTE', 'RELATIVE']),
  reason: z.string().trim().min(4, 'Give a reason of at least 4 characters.').max(200),
  isOpeningBalance: z.boolean().default(false),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().finite(),
        unitCost: z.number().min(0).optional(),
      }),
    )
    .min(1, 'Add at least one product.'),
});

export async function createAdjustmentAction(
  input: unknown,
): Promise<ActionResult<{ reference: string; count: number }>> {
  return runAction(async () => {
    const user = await authorize('inventory.create');
    const values = parseInput(adjustmentSchema, input);

    const result = await createAdjustment({
      warehouseId: values.warehouseId,
      mode: values.mode,
      reason: values.reason,
      isOpeningBalance: values.isOpeningBalance,
      lines: values.lines,
      userId: user.id,
    });

    revalidatePath('/inventory');
    revalidatePath('/inventory/movements');
    revalidatePath('/dashboard');

    return { reference: result.reference, count: result.applied.length };
  });
}

const transferSchema = z
  .object({
    fromWarehouseId: z.string().min(1, 'Choose a source warehouse.'),
    toWarehouseId: z.string().min(1, 'Choose a destination warehouse.'),
    note: z.string().trim().max(200).optional(),
    lines: z
      .array(z.object({ productId: z.string().min(1), quantity: z.number().positive() }))
      .min(1, 'Add at least one product.'),
  })
  .refine((values) => values.fromWarehouseId !== values.toWarehouseId, {
    message: 'Source and destination must be different.',
    path: ['toWarehouseId'],
  });

export async function createTransferAction(
  input: unknown,
): Promise<ActionResult<{ reference: string }>> {
  return runAction(async () => {
    const user = await authorize('inventory.create');
    const values = parseInput(transferSchema, input);

    const result = await createTransfer({
      fromWarehouseId: values.fromWarehouseId,
      toWarehouseId: values.toWarehouseId,
      note: values.note,
      lines: values.lines,
      userId: user.id,
    });

    revalidatePath('/inventory');
    revalidatePath('/inventory/movements');
    revalidatePath('/dashboard');

    return { reference: result.reference };
  });
}
