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
  expenses: number;
  /** Gross profit less returns and operating expenses. */
  netProfit: number;
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
  const [aggregate, returns, expenses] = await Promise.all([
    salesAggregate(from, to),
    prisma.return.aggregate({
      where: { type: 'SALE_RETURN', status: 'COMPLETED', createdAt: { gte: from, lte: to } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.expense.aggregate({
      where: { incurredAt: { gte: from, lte: to } },
      _sum: { amount: true },
    }),
  ]);

  const revenue = Number(aggregate.revenue);
  const netRevenue = Number(aggregate.netRevenue);
  const costOfGoods = Number(aggregate.costOfGoods);
  const grossProfit = netRevenue - costOfGoods;
  const returnsTotal = toNum(returns._sum.total);
  const expenseTotal = toNum(expenses._sum.amount);
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
    expenses: expenseTotal,
    netProfit: grossProfit - returnsTotal - expenseTotal,
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
        SUM(si.total - (si.total * si."taxRate" / (100 + si."taxRate")) - si."unitCost" * si.quantity) AS profit
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
// Reorder suggestions
// ---------------------------------------------------------------------------

export interface ReorderSuggestion {
  productId: string;
  name: string;
  sku: string;
  supplierName: string | null;
  supplierId: string | null;
  available: number;
  reorderLevel: number;
  maxStock: number;
  suggestedQuantity: number;
  /** Average units sold per day over the forecast window. */
  dailyVelocity: number;
  /** Days of cover remaining at current velocity; null when nothing is selling. */
  daysUntilStockout: number | null;
  estimatedCost: number;
}

interface ReorderRow {
  productId: string;
  name: string;
  sku: string;
  supplierId: string | null;
  supplierName: string | null;
  available: string;
  reorderLevel: string;
  maxStock: string;
  reorderQty: string;
  costPrice: string;
  unitsSoldInWindow: string;
}

/**
 * Products at or below their reorder level, with a suggested order quantity.
 *
 * The suggestion is, in order of preference: the product's configured reorder
 * quantity; else enough to reach max stock; else enough to reach twice the
 * reorder level. Velocity comes from actual sales in the forecast window.
 */
export async function getReorderSuggestions(limit = 10): Promise<ReorderSuggestion[]> {
  const settings = await getSettings();
  const windowDays = readNumber(settings, 'inventory.forecastWindowDays') || 30;

  const rows = await prisma.$queryRaw<ReorderRow[]>`
    WITH stock AS (
      SELECT "productId", SUM(quantity) AS qty, SUM(reserved) AS reserved
      FROM inventory GROUP BY "productId"
    ),
    velocity AS (
      SELECT si."productId", SUM(si.quantity) AS units
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s.status <> 'VOIDED'
        AND s."createdAt" >= now() - (${windowDays} || ' days')::interval
      GROUP BY si."productId"
    )
    SELECT
      p.id                                                   AS "productId",
      p.name                                                 AS "name",
      p.sku                                                  AS "sku",
      p."supplierId"                                         AS "supplierId",
      sup.name                                               AS "supplierName",
      COALESCE(stock.qty - stock.reserved, 0)::text          AS "available",
      COALESCE(NULLIF(p."reorderLevel", 0), p."minStock")::text AS "reorderLevel",
      p."maxStock"::text                                     AS "maxStock",
      p."reorderQty"::text                                   AS "reorderQty",
      p."costPrice"::text                                    AS "costPrice",
      COALESCE(velocity.units, 0)::text                      AS "unitsSoldInWindow"
    FROM products p
    LEFT JOIN stock ON stock."productId" = p.id
    LEFT JOIN velocity ON velocity."productId" = p.id
    LEFT JOIN suppliers sup ON sup.id = p."supplierId"
    WHERE p.status = 'ACTIVE'
      AND p."isTrackable" = true
      AND COALESCE(NULLIF(p."reorderLevel", 0), p."minStock") > 0
      AND COALESCE(stock.qty - stock.reserved, 0) <= COALESCE(NULLIF(p."reorderLevel", 0), p."minStock")
    ORDER BY
      (COALESCE(stock.qty - stock.reserved, 0) /
        NULLIF(COALESCE(NULLIF(p."reorderLevel", 0), p."minStock"), 0)) ASC,
      COALESCE(velocity.units, 0) DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => {
    const available = Number(r.available);
    const reorderLevel = Number(r.reorderLevel);
    const maxStock = Number(r.maxStock);
    const reorderQty = Number(r.reorderQty);
    const costPrice = Number(r.costPrice);
    const dailyVelocity = Number(r.unitsSoldInWindow) / windowDays;

    const suggested =
      reorderQty > 0
        ? reorderQty
        : maxStock > 0
          ? Math.max(0, maxStock - available)
          : Math.max(0, reorderLevel * 2 - available);

    return {
      productId: r.productId,
      name: r.name,
      sku: r.sku,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      available,
      reorderLevel,
      maxStock,
      suggestedQuantity: Math.ceil(suggested),
      dailyVelocity: Number(dailyVelocity.toFixed(3)),
      daysUntilStockout: dailyVelocity > 0 ? Math.floor(available / dailyVelocity) : null,
      estimatedCost: Number((Math.ceil(suggested) * costPrice).toFixed(2)),
    };
  });
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
      customer: { select: { name: true } },
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
    customerName: s.customer?.name ?? 'Walk-in',
    cashierName: s.user.name,
    itemCount: s._count.items,
  }));
}

export async function getRecentPurchases(limit = 6) {
  const orders = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      orderNumber: true,
      total: true,
      status: true,
      createdAt: true,
      expectedDate: true,
      supplier: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    total: toNum(o.total),
    status: o.status,
    createdAt: o.createdAt,
    expectedDate: o.expectedDate,
    supplierName: o.supplier.name,
    itemCount: o._count.items,
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

/** Suppliers with orders that are past their expected delivery date. */
export async function getSupplierAlerts(limit = 5) {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
      expectedDate: { lt: new Date() },
    },
    orderBy: { expectedDate: 'asc' },
    take: limit,
    select: {
      id: true,
      orderNumber: true,
      expectedDate: true,
      status: true,
      total: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    supplierId: o.supplier.id,
    supplierName: o.supplier.name,
    expectedDate: o.expectedDate!,
    daysLate: Math.max(0, Math.floor((Date.now() - o.expectedDate!.getTime()) / 86_400_000)),
    status: o.status,
    total: toNum(o.total),
  }));
}
