import { revalidatePath } from 'next/cache';
import type { NextRequest } from 'next/server';
import { authorize } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { parseInput } from '@/lib/action';
import type { SyncResponse } from '@/lib/offline-sale';
import { checkoutSchema } from '@/features/pos/checkout-schema';
import { createSale } from '@/server/services/sale-service';
import { errorResponse, json, readJson, sameOriginJson } from '@/server/pos/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * A live checkout: exactly the `checkout` server action (server prices, open
 * shift, stock check, GCash confirmation), at a URL that survives deploys.
 *
 * The till saves the sale on the device first and sends it here with its
 * local id as `clientRequestId`, so a retry after a lost response returns the
 * sale already recorded. It answers in the same shape as /api/pos/sync.
 */
export async function POST(request: NextRequest) {
  const refused = sameOriginJson(request);
  if (refused) return refused;

  try {
    const user = await authorize('pos.create');
    checkRateLimit(`checkout:${user.id}`, RATE_LIMITS.mutation);
    const values = parseInput(checkoutSchema, await readJson(request));
    if (!values.clientRequestId) {
      return json({ ok: false, code: 'VALIDATION_ERROR', error: 'A checkout needs its id.', retryable: false }, 422);
    }

    const sale = await createSale({
      channel: 'POS',
      items: values.items,
      discount: values.discount,
      payments: values.payments.filter((payment) => payment.amount > 0),
      notes: values.notes,
      userId: user.id,
      clientRequestId: values.clientRequestId,
    });

    revalidatePath('/pos');
    revalidatePath('/sales');
    revalidatePath('/dashboard');
    revalidatePath('/inventory');

    return json({
      ok: true,
      status: 'recorded',
      sale: {
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        total: sale.total,
        paidAmount: sale.paidAmount,
        changeAmount: sale.changeAmount,
        receivedAt: new Date().toISOString(),
      },
      issues: [],
    } satisfies SyncResponse);
  } catch (error) {
    return errorResponse(error, 'pos-checkout');
  }
}
