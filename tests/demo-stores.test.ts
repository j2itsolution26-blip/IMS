import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_CATEGORIES, DEMO_PRODUCTS } from '@/lib/demo-seed';
import { quantityProblem } from '@/lib/quantity';

const service = readFileSync('src/server/platform/demo-service.ts', 'utf8');
const sql = readFileSync('prisma/migrations/20261108090000_demo_stores/migration.sql', 'utf8');

test('the sample catalogue is valid: unique SKUs, known categories, stock that fits each unit', () => {
  const skus = new Set(DEMO_PRODUCTS.map((p) => p.sku));
  assert.equal(skus.size, DEMO_PRODUCTS.length);
  for (const product of DEMO_PRODUCTS) {
    assert.ok((DEMO_CATEGORIES as readonly string[]).includes(product.category), product.sku);
    assert.equal(quantityProblem(product.stock, { allowsDecimal: product.allowsDecimal, unit: product.unit, positive: false }), null, product.sku);
    assert.ok(product.sellingPrice >= product.costPrice, product.sku);
    assert.match(product.sku, /^DEMO-/, 'sample SKUs are marked as demo');
  }
  // It shows off units: something by the kilo, by the meter, and by the piece.
  assert.ok(DEMO_PRODUCTS.some((p) => p.unit === 'KILOGRAM' && p.allowsDecimal));
  assert.ok(DEMO_PRODUCTS.some((p) => p.unit === 'METER' && p.allowsDecimal));
  assert.ok(DEMO_PRODUCTS.some((p) => p.unit === 'PIECE' && !p.allowsDecimal));
});

test('reset refuses any store that is not a demo store before touching anything', () => {
  const reset = service.slice(service.indexOf('export async function resetDemoStore'));
  const guard = reset.indexOf('if (!row.isDemo) throw');
  assert.ok(guard > 0);
  assert.ok(guard < reset.indexOf('deleteMany'), 'the demo check comes before any delete');
  assert.ok(reset.indexOf('confirmName.trim() !== row.name') < reset.indexOf('deleteMany'), 'the typed name is checked first');
  assert.ok(reset.indexOf('lockStore(tx, input.storeId)') < guard, 'the store row is locked first');
  // Every delete is limited to this one store.
  for (const match of reset.matchAll(/\.deleteMany\(\{ where \}\)/g)) assert.ok(match);
  assert.doesNotMatch(reset, /deleteMany\(\)/);
  assert.match(reset, /const where = \{ storeId: input\.storeId \}/);
  // What a reset keeps.
  assert.doesNotMatch(reset, /auditLog\.delete|invoice\.delete|subscriptionPayment\.delete|supportTicket\.delete|user\.delete/);
});

test('sample data only ever goes into a demo store', () => {
  const seed = service.slice(service.indexOf('export async function seedDemoData'));
  assert.ok(seed.indexOf("if (!store?.isDemo) throw") < seed.indexOf('category.upsert'));
});

test('the database keeps the demo flag fixed and allows reset deletes only for the named demo store', () => {
  assert.match(sql, /ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /A store cannot be switched between real and demo/);
  assert.match(sql, /current_setting\('app\.demo_reset_store', true\) = store_id/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM "stores" WHERE "id" = store_id AND "isDemo"\)/);
  for (const fn of ['refuse_change_append_only', 'wallet_transactions_guard', 'cashier_shifts_closed_guard']) {
    assert.match(sql, new RegExp(`CREATE OR REPLACE FUNCTION "${fn}"[\\s\\S]*?demo_reset_allowed`), fn);
  }
  assert.doesNotMatch(sql, /audit_logs_guard|invoices_permanent|subscription_payments_permanent/, 'audit and billing guards are untouched');
  // The flag is set for this transaction only.
  assert.match(service, /set_config\('app\.demo_reset_store', \$\{input\.storeId\}, true\)/);
});

test('demo stores are never billed and stay out of platform figures and reminders', () => {
  const billing = readFileSync('src/server/platform/billing-service.ts', 'utf8');
  assert.match(billing, /if \(row\.isDemo\) throw new ConflictError\('This is a demo store\. Demo stores are not billed\.'\)/);
  const reminders = readFileSync('src/server/platform/billing-reminders.ts', 'utf8');
  assert.equal((reminders.match(/isDemo: false/g) ?? []).length, 2);
  const queries = readFileSync('src/features/platform/queries.ts', 'utf8');
  assert.match(queries, /groupBy\(\{ by: \['status', 'plan'\], where: \{ isDemo: false \}/);
  const create = readFileSync('src/server/platform/subscription-service.ts', 'utf8');
  assert.match(create, /status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null, isDemo: true/);
});

test('people in a demo store always see that it is a demo', () => {
  const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
  assert.match(layout, /user\.store\?\.isDemo && \(/);
  assert.match(layout, /DEMO STORE/);
});
