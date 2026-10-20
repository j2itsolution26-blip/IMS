import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatPieces,
  isWholeQuantity,
  pieceQuantity,
  signedPieceQuantity,
  countQuantity,
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
/* Whole pieces                                                                */
/* -------------------------------------------------------------------------- */

test('a sale or receipt line is at least one whole piece', () => {
  assert.equal(pieceQuantity.safeParse(1).success, true);
  assert.equal(pieceQuantity.safeParse(4).success, true);
  assert.equal(pieceQuantity.safeParse(0).success, false);
  assert.equal(pieceQuantity.safeParse(-2).success, false);
  assert.equal(pieceQuantity.safeParse(2.5).success, false);
  assert.equal(pieceQuantity.safeParse(0.25).success, false);
  assert.equal(pieceQuantity.safeParse('3').success, false, 'strings are not coerced on the server');
});

test('an adjustment is a whole number, positive or negative', () => {
  assert.equal(signedPieceQuantity.safeParse(-3).success, true);
  assert.equal(signedPieceQuantity.safeParse(12).success, true);
  assert.equal(signedPieceQuantity.safeParse(-0.5).success, false);
});

test('a counted quantity is zero or more whole pieces', () => {
  assert.equal(countQuantity.safeParse(0).success, true);
  assert.equal(countQuantity.safeParse(47).success, true);
  assert.equal(countQuantity.safeParse(-1).success, false);
  assert.equal(countQuantity.safeParse(4.2).success, false);
});

test('quantities read as pieces', () => {
  assert.equal(formatPieces(1), '1 pc');
  assert.equal(formatPieces(12), '12 pcs');
  assert.equal(formatPieces(-3), '-3 pcs');
  assert.equal(formatPieces(0), '0 pcs');
  assert.equal(isWholeQuantity(3), true);
  assert.equal(isWholeQuantity(3.5), false);
});

test('Fudgee Barr: 4 pcs at ₱25.00 is ₱100.00', () => {
  const unitPrice = 25;
  const quantity = 4;
  assert.equal(pieceQuantity.safeParse(quantity).success, true);
  assert.equal(unitPrice * quantity, 100);
});

test('product stock thresholds must be whole pieces; the form has no unit field', () => {
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
  assert.equal(productSchema.safeParse(base).success, true);
  assert.equal(productSchema.safeParse({ ...base, reorderLevel: 2.5 }).success, false);
  assert.equal(productSchema.safeParse({ ...base, reorderQty: 0.5 }).success, false);
  const parsed = productSchema.parse({ ...base, unitId: 'unit_box' });
  assert.equal('unitId' in parsed, false, 'a posted unitId is stripped, never stored');
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
  const source = fs.readFileSync(path.join(process.cwd(), 'src/server/reports/registry.ts'), 'utf8');
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
