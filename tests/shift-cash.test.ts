import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DRAWER_AMOUNT, QUICK_OPENING_AMOUNTS, parseCashAmount } from '@/lib/cash-amount';
import { cashVariance, drawerTotals } from '@/lib/shift-math';

test('starting cash accepts peso amounts as typed', () => {
  const cases: [unknown, number][] = [
    ['1000', 1000],
    ['1,000', 1000],
    ['₱1,500.50', 1500.5],
    ['0', 0],
    [' 250.5 ', 250.5],
    [2000, 2000],
  ];
  for (const [input, value] of cases) assert.deepEqual(parseCashAmount(input), { ok: true, value }, String(input));
});

test('starting cash rejects empty, negative, malformed and oversized amounts', () => {
  for (const input of ['', '   ', '-50', 'abc', '10.005', '1e3', '12..5', null, undefined, Number.NaN, String(MAX_DRAWER_AMOUNT + 1)]) {
    assert.equal(parseCashAmount(input).ok, false, String(input));
  }
  assert.equal(parseCashAmount(String(MAX_DRAWER_AMOUNT)).ok, true);
});

test('cash movements must be more than zero; a count may be zero', () => {
  assert.equal(parseCashAmount('0', { allowZero: false }).ok, false);
  assert.equal(parseCashAmount('0').ok, true);
});

test('quick amounts are the four the dialog offers', () => {
  assert.deepEqual([...QUICK_OPENING_AMOUNTS], [500, 1000, 1500, 2000]);
});

test('expected cash: start + (tendered − change) + in − refunds − out', () => {
  const totals = drawerTotals({
    openingCash: 1000,
    // ₱750 sale paid with ₱1,000 (₱250 change) and a ₱120 sale paid exactly.
    cashTendered: 1120,
    changeGiven: 250,
    cashIn: 200,
    cashRefunds: 45,
    cashOut: 300,
  });
  assert.equal(totals.cashSales, 870);
  assert.equal(totals.expectedCash, 1000 + 870 + 200 - 45 - 300);
});

test('change given never counts as drawer cash', () => {
  const tenderedOnly = drawerTotals({ openingCash: 1000, cashTendered: 1000, changeGiven: 0, cashIn: 0, cashRefunds: 0, cashOut: 0 });
  const withChange = drawerTotals({ openingCash: 1000, cashTendered: 1000, changeGiven: 250, cashIn: 0, cashRefunds: 0, cashOut: 0 });
  assert.equal(tenderedOnly.expectedCash - withChange.expectedCash, 250);
});

test('decimal-safe: centavos do not drift', () => {
  const totals = drawerTotals({ openingCash: '0.10', cashTendered: '0.20', changeGiven: 0, cashIn: 0, cashRefunds: 0, cashOut: 0 });
  assert.equal(totals.expectedCash, 0.3);
});

test('variance is counted − expected, labelled balanced / overage / shortage', () => {
  assert.deepEqual(cashVariance(1825, 1825), { difference: 0, kind: 'BALANCED' });
  assert.deepEqual(cashVariance(1850, 1825), { difference: 25, kind: 'OVERAGE' });
  assert.deepEqual(cashVariance(1800.5, 1825), { difference: -24.5, kind: 'SHORTAGE' });
});
