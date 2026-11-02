import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashVariance, drawerBreakdown, drawerTotals } from '@/lib/shift-math';
import { walletFigures } from '@/lib/wallet';

/** The worked example from the "Additional or revise" brief. */
const PDF = {
  openingCash: 1000,
  cashSales: 1000,
  gcashSales: 1380.25,
  otherNonCashSales: 0,
  walletCashIn: 50 + 20, // cash load ₱50 + cash-in ₱20, both paid in cash
  walletCashOut: 100,
  walletFees: 50,
  cashIn: 0,
  cashOut: 100,
  cashRefunds: 0,
  nonCashRefunds: 0,
};

test('the brief example reconciles to ₱1,920.00, balanced when ₱1,920.00 is counted', () => {
  const { rows, expectedCash } = drawerBreakdown(PDF);
  assert.equal(expectedCash, 1920);
  assert.deepEqual(cashVariance(1920, expectedCash), { difference: 0, kind: 'BALANCED' });
  assert.deepEqual(cashVariance(1900, expectedCash), { difference: -20, kind: 'SHORTAGE' });
  assert.deepEqual(cashVariance(1925.5, expectedCash), { difference: 5.5, kind: 'OVERAGE' });
  // GCash product sales are listed, at ₱0 drawer impact, with what was received.
  const gcash = rows.find((row) => row.key === 'gcashSales');
  assert.deepEqual({ impact: gcash?.drawerImpact, recorded: gcash?.recorded }, { impact: 0, recorded: 1380.25 });
});

test('the breakdown agrees with the drawer total used to close a shift', () => {
  // Same shift, as computeShiftSummary feeds drawerTotals: wallet services as one net figure.
  const cashIn = walletFigures('CASH_IN', 70, 30); // fee paid in cash on top
  const cashOut = walletFigures('CASH_OUT', 100, 20); // fee kept from the cash handed back
  const walletCash = cashIn.drawerEffect + cashOut.drawerEffect;
  const totals = drawerTotals({ openingCash: 1000, cashTendered: 1290, changeGiven: 290, cashIn: 0, cashRefunds: 0, cashOut: 100, walletCash });
  const breakdown = drawerBreakdown({ ...PDF, walletCashIn: 70, walletCashOut: 100, walletFees: 50 });
  assert.equal(breakdown.expectedCash, totals.expectedCash);
});

test('electronic money never changes the expected drawer cash', () => {
  const base = drawerBreakdown(PDF).expectedCash;
  assert.equal(drawerBreakdown({ ...PDF, gcashSales: 99999, otherNonCashSales: 500, nonCashRefunds: 300 }).expectedCash, base);
  // A cash refund does.
  assert.equal(drawerBreakdown({ ...PDF, cashRefunds: 40 }).expectedCash, base - 40);
});
