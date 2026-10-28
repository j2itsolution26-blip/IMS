import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawerTotals } from '@/lib/shift-math';
import { lastFourDigits, walletFigures, walletInstruction, walletProblem, walletReference } from '@/lib/wallet';

const peso = (n: number) => `₱${n.toFixed(2)}`;

test('cash-in: ₱1,000 sent with a ₱15 fee — collect ₱1,015, drawer +₱1,015, store GCash −₱1,000, income ₱15', () => {
  assert.deepEqual(walletFigures('CASH_IN', 1000, 15), {
    collectCash: 1015,
    giveCash: 0,
    drawerEffect: 1015,
    walletEffect: -1000,
    revenue: 15,
  });
  assert.match(walletInstruction('CASH_IN', 1000, 15, peso), /Collect ₱1015\.00 cash.*send ₱1000\.00/);
});

test('cash-out: ₱1,000 received with a ₱15 fee — give ₱985, drawer −₱985, store GCash +₱1,000, income ₱15', () => {
  assert.deepEqual(walletFigures('CASH_OUT', 1000, 15), {
    collectCash: 0,
    giveCash: 985,
    drawerEffect: -985,
    walletEffect: 1000,
    revenue: 15,
  });
});

test('only the fee is income: amounts are exact to the centavo and never counted as sales', () => {
  const f = walletFigures('CASH_IN', 0.1 + 0.2, 0.05);
  assert.equal(f.collectCash, 0.35);
  assert.equal(f.revenue, 0.05);
  const sales = readFileSync('src/server/services/sale-service.ts', 'utf8');
  assert.doesNotMatch(sales, /walletTransaction/, 'sales never read GCash services');
});

test('the drawer counts GCash services once, beside sales and cash movements', () => {
  // ₱500 float, a ₱1,000 cash-in with ₱15 fee (+1,015), a ₱500 cash-out with ₱10 fee (−490).
  const walletCash = walletFigures('CASH_IN', 1000, 15).drawerEffect + walletFigures('CASH_OUT', 500, 10).drawerEffect;
  const t = drawerTotals({ openingCash: 500, cashTendered: 0, changeGiven: 0, cashIn: 0, cashRefunds: 0, cashOut: 0, walletCash });
  assert.equal(t.walletCash, 525);
  assert.equal(t.expectedCash, 1025);
  // Without services the drawer is as before.
  assert.equal(drawerTotals({ openingCash: 500, cashTendered: 0, changeGiven: 0, cashIn: 0, cashRefunds: 0, cashOut: 0 }).expectedCash, 500);
});

test('invalid entries are refused before anything is recorded', () => {
  assert.match(walletProblem('CASH_IN', 0, 0) ?? '', /amount/);
  assert.match(walletProblem('CASH_IN', -5, 0) ?? '', /amount/);
  assert.match(walletProblem('CASH_IN', 100, -1) ?? '', /negative/);
  assert.match(walletProblem('CASH_OUT', 100, 100) ?? '', /less than the amount/);
  assert.match(walletProblem('CASH_IN', 100.001, 0) ?? '', /two decimal/);
  assert.match(walletProblem('CASH_IN', 500_000, 0) ?? '', /more than/);
  assert.equal(walletProblem('CASH_IN', 1000, 15), null);
});

test('references read GC-000123 and only the last four digits of a customer number are kept', () => {
  assert.equal(walletReference(123), 'GC-000123');
  assert.equal(lastFourDigits('0917 123 4567'), '4567');
  assert.equal(lastFourDigits('+63 917-123-4567'), '4567');
  assert.equal(lastFourDigits('12'), null);
  assert.equal(lastFourDigits(undefined), null);
});

test('the server records only for the signed-in cashier’s open shift, after confirmation, once per reference', () => {
  const service = readFileSync('src/server/services/wallet-service.ts', 'utf8');
  const actions = readFileSync('src/features/wallet/actions.ts', 'utf8');
  assert.match(actions, /recordWalletTransaction\(\{ \.\.\.values, userId: user\.id \}\)/);
  assert.match(service, /walletServicesEnabled\(\)/);
  assert.match(service, /input\.confirmed !== true/);
  assert.match(service, /getOpenShift\(input\.userId\)/);
  assert.match(service, /lockShiftIfOpen\(tx, shift\.id, 'share'\)/);
  assert.match(service, /already recorded/);
  const reverse = service.slice(service.indexOf('export async function reverseWalletTransaction'));
  assert.match(reverse, /lockShiftIfOpen\(tx, row\.shiftId, 'share'\)/);
  assert.match(reverse, /!input\.isOwner && row\.userId !== input\.actorId/);
  assert.doesNotMatch(service, /walletTransaction\.delete/);
});

test('the migration holds the money rules, isolation and append-only history in the database', () => {
  const sql = readFileSync('prisma/migrations/20261107090000_gcash_services/migration.sql', 'utf8');
  assert.match(sql, /"wallet_transactions_amount_positive" CHECK \("amount" > 0\)/);
  assert.match(sql, /"fee" < "amount"/);
  assert.match(sql, /"wallet_transactions_live_reference"[\s\S]*WHERE "reversedAt" IS NULL/);
  assert.match(sql, /"wallet_transactions_tenant_guard"/);
  assert.match(sql, /"wallet_transactions_guard"/);
  assert.match(sql, /NEW."walletCash"/, 'a closed shift’s GCash figure is frozen too');
  const scope = readFileSync('src/lib/tenant/scope.ts', 'utf8');
  assert.match(scope, /WalletTransaction: \{ kind: 'store' \}/);
});
