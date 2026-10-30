import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  countQuantity,
  formatPieces,
  isWholeQuantity,
  lineQuantity,
  quantityProblem,
  signedQuantity,
} from '@/lib/quantity';
import { stockBand, stockThreshold, suggestedRestock } from '@/lib/stock-status';
import { resolveDashboardVariant } from '@/lib/dashboard-access';
import {
  ALL_PERMISSION_KEYS,
  FINANCIAL_PERMISSION,
  SYSTEM_ROLES,
  resolveRolePermissions,
  type PermissionKey,
} from '@/lib/permissions';
import { canOpenReport, visibleReportResult } from '@/server/reports/report-access';
import { productSchema } from '@/features/products/schema';

/* -------------------------------------------------------------------------- */
/* Quantities (whole pieces by default, decimals where a product allows)       */
/* -------------------------------------------------------------------------- */

test('a sale or receipt line is above zero with at most 3 decimals; the product decides about fractions', () => {
  assert.equal(lineQuantity.safeParse(1).success, true);
  assert.equal(lineQuantity.safeParse(4).success, true);
  assert.equal(lineQuantity.safeParse(1.5).success, true);
  assert.equal(lineQuantity.safeParse(0.125).success, true);
  assert.equal(lineQuantity.safeParse(0).success, false);
  assert.equal(lineQuantity.safeParse(-2).success, false);
  assert.equal(lineQuantity.safeParse(0.1234).success, false);
  assert.equal(lineQuantity.safeParse('3').success, false, 'strings are not coerced on the server');
  // A piece product refuses a fraction; a decimal product takes one.
  assert.match(quantityProblem(2.5, { allowsDecimal: false }) ?? '', /whole pcs/);
  assert.equal(quantityProblem(2.5, { allowsDecimal: true, unit: 'KILOGRAM' }), null);
});

test('an adjustment may be positive or negative, up to 3 decimals', () => {
  assert.equal(signedQuantity.safeParse(-3).success, true);
  assert.equal(signedQuantity.safeParse(12).success, true);
  assert.equal(signedQuantity.safeParse(-0.5).success, true);
  assert.equal(signedQuantity.safeParse(0.0001).success, false);
});

test('a counted quantity is zero or more', () => {
  assert.equal(countQuantity.safeParse(0).success, true);
  assert.equal(countQuantity.safeParse(47).success, true);
  assert.equal(countQuantity.safeParse(4.25).success, true);
  assert.equal(countQuantity.safeParse(-1).success, false);
});

test('quantities read as pieces unless a unit is given, and fractions are never rounded away', () => {
  assert.equal(formatPieces(1), '1 pc');
  assert.equal(formatPieces(12), '12 pcs');
  assert.equal(formatPieces(-3), '-3 pcs');
  assert.equal(formatPieces(0), '0 pcs');
  assert.equal(formatPieces(1.5, 'METER'), '1.5 m');
  assert.equal(formatPieces(0.25, 'KILOGRAM'), '0.25 kg');
  assert.equal(isWholeQuantity(3), true);
  assert.equal(isWholeQuantity(3.5), false);
});

test('Fudgee Barr: 4 pcs at ₱25.00 is ₱100.00', () => {
  const unitPrice = 25;
  const quantity = 4;
  assert.equal(lineQuantity.safeParse(quantity).success, true);
  assert.equal(unitPrice * quantity, 100);
});

test('stock thresholds follow the unit: whole for piece products, decimals when allowed', () => {
  const base = {
    name: 'Fudgee Barr',
    sku: 'FUDGEE',
    barcode: '',
    description: '',
    imageUrl: '',
    categoryId: 'c1',
    costPrice: 18,
    sellingPrice: 25,
    minStock: 0,
    maxStock: 0,
    reorderLevel: 10,
    reorderQty: 24,
    status: 'ACTIVE' as const,
    isTrackable: true,
  };
  const parsed = productSchema.parse(base);
  // An existing product posted without a unit stays a whole-piece product.
  assert.equal(parsed.unit, 'PIECE');
  assert.equal(parsed.allowsDecimal, false);
  assert.equal(productSchema.safeParse({ ...base, reorderLevel: 2.5 }).success, false);
  assert.equal(productSchema.safeParse({ ...base, reorderQty: 0.5 }).success, false);
  assert.equal(productSchema.safeParse({ ...base, unit: 'KILOGRAM', allowsDecimal: true, reorderLevel: 2.5 }).success, true);
  assert.equal(productSchema.safeParse({ ...base, unit: 'KILOGRAM', allowsDecimal: true, reorderLevel: 2.5555 }).success, false);
  assert.equal(productSchema.safeParse({ ...base, unit: 'LITRE' }).success, false, 'only known units');
  assert.equal('unitId' in productSchema.parse({ ...base, unitId: 'unit_box' }), false, 'a posted unitId is stripped');
});

/* -------------------------------------------------------------------------- */
/* Stock bands and restocking                                                  */
/* -------------------------------------------------------------------------- */

test('stock bands are mutually exclusive', () => {
  assert.equal(stockBand(0, 10), 'OUT');
  assert.equal(stockBand(-2, 10), 'OUT');
  assert.equal(stockBand(8, 10), 'LOW');
  assert.equal(stockBand(10, 10), 'LOW', 'at the level counts as low');
  assert.equal(stockBand(11, 10), 'IN');
  assert.equal(stockBand(5, 0), 'IN', 'no level set: stocked means in stock');
  assert.equal(stockBand(0, 0), 'OUT');
});

test('the threshold is the reorder level, falling back to the minimum', () => {
  assert.equal(stockThreshold(10, 4), 10);
  assert.equal(stockThreshold(0, 4), 4);
  assert.equal(stockThreshold(0, 0), 0);
});

test('suggested restock comes only from configured values', () => {
  assert.equal(suggestedRestock({ available: 8, reorderQty: 24, maxStock: 0 }), 24);
  assert.equal(suggestedRestock({ available: 8, reorderQty: 0, maxStock: 50 }), 42);
  assert.equal(suggestedRestock({ available: -3, reorderQty: 0, maxStock: 50 }), 50, 'never orders for negative stock');
  assert.equal(suggestedRestock({ available: 60, reorderQty: 0, maxStock: 50 }), null);
  assert.equal(suggestedRestock({ available: 8, reorderQty: 0, maxStock: 0 }), null, 'nothing configured: no invented target');
});

/* -------------------------------------------------------------------------- */
/* Roles                                                                       */
/* -------------------------------------------------------------------------- */

function holder(slug: string) {
  const role = SYSTEM_ROLES.find((r) => r.slug === slug);
  assert.ok(role, `system role ${slug}`);
  return { permissions: new Set<PermissionKey>(resolveRolePermissions(role)) };
}

test('each system role lands on its own dashboard', () => {
  assert.equal(resolveDashboardVariant(holder('owner').permissions), 'owner');
  assert.equal(resolveDashboardVariant(holder('inventory-staff').permissions), 'inventory');
  assert.equal(resolveDashboardVariant(holder('cashier').permissions), 'cashier');
  assert.equal(resolveDashboardVariant(holder('system-admin').permissions), 'platform');
  assert.equal(resolveDashboardVariant(new Set<PermissionKey>()), 'none');
});

test('only the owner holds the financial permission among system roles', () => {
  const holders = SYSTEM_ROLES.filter((role) => resolveRolePermissions(role).includes(FINANCIAL_PERMISSION)).map(
    (role) => role.slug,
  );
  assert.deepEqual(holders, ['owner']);
});

test('the units permission is gone from the catalogue and every role', () => {
  assert.equal(ALL_PERMISSION_KEYS.some((key) => key.startsWith('units.')), false);
  for (const role of SYSTEM_ROLES) {
    assert.equal(resolveRolePermissions(role).some((key) => key.startsWith('units.')), false, role.slug);
  }
});

test('financial reports open for the owner only', () => {
  const salesReport = { permission: 'reports.view' as PermissionKey, financial: true };
  assert.equal(canOpenReport(holder('owner'), salesReport), true);
  assert.equal(canOpenReport(holder('inventory-staff'), salesReport), false);
  assert.equal(canOpenReport(holder('cashier'), salesReport), false);
  assert.equal(canOpenReport(holder('system-admin'), salesReport), false);

  const stockReport = { permission: 'inventory.view' as PermissionKey };
  assert.equal(canOpenReport(holder('inventory-staff'), stockReport), true);
});

test('cost columns are stripped for staff, kept for the owner', () => {
  const report = { permission: 'inventory.view' as PermissionKey, costColumns: ['costPrice', 'stockValue'] };
  const result = {
    columns: [{ key: 'name' }, { key: 'onHand' }, { key: 'costPrice' }, { key: 'stockValue' }],
    rows: [{ name: 'Fudgee Barr', onHand: 46, costPrice: 18, stockValue: 828 }],
  };
  const staff = visibleReportResult(holder('inventory-staff'), report, result);
  assert.deepEqual(staff.columns.map((c) => c.key), ['name', 'onHand']);
  assert.deepEqual(staff.rows[0], { name: 'Fudgee Barr', onHand: 46 });
  assert.equal(visibleReportResult(holder('owner'), report, result), result);
});

/**
 * Guards the catalogue itself: every report that carries a money column must
 * either be owner-only or list that column for removal. A new report that
 * forgets to do so fails here instead of leaking figures to staff.
 */
test('no report shows a money column to staff', () => {
  // Line endings vary with the checkout (Windows writes CRLF); compare on LF.
  const source = fs.readFileSync(path.join(process.cwd(), 'src/server/reports/registry.ts'), 'utf8').replace(/\r\n/g, '\n');
  const blocks = source.split(/\n  \{\n    id: '/).slice(1);
  assert.ok(blocks.length >= 10, 'parsed the report definitions');

  for (const block of blocks) {
    const id = block.slice(0, block.indexOf("'"));
    if (/\n    financial: true,/.test(block)) continue;
    const costColumns = [...(block.match(/costColumns: \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const moneyColumns = [...block.matchAll(/money\('([^']+)'/g)].map((m) => m[1]);
    for (const column of moneyColumns) {
      assert.ok(costColumns.includes(column), `report "${id}" shows money column "${column}" to staff`);
    }
    assert.equal(/\n\s+summary: \[/.test(block), false, `report "${id}" has a money summary but is not owner-only`);
  }
});
