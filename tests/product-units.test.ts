import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { UNITS, decimalPlaces, formatUnits, quantityProblem, quantityStep } from '@/lib/quantity';
import { missingTemplates, normalizeCategoryName } from '@/lib/category-templates';
import { refundAmounts } from '@/lib/refund-math';
import { tenderSummary } from '@/lib/tender';

test('rice per kilogram: 1.25 kg at ₱52.00 is ₱65.00, exactly', () => {
  const line = new Prisma.Decimal('1.25').times('52.00');
  assert.equal(line.toFixed(2), '65.00');
  assert.equal(quantityProblem(1.25, { allowsDecimal: true, unit: 'KILOGRAM' }), null);
  assert.equal(formatUnits(1.25, 'KILOGRAM'), '1.25 kg');
});

test('wire per meter: 1.5 m at ₱18.00 is ₱27.00', () => {
  assert.equal(new Prisma.Decimal('1.5').times('18').toFixed(2), '27.00');
  assert.equal(formatUnits(1.5, 'METER'), '1.5 m');
});

test('a whole-unit product refuses fractions; a decimal product refuses more than 3 places', () => {
  assert.match(quantityProblem(1.5, { allowsDecimal: false, unit: 'SACK' }) ?? '', /whole sacks/);
  assert.match(quantityProblem(0.1234, { allowsDecimal: true, unit: 'KILOGRAM' }) ?? '', /3 decimal places/);
  assert.match(quantityProblem(0, { allowsDecimal: true }) ?? '', /more than zero/);
  assert.match(quantityProblem(-1, { allowsDecimal: true }) ?? '', /more than zero/);
  assert.equal(quantityProblem(0, { allowsDecimal: false, positive: false }), null, 'a count may be zero');
  assert.match(quantityProblem('', { allowsDecimal: true }) ?? '', /Enter a quantity/);
  assert.equal(decimalPlaces('0.125'), 3);
  assert.equal(decimalPlaces(2), 0);
  assert.equal(quantityStep(true), 0.001);
  assert.equal(quantityStep(false), 1);
});

test('weights, volumes and lengths default to decimals; packaged units stay whole', () => {
  for (const unit of ['KILOGRAM', 'LITER', 'METER'] as const) assert.equal(UNITS[unit].decimalsByDefault, true, unit);
  for (const unit of ['PIECE', 'PACK', 'SACK', 'BAG', 'BOTTLE'] as const) assert.equal(UNITS[unit].decimalsByDefault, false, unit);
});

test('a fractional sale is refunded and paid for exactly', () => {
  // 1.5 m of wire at ₱18 = ₱27; ₱100 cash gives ₱73 change.
  assert.deepEqual(tenderSummary({ total: 27, method: 'CASH', received: 100 }).change, 73);
  const r = refundAmounts({
    sale: { subtotal: 27, discount: 0, total: 27 },
    items: [{ id: 'w', quantity: '1.5', returnedQuantity: 0, total: 27 }],
    request: [{ saleItemId: 'w', quantity: '0.5' }],
    previous: { subtotal: 0, total: 0 },
  });
  assert.equal(r.total.toString(), '9');
});

test('suggested categories skip names the store already has, by spelling or alias', () => {
  assert.equal(normalizeCategoryName('  Rice &  Grains '), 'rice and grains');
  const existing = ['rice and grains', 'Gamot', 'Uling', 'beverages'];
  const missing = missingTemplates(existing).map((t) => t.name);
  assert.ok(!missing.includes('Rice and Grains'));
  assert.ok(!missing.includes('Over-the-Counter Medicines'), 'Gamot is the same group');
  assert.ok(!missing.includes('Charcoal and Fuel'));
  assert.ok(!missing.includes('Beverages'));
  assert.ok(missing.includes('Animal Feeds'));
  assert.ok(missing.includes('Cooking Oil'));
  assert.equal(missingTemplates([...existing, ...missing]).length, 0, 'adding them all leaves nothing to add');
});

test('every stock change checks the quantity against the product it moves', () => {
  const inventory = readFileSync('src/server/services/inventory-service.ts', 'utf8');
  const apply = inventory.slice(inventory.indexOf('export async function applyStockMovement'));
  assert.ok(apply.indexOf('allowsDecimal: true') < apply.indexOf('quantityFor(input.quantity'), 'the product is read first');
  const sale = readFileSync('src/server/services/sale-service.ts', 'utf8');
  assert.match(sale, /quantityFor\(item\.quantity, `Quantity for \$\{product\.name\}`, product\)/);
  const returns = readFileSync('src/server/services/return-service.ts', 'utf8');
  assert.match(returns, /item\.product\.allowsDecimal \|\| !D\(item\.quantity\)\.isInteger\(\)/);
});

test('the migration keeps existing products whole and enforces the rule per product in the database', () => {
  const sql = readFileSync('prisma/migrations/20261106090000_product_units/migration.sql', 'utf8');
  assert.match(sql, /ADD COLUMN "unit" "ProductUnit" NOT NULL DEFAULT 'PIECE'/);
  assert.match(sql, /ADD COLUMN "allowsDecimal" BOOLEAN NOT NULL DEFAULT false/);
  for (const table of ['inventory', 'inventory_transactions', 'sale_items', 'return_items']) {
    assert.match(sql, new RegExp(`CREATE TRIGGER "${table}_unit_precision"`), table);
  }
  assert.match(sql, /"products_thresholds_follow_unit"/);
  assert.match(sql, /"products_unit_change_guard"/);
  assert.match(sql, /"sale_items_quantity_positive" CHECK \("quantity" > 0\)/);
  assert.doesNotMatch(sql, /^\s*UPDATE /m, 'no existing row is rewritten');
  assert.doesNotMatch(sql, /^\s*DELETE /m);
});
