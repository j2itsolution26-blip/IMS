import 'server-only';

import { prisma } from '@/lib/prisma';
import { getSettings, readNumber } from '@/server/services/settings-service';

/**
 * Inventory analytics: turnover, ageing, movement classification, and supplier
 * performance. Movement classification is driven by actual sales in a window,
 * not by a flag someone has to remember to set on the product.
 */

export type StockStatus = 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'HEALTHY' | 'OVERSTOCK';

/**
 * Where one product's stock actually sits. An aggregate row says how much
 * exists; this says whether any of it is somewhere a till can sell it from.
 */
export interface WarehouseStockRow {
  warehouseId: string;
  warehouseName: string;
  /** Stock in a deactivated warehouse counts toward totals but cannot be sold. */
  isActive: boolean;
  quantity: number;
  reserved: number;
}

export interface StockLevelRow {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  categoryName: string;
  warehouseName: string | null;
  onHand: number;
  reserved: number;
  available: number;
  reorderLevel: number;
  minStock: number;
  maxStock: number;
  costPrice: number;
  sellingPrice: number;
  stockValue: number;
  status: StockStatus;
  lastSoldAt: Date | null;
  lastReceivedAt: Date | null;
  /** Per-warehouse split behind `onHand`, holdings only. */
  warehouseBreakdown: WarehouseStockRow[];
}

interface StockLevelSqlRow {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  categoryName: string;
  warehouseName: string | null;
  onHand: string;
  reserved: string;
  reorderLevel: string;
  minStock: string;
  maxStock: string;
  costPrice: string;
  sellingPrice: string;
  lastSoldAt: Date | null;
  lastReceivedAt: Date | null;
  warehouseBreakdown: {
    warehouseId: string;
    warehouseName: string;
    isActive: boolean;
    quantity: string;
    reserved: string;
  }[];
}

function classify(available: number, threshold: number, maxStock: number, criticalRatio: number): StockStatus {
  if (available <= 0) return 'OUT_OF_STOCK';
  if (threshold > 0 && available <= threshold * criticalRatio) return 'CRITICAL';
  if (threshold > 0 && available <= threshold) return 'LOW';
  if (maxStock > 0 && available > maxStock) return 'OVERSTOCK';
  return 'HEALTHY';
}

export interface StockLevelQuery {
  warehouseId?: string | null;
  categoryId?: string | null;
  search?: string | null;
  status?: StockStatus | 'ALL';
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * The stock register. Aggregates across warehouses unless one is selected.
 *
 * Status filtering happens in SQL so pagination counts stay correct — filtering
 * after paging would show "12 low stock" while listing 3.
 */
export async function getStockLevels(query: StockLevelQuery = {}): Promise<Paginated<StockLevelRow>> {
  const settings = await getSettings();
  const criticalRatio = readNumber(settings, 'inventory.criticalStockRatio') || 0.5;

  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, query.pageSize ?? 25));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [`p.status = 'ACTIVE'`, `p."isTrackable" = true`];
  const params: unknown[] = [];

  // Scoping to a warehouse belongs in the JOIN, not the WHERE. In the WHERE it
  // silently turns the LEFT JOIN below into an inner one, so a product holding
  // no stock at that location vanishes from the register instead of reporting
  // zero — which reads as "no such product" when it means "none of it here".
  let inventoryJoin = `LEFT JOIN inventory i ON i."productId" = p.id`;
  if (query.warehouseId) {
    params.push(query.warehouseId);
    inventoryJoin += ` AND i."warehouseId" = $${params.length}`;
  }

  if (query.categoryId) {
    params.push(query.categoryId);
    conditions.push(`p."categoryId" = $${params.length}`);
  }
  if (query.search?.trim()) {
    params.push(`%${query.search.trim()}%`);
    const idx = params.length;
    conditions.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx} OR p.barcode ILIKE $${idx})`);
  }

  const statusFilter =
    query.status && query.status !== 'ALL'
      ? {
          OUT_OF_STOCK: `available <= 0`,
          CRITICAL: `available > 0 AND threshold > 0 AND available <= threshold * ${criticalRatio}`,
          LOW: `available > 0 AND threshold > 0 AND available > threshold * ${criticalRatio} AND available <= threshold`,
          HEALTHY: `available > 0 AND (threshold <= 0 OR available > threshold) AND (max_stock <= 0 OR available <= max_stock)`,
          OVERSTOCK: `max_stock > 0 AND available > max_stock`,
        }[query.status]
      : null;

  // Grouping key depends on whether a specific warehouse was chosen: one row
  // per product overall, or one row per product per warehouse.
  const base = `
    WITH agg AS (
      SELECT
        p.id                                                    AS "productId",
        p.name                                                  AS "name",
        p.sku                                                   AS "sku",
        p."imageUrl"                                            AS "imageUrl",
        c.name                                                  AS "categoryName",
        ${query.warehouseId ? 'MAX(w.name)' : 'NULL::text'}     AS "warehouseName",
        COALESCE(SUM(i.quantity), 0)                            AS on_hand,
        COALESCE(SUM(i.reserved), 0)                            AS reserved,
        COALESCE(SUM(i.quantity), 0) - COALESCE(SUM(i.reserved), 0) AS available,
        COALESCE(
          json_agg(
            json_build_object(
              'warehouseId',   w.id,
              'warehouseName', w.name,
              'isActive',      w."isActive",
              'quantity',      i.quantity::text,
              'reserved',      i.reserved::text
            ) ORDER BY w.name
          ) FILTER (WHERE w.id IS NOT NULL AND i.quantity <> 0),
          '[]'::json
        )                                                       AS warehouse_breakdown,
        COALESCE(NULLIF(p."reorderLevel", 0), p."minStock")     AS threshold,
        p."reorderLevel"                                        AS reorder_level,
        p."minStock"                                            AS min_stock,
        p."maxStock"                                            AS max_stock,
        p."costPrice"                                           AS cost_price,
        p."sellingPrice"                                        AS selling_price,
        MAX(i."lastSoldAt")                                     AS last_sold_at,
        MAX(i."lastReceivedAt")                                 AS last_received_at
      FROM products p
      JOIN categories c ON c.id = p."categoryId"
      ${inventoryJoin}
      LEFT JOIN warehouses w ON w.id = i."warehouseId"
      WHERE ${conditions.join(' AND ')}
      GROUP BY p.id, c.name
    )
    SELECT * FROM agg
    ${statusFilter ? `WHERE ${statusFilter}` : ''}
  `;

  const countRows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    `SELECT COUNT(*)::int AS count FROM (${base}) AS filtered`,
    ...params,
  );

  const rows = await prisma.$queryRawUnsafe<StockLevelSqlRow[]>(
    `
    SELECT
      "productId", "name", "sku", "imageUrl", "categoryName", "warehouseName",
      on_hand::text          AS "onHand",
      reserved::text         AS "reserved",
      reorder_level::text    AS "reorderLevel",
      min_stock::text        AS "minStock",
      max_stock::text        AS "maxStock",
      cost_price::text       AS "costPrice",
      selling_price::text    AS "sellingPrice",
      last_sold_at           AS "lastSoldAt",
      last_received_at       AS "lastReceivedAt",
      warehouse_breakdown    AS "warehouseBreakdown"
    FROM (${base}) AS filtered
    ORDER BY available ASC, "name" ASC
    LIMIT ${pageSize} OFFSET ${offset}
    `,
    ...params,
  );

  const total = countRows[0]?.count ?? 0;

  return {
    rows: rows.map((r) => {
      const onHand = Number(r.onHand);
      const reserved = Number(r.reserved);
      const available = onHand - reserved;
      const reorderLevel = Number(r.reorderLevel);
      const minStock = Number(r.minStock);
      const maxStock = Number(r.maxStock);
      const costPrice = Number(r.costPrice);
      const threshold = reorderLevel > 0 ? reorderLevel : minStock;

      return {
        productId: r.productId,
        name: r.name,
        sku: r.sku,
        imageUrl: r.imageUrl,
        categoryName: r.categoryName,
        warehouseName: r.warehouseName,
        onHand,
        reserved,
        available,
        reorderLevel,
        minStock,
        maxStock,
        costPrice,
        sellingPrice: Number(r.sellingPrice),
        stockValue: Number((onHand * costPrice).toFixed(2)),
        status: classify(available, threshold, maxStock, criticalRatio),
        lastSoldAt: r.lastSoldAt,
        lastReceivedAt: r.lastReceivedAt,
        warehouseBreakdown: (r.warehouseBreakdown ?? []).map((w) => ({
          warehouseId: w.warehouseId,
          warehouseName: w.warehouseName,
          isActive: w.isActive,
          quantity: Number(w.quantity),
          reserved: Number(w.reserved),
        })),
      };
    }),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface TurnoverResult {
  costOfGoodsSold: number;
  averageInventoryValue: number;
  /** COGS ÷ average inventory value. Higher means stock is converting faster. */
  turnoverRatio: number;
  /** 365 ÷ turnover — how long an average unit sits before it sells. */
  daysOnHand: number | null;
}

/**
 * Inventory turnover for a window.
 *
 * Average inventory value is approximated from the opening and closing
 * positions reconstructed from the ledger, which is the standard two-point
 * average used in retail accounting.
 */
export async function getInventoryTurnover(from: Date, to: Date): Promise<TurnoverResult> {
  const rows = await prisma.$queryRaw<{ cogs: string; opening: string; closing: string }[]>`
    WITH cogs AS (
      SELECT COALESCE(SUM(s."costOfGoods"), 0) AS value
      FROM sales s
      WHERE s.status <> 'VOIDED' AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
    ),
    closing AS (
      SELECT COALESCE(SUM(i.quantity * p."costPrice"), 0) AS value
      FROM inventory i JOIN products p ON p.id = i."productId"
    ),
    -- Rewind the ledger to reconstruct the position at the start of the window.
    movement_since AS (
      SELECT COALESCE(SUM(it.quantity * it."unitCost"), 0) AS value
      FROM inventory_transactions it
      WHERE it."createdAt" >= ${from}
    )
    SELECT
      cogs.value::text                                        AS "cogs",
      (closing.value - movement_since.value)::text            AS "opening",
      closing.value::text                                     AS "closing"
    FROM cogs, closing, movement_since
  `;

  const row = rows[0];
  const costOfGoodsSold = Number(row?.cogs ?? 0);
  const opening = Math.max(0, Number(row?.opening ?? 0));
  const closing = Number(row?.closing ?? 0);
  const averageInventoryValue = (opening + closing) / 2;

  const turnoverRatio = averageInventoryValue > 0 ? costOfGoodsSold / averageInventoryValue : 0;

  return {
    costOfGoodsSold,
    averageInventoryValue,
    turnoverRatio: Number(turnoverRatio.toFixed(2)),
    daysOnHand: turnoverRatio > 0 ? Number((365 / turnoverRatio).toFixed(0)) : null,
  };
}

export interface AgingBucket {
  label: string;
  products: number;
  units: number;
  value: number;
}

/**
 * How long current stock has been sitting, bucketed by days since last receipt.
 * Value concentrated in the older buckets is capital that is not working.
 */
export async function getInventoryAging(): Promise<AgingBucket[]> {
  const rows = await prisma.$queryRaw<{ bucket: string; products: number; units: string; value: string }[]>`
    WITH aged AS (
      SELECT
        p.id,
        SUM(i.quantity) AS units,
        SUM(i.quantity * p."costPrice") AS value,
        COALESCE(
          EXTRACT(DAY FROM now() - MAX(i."lastReceivedAt")),
          EXTRACT(DAY FROM now() - MIN(p."createdAt"))
        ) AS age_days
      FROM products p
      JOIN inventory i ON i."productId" = p.id
      WHERE p.status = 'ACTIVE' AND p."isTrackable" = true
      GROUP BY p.id
      HAVING SUM(i.quantity) > 0
    )
    SELECT
      CASE
        WHEN age_days <= 30  THEN '0-30 days'
        WHEN age_days <= 60  THEN '31-60 days'
        WHEN age_days <= 90  THEN '61-90 days'
        WHEN age_days <= 180 THEN '91-180 days'
        ELSE '180+ days'
      END               AS "bucket",
      COUNT(*)::int     AS "products",
      SUM(units)::text  AS "units",
      SUM(value)::text  AS "value"
    FROM aged
    GROUP BY 1
  `;

  const order = ['0-30 days', '31-60 days', '61-90 days', '91-180 days', '180+ days'];
  const byBucket = new Map(rows.map((r) => [r.bucket, r]));

  // Always return every bucket so the chart keeps a stable shape.
  return order.map((label) => {
    const row = byBucket.get(label);
    return {
      label,
      products: row?.products ?? 0,
      units: row ? Number(row.units) : 0,
      value: row ? Number(row.value) : 0,
    };
  });
}

export interface MovementRow {
  productId: string;
  name: string;
  sku: string;
  onHand: number;
  stockValue: number;
  unitsSold: number;
  dailyVelocity: number;
  daysSinceLastSale: number | null;
}

export type MovementClass = 'FAST' | 'SLOW' | 'DEAD';

/**
 * Classifies stocked products by how quickly they are selling.
 *
 * FAST: top movers by units in the window.
 * SLOW: sold something, but nothing recently (past the slow-moving threshold).
 * DEAD: holding stock and sold nothing at all within the dead-stock threshold.
 */
export async function getMovementAnalysis(kind: MovementClass, limit = 20): Promise<MovementRow[]> {
  const settings = await getSettings();
  const slowDays = readNumber(settings, 'inventory.slowMovingDays') || 14;
  const deadDays = readNumber(settings, 'inventory.deadStockDays') || 30;
  const windowDays = readNumber(settings, 'inventory.forecastWindowDays') || 30;

  const thresholdDays = kind === 'DEAD' ? deadDays : slowDays;

  const rows = await prisma.$queryRaw<
    {
      productId: string;
      name: string;
      sku: string;
      onHand: string;
      stockValue: string;
      unitsSold: string;
      daysSinceLastSale: number | null;
    }[]
  >`
    WITH stock AS (
      SELECT
        p.id, p.name, p.sku, p."costPrice",
        SUM(i.quantity) AS on_hand
      FROM products p
      JOIN inventory i ON i."productId" = p.id
      WHERE p.status = 'ACTIVE' AND p."isTrackable" = true
      GROUP BY p.id
      HAVING SUM(i.quantity) > 0
    ),
    sold AS (
      SELECT
        si."productId",
        SUM(si.quantity) FILTER (
          WHERE s."createdAt" >= now() - (${windowDays} || ' days')::interval
        ) AS units_in_window,
        MAX(s."createdAt") AS last_sale
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s.status <> 'VOIDED'
      GROUP BY si."productId"
    )
    SELECT
      stock.id                                              AS "productId",
      stock.name                                            AS "name",
      stock.sku                                             AS "sku",
      stock.on_hand::text                                   AS "onHand",
      (stock.on_hand * stock."costPrice")::text             AS "stockValue",
      COALESCE(sold.units_in_window, 0)::text               AS "unitsSold",
      CASE WHEN sold.last_sale IS NULL THEN NULL
           ELSE EXTRACT(DAY FROM now() - sold.last_sale)::int
      END                                                   AS "daysSinceLastSale"
    FROM stock
    LEFT JOIN sold ON sold."productId" = stock.id
    WHERE
      CASE
        WHEN ${kind} = 'FAST'
          THEN COALESCE(sold.units_in_window, 0) > 0
        WHEN ${kind} = 'DEAD'
          THEN sold.last_sale IS NULL
            OR sold.last_sale < now() - (${thresholdDays} || ' days')::interval
        ELSE
          sold.last_sale IS NOT NULL
          AND sold.last_sale < now() - (${thresholdDays} || ' days')::interval
          AND sold.last_sale >= now() - (${deadDays} || ' days')::interval
      END
    ORDER BY
      CASE WHEN ${kind} = 'FAST' THEN COALESCE(sold.units_in_window, 0) END DESC NULLS LAST,
      CASE WHEN ${kind} <> 'FAST' THEN stock.on_hand * stock."costPrice" END DESC NULLS LAST
    LIMIT ${limit}
  `;

  return rows.map((r) => {
    const unitsSold = Number(r.unitsSold);
    return {
      productId: r.productId,
      name: r.name,
      sku: r.sku,
      onHand: Number(r.onHand),
      stockValue: Number(Number(r.stockValue).toFixed(2)),
      unitsSold,
      dailyVelocity: Number((unitsSold / windowDays).toFixed(3)),
      daysSinceLastSale: r.daysSinceLastSale,
    };
  });
}

export interface SupplierPerformanceRow {
  supplierId: string;
  name: string;
  orders: number;
  receivedOrders: number;
  totalSpend: number;
  onTimeRate: number;
  averageLeadTimeDays: number | null;
  outstandingBalance: number;
}

/** Supplier scorecard: spend, reliability, and what is still owed. */
export async function getSupplierPerformance(from: Date, to: Date, limit = 20): Promise<SupplierPerformanceRow[]> {
  const rows = await prisma.$queryRaw<
    {
      supplierId: string;
      name: string;
      orders: number;
      receivedOrders: number;
      totalSpend: string;
      onTime: number;
      avgLeadTime: string | null;
      outstanding: string;
    }[]
  >`
    SELECT
      sup.id                                                        AS "supplierId",
      sup.name                                                      AS "name",
      COUNT(po.id)::int                                             AS "orders",
      COUNT(po.id) FILTER (WHERE po.status = 'RECEIVED')::int        AS "receivedOrders",
      COALESCE(SUM(po.total), 0)::text                              AS "totalSpend",
      COUNT(po.id) FILTER (
        WHERE po."receivedDate" IS NOT NULL
          AND (po."expectedDate" IS NULL OR po."receivedDate" <= po."expectedDate")
      )::int                                                        AS "onTime",
      AVG(
        EXTRACT(EPOCH FROM (po."receivedDate" - po."createdAt")) / 86400
      ) FILTER (WHERE po."receivedDate" IS NOT NULL)::text           AS "avgLeadTime",
      COALESCE(SUM(po.total - po."paidAmount") FILTER (WHERE po.status <> 'CANCELLED'), 0)::text AS "outstanding"
    FROM suppliers sup
    JOIN purchase_orders po ON po."supplierId" = sup.id
    WHERE po."createdAt" >= ${from} AND po."createdAt" <= ${to}
    GROUP BY sup.id, sup.name
    ORDER BY SUM(po.total) DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    supplierId: r.supplierId,
    name: r.name,
    orders: r.orders,
    receivedOrders: r.receivedOrders,
    totalSpend: Number(r.totalSpend),
    onTimeRate: r.receivedOrders > 0 ? Number(((r.onTime / r.receivedOrders) * 100).toFixed(1)) : 0,
    averageLeadTimeDays: r.avgLeadTime != null ? Number(Number(r.avgLeadTime).toFixed(1)) : null,
    outstandingBalance: Number(r.outstanding),
  }));
}

export interface PurchaseTrendPoint {
  bucket: string;
  label: string;
  orders: number;
  spend: number;
  unitsReceived: number;
}

export async function getPurchaseTrends(from: Date, to: Date, granularity: 'day' | 'week' | 'month' = 'month') {
  const rows = await prisma.$queryRawUnsafe<
    { bucket: Date; orders: number; spend: string; units: string }[]
  >(
    `
    SELECT
      date_trunc('${granularity}', po."createdAt")   AS "bucket",
      COUNT(*)::int                                  AS "orders",
      COALESCE(SUM(po.total), 0)::text               AS "spend",
      COALESCE(SUM((
        SELECT SUM(pi."receivedQuantity") FROM purchase_items pi WHERE pi."purchaseOrderId" = po.id
      )), 0)::text                                   AS "units"
    FROM purchase_orders po
    WHERE po.status <> 'CANCELLED' AND po."createdAt" >= $1 AND po."createdAt" <= $2
    GROUP BY 1
    ORDER BY 1
    `,
    from,
    to,
  );

  const formatter = new Intl.DateTimeFormat('en-PH',
    granularity === 'month' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' },
  );

  return rows.map((r) => ({
    bucket: r.bucket.toISOString(),
    label: formatter.format(r.bucket),
    orders: r.orders,
    spend: Number(r.spend),
    unitsReceived: Number(r.units),
  }));
}
