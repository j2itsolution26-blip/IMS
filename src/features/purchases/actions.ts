'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  receivePurchaseOrder,
  recordSupplierPayment,
} from '@/server/services/purchase-service';
import { createPurchaseReturn } from '@/server/services/return-service';

/** Purchasing actions: raise, receive, pay, cancel, and return to supplier. */

const createSchema = z.object({
  supplierId: z.string().min(1, 'Choose a supplier.'),
  warehouseId: z.string().min(1, 'Choose a receiving warehouse.'),
  status: z.enum(['DRAFT', 'ORDERED']).default('DRAFT'),
  expectedDate: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : null))
    .refine((value) => value === null || !Number.isNaN(value.getTime()), 'Enter a valid date.'),
  discount: z.number().min(0).default(0),
  shippingCost: z.number().min(0).default(0),
  notes: z.string().trim().max(1000).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive('Quantity must be greater than zero.'),
        unitCost: z.number().min(0),
        taxRate: z.number().min(0).max(100).default(0),
        discount: z.number().min(0).default(0),
      }),
    )
    .min(1, 'Add at least one product to the order.'),
});

export async function createPurchaseOrderAction(
  input: unknown,
): Promise<ActionResult<{ id: string; orderNumber: string }>> {
  return runAction(async () => {
    const user = await authorize('purchases.create');
    const values = parseInput(createSchema, input);

    const order = await createPurchaseOrder({
      supplierId: values.supplierId,
      warehouseId: values.warehouseId,
      status: values.status,
      expectedDate: values.expectedDate,
      discount: values.discount,
      shippingCost: values.shippingCost,
      notes: values.notes,
      items: values.items,
      userId: user.id,
    });

    revalidatePath('/purchases');
    revalidatePath('/dashboard');
    return order;
  });
}

const receiveSchema = z.object({
  purchaseOrderId: z.string().min(1),
  note: z.string().trim().max(200).optional(),
  lines: z
    .array(
      z.object({
        purchaseItemId: z.string().min(1),
        quantity: z.number().min(0),
        unitCost: z.number().min(0).optional(),
      }),
    )
    .min(1, 'Enter a quantity for at least one line.'),
});

export async function receivePurchaseOrderAction(
  input: unknown,
): Promise<ActionResult<{ fullyReceived: boolean; lineCount: number }>> {
  return runAction(async () => {
    const user = await authorize('purchases.update');
    const values = parseInput(receiveSchema, input);

    const result = await receivePurchaseOrder({
      purchaseOrderId: values.purchaseOrderId,
      note: values.note,
      lines: values.lines.filter((line) => line.quantity > 0),
      userId: user.id,
    });

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${values.purchaseOrderId}`);
    revalidatePath('/inventory');
    revalidatePath('/dashboard');

    return { fullyReceived: result.fullyReceived, lineCount: result.lineCount };
  });
}

const paymentSchema = z.object({
  purchaseOrderId: z.string().min(1),
  method: z.enum(['CASH', 'GCASH', 'MAYA', 'CARD', 'BANK_TRANSFER', 'CREDIT']),
  amount: z.number().positive('Enter an amount greater than zero.'),
  reference: z.string().trim().max(80).optional(),
});

export async function recordSupplierPaymentAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authorize('payments.create');
    const values = parseInput(paymentSchema, input);

    await recordSupplierPayment({ ...values, userId: user.id });

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${values.purchaseOrderId}`);
    revalidatePath('/payments');
  });
}

const cancelSchema = z.object({
  purchaseOrderId: z.string().min(1),
  reason: z.string().trim().min(4, 'Give a reason of at least 4 characters.').max(200),
});

export async function cancelPurchaseOrderAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authorize('purchases.delete');
    const values = parseInput(cancelSchema, input);

    await cancelPurchaseOrder(values.purchaseOrderId, user.id, values.reason);

    revalidatePath('/purchases');
    revalidatePath(`/purchases/${values.purchaseOrderId}`);
  });
}

const purchaseReturnSchema = z.object({
  warehouseId: z.string().min(1, 'Choose the warehouse the goods are leaving.'),
  reason: z.string().trim().min(4, 'Give a reason of at least 4 characters.').max(200),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive(),
        unitCost: z.number().min(0),
      }),
    )
    .min(1, 'Add at least one product.'),
});

export async function createPurchaseReturnAction(
  input: unknown,
): Promise<ActionResult<{ id: string; returnNumber: string; total: number }>> {
  return runAction(async () => {
    const user = await authorize('returns.create');
    const values = parseInput(purchaseReturnSchema, input);

    const result = await createPurchaseReturn({ ...values, userId: user.id });

    revalidatePath('/returns');
    revalidatePath('/inventory');
    revalidatePath('/dashboard');

    return result;
  });
}
