import { z } from 'zod';
import { lineQuantity } from '@/lib/quantity';

/**
 * A live checkout, as the till sends it. Shared by the `checkout` server
 * action and POST /api/pos/checkout, which the till uses so a sale it keeps
 * retrying after a lost response can still reach a newer deploy.
 *
 * The client sends product ids and quantities only. Prices and costs are
 * always re-read from the database inside the checkout transaction, so a
 * tampered request cannot change what anything sells for.
 */
export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        // Above zero, up to 3 decimals. Whether this product may take a
        // fraction is checked against the product in the sale service.
        quantity: lineQuantity,
        // Deliberately no `unitPrice`: the till has no price-override
        // permission, so the database price is the only price. Zod strips
        // unknown keys, so a tampered request carrying one is simply ignored.
        discount: z.number().min(0).default(0),
      }),
    )
    .min(1, 'The basket is empty.'),
  discount: z.number().min(0).default(0),
  payments: z
    .array(
      z.object({
        // The till only takes cash and GCash; CARD and OTHER remain in the
        // enum for historical sales.
        method: z.enum(['CASH', 'GCASH']),
        amount: z.number().finite().min(0),
        reference: z.string().max(80).optional(),
        // GCash: the cashier saw the money arrive in the store account.
        confirmedReceived: z.boolean().optional(),
      }),
    )
    .min(1, 'Record at least one payment.'),
  notes: z.string().max(500).optional(),
  // One per checkout attempt, so a retried request records the sale once.
  clientRequestId: z.string().uuid().optional(),
});

export type CheckoutInput = z.input<typeof checkoutSchema>;
