import 'server-only';

import { prisma, type DbClient } from '@/lib/prisma';

/**
 * Document numbering (INV-000123, PO-000045, ...).
 *
 * The counter lives in a `settings` row and is incremented with a single
 * atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. Two cashiers
 * checking out at the same instant therefore cannot be handed the same invoice
 * number — which a `count() + 1` scheme would happily do.
 */

export type DocumentKind = 'SALE' | 'PURCHASE_ORDER' | 'RETURN' | 'PAYMENT' | 'EXPENSE' | 'ADJUSTMENT' | 'TRANSFER';

const CONFIG: Record<DocumentKind, { prefix: string; label: string }> = {
  SALE: { prefix: 'INV', label: 'Sale invoice counter' },
  PURCHASE_ORDER: { prefix: 'PO', label: 'Purchase order counter' },
  RETURN: { prefix: 'RET', label: 'Return counter' },
  PAYMENT: { prefix: 'PAY', label: 'Payment counter' },
  EXPENSE: { prefix: 'EXP', label: 'Expense counter' },
  ADJUSTMENT: { prefix: 'ADJ', label: 'Stock adjustment counter' },
  TRANSFER: { prefix: 'TRF', label: 'Stock transfer counter' },
};

export async function nextDocumentNumber(kind: DocumentKind, db: DbClient = prisma): Promise<string> {
  const { prefix, label } = CONFIG[kind];
  const key = `counter.${kind.toLowerCase()}`;

  const rows = await db.$queryRaw<{ value: string }[]>`
    INSERT INTO settings (id, key, value, type, "group", label, description, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${key}, '1', 'NUMBER', 'counters', ${label},
            'Managed automatically — do not edit by hand.', now(), now())
    ON CONFLICT (key)
      DO UPDATE SET value = (settings.value::bigint + 1)::text, "updatedAt" = now()
    RETURNING value
  `;

  const sequence = Number(rows[0]?.value ?? 1);
  return `${prefix}-${String(sequence).padStart(6, '0')}`;
}
