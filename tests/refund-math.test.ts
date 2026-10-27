import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RefundError, refundAmounts } from '@/lib/refund-math';
import { SALE_STATUS_LABEL } from '@/lib/sale-status';

const none = { subtotal: 0, total: 0 };
const num = (value: { toString(): string }) => Number(value.toString());

test('a plain sale refunds exactly the price paid', () => {
  const r = refundAmounts({
    sale: { subtotal: 300, discount: 0, total: 300 },
    items: [{ id: 'a', quantity: 3, returnedQuantity: 0, total: 300 }],
    request: [{ saleItemId: 'a', quantity: 1 }],
    previous: none,
  });
  assert.equal(num(r.total), 100);
  assert.equal(num(r.subtotal), 100);
  assert.equal(r.closesSale, false);
});

test('the order discount is shared out, so a refund never pays back more than was paid', () => {
  // Two ₱100 items with ₱20 off the whole order: the customer paid ₱180.
  const sale = { subtotal: 200, discount: 20, total: 180 };
  const items = [{ id: 'a', quantity: 2, returnedQuantity: 0, total: 200 }];
  const first = refundAmounts({ sale, items, request: [{ saleItemId: 'a', quantity: 1 }], previous: none });
  assert.equal(num(first.total), 90);
  const second = refundAmounts({
    sale,
    items: [{ ...items[0], returnedQuantity: 1 }],
    request: [{ saleItemId: 'a', quantity: 1 }],
    previous: { subtotal: first.subtotal, total: first.total },
  });
  assert.equal(num(second.total), 90);
  assert.equal(num(first.total) + num(second.total), 180);
  assert.equal(second.closesSale, true);
});

test('tax is refunded in cash but kept out of the ex-tax figure reports subtract', () => {
  // ₱100 + 12% tax = ₱112 paid.
  const r = refundAmounts({
    sale: { subtotal: 100, discount: 0, total: 112 },
    items: [{ id: 'a', quantity: 1, returnedQuantity: 0, total: 100 }],
    request: [{ saleItemId: 'a', quantity: 1 }],
    previous: none,
  });
  assert.equal(num(r.total), 112);
  assert.equal(num(r.subtotal), 100);
});

test('the last pieces absorb rounding, so refunds add up to exactly the sale total', () => {
  // Three pieces for ₱100 with ₱1 off: ₱33.00 each after the share, ₱99 in all.
  const sale = { subtotal: 100, discount: 1, total: 99 };
  let item = { id: 'a', quantity: 3, returnedQuantity: 0, total: 100 };
  let previous = { subtotal: 0, total: 0 };
  let refunded = 0;
  for (let i = 0; i < 3; i++) {
    const r = refundAmounts({ sale, items: [item], request: [{ saleItemId: 'a', quantity: 1 }], previous });
    refunded += num(r.total);
    previous = { subtotal: previous.subtotal + num(r.subtotal), total: previous.total + num(r.total) };
    item = { ...item, returnedQuantity: item.returnedQuantity + 1 };
  }
  assert.equal(Math.round(refunded * 100) / 100, 99);
  assert.equal(Math.round(previous.subtotal * 100) / 100, 99);
});

test('more than remains returnable, unknown lines, negatives and empty requests are refused', () => {
  const base = {
    sale: { subtotal: 100, discount: 0, total: 100 },
    items: [{ id: 'a', quantity: 2, returnedQuantity: 1, total: 100 }],
    previous: none,
  };
  assert.throws(() => refundAmounts({ ...base, request: [{ saleItemId: 'a', quantity: 2 }] }), RefundError);
  // The same line twice in one request still counts as one total.
  assert.throws(() => refundAmounts({ ...base, request: [{ saleItemId: 'a', quantity: 1 }, { saleItemId: 'a', quantity: 1 }] }), RefundError);
  assert.throws(() => refundAmounts({ ...base, request: [{ saleItemId: 'zzz', quantity: 1 }] }), RefundError);
  assert.throws(() => refundAmounts({ ...base, request: [{ saleItemId: 'a', quantity: -1 }] }), RefundError);
  assert.throws(() => refundAmounts({ ...base, request: [{ saleItemId: 'a', quantity: 0 }] }), RefundError);
});

test('a refund is capped at what is left of the sale total', () => {
  const r = refundAmounts({
    sale: { subtotal: 100, discount: 0, total: 100 },
    items: [{ id: 'a', quantity: 2, returnedQuantity: 0, total: 100 }],
    request: [{ saleItemId: 'a', quantity: 2 }],
    previous: { subtotal: 30, total: 30 },
  });
  assert.equal(num(r.total), 70);
});

test('refunds and voids lock the sale first, and a void records who, when and why', () => {
  const returns = readFileSync('src/server/services/return-service.ts', 'utf8');
  const sales = readFileSync('src/server/services/sale-service.ts', 'utf8');
  const lockFirst = (source: string, fn: string) => {
    const body = source.slice(source.indexOf(fn));
    assert.ok(body.indexOf('lockSale(tx') < body.indexOf('tx.sale.findUnique'), `${fn} must lock before reading`);
  };
  lockFirst(returns, 'export async function createSaleReturn');
  lockFirst(sales, 'export async function voidSale');
  assert.match(sales, /FOR UPDATE/);
  assert.match(sales, /voidedAt: new Date\(\), voidedById: userId, voidReason: trimmed/);
  // Nothing deletes a sale to refund or void it.
  assert.doesNotMatch(returns + sales, /sale\.delete/);
});

test('the migration makes voids final and keeps returned quantities within what was sold', () => {
  const sql = readFileSync('prisma/migrations/20261104090000_refunds_and_voids/migration.sql', 'utf8');
  assert.match(sql, /"returnedQuantity" <= "quantity"/);
  assert.match(sql, /A voided sale cannot be changed/);
  assert.match(sql, /returns_storeId_clientRequestId_key/);
  assert.match(sql, /'voidedById', 'users'/);
  assert.doesNotMatch(sql, /DELETE FROM "(sales|returns|sale_items)"/);
});

test('partly refunded, refunded and voided sales are labelled differently', () => {
  assert.equal(SALE_STATUS_LABEL.COMPLETED, 'Paid');
  assert.equal(SALE_STATUS_LABEL.PARTIALLY_RETURNED, 'Partly refunded');
  assert.equal(SALE_STATUS_LABEL.RETURNED, 'Refunded');
  assert.equal(SALE_STATUS_LABEL.VOIDED, 'Voided');
});
