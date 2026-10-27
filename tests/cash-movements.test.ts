import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CATEGORIES_FOR,
  CATEGORY_LABEL,
  correctionTypeFor,
  drawerEffect,
  isCategoryAllowed,
  movementReference,
  parseMovementReference,
} from '@/lib/cash-movements';
import { drawerTotals } from '@/lib/shift-math';

test('every movement has a readable reference: CO for cash out, CI for cash in', () => {
  assert.equal(movementReference('CASH_OUT', 123), 'CO-000123');
  assert.equal(movementReference('CASH_IN', 7), 'CI-000007');
  assert.equal(parseMovementReference('CO-000123'), 123);
  assert.equal(parseMovementReference('co123'), 123);
  assert.equal(parseMovementReference('42'), 42);
  assert.equal(parseMovementReference('paid ice'), null);
});

test('each direction offers its own categories; a correction is never chosen by hand', () => {
  assert.ok(isCategoryAllowed('CASH_OUT', 'SUPPLIER_PAYMENT'));
  assert.ok(isCategoryAllowed('CASH_OUT', 'BANK_DEPOSIT'));
  assert.ok(isCategoryAllowed('CASH_IN', 'CHANGE_FUND'));
  assert.ok(!isCategoryAllowed('CASH_IN', 'SUPPLIER_PAYMENT'));
  assert.ok(!isCategoryAllowed('CASH_OUT', 'CORRECTION'));
  assert.ok(!isCategoryAllowed('CASH_IN', 'CORRECTION'));
  for (const list of Object.values(CATEGORIES_FOR)) for (const c of list) assert.ok(CATEGORY_LABEL[c]);
});

test('a cash out lowers the expected drawer once, and its correction puts it back', () => {
  const before = drawerTotals({ openingCash: 1000, cashTendered: 0, changeGiven: 0, cashIn: 0, cashRefunds: 0, cashOut: 0 });
  const after = drawerTotals({ openingCash: 1000, cashTendered: 0, changeGiven: 0, cashIn: 0, cashRefunds: 0, cashOut: 250 });
  assert.equal(after.expectedCash, before.expectedCash + drawerEffect('CASH_OUT', 250));
  assert.equal(after.expectedCash, 750);
  // The correction runs the other way, for the same amount.
  assert.equal(correctionTypeFor('CASH_OUT'), 'CASH_IN');
  const corrected = drawerTotals({ openingCash: 1000, cashTendered: 0, changeGiven: 0, cashIn: 250, cashRefunds: 0, cashOut: 250 });
  assert.equal(corrected.expectedCash, 1000);
});

test('cash out sits beside sales and refunds in the drawer, never counted as either', () => {
  // ₱1,000 handed over on a ₱350 sale (₱650 change), a ₱100 cash refund, ₱200 cash out.
  const t = drawerTotals({ openingCash: 500, cashTendered: 1000, changeGiven: 650, cashIn: 0, cashRefunds: 100, cashOut: 200 });
  assert.equal(t.cashSales, 350);
  assert.equal(t.expectedCash, 500 + 350 - 100 - 200);
});

test('the server takes the cashier from the session, checks the category, refuses duplicates and corrects only open shifts', () => {
  const service = readFileSync('src/server/services/shift-service.ts', 'utf8');
  const actions = readFileSync('src/features/pos/shift-actions.ts', 'utf8');
  assert.match(actions, /addCashMovement\(\{\s*userId: user\.id/);
  assert.match(actions, /actorId: user\.id/);
  assert.doesNotMatch(actions.slice(actions.indexOf('const movementSchema'), actions.indexOf('export async function addCashMovementAction')), /'CORRECTION'/);
  assert.match(service, /isCategoryAllowed\(input\.type, category\)/);
  assert.match(service, /clientRequestId/);
  const correct = service.slice(service.indexOf('export async function correctCashMovement'));
  assert.match(correct, /lockShiftIfOpen\(tx, original\.shiftId/);
  assert.match(correct, /already been corrected/);
  assert.match(correct, /!input\.isOwner && original\.userId !== input\.actorId/);
  assert.doesNotMatch(service, /cashMovement\.(update|delete)/);
});

test('a cashier sees only their own movements; the owner sees everyone’s', () => {
  const page = readFileSync('src/app/(app)/cash-movements/page.tsx', 'utf8');
  assert.match(page, /const ownOnly = isOwner \? null : user\.id/);
  assert.match(page, /userId: ownOnly \?\? \(params\.cashier \|\| undefined\)/);
  assert.match(page, /\.\.\.\(ownOnly \? \{ userId: ownOnly \} : \{\}\)/);
});

test('the migration numbers movements without rewriting them and links corrections safely', () => {
  const sql = readFileSync('prisma/migrations/20261105090000_cash_movement_details/migration.sql', 'utf8');
  assert.match(sql, /ADD COLUMN "number" INTEGER NOT NULL DEFAULT nextval/);
  assert.doesNotMatch(sql, /UPDATE "cash_movements"/);
  assert.doesNotMatch(sql, /DELETE FROM "cash_movements"/);
  assert.match(sql, /"cash_movements_correctsId_key"/);
  assert.match(sql, /"cash_movements_storeId_clientRequestId_key"/);
  assert.match(sql, /\("category" = 'CORRECTION'\) = \("correctsId" IS NOT NULL\)/);
  assert.match(sql, /'correctsId', 'cash_movements'/);
});
