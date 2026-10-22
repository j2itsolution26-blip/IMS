import 'server-only';

import { cache } from 'react';
import { storeDb } from '@/lib/tenant/context';
import { NotFoundError } from '@/lib/errors';

/**
 * This is a single-store system. Exactly one warehouse ("Main Store") is
 * seeded by `prisma/bootstrap.ts` and every POS/inventory operation resolves
 * it silently — there is no location picker anywhere in the UI.
 */
export const getDefaultWarehouseId = cache(async (): Promise<string> => {
  const db = await storeDb();
  const warehouse = await db.warehouse.findFirst({
    where: { isActive: true },
    orderBy: { isDefault: 'desc' },
    select: { id: true },
  });
  if (!warehouse) throw new NotFoundError('Default warehouse — run `npm run db:bootstrap`.');
  return warehouse.id;
});
