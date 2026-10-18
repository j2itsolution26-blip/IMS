'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { createAdjustment, createStockIn } from '@/server/services/stock-movement-service';
import { findInventoryProductByBarcode, type InventoryBarcodeLookup } from '@/features/inventory/queries';

/** Manual stock operations: stock-in, counts, and write-offs. */

const stockInSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive('Enter a quantity greater than zero.'),
  unitCost: z.number().min(0).optional(),
});

export async function stockInAction(
  input: unknown,
): Promise<ActionResult<{ reference: string }>> {
  return runAction(async () => {
    const user = await authorize('inventory.create');
    const values = parseInput(stockInSchema, input);

    const result = await createStockIn({
      productId: values.productId,
      quantity: values.quantity,
      unitCost: values.unitCost,
      userId: user.id,
    });

    revalidatePath('/inventory');
    revalidatePath('/dashboard');
    revalidatePath('/pos');

    return { reference: result.reference };
  });
}

const adjustmentSchema = z.object({
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
      mode: values.mode,
      reason: values.reason,
      isOpeningBalance: values.isOpeningBalance,
      lines: values.lines,
      userId: user.id,
    });

    revalidatePath('/inventory');
    revalidatePath('/dashboard');

    return { reference: result.reference, count: result.applied.length };
  });
}

/** Printable ASCII up to 64 characters — longer than any retail symbology. */
const barcodeSchema = z
  .string()
  .trim()
  .min(1, 'Scan a barcode.')
  .max(64, 'That is not a valid barcode.')
  .regex(/^[\x20-\x7E]+$/, 'That is not a valid barcode.');

/**
 * Finds the product behind a scanned code for receiving, counting and the
 * inventory search. Read-only: stock only changes through the actions above.
 */
export async function lookupInventoryBarcode(code: unknown): Promise<ActionResult<InventoryBarcodeLookup>> {
  return runAction(async () => {
    await authorize('inventory.view');
    return findInventoryProductByBarcode(parseInput(barcodeSchema, code));
  });
}
