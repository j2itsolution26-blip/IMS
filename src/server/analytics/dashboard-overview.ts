import 'server-only';

import { prisma } from '@/lib/prisma';
import type { DateRange } from '@/server/analytics/date-range';
import {
  getComparedSalesSummary,
  getInventorySnapshot,
  getProductPerformance,
  type ComparedSummary,
  type InventorySnapshot,
  type ProductPerformance,
} from '@/server/analytics/dashboard';
import {
  getStockLevels,
  getMovementAnalysis,
  type MovementRow,
  type StockLevelRow,
} from '@/server/analytics/inventory-analytics';
import {
  getPaymentMethodBreakdown,
  getSalesTimeSeries,
  granularityForRange,
  type TimeSeriesPoint,
} from '@/server/analytics/sales-analytics';
import { listSales, type SaleListRow } from '@/features/sales/queries';

/**
 * Everything the dashboard draws, gathered in one pass.
 *
 * The page awaits this once rather than each card fetching for itself: a
 * dozen independent round trips is what makes a dashboard feel slow, and it
 * also lets every panel agree on the same window.
 */
export interface DashboardOverview {
  summary: ComparedSummary;
  snapshot: InventorySnapshot;
  trend: TimeSeriesPoint[];
  payments: { method: string; amount: number; count: number; share: number }[];
  topProducts: ProductPerformance[];
  lowStock: StockLevelRow[];
  slowMoving: MovementRow[];
  recentSales: SaleListRow[];
  activeProducts: number;
}

/**
 * Everything at or below its low-stock level, plus everything already out.
 * Queried per status because the stock register filters on one at a time;
 * out-of-stock leads because it is the most urgent to act on.
 */
async function getNeedsAttention(limit: number): Promise<StockLevelRow[]> {
  const [out, critical, low] = await Promise.all([
    getStockLevels({ status: 'OUT_OF_STOCK', page: 1, pageSize: limit }),
    getStockLevels({ status: 'CRITICAL', page: 1, pageSize: limit }),
    getStockLevels({ status: 'LOW', page: 1, pageSize: limit }),
  ]);
  return [...out.rows, ...critical.rows, ...low.rows].slice(0, limit);
}

export async function getDashboardOverview(range: DateRange): Promise<DashboardOverview> {
  const { from, to } = range;

  const [summary, snapshot, trend, payments, topProducts, lowStock, slowMoving, sales, activeProducts] =
    await Promise.all([
      getComparedSalesSummary(range),
      getInventorySnapshot(),
      getSalesTimeSeries(from, to, granularityForRange(from, to)),
      getPaymentMethodBreakdown(from, to),
      getProductPerformance({ from, to, sort: 'units', limit: 5 }),
      getNeedsAttention(5),
      getMovementAnalysis('SLOW', 5),
      listSales({ from, to, page: 1, pageSize: 6 }),
      prisma.product.count({ where: { status: 'ACTIVE' } }),
    ]);

  return {
    summary,
    snapshot,
    trend,
    payments,
    topProducts,
    lowStock,
    slowMoving,
    recentSales: sales.rows,
    activeProducts,
  };
}
