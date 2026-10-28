import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  NAVIGATION,
  isNavGroup,
  isNavItemActive,
  isNavLinkActive,
  visibleNavigation,
  type NavGroup,
  type NavItem,
  type NavLink,
} from '@/components/layout/navigation';
import { ROUTE_PERMISSIONS, SYSTEM_ROLES, resolveRolePermissions } from '@/lib/permissions';

const store = NAVIGATION.find((section) => section.label === 'Store')!;
const products = store.items.find((item) => item.label === 'Products') as NavGroup;
const child = (label: string) => products.children.find((link) => link.label === label)!;
const inventory = store.items.find((item) => item.label === 'Inventory') as NavLink;

const labels = (items: NavItem[]) => items.map((item) => item.label);
const grantedFor = (slug: string) => {
  const role = SYSTEM_ROLES.find((r) => r.slug === slug);
  assert.ok(role, `role ${slug} exists`);
  return new Set<string>(resolveRolePermissions(role));
};

test('store navigation puts POS directly below Dashboard, then Products', () => {
  assert.deepEqual(labels(store.items).slice(0, 5), ['Dashboard', 'POS', 'Products', 'Inventory', 'Reports']);
  assert.ok(isNavGroup(products));
  assert.deepEqual(labels(products.children), ['All Products', 'Categories', 'Stock Management']);
});

test('every link appears once, so no two entries lead to the same page', () => {
  const hrefs = NAVIGATION.flatMap((section) =>
    section.items.flatMap((item) => (isNavGroup(item) ? item.children : [item]).map((link) => link.href)),
  );
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test('each Products page lights up exactly one child, and the parent with it', () => {
  const cases: [string, string][] = [
    ['/products', 'All Products'],
    ['/products/new', 'All Products'],
    ['/products/abc123', 'All Products'],
    ['/products/abc123/edit', 'All Products'],
    ['/products/categories', 'Categories'],
    ['/inventory', 'Stock Management'],
  ];
  for (const [pathname, expected] of cases) {
    const active = products.children.filter((link) => isNavLinkActive(link, pathname)).map((l) => l.label);
    assert.deepEqual(active, [expected], pathname);
    assert.ok(isNavItemActive(products, pathname), `${pathname} highlights Products`);
    assert.ok(!isNavItemActive(inventory, pathname), `${pathname} leaves Inventory dark`);
  }
});

test('the ledger and adjustment pages belong to Inventory, not Stock Management', () => {
  for (const pathname of ['/inventory/movements', '/inventory/adjustments']) {
    assert.ok(isNavLinkActive(inventory, pathname), pathname);
    assert.ok(!isNavItemActive(products, pathname), pathname);
  }
  assert.ok(!isNavLinkActive(child('Stock Management'), '/inventory/movements'));
});

test('a prefix only matches whole path segments', () => {
  assert.ok(!isNavLinkActive(child('All Products'), '/products-archive'));
  assert.ok(!isNavLinkActive(child('Categories'), '/products/categories-old'));
});

test('the sidebar hides links a role cannot open, and empty groups with them', () => {
  const cashier = visibleNavigation(NAVIGATION, grantedFor('cashier'));
  const cashierProducts = cashier.flatMap((section) => section.items).find((item) => item.label === 'Products');
  // Cashiers may look products and stock up, but categories are not theirs.
  assert.ok(cashierProducts && isNavGroup(cashierProducts));
  assert.deepEqual(labels(cashierProducts.children), ['All Products', 'Stock Management']);

  const staff = visibleNavigation(NAVIGATION, grantedFor('inventory-staff'));
  const staffItems = staff.flatMap((section) => section.items);
  const staffProducts = staffItems.find((item) => item.label === 'Products');
  assert.ok(staffProducts && isNavGroup(staffProducts));
  assert.deepEqual(labels(staffProducts.children), ['All Products', 'Categories', 'Stock Management']);

  const partial = visibleNavigation(NAVIGATION, new Set(['inventory.view']));
  const partialProducts = partial.flatMap((s) => s.items).find((item) => item.label === 'Products');
  assert.ok(partialProducts && isNavGroup(partialProducts));
  assert.deepEqual(labels(partialProducts.children), ['Stock Management']);
});

test('the middleware guards every page the menu links to', () => {
  const links = NAVIGATION.flatMap((section) =>
    section.items.flatMap((item) => (isNavGroup(item) ? item.children : [item])),
  ).filter((link) => !link.href.startsWith('/system-admin'));

  for (const link of links) {
    const guard = ROUTE_PERMISSIONS.find(
      (route) => link.href === route.prefix || link.href.startsWith(`${route.prefix}/`),
    );
    assert.ok(guard, `${link.href} has a route permission`);
  }
});

const settings = store.items.find((item) => item.label === 'Settings') as NavGroup;
const sales = store.items.find((item) => item.label === 'Sales') as NavLink;

test('every Settings page keeps Settings lit, with exactly one child active', () => {
  assert.ok(isNavGroup(settings), 'Settings is a group');
  const cases: [string, string][] = [
    ['/settings', 'Store Settings'],
    ['/settings/users', 'Staff Accounts'],
    ['/settings/roles', 'Roles & Permissions'],
    ['/settings/subscription', 'Subscription & Billing'],
  ];
  for (const [pathname, expected] of cases) {
    const active = settings.children.filter((link) => isNavLinkActive(link, pathname)).map((link) => link.label);
    assert.deepEqual(active, [expected], pathname);
    assert.ok(isNavItemActive(settings, pathname), `${pathname} highlights Settings`);
  }
});

test('refund pages belong to Sales', () => {
  for (const pathname of ['/sales', '/sales/abc', '/returns', '/returns/abc']) assert.ok(isNavLinkActive(sales, pathname), pathname);
  assert.ok(!isNavLinkActive(sales, '/returns-old'));
});

test('the owner sees every settings page; staff see only what they may open', () => {
  const ownerSettings = visibleNavigation(NAVIGATION, grantedFor('owner'))
    .flatMap((section) => section.items)
    .find((item) => item.label === 'Settings');
  assert.ok(ownerSettings && isNavGroup(ownerSettings));
  assert.deepEqual(labels(ownerSettings.children), ['Store Settings', 'Staff Accounts', 'Roles & Permissions', 'Subscription & Billing']);

  for (const slug of ['cashier', 'inventory-staff']) {
    const items = visibleNavigation(NAVIGATION, grantedFor(slug)).flatMap((section) => section.items);
    assert.ok(!items.some((item) => item.label === 'Settings'), `${slug} has no Settings`);
  }
  // Someone delegated only staff management still finds it.
  const delegated = visibleNavigation(NAVIGATION, new Set(['users.view'])).flatMap((section) => section.items);
  const delegatedSettings = delegated.find((item) => item.label === 'Settings');
  assert.ok(delegatedSettings && isNavGroup(delegatedSettings));
  assert.deepEqual(labels(delegatedSettings.children), ['Staff Accounts']);
});

test('an unknown address inside the app is answered within the shell, not by a bare page', () => {
  const missing = readFileSync('src/app/(app)/[...missing]/page.tsx', 'utf8');
  assert.match(missing, /notFound\(\)/);
  const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
  assert.match(layout, /getSettings\(\)\.catch\(/);
});
