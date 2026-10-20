import 'server-only';

import type { InventoryTransactionType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { STORE_TIME_ZONE, addStoreDays, eachStoreBucket, startOfStoreDay } from '@/lib/store-time';
import { suggestedRestock } from '@/lib/stock-status';
import { formatBucketLabel } from '@/server/analytics/sales-analytics';

/**
 * Data for the Inventory Operations Dashboard.
 *
 * Every figure is aggregated in Postgres over active, stock-tracked products
 * and the stock ledger. Nothing here reads sales totals, payments, cost or
 * profit, so the dashboard is safe to show any role with inventory access.
 * Stock value is the one cost-based figure and is only computed on request
 * (`includeValue`), which the page grants to the owner alone.
 *
 * The stock bands match `@/lib/stock-status` and the register's SQL filters:
 *   out = available <= 0
 *   low = available > 0 AND threshold > 0 AND available <= threshold
 *   in  = everything else
 * where threshold = reorder level, or the minimum stock when no level is set.
 */

const STOCK_CTE = `
  WITH stock AS (
    SELECT
      p.id,
      p.name,
      p.sku,
      p."imageUrl"                                          AS image_url,
      p."categoryId"                                        AS category_id,
      p."reorderQty"                                        AS reorder_qty,
      p."maxStock"                                          AS max_stock,
      p."costPrice"                                         AS cost_price,
      COALESCE(NULLIF(p."reorderLevel", 0), p."minStock")   AS threshold,
      COALESCE(SUM(i.quantity), 0)                          AS on_hand,
      COALESCE(SUM(i.quantity), 0) - COALESCE(SUM(i.reserved), 0) AS available
    FROM products p
    LEFT JOIN inventory i ON i."productId" = p.id
    WHERE p.status = 'ACTIVE' AND p."isTrackable" = true
    GROUP BY p.id
  )
`;

export interface InventoryKpis {
  /** Active, stock-tracked products — the population every band is drawn from. */
  totalProducts: number;
  /** Active products whose stock is not tracked (services, fees). */
  untrackedProducts: number;
  activeCategories: number;
  outOfStock: number;
  lowStock: number;
  inStock: number;
  /** Out of stock or low: everything that needs replenishing. */
  restockRequired: number;
  /** Of those, how many have a reorder quantity or maximum to suggest from. */
  restockWithSuggestion: number;
  /** Total pieces suggested across those products. */
  suggestedPieces: number;
  /** Distinct receipts and adjustments (by reference) recorded today. */
  movementsToday: number;
  piecesReceivedToday: number;
  /** Stock at cost. Null unless the caller may see cost. */
  stockValue: number | null;
}

export interface CategoryCount {
  categoryId: string;
  name: string;
  products: number;
}

export interface MovementDay {
  bucket: string;
  label: string;
  /** Pieces received through stock-in. */
  received: number;
  /** Net pieces from adjustments and opening balances; negative when more was written off. */
  adjusted: number;
}

export interface ReorderCandidate {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  available: number;
  threshold: number;
  /** Null when the product has neither a reorder quantity nor a maximum. */
  suggested: number | null;
}

export interface StockActivity {
  id: string;
  type: InventoryTransactionType;
  quantity: number;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: Date;
  note: string | null;
  referenceId: string | null;
  productId: string;
  productName: string;
  sku: string;
  userName: string;
}

export interface InventoryDashboardData {
  kpis: InventoryKpis;
  categories: CategoryCount[];
  movementTrend: MovementDay[];
  /** False when the ledger holds no receipts or adjustments in the window. */
  hasMovementHistory: boolean;
  reorder: ReorderCandidate[];
  recentActivity: StockActivity[];
}

interface KpiRow {
  total: number;
  out: number;
  low: number;
  instock: number;
  value: string;
}

/** The KPI figures on their own, for screens that need the counts but not the charts. */
export async function getInventoryKpis({ includeValue = false, now = new Date() }: { includeValue?: boolean; now?: Date } = {}) {
  return getKpis(now, includeValue);
}

async function getKpis(now: Date, includeValue: boolean): Promise<InventoryKpis> {
  const todayStart = startOfStoreDay(now);

  const [bands, restockRows, untracked, categories, today] = await Promise.all([
    prisma.$queryRawUnsafe<KpiRow[]>(`
      ${STOCK_CTE}
      SELECT
        COUNT(*)::int                                                              AS total,
        COUNT(*) FILTER (WHERE available <= 0)::int                                AS out,
        COUNT(*) FILTER (WHERE available > 0 AND threshold > 0 AND available <= threshold)::int AS low,
        COUNT(*) FILTER (WHERE available > 0 AND (threshold <= 0 OR available > threshold))::int AS instock,
        ${includeValue ? 'COALESCE(SUM(on_hand * cost_price), 0)::text' : `'0'`} AS value
      FROM stock
    `),
    // Only the products that need restocking, and only what the suggestion needs.
    prisma.$queryRawUnsafe<{ available: string; reorder_qty: string; max_stock: string }[]>(`
      ${STOCK_CTE}
      SELECT available::text, reorder_qty::text, max_stock::text
      FROM stock
      WHERE available <= 0 OR (threshold > 0 AND available <= threshold)
    `),
    prisma.product.count({ where: { status: 'ACTIVE', isTrackable: false } }),
    prisma.category.count({ where: { isActive: true } }),
    prisma.$queryRaw<{ movements: number; received: string }[]>`
      SELECT
        COUNT(DISTINCT COALESCE(t."referenceId", t.id))::int AS movements,
        COALESCE(SUM(t.quantity) FILTER (WHERE t.type = 'STOCK_IN'), 0)::text AS received
      FROM inventory_transactions t
      WHERE t."createdAt" >= ${todayStart}
        AND t.type IN ('STOCK_IN', 'OPENING_BALANCE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT')
    `,
  ]);

  const band = bands[0];
  let restockWithSuggestion = 0;
  let suggestedPieces = 0;
  for (const row of restockRows) {
    const suggestion = suggestedRestock({
      available: Number(row.available),
      reorderQty: Number(row.reorder_qty),
      maxStock: Number(row.max_stock),
    });
    if (suggestion != null) {
      restockWithSuggestion += 1;
      suggestedPieces += suggestion;
    }
  }

  return {
    totalProducts: band?.total ?? 0,
    untrackedProducts: untracked,
    activeCategories: categories,
    outOfStock: band?.out ?? 0,
    lowStock: band?.low ?? 0,
    inStock: band?.instock ?? 0,
    restockRequired: restockRows.length,
    restockWithSuggestion,
    suggestedPieces,
    movementsToday: today[0]?.movements ?? 0,
    piecesReceivedToday: Number(today[0]?.received ?? 0),
    stockValue: includeValue ? Number(band?.value ?? 0) : null,
  };
}

/** Active, tracked products per active category — every category, including empty ones. */
async function getCategoryCounts(): Promise<CategoryCount[]> {
  const rows = await prisma.$queryRaw<{ categoryId: string; name: string; products: number }[]>`
    SELECT c.id AS "categoryId", c.name, COUNT(p.id)::int AS products
    FROM categories c
    LEFT JOIN products p
      ON p."categoryId" = c.id AND p.status = 'ACTIVE' AND p."isTrackable" = true
    WHERE c."isActive" = true
    GROUP BY c.id, c.name
    ORDER BY products DESC, c.name ASC
  `;
  return rows;
}

const TREND_DAYS = 7;

/** Pieces received and net adjustments per store day, for the last seven days including today. */
async function getMovementTrend(now: Date): Promise<{ days: MovementDay[]; hasHistory: boolean }> {
  const to = now;
  const from = startOfStoreDay(addStoreDays(now, -(TREND_DAYS - 1)));
  const local = `(t."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE '${STORE_TIME_ZONE}')`;

  const rows = await prisma.$queryRawUnsafe<{ bucket: Date; received: string; adjusted: string }[]>(
    `
    SELECT
      date_trunc('day', ${local}) AT TIME ZONE '${STORE_TIME_ZONE}' AS bucket,
      COALESCE(SUM(t.quantity) FILTER (WHERE t.type = 'STOCK_IN'), 0)::text AS received,
      COALESCE(SUM(t.quantity) FILTER (WHERE t.type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OPENING_BALANCE')), 0)::text AS adjusted
    FROM inventory_transactions t
    WHERE t."createdAt" >= $1 AND t."createdAt" <= $2
      AND t.type IN ('STOCK_IN', 'OPENING_BALANCE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT')
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    from,
    to,
  );

  const byBucket = new Map(rows.map((row) => [row.bucket.getTime(), row]));
  const days = eachStoreBucket(from, to, 'day', TREND_DAYS + 1).map((start) => {
    const row = byBucket.get(start.getTime());
    return {
      bucket: start.toISOString(),
      label: formatBucketLabel(start, 'day'),
      received: row ? Number(row.received) : 0,
      adjusted: row ? Number(row.adjusted) : 0,
    };
  });

  return { days, hasHistory: rows.length > 0 };
}

const REORDER_ROWS = 8;

/**
 * Products that need restocking, nearest to empty first: out of stock, then
 * by how much of the low-stock level is left. Only products with a threshold
 * appear, since "closest to the threshold" needs one.
 */
async function getReorderCandidates(): Promise<ReorderCandidate[]> {
  const rows = await prisma.$queryRawUnsafe<
    {
      id: string;
      name: string;
      sku: string;
      image_url: string | null;
      available: string;
      threshold: string;
      reorder_qty: string;
      max_stock: string;
    }[]
  >(`
    ${STOCK_CTE}
    SELECT id, name, sku, image_url, available::text, threshold::text, reorder_qty::text, max_stock::text
    FROM stock
    WHERE threshold > 0 AND available <= threshold
    ORDER BY (available / threshold) ASC, name ASC
    LIMIT ${REORDER_ROWS}
  `);

  return rows.map((row) => {
    const available = Number(row.available);
    return {
      productId: row.id,
      name: row.name,
      sku: row.sku,
      imageUrl: row.image_url,
      available,
      threshold: Number(row.threshold),
      suggested: suggestedRestock({
        available,
        reorderQty: Number(row.reorder_qty),
        maxStock: Number(row.max_stock),
      }),
    };
  });
}

const ACTIVITY_ROWS = 10;

/** The latest stock movements of every kind, with before and after balances. */
export async function getRecentStockActivity(limit = ACTIVITY_ROWS): Promise<StockActivity[]> {
  const rows = await prisma.inventoryTransaction.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      quantity: true,
      balanceBefore: true,
      balanceAfter: true,
      createdAt: true,
      note: true,
      referenceId: true,
      product: { select: { id: true, name: true, sku: true } },
      user: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    quantity: toNum(row.quantity),
    balanceBefore: toNum(row.balanceBefore),
    balanceAfter: toNum(row.balanceAfter),
    createdAt: row.createdAt,
    note: row.note,
    referenceId: row.referenceId,
    productId: row.product.id,
    productName: row.product.name,
    sku: row.product.sku,
    userName: row.user?.name ?? 'System',
  }));
}

export async function getInventoryDashboard({
  includeValue,
  now = new Date(),
}: {
  /** Stock value at cost — the owner's figure. */
  includeValue: boolean;
  now?: Date;
}): Promise<InventoryDashboardData> {
  const [kpis, categories, trend, reorder, recentActivity] = await Promise.all([
    getKpis(now, includeValue),
    getCategoryCounts(),
    getMovementTrend(now),
    getReorderCandidates(),
    getRecentStockActivity(),
  ]);

  return {
    kpis,
    categories,
    movementTrend: trend.days,
    hasMovementHistory: trend.hasHistory,
    reorder,
    recentActivity,
  };
}
