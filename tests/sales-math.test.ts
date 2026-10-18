import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeSummary, type ReturnsAggregateRow, type SalesAggregateRow } from '@/server/analytics/sales-math';

const NO_RETURNS: ReturnsAggregateRow = { total: '0', count: 0, restockedCost: '0' };

function sales(overrides: Partial<SalesAggregateRow> = {}): SalesAggregateRow {
  return {
    transactionCount: 0,
    revenue: '0',
    netRevenue: '0',
    orderDiscounts: '0',
    costOfGoods: '0',
    itemsSold: '0',
    grossSales: '0',
    lineDiscounts: '0',
    zeroCostLines: 0,
    ...overrides,
  };
}

test('an empty period is all zeros, not NaN', () => {
  const summary = composeSummary(sales(), NO_RETURNS, 0);
  assert.equal(summary.netSales, 0);
  assert.equal(summary.averageOrderValue, 0);
  assert.equal(summary.marginPercent, 0);
  assert.equal(summary.netProfit, 0);
});

test('net sales is gross less discounts less refunds, with discounts counted once', () => {
  // Two sales: ₱1,000 of goods, ₱50 off a line, ₱30 off an order, no tax.
  // Sale totals already have both discounts applied: 1000 − 50 − 30 = 920.
  const summary = composeSummary(
    sales({
      transactionCount: 2,
      grossSales: '1000',
      lineDiscounts: '50',
      orderDiscounts: '30',
      revenue: '920',
      netRevenue: '920',
      costOfGoods: '600',
    }),
    { total: '100', count: 1, restockedCost: '60' },
    920,
  );

  assert.equal(summary.discounts, 80);
  assert.equal(summary.grossSales - summary.discounts, summary.netRevenue);
  assert.equal(summary.netSales, 820);
  assert.equal(summary.averageOrderValue, 410);
});

test('a restocked refund gives back its cost, so profit is not double-counted', () => {
  const summary = composeSummary(
    sales({ transactionCount: 1, grossSales: '200', revenue: '200', netRevenue: '200', costOfGoods: '120' }),
    { total: '200', count: 1, restockedCost: '120' },
    0,
  );
  // Everything came back to the shelf: no sale, no cost, no profit.
  assert.equal(summary.netSales, 0);
  assert.equal(summary.netCostOfGoods, 0);
  assert.equal(summary.netProfit, 0);
});

test('a refund that is not restocked keeps its cost as a loss', () => {
  const summary = composeSummary(
    sales({ transactionCount: 1, grossSales: '200', revenue: '200', netRevenue: '200', costOfGoods: '120' }),
    { total: '200', count: 1, restockedCost: '0' },
    0,
  );
  assert.equal(summary.netProfit, -120);
});

test('tax is not revenue', () => {
  const summary = composeSummary(
    sales({ transactionCount: 1, grossSales: '100', revenue: '112', netRevenue: '100', costOfGoods: '70' }),
    NO_RETURNS,
    112,
  );
  assert.equal(summary.netSales, 100);
  assert.equal(summary.netProfit, 30);
});

test('float noise does not leak into money', () => {
  const summary = composeSummary(
    sales({ transactionCount: 3, revenue: '0.3', netRevenue: '0.3', grossSales: '0.3', costOfGoods: '0.1' }),
    { total: '0.2', count: 1, restockedCost: '0' },
    0,
  );
  assert.equal(summary.netSales, 0.1);
  assert.equal(summary.netProfit, 0);
});

test('missing cost is surfaced, not hidden', () => {
  const summary = composeSummary(sales({ transactionCount: 1, zeroCostLines: 2 }), NO_RETURNS, 0);
  assert.equal(summary.zeroCostLines, 2);
});
