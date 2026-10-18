/**
 * Sales arithmetic, kept free of the database and of `server-only` so the
 * definitions can be unit tested on their own. The queries that feed it live
 * in `dashboard.ts`.
 */

/**
 * The one set of money definitions every screen reports.
 *
 * A qualifying sale is any sale not VOIDED. A refunded sale still counts as
 * the sale it was; its refund is netted off separately, in the period the
 * refund was given, so the original invoice stays an accurate record.
 *
 *   grossSales         sum of line quantity x unit price, before any discount
 *   discounts          line discounts + order discounts
 *   revenue            sum of sale totals: what the till took (after discounts, tax included)
 *   netRevenue         revenue less tax = grossSales - discounts
 *   refunds            completed returns (refunded at the price paid, no tax)
 *   netSales           netRevenue - refunds
 *   costOfGoods        cost frozen on each sale line when it was rung up
 *   returnedCost       cost of refunded goods that went back on the shelf
 *   netCostOfGoods     costOfGoods - returnedCost
 *   netProfit          netSales - netCostOfGoods (other expenses are not recorded)
 *   averageOrderValue  netSales / transactionCount
 *
 * Goods refunded without restocking keep their cost in COGS: they are a loss.
 */
export interface SalesSummary {
  transactionCount: number;
  grossSales: number;
  discounts: number;
  /** What the till took: after discounts, tax included, before refunds. */
  revenue: number;
  /** Revenue excluding tax. */
  netRevenue: number;
  /** Net revenue less refunds given in the window. */
  netSales: number;
  costOfGoods: number;
  returnedCost: number;
  netCostOfGoods: number;
  /** Net revenue less cost of goods, before refunds. */
  grossProfit: number;
  marginPercent: number;
  itemsSold: number;
  averageOrderValue: number;
  returnsTotal: number;
  returnsCount: number;
  /** Net sales less net cost of goods: the estimated profit. */
  netProfit: number;
  cashSales: number;
  /**
   * Sold lines recorded with a zero unit cost. Any at all means cost is
   * missing for part of the window, so profit is overstated and incomplete.
   */
  zeroCostLines: number;
}

export interface SalesAggregateRow {
  transactionCount: number;
  revenue: string;
  netRevenue: string;
  orderDiscounts: string;
  costOfGoods: string;
  itemsSold: string;
  grossSales: string;
  lineDiscounts: string;
  zeroCostLines: number;
}

export interface ReturnsAggregateRow {
  total: string;
  count: number;
  restockedCost: string;
}

/** Money is held to 4dp in the database; float subtraction must not add noise. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Turns the raw sums into the reported figures. */
export function composeSummary(
  aggregate: SalesAggregateRow,
  returns: ReturnsAggregateRow,
  cashSales: number,
): SalesSummary {
  const revenue = Number(aggregate.revenue);
  const netRevenue = Number(aggregate.netRevenue);
  const costOfGoods = Number(aggregate.costOfGoods);
  const returnsTotal = Number(returns.total);
  const returnedCost = Number(returns.restockedCost);
  const netSales = round2(netRevenue - returnsTotal);
  const netCostOfGoods = round2(costOfGoods - returnedCost);
  const grossProfit = round2(netRevenue - costOfGoods);
  const transactionCount = aggregate.transactionCount;

  return {
    transactionCount,
    grossSales: Number(aggregate.grossSales),
    discounts: round2(Number(aggregate.lineDiscounts) + Number(aggregate.orderDiscounts)),
    revenue,
    netRevenue,
    netSales,
    costOfGoods,
    returnedCost,
    netCostOfGoods,
    grossProfit,
    marginPercent: netRevenue > 0 ? Number(((grossProfit / netRevenue) * 100).toFixed(2)) : 0,
    itemsSold: Number(aggregate.itemsSold),
    averageOrderValue: transactionCount > 0 ? round2(netSales / transactionCount) : 0,
    returnsTotal,
    returnsCount: returns.count,
    netProfit: round2(netSales - netCostOfGoods),
    cashSales,
    zeroCostLines: aggregate.zeroCostLines,
  };
}
