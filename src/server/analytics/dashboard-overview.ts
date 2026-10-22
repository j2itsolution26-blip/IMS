import 'server-only';

import { getStoreContext } from '@/lib/tenant/context';
import { percentChange } from '@/lib/decimal';
import { resolveRange, type DateRange } from '@/server/analytics/date-range';
import {
  getComparedSalesSummary,
  getProductPerformance,
  type ComparedSummary,
  type PerformanceSort,
  type ProductPerformance,
} from '@/server/analytics/dashboard';
import { getStockLevels, type StockLevelRow } from '@/server/analytics/inventory-analytics';
import {
  getSalesBreakdown,
  getSalesTimeSeries,
  granularityForRange,
  type BreakdownRow,
  type Granularity,
  type TimeSeriesPoint,
} from '@/server/analytics/sales-analytics';
import { fillSeries } from '@/server/analytics/sales-overview';
import { listSales, type SaleListRow } from '@/features/sales/queries';

/**
 * Everything the Sales Dashboard draws, gathered in one pass.
 *
 * Every figure comes from the same queries the Sales and Reports pages use,
 * over the same store-time windows, so the three screens agree for any
 * period. Aggregation happens in Postgres; only totals and short lists come
 * back.
 */

/** Takings and transaction count for one window, against the one before it. */
export interface HeadlineFigure {
  revenue: number;
  transactions: number;
  previousRevenue: number;
  previousTransactions: number;
  change: number | null;
}

export interface DashboardOverview {
  /** Fixed windows for the first card row, whatever period is selected. */
  headline: { today: HeadlineFigure; week: HeadlineFigure; month: HeadlineFigure };
  /** The selected period. Profit fields are zeroed unless `canViewProfit`. */
  summary: ComparedSummary;
  trend: TimeSeriesPoint[];
  granularity: Granularity;
  categories: BreakdownRow[];
  topProducts: ProductPerformance[];
  recentSales: SaleListRow[];
  lowStock: StockLevelRow[];
  /** Every product needing attention, not just the rows listed. */
  lowStockTotal: number;
  canViewProfit: boolean;
}

export interface DashboardOptions {
  range: DateRange;
  topLimit: 5 | 10;
  /** Top sellers are ranked by revenue. */
  topSort?: Extract<PerformanceSort, 'revenue'>;
  canViewProfit: boolean;
  now?: Date;
}

interface HeadlineRow {
  todayRevenue: string;
  todayCount: number;
  yesterdayRevenue: string;
  yesterdayCount: number;
  weekRevenue: string;
  weekCount: number;
  lastWeekRevenue: string;
  lastWeekCount: number;
  monthRevenue: string;
  monthCount: number;
  lastMonthRevenue: string;
  lastMonthCount: number;
}

/**
 * Today, this week and this month against the period before each, in one
 * scan of `sales`. Revenue is the same "what the till took" figure the Sales
 * page leads with: every sale that was not voided, after discounts.
 */
async function getHeadline(now: Date): Promise<DashboardOverview['headline']> {
  const today = resolveRange('today', now);
  const week = resolveRange('week', now);
  const month = resolveRange('month', now);

  const earliest = new Date(Math.min(week.previous.from.getTime(), month.previous.from.getTime()));
  const latest = new Date(Math.max(week.to.getTime(), month.to.getTime()));

  const { db, storeId } = await getStoreContext();
  const rows = await db.$queryRaw<HeadlineRow[]>`
    SELECT
      COALESCE(SUM(s.total) FILTER (WHERE s."createdAt" BETWEEN ${today.from} AND ${today.to}), 0)::text AS "todayRevenue",
      (COUNT(*) FILTER (WHERE s."createdAt" BETWEEN ${today.from} AND ${today.to}))::int AS "todayCount",
      COALESCE(SUM(s.total) FILTER (WHERE s."createdAt" BETWEEN ${today.previous.from} AND ${today.previous.to}), 0)::text AS "yesterdayRevenue",
      (COUNT(*) FILTER (WHERE s."createdAt" BETWEEN ${today.previous.from} AND ${today.previous.to}))::int AS "yesterdayCount",
      COALESCE(SUM(s.total) FILTER (WHERE s."createdAt" BETWEEN ${week.from} AND ${week.to}), 0)::text AS "weekRevenue",
      (COUNT(*) FILTER (WHERE s."createdAt" BETWEEN ${week.from} AND ${week.to}))::int AS "weekCount",
      COALESCE(SUM(s.total) FILTER (WHERE s."createdAt" BETWEEN ${week.previous.from} AND ${week.previous.to}), 0)::text AS "lastWeekRevenue",
      (COUNT(*) FILTER (WHERE s."createdAt" BETWEEN ${week.previous.from} AND ${week.previous.to}))::int AS "lastWeekCount",
      COALESCE(SUM(s.total) FILTER (WHERE s."createdAt" BETWEEN ${month.from} AND ${month.to}), 0)::text AS "monthRevenue",
      (COUNT(*) FILTER (WHERE s."createdAt" BETWEEN ${month.from} AND ${month.to}))::int AS "monthCount",
      COALESCE(SUM(s.total) FILTER (WHERE s."createdAt" BETWEEN ${month.previous.from} AND ${month.previous.to}), 0)::text AS "lastMonthRevenue",
      (COUNT(*) FILTER (WHERE s."createdAt" BETWEEN ${month.previous.from} AND ${month.previous.to}))::int AS "lastMonthCount"
    FROM sales s
    WHERE s."storeId" = ${storeId}
      AND s.status <> 'VOIDED'
      AND s."createdAt" >= ${earliest}
      AND s."createdAt" <= ${latest}
  `;
  const row = rows[0];

  const figure = (revenue: string, count: number, prevRevenue: string, prevCount: number): HeadlineFigure => ({
    revenue: Number(revenue),
    transactions: count,
    previousRevenue: Number(prevRevenue),
    previousTransactions: prevCount,
    change: percentChange(revenue, prevRevenue),
  });

  if (!row) {
    const empty = figure('0', 0, '0', 0);
    return { today: empty, week: empty, month: empty };
  }

  return {
    today: figure(row.todayRevenue, row.todayCount, row.yesterdayRevenue, row.yesterdayCount),
    week: figure(row.weekRevenue, row.weekCount, row.lastWeekRevenue, row.lastWeekCount),
    month: figure(row.monthRevenue, row.monthCount, row.lastMonthRevenue, row.lastMonthCount),
  };
}

/**
 * Out of stock first, then critical, then low — the order to act on them.
 * The totals come back with the rows, so the count costs nothing extra.
 */
async function getNeedsAttention(limit: number): Promise<{ rows: StockLevelRow[]; total: number }> {
  const [out, critical, low] = await Promise.all([
    getStockLevels({ status: 'OUT_OF_STOCK', page: 1, pageSize: limit }),
    getStockLevels({ status: 'CRITICAL', page: 1, pageSize: limit }),
    getStockLevels({ status: 'LOW', page: 1, pageSize: limit }),
  ]);
  return {
    rows: [...out.rows, ...critical.rows, ...low.rows].slice(0, limit),
    total: out.total + critical.total + low.total,
  };
}

/**
 * Removes cost and profit before anything leaves the server, so a staff
 * account without access cannot read them from the page payload either.
 */
function redactProfit(data: DashboardOverview): DashboardOverview {
  const hide = (summary: ComparedSummary['current']): ComparedSummary['current'] => ({
    ...summary,
    costOfGoods: 0,
    returnedCost: 0,
    netCostOfGoods: 0,
    grossProfit: 0,
    marginPercent: 0,
    netProfit: 0,
    zeroCostLines: 0,
  });

  return {
    ...data,
    summary: {
      current: hide(data.summary.current),
      previous: hide(data.summary.previous),
      change: { ...data.summary.change, netProfit: null },
    },
    trend: data.trend.map((point) => ({ ...point, profit: 0 })),
    categories: data.categories.map((row) => ({ ...row, profit: 0 })),
    topProducts: data.topProducts.map((row) => ({ ...row, profit: 0, marginPercent: 0 })),
    recentSales: data.recentSales.map((row) => ({ ...row, profit: 0 })),
  };
}

const LOW_STOCK_ROWS = 6;
const RECENT_SALES_ROWS = 10;
/** Every category is fetched so the shares add up to 100%. */
const MAX_CATEGORIES = 100;

export async function getDashboardOverview(options: DashboardOptions): Promise<DashboardOverview> {
  const { range, topLimit, topSort = 'revenue', canViewProfit, now = new Date() } = options;
  const { from, to } = range;
  const granularity = granularityForRange(from, to);

  const [headline, summary, trend, categories, topProducts, sales, lowStock] = await Promise.all([
    getHeadline(now),
    getComparedSalesSummary(range),
    getSalesTimeSeries(from, to, granularity),
    getSalesBreakdown('category', from, to, MAX_CATEGORIES),
    getProductPerformance({ from, to, sort: topSort, limit: topLimit }),
    listSales({ from, to, excludeVoided: true, page: 1, pageSize: RECENT_SALES_ROWS }),
    getNeedsAttention(LOW_STOCK_ROWS),
  ]);

  const data: DashboardOverview = {
    headline,
    summary,
    trend: fillSeries(trend, from, to, granularity),
    granularity,
    categories,
    topProducts,
    recentSales: sales.rows,
    lowStock: lowStock.rows,
    lowStockTotal: lowStock.total,
    canViewProfit,
  };

  return canViewProfit ? data : redactProfit(data);
}
