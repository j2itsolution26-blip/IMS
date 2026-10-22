import 'server-only';

import type { DbClient } from '@/lib/prisma';
import { getStoreContext } from '@/lib/tenant/context';

/**
 * Document numbering (INV-000123, PO-000045, ...).
 *
 * The counter lives in a `settings` row and is incremented with a single
 * atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. Two cashiers
 * checking out at the same instant therefore cannot be handed the same invoice
 * number — which a `count() + 1` scheme would happily do.
 *
 * Each store has its own counters, so every store starts at INV-000001.
 */

export type DocumentKind = 'SALE' | 'RETURN' | 'PAYMENT' | 'ADJUSTMENT';

const CONFIG: Record<DocumentKind, { prefix: string; label: string }> = {
  SALE: { prefix: 'INV', label: 'Sale invoice counter' },
  RETURN: { prefix: 'RET', label: 'Return counter' },
  PAYMENT: { prefix: 'PAY', label: 'Payment counter' },
  ADJUSTMENT: { prefix: 'ADJ', label: 'Stock adjustment counter' },
};

export async function nextDocumentNumber(kind: DocumentKind, db?: DbClient): Promise<string> {
  const { prefix, label } = CONFIG[kind];
  const key = `counter.${kind.toLowerCase()}`;
  const store = await getStoreContext();
  db ??= store.db;

  const rows = await db.$queryRaw<{ value: string }[]>`
    INSERT INTO settings (id, "storeId", key, value, type, "group", label, description, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${store.storeId}, ${key}, '1', 'NUMBER', 'counters', ${label},
            'Managed automatically — do not edit by hand.', now(), now())
    ON CONFLICT ("storeId", key)
      DO UPDATE SET value = (settings.value::bigint + 1)::text, "updatedAt" = now()
    RETURNING value
  `;

  const sequence = Number(rows[0]?.value ?? 1);
  return `${prefix}-${String(sequence).padStart(6, '0')}`;
}
