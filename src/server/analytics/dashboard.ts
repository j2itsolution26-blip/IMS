import 'server-only';

import { prisma } from '@/lib/prisma';
import { percentChange, toNum } from '@/lib/decimal';
import type { DateRange } from '@/server/analytics/date-range';
import { getSettings, readNumber } from '@/server/services/settings-service';

/**
 * Dashboard aggregates.
 *
 * Every figure on this page is derived here from `sales`, `sale_items`,
 * `returns`, `expenses`, `inventory`, and `inventory_transactions`. Nothing is
 * cached, estimated, or seeded — an empty database correctly produces zeros.
 *
 * Voided sales are excluded everywhere. Returns are netted off separately
 * rather than by mutating the original sale, so the original invoice stays an
 * accurate historical record.
 */

export interface SalesSummary {
  transactionCount: number;
  /** Gross takings, tax included. */
  revenue: number;
  /** Revenue excluding tax — the figure profit is measured against. */
  netRevenue: number;
  costOfGoods: number;
  grossProfit: number;
  marginPercent: number;
  itemsSold: number;
  averageOrderValue: number;
  returnsTotal: number;
  returnsCount: number;
  /** Gross profit less returns. */
  netProfit: number;
  cashSales: number;
}

interface SalesAggregateRow {
  transactionCount: number;
  revenue: string;
  netRevenue: string;
  costOfGoods: string;
  itemsSold: string;
}

async function salesAggregate(from: Date, to: Date): Promise<SalesAggregateRow> {
  // One pass over `sales` for the money, one correlated pass over `sale_items`
  // for the unit count — joining the lines in directly would multiply the sale
  // totals by the number of lines on each invoice.
  const rows = await prisma.$queryRaw<SalesAggregateRow[]>`
    SELECT
      COUNT(*)::int                                      AS "transactionCount",
      COALESCE(SUM(s.total), 0)::text                    AS "revenue",
      COALESCE(SUM(s.total - s."taxAmount"), 0)::text    AS "netRevenue",
      COALESCE(SUM(s."costOfGoods"), 0)::text            AS "costOfGoods",
      COALESCE((
        SELECT SUM(si.quantity)
        FROM sale_items si
        JOIN sales s2 ON s2.id = si."saleId"
        WHERE s2.status <> 'VOIDED'
          AND s2."createdAt" >= ${from}
          AND s2."createdAt" <= ${to}
      ), 0)::text                                        AS "itemsSold"
    FROM sales s
    WHERE s.status <> 'VOIDED'
      AND s."createdAt" >= ${from}
      AND s."createdAt" <= ${to}
  `;

  return (
    rows[0] ?? {
      transactionCount: 0,
      revenue: '0',
      netRevenue: '0',
      costOfGoods: '0',
      itemsSold: '0',
    }
  );
}

export async function getSalesSummary(from: Date, to: Date): Promise<SalesSummary> {
  const [aggregate, returns, cash] = await Promise.all([
    salesAggregate(from, to),
    prisma.return.aggregate({
      where: { status: 'COMPLETED', createdAt: { gte: from, lte: to } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: { method: 'CASH', direction: 'INBOUND', createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
  ]);

  const revenue = Number(aggregate.revenue);
  const netRevenue = Number(aggregate.netRevenue);
  const costOfGoods = Number(aggregate.costOfGoods);
  const grossProfit = netRevenue - costOfGoods;
  const returnsTotal = toNum(returns._sum.total);
  const transactionCount = aggregate.transactionCount;

  return {
    transactionCount,
    revenue,
    netRevenue,
    costOfGoods,
    grossProfit,
    marginPercent: netRevenue > 0 ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0,
    itemsSold: Number(aggregate.itemsSold),
    averageOrderValue: transactionCount > 0 ? revenue / transactionCount : 0,
    returnsTotal,
    returnsCount: returns._count,
    netProfit: grossProfit - returnsTotal,
    cashSales: toNum(cash._sum.amount),
  };
}

export interface ComparedSummary {
  current: SalesSummary;
  previous: SalesSummary;
  change: {
    revenue: number | null;
    netProfit: number | null;
    transactionCount: number | null;
    itemsSold: number | null;
  };
}

export async function getComparedSalesSummary(range: DateRange): Promise<ComparedSummary> {
  const [current, previous] = await Promise.all([
    getSalesSummary(range.from, range.to),
    getSalesSummary(range.previous.from, range.previous.to),
  ]);

  return {
    current,
    previous,
    change: {
      revenue: percentChange(current.revenue, previous.revenue),
      netProfit: percentChange(current.netProfit, previous.netProfit),
      transactionCount: percentChange(current.transactionCount, previous.transactionCount),
      itemsSold: percentChange(current.itemsSold, previous.itemsSold),
    },
  };
}

// ---------------------------------------------------------------------------
// Stock position
// ---------------------------------------------------------------------------

export interface InventorySnapshot {
  /** Stock at cost — what the shelves are worth to the business. */
  costValue: number;
  /** Stock at selling price — what it would fetch if it all sold. */
  retailValue: number;
  onHand: number;
  reserved: number;
  available: number;
  distinctProducts: number;
  stockedProducts: number;
  outOfStock: number;
  criticalStock: number;
  lowStock: number;
  healthyStock: number;
  overStock: number;
  deadStock: number;
}

interface StockValueRow {
  costValue: string;
  retailValue: string;
  onHand: string;
  reserved: string;
  distinctProducts: number;
  stockedProducts: number;
}

interface StockStatusRow {
  outofstock: number;
  critical: number;
  low: number;
  healthy: number;
  overstock: number;
}

export async function getInventorySnapshot(): Promise<InventorySnapshot> {
  const settings = await getSettings();
  const criticalRatio = readNumber(settings, 'inventory.criticalStockRatio') || 0.5;
  const deadStockDays = readNumber(settings, 'inventory.deadStockDays') || 30;

  const [valueRows, statusRows, deadStock] = await Promise.all([
    prisma.$queryRaw<StockValueRow[]>`
      SELECT
        COALESCE(SUM(i.quantity * p."costPrice"), 0)::text    AS "costValue",
        COALESCE(SUM(i.quantity * p."sellingPrice"), 0)::text AS "retailValue",
        COALESCE(SUM(i.quantity), 0)::text                    AS "onHand",
        COALESCE(SUM(i.reserved), 0)::text                    AS "reserved",
        COUNT(DISTINCT p.id)::int                             AS "distinctProducts",
        COUNT(DISTINCT p.id) FILTER (WHERE i.quantity > 0)::int AS "stockedProducts"
      FROM products p
      LEFT JOIN inventory i ON i."productId" = p.id
      WHERE p.status = 'ACTIVE' AND p."isTrackable" = true
    `,
    prisma.$queryRaw<StockStatusRow[]>`
      WITH stock AS (
        SELECT
          p.id,
          COALESCE(SUM(i.quantity), 0)  AS qty,
          COALESCE(SUM(i.reserved), 0)  AS reserved,
          COALESCE(NULLIF(p."reorderLevel", 0), p."minStock") AS threshold,
          p."maxStock" AS max_stock
        FROM products p
        LEFT JOIN inventory i ON i."productId" = p.id
        WHERE p.status = 'ACTIVE' AND p."isTrackable" = true
        GROUP BY p.id, p."reorderLevel", p."minStock", p."maxStock"
      ),
      classified AS (
        SELECT (qty - reserved) AS available, threshold, max_stock FROM stock
      )
      SELECT
        COUNT(*) FILTER (WHERE available <= 0)::int AS outofstock,
        COUNT(*) FILTER (
          WHERE available > 0 AND threshold > 0 AND available <= threshold * ${criticalRatio}
        )::int AS critical,
        COUNT(*) FILTER (
          WHERE available > 0 AND threshold > 0
            AND available > threshold * ${criticalRatio} AND available <= threshold
        )::int AS low,
        COUNT(*) FILTER (
          WHERE available > 0 AND (threshold <= 0 OR available > threshold)
            AND (max_stock <= 0 OR available <= max_stock)
        )::int AS healthy,
        COUNT(*) FILTER (WHERE max_stock > 0 AND available > max_stock)::int AS overstock
      FROM classified
    `,
    countDeadStock(deadStockDays),
  ]);

  const value = valueRows[0];
  const status = statusRows[0];
  const onHand = Number(value?.onHand ?? 0);
  const reserved = Number(value?.reserved ?? 0);

  return {
    costValue: Number(value?.costValue ?? 0),
    retailValue: Number(value?.retailValue ?? 0),
    onHand,
    reserved,
    available: onHand - reserved,
    distinctProducts: value?.distinctProducts ?? 0,
    stockedProducts: value?.stockedProducts ?? 0,
    outOfStock: status?.outofstock ?? 0,
    criticalStock: status?.critical ?? 0,
    lowStock: status?.low ?? 0,
    healthyStock: status?.healthy ?? 0,
    overStock: status?.overstock ?? 0,
    deadStock,
  };
}

/** Products holding stock that have not sold a single unit in the threshold window. */
async function countDeadStock(days: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT p.id
      FROM products p
      JOIN inventory i ON i."productId" = p.id
      WHERE p.status = 'ACTIVE' AND p."isTrackable" = true
      GROUP BY p.id
      HAVING SUM(i.quantity) > 0
         AND NOT EXISTS (
           SELECT 1
           FROM sale_items si
           JOIN sales s ON s.id = si."saleId"
           WHERE si."productId" = p.id
             AND s.status <> 'VOIDED'
             AND s."createdAt" >= now() - (${days} || ' days')::interval
         )
    ) AS dead
  `;
  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Product performance
// ---------------------------------------------------------------------------

export interface ProductPerformance {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  categoryName: string;
  unitsSold: number;
  revenue: number;
  profit: number;
  marginPercent: number;
  currentStock: number;
}

interface PerformanceRow {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  categoryName: string;
  unitsSold: string;
  revenue: string;
  profit: string;
  currentStock: string;
}

function mapPerformance(rows: PerformanceRow[]): ProductPerformance[] {
  return rows.map((r) => {
    const revenue = Number(r.revenue);
    const profit = Number(r.profit);
    return {
      productId: r.productId,
      name: r.name,
      sku: r.sku,
      imageUrl: r.imageUrl,
      categoryName: r.categoryName,
      unitsSold: Number(r.unitsSold),
      revenue,
      profit,
      marginPercent: revenue > 0 ? Number(((profit / revenue) * 100).toFixed(2)) : 0,
      currentStock: Number(r.currentStock),
    };
  });
}

export type PerformanceSort = 'units' | 'revenue' | 'profit';

const SORT_COLUMNS: Record<PerformanceSort, string> = {
  units: 'units_sold',
  revenue: 'revenue',
  profit: 'profit',
};

/**
 * Best/worst sellers over a window.
 *
 * `direction: 'asc'` on a window with `includeUnsold` gives the worst
 * performers — including products that sold nothing at all, which is the
 * question an owner actually cares about.
 */
export async function getProductPerformance(options: {
  from: Date;
  to: Date;
  sort?: PerformanceSort;
  direction?: 'asc' | 'desc';
  limit?: number;
  includeUnsold?: boolean;
}): Promise<ProductPerformance[]> {
  const { from, to, sort = 'revenue', direction = 'desc', limit = 5, includeUnsold = false } = options;

  // Column and direction are resolved from closed unions, never from raw input,
  // so nothing caller-supplied is ever concatenated into the statement. The
  // date and limit values are still bound as parameters.
  const sortColumn = SORT_COLUMNS[sort];
  const orderDirection = direction === 'asc' ? 'ASC' : 'DESC';

  // Raw SQL keeps the join, the aggregation, and the ordering in one pass —
  // doing this in JS would mean pulling every sale line into memory.
  const rows = await prisma.$queryRawUnsafe<PerformanceRow[]>(
    `
    WITH sold AS (
      SELECT
        si."productId",
        SUM(si.quantity)                                             AS units_sold,
        SUM(si.total)                                                AS revenue,
        SUM(si.total - si."unitCost" * si.quantity)                  AS profit
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s.status <> 'VOIDED' AND s."createdAt" >= $1 AND s."createdAt" <= $2
      GROUP BY si."productId"
    ),
    stock AS (
      SELECT "productId", SUM(quantity) AS qty FROM inventory GROUP BY "productId"
    )
    SELECT
      p.id                                    AS "productId",
      p.name                                  AS "name",
      p.sku                                   AS "sku",
      p."imageUrl"                            AS "imageUrl",
      c.name                                  AS "categoryName",
      COALESCE(sold.units_sold, 0)::text      AS "unitsSold",
      COALESCE(sold.revenue, 0)::text         AS "revenue",
      COALESCE(sold.profit, 0)::text          AS "profit",
      COALESCE(stock.qty, 0)::text            AS "currentStock"
    FROM products p
    JOIN categories c ON c.id = p."categoryId"
    ${includeUnsold ? 'LEFT JOIN' : 'JOIN'} sold ON sold."productId" = p.id
    LEFT JOIN stock ON stock."productId" = p.id
    WHERE p.status = 'ACTIVE'
    ORDER BY COALESCE(sold.${sortColumn}, 0) ${orderDirection}, p.name ASC
    LIMIT $3
    `,
    from,
    to,
    limit,
  );

  return mapPerformance(rows);
}

// ---------------------------------------------------------------------------
// Activity feeds
// ---------------------------------------------------------------------------

export async function getRecentSales(limit = 6) {
  const sales = await prisma.sale.findMany({
    where: { status: { not: 'VOIDED' } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      createdAt: true,
      channel: true,
      user: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return sales.map((s) => ({
    id: s.id,
    invoiceNumber: s.invoiceNumber,
    total: toNum(s.total),
    createdAt: s.createdAt,
    channel: s.channel,
    cashierName: s.user.name,
    itemCount: s._count.items,
  }));
}

export async function getRecentInventoryActivity(limit = 8) {
  const movements = await prisma.inventoryTransaction.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      quantity: true,
      balanceAfter: true,
      createdAt: true,
      note: true,
      product: { select: { id: true, name: true, sku: true } },
      warehouse: { select: { name: true } },
      user: { select: { name: true } },
    },
  });

  return movements.map((m) => ({
    id: m.id,
    type: m.type,
    quantity: toNum(m.quantity),
    balanceAfter: toNum(m.balanceAfter),
    createdAt: m.createdAt,
    note: m.note,
    productId: m.product.id,
    productName: m.product.name,
    sku: m.product.sku,
    warehouseName: m.warehouse.name,
    userName: m.user?.name ?? 'System',
  }));
}
