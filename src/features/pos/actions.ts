'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { createSale, type CompletedSale } from '@/server/services/sale-service';
import { searchSellableProducts, type SellableProduct } from '@/features/products/queries';

/**
 * Point-of-sale actions.
 *
 * The client sends product ids and quantities only. Prices and costs are
 * always re-read from the database inside the checkout transaction, so a
 * tampered request cannot change what anything sells for. There is no
 * customer or warehouse to pick — every sale is a walk-in sale at the
 * store's single location.
 */

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().positive('Quantity must be greater than zero.'),
        unitPrice: z.number().min(0).optional(),
        discount: z.number().min(0).default(0),
      }),
    )
    .min(1, 'The basket is empty.'),
  discount: z.number().min(0).default(0),
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'GCASH', 'CARD', 'OTHER']),
        amount: z.number().min(0),
        reference: z.string().max(80).optional(),
      }),
    )
    .min(1, 'Record at least one payment.'),
  notes: z.string().max(500).optional(),
});

export type CheckoutInput = z.input<typeof checkoutSchema>;

export async function checkout(input: unknown): Promise<ActionResult<CompletedSale>> {
  return runAction(async () => {
    const user = await authorize('pos.create');

    // A till should never be able to submit hundreds of sales a minute; this
    // catches a stuck button or a scripted replay.
    checkRateLimit(`checkout:${user.id}`, RATE_LIMITS.mutation);

    const values = parseInput(checkoutSchema, input);

    const sale = await createSale({
      channel: 'POS',
      items: values.items,
      discount: values.discount,
      payments: values.payments.filter((payment) => payment.amount > 0),
      notes: values.notes,
      userId: user.id,
    });

    revalidatePath('/pos');
    revalidatePath('/sales');
    revalidatePath('/dashboard');
    revalidatePath('/inventory');

    return sale;
  });
}

/** Live product lookup for the terminal's search and barcode field. */
export async function lookupProducts(term: string): Promise<ActionResult<SellableProduct[]>> {
  return runAction(async () => {
    await authorize('pos.view');
    return searchSellableProducts(term, 40);
  });
}
