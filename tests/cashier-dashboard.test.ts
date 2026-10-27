import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAVIGATION, isNavGroup, visibleNavigation } from '@/components/layout/navigation';
import { FINANCIAL_PERMISSION, SYSTEM_ROLES, resolveRolePermissions, type PermissionKey } from '@/lib/permissions';
import { resolveDashboardVariant } from '@/lib/dashboard-access';
import { COMPLETED_TRANSACTION_STATUSES, canViewSaleRecord, salesScopeUserId } from '@/lib/sales-scope';
import { cashierCashWindow } from '@/lib/cashier-window';

const permissionsOf = (slug: string) => {
  const role = SYSTEM_ROLES.find((r) => r.slug === slug);
  assert.ok(role, `role ${slug} exists`);
  return new Set<PermissionKey>(resolveRolePermissions(role));
};
const viewer = (id: string, slug: string) => ({ id, permissions: permissionsOf(slug) });

test('a cashier lands on the cashier dashboard', () => {
  assert.equal(resolveDashboardVariant(permissionsOf('cashier')), 'cashier');
  assert.equal(resolveDashboardVariant(permissionsOf('owner')), 'owner');
});

test('the cashier sidebar reads Dashboard, POS, Products, Inventory, Reports, Sales, Cash In / Out, then Support — and nothing of the owner', () => {
  const items = visibleNavigation(NAVIGATION, permissionsOf('cashier')).flatMap((section) => section.items);
  assert.deepEqual(
    items.map((item) => item.label),
    ['Dashboard', 'POS', 'Products', 'Inventory', 'Reports', 'Sales', 'Cash In / Out', 'Support'],
  );
  const hrefs = items.flatMap((item) => (isNavGroup(item) ? item.children : [item]).map((link) => link.href));
  for (const href of hrefs) {
    assert.ok(!href.startsWith('/settings') && !href.startsWith('/system-admin'), `${href} is not the owner's`);
  }
});

test('the cashier role holds no owner-only permission', () => {
  const granted = permissionsOf('cashier');
  assert.ok(!granted.has(FINANCIAL_PERMISSION), 'no cost, profit or store-wide takings');
  for (const key of granted) {
    assert.ok(!/^(users|roles|settings|platform)\./.test(key), `${key} is not administration`);
  }
  // Read-only stock: no receiving or adjusting.
  assert.ok(!granted.has('inventory.create') && !granted.has('inventory.update'));
});

test('a cashier reads only their own sales; the owner reads every sale', () => {
  const cashier = viewer('cashier-1', 'cashier');
  const owner = viewer('owner-1', 'owner');

  assert.equal(salesScopeUserId(cashier), 'cashier-1');
  assert.equal(salesScopeUserId(owner), null);

  assert.ok(canViewSaleRecord(cashier, 'cashier-1'));
  assert.ok(!canViewSaleRecord(cashier, 'cashier-2'));
  assert.ok(canViewSaleRecord(owner, 'cashier-2'));
});

test('completed transactions leave voided and fully refunded sales out', () => {
  assert.deepEqual([...COMPLETED_TRANSACTION_STATUSES].sort(), ['COMPLETED', 'PARTIALLY_RETURNED']);
});

test('cash collected covers the open shift, or the Manila store day without one', () => {
  const openedAt = new Date('2026-10-20T00:30:00Z');
  assert.deepEqual(cashierCashWindow({ id: 'shift-1', openedAt }), { kind: 'shift', shiftId: 'shift-1', since: openedAt });

  // 04:00 on 21 October in Manila (UTC+8) is still 20 October in UTC.
  const window = cashierCashWindow(null, new Date('2026-10-20T20:00:00Z'));
  assert.equal(window.kind, 'day');
  if (window.kind !== 'day') return;
  assert.equal(window.from.toISOString(), '2026-10-20T16:00:00.000Z');
  assert.ok(window.to.getTime() > new Date('2026-10-21T15:59:00Z').getTime());
  assert.ok(window.to.getTime() < new Date('2026-10-21T16:00:00Z').getTime());
});
