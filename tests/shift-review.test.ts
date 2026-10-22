import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCashAmount } from '@/lib/cash-amount';
import { cashVariance, drawerTotals } from '@/lib/shift-math';
import {
  adjustedVariance,
  closeNotificationTypes,
  displayStatus,
  isOverdue,
  normaliseTolerance,
  notificationKey,
  parseShiftReference,
  reviewStatusAtClose,
  shiftReference,
} from '@/lib/shift-review';
import { NAVIGATION, isNavGroup, visibleNavigation } from '@/components/layout/navigation';
import { FINANCIAL_PERMISSION, ROUTE_PERMISSIONS, SYSTEM_ROLES, resolveRolePermissions } from '@/lib/permissions';

/* ---------------------------------------------------------------- opening */

test('a shift opens with the suggested ₱1,000.00 or any custom count, never a negative one', () => {
  assert.deepEqual(parseCashAmount('1,000.00'), { ok: true, value: 1000 });
  assert.deepEqual(parseCashAmount('1375.25'), { ok: true, value: 1375.25 });
  for (const bad of ['-1', '-1000', 'one thousand', '1000.001']) assert.equal(parseCashAmount(bad).ok, false, bad);
});

/* ------------------------------------------------------------ drawer cash */

test('only the cash part of a split payment reaches the drawer; GCash never does', () => {
  // ₱500 sale: ₱300 GCash + ₱200 cash (exact). The GCash leg is not cash tendered.
  const split = drawerTotals({ openingCash: 1000, cashTendered: 200, changeGiven: 0, cashIn: 0, cashRefunds: 0, cashOut: 0 });
  assert.equal(split.cashSales, 200);
  assert.equal(split.expectedCash, 1200);
  // An all-GCash shift leaves the drawer at its float.
  const gcashOnly = drawerTotals({ openingCash: 1000, cashTendered: 0, changeGiven: 0, cashIn: 0, cashRefunds: 0, cashOut: 0 });
  assert.equal(gcashOnly.expectedCash, 1000);
});

test('a full day: sales, a refund, cash in and a bank drop give the expected drawer', () => {
  const totals = drawerTotals({
    openingCash: 1000,
    cashTendered: '5320.50',
    changeGiven: '412.50',
    cashIn: 500,
    cashRefunds: '89.75',
    cashOut: 3000,
  });
  assert.equal(totals.cashSales, 4908);
  assert.equal(totals.expectedCash, 3318.25);
  assert.deepEqual(cashVariance(3318.25, totals.expectedCash), { difference: 0, kind: 'BALANCED' });
  assert.deepEqual(cashVariance(3300, totals.expectedCash), { difference: -18.25, kind: 'SHORTAGE' });
  assert.deepEqual(cashVariance(3320, totals.expectedCash), { difference: 1.75, kind: 'OVERAGE' });
});

/* ------------------------------------------------------------------ review */

test('with the default ₱0 tolerance every peso short or over needs review; balanced does not', () => {
  assert.equal(reviewStatusAtClose(0, 0), 'NOT_REQUIRED');
  assert.equal(reviewStatusAtClose(-0.01, 0), 'PENDING');
  assert.equal(reviewStatusAtClose(0.01, 0), 'PENDING');
});

test('a tolerance lets small misses through, both directions, and nothing past it', () => {
  assert.equal(reviewStatusAtClose(-5, 5), 'NOT_REQUIRED');
  assert.equal(reviewStatusAtClose(5, 5), 'NOT_REQUIRED');
  assert.equal(reviewStatusAtClose(-5.01, 5), 'PENDING');
  assert.equal(reviewStatusAtClose('5.01', 5), 'PENDING');
});

test('a negative or broken tolerance setting falls back to ₱0', () => {
  assert.equal(normaliseTolerance(-10), 0);
  assert.equal(normaliseTolerance(Number.NaN), 0);
  assert.equal(reviewStatusAtClose(-1, -10), 'PENDING');
});

test('status shown to the owner: open, closed, requires review, reviewed', () => {
  assert.equal(displayStatus('OPEN', 'NOT_REQUIRED'), 'OPEN');
  assert.equal(displayStatus('CLOSED', 'NOT_REQUIRED'), 'CLOSED');
  assert.equal(displayStatus('CLOSED', 'PENDING'), 'REQUIRES_REVIEW');
  assert.equal(displayStatus('CLOSED', 'REVIEWED'), 'REVIEWED');
});

test('adjustments sit beside the variance and never rewrite it', () => {
  const original = -20;
  assert.equal(adjustedVariance(original, [20]), 0);
  assert.equal(adjustedVariance(original, []), original);
  assert.equal(adjustedVariance('-0.30', ['0.10', '0.20']), 0);
  assert.equal(original, -20);
});

/* -------------------------------------------------------------- references */

test('shift references read SH-000123 and parse back from what staff type', () => {
  assert.equal(shiftReference(123), 'SH-000123');
  for (const typed of ['SH-000123', 'sh-123', 'sh123', '123', ' 000123 ']) assert.equal(parseShiftReference(typed), 123, typed);
  for (const junk of ['', 'SH-', 'abc', 'SH-12a', '0', '-5']) assert.equal(parseShiftReference(junk), null, junk);
});

/* ----------------------------------------------------------- notifications */

test('one notice per event per shift, so retries and polls cannot duplicate it', () => {
  assert.equal(notificationKey('SHIFT_CLOSED', 'abc'), notificationKey('SHIFT_CLOSED', 'abc'));
  assert.notEqual(notificationKey('SHIFT_CLOSED', 'abc'), notificationKey('SHIFT_SHORTAGE', 'abc'));
  assert.notEqual(notificationKey('SHIFT_CLOSED', 'abc'), notificationKey('SHIFT_CLOSED', 'xyz'));
});

test('a close raises "closed", plus shortage or overage only when it needs review', () => {
  assert.deepEqual(closeNotificationTypes('BALANCED', 'NOT_REQUIRED'), ['SHIFT_CLOSED']);
  assert.deepEqual(closeNotificationTypes('SHORTAGE', 'PENDING'), ['SHIFT_CLOSED', 'SHIFT_SHORTAGE']);
  assert.deepEqual(closeNotificationTypes('OVERAGE', 'PENDING'), ['SHIFT_CLOSED', 'SHIFT_OVERAGE']);
  // Within tolerance: no alarm.
  assert.deepEqual(closeNotificationTypes('SHORTAGE', 'NOT_REQUIRED'), ['SHIFT_CLOSED']);
});

test('the left-open notice is off at 0 hours and fires once the limit passes', () => {
  const openedAt = new Date('2026-10-22T00:00:00Z');
  assert.equal(isOverdue(openedAt, new Date('2026-10-23T00:00:00Z'), 0), false);
  assert.equal(isOverdue(openedAt, new Date('2026-10-22T11:59:00Z'), 12), false);
  assert.equal(isOverdue(openedAt, new Date('2026-10-22T12:00:00Z'), 12), true);
});

/* ------------------------------------------------------------- permissions */

const grantedFor = (slug: string) => new Set<string>(resolveRolePermissions(SYSTEM_ROLES.find((r) => r.slug === slug)!));
const visibleLabels = (slug: string) =>
  visibleNavigation(NAVIGATION, grantedFor(slug))
    .flatMap((s) => s.items)
    .flatMap((item) => (isNavGroup(item) ? item.children : [item]))
    .map((link) => link.label);

test('Shift Management is in the owner menu only', () => {
  assert.ok(visibleLabels('owner').includes('Shift Management'));
  assert.ok(!visibleLabels('cashier').includes('Shift Management'));
  assert.ok(!visibleLabels('inventory-staff').includes('Shift Management'));
  assert.ok(!visibleLabels('system-admin').includes('Shift Management'));
});

test('the owner-only gate is a key no default staff role holds', () => {
  for (const slug of ['cashier', 'inventory-staff', 'system-admin']) assert.ok(!grantedFor(slug).has(FINANCIAL_PERMISSION), slug);
  assert.ok(grantedFor('owner').has(FINANCIAL_PERMISSION));
  assert.ok(ROUTE_PERMISSIONS.some((route) => route.prefix === '/shifts'));
});

/* ------------------------------------------------------ database guarantees */

const migrationSql = readdirSync(join(process.cwd(), 'prisma', 'migrations'))
  .filter((dir) => /^\d+_/.test(dir))
  .map((dir) => readFileSync(join(process.cwd(), 'prisma', 'migrations', dir, 'migration.sql'), 'utf8'))
  .join('\n');

test('the migrations keep one open shift per cashier and protect the cash records', () => {
  assert.match(migrationSql, /CREATE UNIQUE INDEX "cashier_shifts_one_open_per_user"[\s\S]*WHERE "status" = 'OPEN'/);
  assert.match(migrationSql, /CREATE TRIGGER "audit_logs_append_only"/);
  assert.match(migrationSql, /CREATE TRIGGER "cash_movements_append_only"/);
  assert.match(migrationSql, /CREATE TRIGGER "shift_adjustments_append_only"/);
  assert.match(migrationSql, /CREATE TRIGGER "cashier_shifts_closed_guard"/);
  assert.match(migrationSql, /CREATE UNIQUE INDEX "notifications_dedupeKey_key"/);
});
