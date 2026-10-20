import 'server-only';

import {
  STORE_TIME_ZONE,
  eachStoreBucket,
  endOfStoreMonth,
  startOfStoreMonth,
} from '@/lib/store-time';
import type { DateRange } from '@/server/analytics/date-range';
import { resolveRange } from '@/server/analytics/date-range';
import {
  getComparedSalesSummary,
  getProductPerformance,
  type ComparedSummary,
  type ProductPerformance,
} from '@/server/analytics/dashboard';
import {
  getPaymentMethodBreakdown,
  getSalesByHour,
  getSalesBreakdown,
  getSalesTimeSeries,
  granularityForRange,
  formatBucketLabel,
  type BreakdownRow,
  type Granularity,
  type HourlyPoint,
  type TimeSeriesPoint,
} from '@/server/analytics/sales-analytics';

/**
 * Everything the sales screen draws, gathered in one pass.
 *
 * Each figure already had a query behind it; what was missing was a single
 * place to ask for them together, so the page is one await rather than a
 * dozen and every panel reports the same window.
 */
export interface SalesOverview {
  /** The selected window, against the equivalent window before it. */
  summary: ComparedSummary;
  /** The main chart: hourly for a day, daily for a month, monthly for a year. */
  trend: TimeSeriesPoint[];
  granularity: Granularity;
  /** This calendar month, day by day, newest first. */
  daily: TimeSeriesPoint[];
  /** The last six calendar months, for the bar chart. */
  monthly: TimeSeriesPoint[];
  payments: { method: string; amount: number; count: number; share: number }[];
  categories: BreakdownRow[];
  hourly: HourlyPoint[];
  topProducts: ProductPerformance[];
  /** This calendar month against last, regardless of the selected window. */
  monthComparison: ComparedSummary;
  monthLabels: { current: string; previous: string };
}

const MONTHS_OF_HISTORY = 6;

/**
 * Zeroes every cost and profit figure in an overview before it is rendered,
 * so the Sales page shows a cashier the takings without the owner's margins.
 */
export function redactSalesOverviewProfit(overview: SalesOverview): SalesOverview {
  const hide = (summary: ComparedSummary): ComparedSummary => {
    const clear = (row: ComparedSummary['current']): ComparedSummary['current'] => ({
      ...row,
      costOfGoods: 0,
      returnedCost: 0,
      netCostOfGoods: 0,
      grossProfit: 0,
      marginPercent: 0,
      netProfit: 0,
      zeroCostLines: 0,
    });
    return {
      current: clear(summary.current),
      previous: clear(summary.previous),
      change: { ...summary.change, netProfit: null },
    };
  };
  const noProfit = <T extends { profit: number }>(rows: T[]): T[] => rows.map((row) => ({ ...row, profit: 0 }));

  return {
    ...overview,
    summary: hide(overview.summary),
    monthComparison: hide(overview.monthComparison),
    trend: noProfit(overview.trend),
    daily: noProfit(overview.daily),
    monthly: noProfit(overview.monthly),
    categories: noProfit(overview.categories),
    topProducts: overview.topProducts.map((row) => ({ ...row, profit: 0, marginPercent: 0 })),
  };
}

/**
 * Puts the quiet buckets back.
 *
 * The time-series query groups what exists, so a month with no sales simply
 * is not returned — which left the monthly chart showing a single bar and the
 * trend line sloping smoothly between two sales a fortnight apart, implying
 * growth that never happened. Slots and queried buckets are both store-time
 * bucket starts, so they are matched by exact timestamp.
 */
export function fillSeries(
  points: TimeSeriesPoint[],
  from: Date,
  to: Date,
  granularity: Granularity,
): TimeSeriesPoint[] {
  const slots = eachStoreBucket(from, to, granularity);
  if (slots.length === 0) return points;

  const byBucket = new Map(points.map((point) => [new Date(point.bucket).getTime(), point]));

  return slots.map(
    (slot) =>
      byBucket.get(slot.getTime()) ?? {
        bucket: slot.toISOString(),
        label: formatBucketLabel(slot, granularity),
        revenue: 0,
        profit: 0,
        orders: 0,
        units: 0,
      },
  );
}

export async function getSalesOverview(range: DateRange, now: Date = new Date()): Promise<SalesOverview> {
  const { from, to } = range;
  const granularity = granularityForRange(from, to);

  const thisMonth = resolveRange('month', now);
  const monthlyFrom = startOfStoreMonth(now, -(MONTHS_OF_HISTORY - 1));
  const monthlyTo = endOfStoreMonth(now);

  const [summary, trend, daily, monthly, payments, categories, hourly, topProducts, monthComparison] =
    await Promise.all([
      getComparedSalesSummary(range),
      getSalesTimeSeries(from, to, granularity),
      getSalesTimeSeries(thisMonth.from, thisMonth.to, 'day'),
      getSalesTimeSeries(monthlyFrom, monthlyTo, 'month'),
      getPaymentMethodBreakdown(from, to),
      getSalesBreakdown('category', from, to, 6),
      getSalesByHour(from, to),
      getProductPerformance({ from, to, sort: 'units', limit: 5 }),
      getComparedSalesSummary(thisMonth),
    ]);

  const monthName = (date: Date) =>
    date.toLocaleDateString('en-PH', { month: 'long', timeZone: STORE_TIME_ZONE });

  return {
    summary,
    trend: fillSeries(trend, from, to, granularity),
    granularity,
    // Newest day first — an owner checks today before last Tuesday.
    daily: [...daily].reverse(),
    monthly: fillSeries(monthly, monthlyFrom, monthlyTo, 'month'),
    payments,
    categories,
    hourly,
    topProducts,
    monthComparison,
    monthLabels: { current: monthName(now), previous: monthName(startOfStoreMonth(now, -1)) },
  };
}
