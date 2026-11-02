import 'server-only';

import { getStoreContext } from '@/lib/tenant/context';
import { readBranchIds, sqlBranch } from '@/server/analytics/branch-filter';

/**
 * Cheap counts for the navigation badges. Kept separate from the full
 * dashboard aggregates because these run on every page load — the sidebar
 * should not pay for a stock valuation it does not display.
 */
export async function countActionableStock(): Promise<number> {
  const { db, storeId } = await getStoreContext();
  const branches = await readBranchIds();
  const rows = await db.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT p.id
      FROM products p
      LEFT JOIN inventory i ON i."productId" = p.id${sqlBranch('i."warehouseId"', branches)}
      WHERE p."storeId" = ${storeId} AND p.status = 'ACTIVE' AND p."isTrackable" = true
      GROUP BY p.id, p."reorderLevel", p."minStock"
      HAVING COALESCE(NULLIF(p."reorderLevel", 0), p."minStock") > 0
         AND COALESCE(SUM(i.quantity), 0) - COALESCE(SUM(i.reserved), 0)
             <= COALESCE(NULLIF(p."reorderLevel", 0), p."minStock")
    ) AS needs_attention
  `;
  return rows[0]?.count ?? 0;
}
