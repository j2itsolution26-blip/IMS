import 'server-only';

import { cache } from 'react';
import { assertPasswordSettled, getCurrentUser } from '@/lib/session';
import { storeDb } from '@/lib/tenant/context';
import { operatingBranchId } from '@/lib/tenant/branch';

/**
 * The branch whose stock the till shows: the branch of the cashier's open
 * shift (where the sale will be filed), or the account's operating branch
 * before a shift is open. See src/lib/tenant/branch.ts.
 */
export const posBranchId = cache(async (): Promise<string> => {
  const user = await getCurrentUser();
  if (user) {
    assertPasswordSettled(user);
    const db = await storeDb();
    const shift = await db.cashierShift.findFirst({ where: { userId: user.id, status: 'OPEN' }, select: { warehouseId: true } });
    if (shift) return shift.warehouseId;
  }
  return operatingBranchId();
});
