import 'server-only';

import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';

/**
 * Sales analytics.
 *
 * All aggregation happens in Postgres. The app never pulls raw sale lines into
 * memory to add them up — that would stop scaling the moment the business has
 * a real transaction history.
 *
 * Time buckets are produced by `date_trunc`, which uses the database session
 * timezone (UTC on Supabase). Range boundaries come from the app server, so
 * deploy both in the same timezone as the business for day boundaries to line
 * up with the trading day.
 */

export type Granularity = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface TimeSeriesPoint {
  bucket: string;
  label: string;
  revenue: number;
  profit: number;
  orders: number;
  units: number;
}

interface TimeSeriesRow {
  bucket: Date;
  revenue: string;
  profit: string;
  orders: number;
  units: string;
}

const BUCKET_LABEL: Record<Granularity, Intl.DateTimeFormatOptions> = {
  hour: { hour: 'numeric' },
  day: { month: 'short', day: 'numeric' },
  week: { month: 'short', day: 'numeric' },
  month: { month: 'short', year: '2-digit' },
  year: { year: 'numeric' },
};

/** Revenue/profit/orders over time, bucketed at the requested granularity. */
export async function getSalesTimeSeries(
  from: Date,
  to: Date,
  granularity: Granularity,
): Promise<TimeSeriesPoint[]> {
  // `granularity` is a closed union, so interpolating it into date_trunc is safe.
  const rows = await prisma.$queryRawUnsafe<TimeSeriesRow[]>(
    `
    SELECT
      date_trunc('${granularity}', s."createdAt")            AS "bucket",
      COALESCE(SUM(s.total), 0)::text                        AS "revenue",
      COALESCE(SUM(s.total - s."taxAmount" - s."costOfGoods"), 0)::text AS "profit",
      COUNT(*)::int                                          AS "orders",
      COALESCE(SUM((
        SELECT SUM(si.quantity) FROM sale_items si WHERE si."saleId" = s.id
      )), 0)::text                                           AS "units"
    FROM sales s
    WHERE s.status <> 'VOIDED' AND s."createdAt" >= $1 AND s."createdAt" <= $2
    GROUP BY 1
    ORDER BY 1 ASC
    `,
    from,
    to,
  );

  const formatter = new Intl.DateTimeFormat('en-PH', BUCKET_LABEL[granularity]);

  return rows.map((r) => ({
    bucket: r.bucket.toISOString(),
    label: formatter.format(r.bucket),
    revenue: Number(r.revenue),
    profit: Number(r.profit),
    orders: r.orders,
    units: Number(r.units),
  }));
}

/** Picks a sensible bucket size for a window so charts never render 900 bars. */
export function granularityForRange(from: Date, to: Date): Granularity {
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days <= 2) return 'hour';
  if (days <= 62) return 'day';
  if (days <= 210) return 'week';
  if (days <= 1200) return 'month';
  return 'year';
}

export interface BreakdownRow {
  id: string;
  label: string;
  revenue: number;
  profit: number;
  units: number;
  orders: number;
  share: number;
}

interface RawBreakdownRow {
  id: string;
  label: string;
  revenue: string;
  profit: string;
  units: string;
  orders: number;
}

/** Dimensions sales can be sliced by. Each maps to a fixed, safe join. */
export type SalesDimension = 'category' | 'employee' | 'paymentMethod' | 'channel';

const DIMENSION_SQL: Record<SalesDimension, { join: string; id: string; label: string }> = {
  category: {
    join: 'JOIN categories dim ON dim.id = p."categoryId"',
    id: 'dim.id',
    label: 'dim.name',
  },
  employee: {
    join: 'JOIN users dim ON dim.id = s."userId"',
    id: 'dim.id',
    label: 'dim.name',
  },
  paymentMethod: { join: '', id: '', label: '' },
  channel: { join: '', id: '', label: '' },
};

/**
 * Revenue/profit broken down by any supported dimension.
 * `share` is each row's percentage of the window's total revenue.
 */
export async function getSalesBreakdown(
  dimension: Exclude<SalesDimension, 'paymentMethod' | 'channel'>,
  from: Date,
  to: Date,
  limit = 10,
): Promise<BreakdownRow[]> {
  const spec = DIMENSION_SQL[dimension];
  const isLineLevel = dimension === 'category';

  const sql = isLineLevel
    ? `
      SELECT
        ${spec.id}                    AS "id",
        ${spec.label}                 AS "label",
        SUM(si.total)::text           AS "revenue",
        SUM(si.total - si."unitCost" * si.quantity)::text AS "profit",
        SUM(si.quantity)::text        AS "units",
        COUNT(DISTINCT s.id)::int     AS "orders"
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      JOIN products p ON p.id = si."productId"
      ${spec.join}
      WHERE s.status <> 'VOIDED' AND s."createdAt" >= $1 AND s."createdAt" <= $2
      GROUP BY 1, 2
      ORDER BY SUM(si.total) DESC
      LIMIT $3
      `
    : `
      SELECT
        ${spec.id}                                        AS "id",
        ${spec.label}                                     AS "label",
        SUM(s.total)::text                                AS "revenue",
        SUM(s.total - s."taxAmount" - s."costOfGoods")::text AS "profit",
        COALESCE(SUM((SELECT SUM(si.quantity) FROM sale_items si WHERE si."saleId" = s.id)), 0)::text AS "units",
        COUNT(*)::int                                     AS "orders"
      FROM sales s
      ${spec.join}
      WHERE s.status <> 'VOIDED' AND s."createdAt" >= $1 AND s."createdAt" <= $2
      GROUP BY 1, 2
      ORDER BY SUM(s.total) DESC
      LIMIT $3
      `;

  const rows = await prisma.$queryRawUnsafe<RawBreakdownRow[]>(sql, from, to, limit);
  const total = rows.reduce((acc, r) => acc + Number(r.revenue), 0);

  return rows.map((r) => {
    const revenue = Number(r.revenue);
    return {
      id: r.id,
      label: r.label,
      revenue,
      profit: Number(r.profit),
      units: Number(r.units),
      orders: r.orders,
      share: total > 0 ? Number(((revenue / total) * 100).toFixed(2)) : 0,
    };
  });
}

/** Takings split by payment rail — cash drawer vs GCash vs card. */
export async function getPaymentMethodBreakdown(from: Date, to: Date) {
  const rows = await prisma.payment.groupBy({
    by: ['method'],
    where: { direction: 'INBOUND', createdAt: { gte: from, lte: to } },
    _sum: { amount: true },
    _count: true,
  });

  const total = rows.reduce((acc, r) => acc + toNum(r._sum.amount), 0);

  return rows
    .map((r) => ({
      method: r.method,
      amount: toNum(r._sum.amount),
      count: r._count,
      share: total > 0 ? Number(((toNum(r._sum.amount) / total) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export interface HourlyPoint {
  hour: number;
  label: string;
  revenue: number;
  orders: number;
}

/**
 * Average trading pattern by hour of day. Answers "when is the shop busy?"
 * across the whole window rather than for one specific day.
 */
export async function getSalesByHour(from: Date, to: Date): Promise<HourlyPoint[]> {
  const rows = await prisma.$queryRaw<{ hour: number; revenue: string; orders: number }[]>`
    SELECT
      EXTRACT(HOUR FROM s."createdAt")::int AS "hour",
      COALESCE(SUM(s.total), 0)::text       AS "revenue",
      COUNT(*)::int                         AS "orders"
    FROM sales s
    WHERE s.status <> 'VOIDED' AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
    GROUP BY 1
    ORDER BY 1
  `;

  const byHour = new Map(rows.map((r) => [r.hour, r]));

  // Emit all 24 hours so the chart shows the quiet parts of the day too.
  return Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour);
    return {
      hour,
      label: `${((hour + 11) % 12) + 1}${hour < 12 ? 'am' : 'pm'}`,
      revenue: row ? Number(row.revenue) : 0,
      orders: row?.orders ?? 0,
    };
  });
}

export interface ReturnedProduct {
  productId: string;
  name: string;
  sku: string;
  unitsReturned: number;
  unitsSold: number;
  returnRate: number;
  refundValue: number;
}

/** Products coming back most often — a quality or mis-pricing signal. */
export async function getMostReturnedProducts(from: Date, to: Date, limit = 10): Promise<ReturnedProduct[]> {
  const rows = await prisma.$queryRaw<
    { productId: string; name: string; sku: string; unitsReturned: string; unitsSold: string; refundValue: string }[]
  >`
    WITH returned AS (
      SELECT ri."productId", SUM(ri.quantity) AS units, SUM(ri.total) AS value
      FROM return_items ri
      JOIN returns r ON r.id = ri."returnId"
      WHERE r.status = 'COMPLETED'
        AND r."createdAt" >= ${from} AND r."createdAt" <= ${to}
      GROUP BY ri."productId"
    ),
    sold AS (
      SELECT si."productId", SUM(si.quantity) AS units
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE s.status <> 'VOIDED' AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      GROUP BY si."productId"
    )
    SELECT
      p.id                              AS "productId",
      p.name                            AS "name",
      p.sku                             AS "sku",
      returned.units::text              AS "unitsReturned",
      COALESCE(sold.units, 0)::text     AS "unitsSold",
      returned.value::text              AS "refundValue"
    FROM returned
    JOIN products p ON p.id = returned."productId"
    LEFT JOIN sold ON sold."productId" = returned."productId"
    ORDER BY returned.units DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => {
    const unitsReturned = Number(r.unitsReturned);
    const unitsSold = Number(r.unitsSold);
    return {
      productId: r.productId,
      name: r.name,
      sku: r.sku,
      unitsReturned,
      unitsSold,
      returnRate: unitsSold > 0 ? Number(((unitsReturned / unitsSold) * 100).toFixed(2)) : 100,
      refundValue: Number(r.refundValue),
    };
  });
}
