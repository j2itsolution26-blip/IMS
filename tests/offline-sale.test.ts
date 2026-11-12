import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySyncResult,
  clampOccurredAt,
  offlineSyncRequestSchema,
  priceWasInEffect,
  pricesInEffect,
  retryDelayMs,
  type SyncResponse,
} from '@/lib/offline-sale';

const at = (iso: string) => new Date(iso);

const validSale = () => ({
  deviceId: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b',
  sale: {
    id: '0b1c2d3e-4f50-4a61-8b72-c3d4e5f6a7b8',
    localReceiptNumber: 'OFF-6F1D-000001',
    occurredAt: '2026-11-12T03:15:00.000Z',
    catalogFetchedAt: '2026-11-12T01:00:00.000Z',
    userId: 'user_1',
    shiftId: 'shift_1',
    warehouseId: 'wh_1',
    taxRate: 0,
    items: [{ productId: 'p1', quantity: 0.25, unitPrice: 60 }],
    cashTendered: 20,
    total: 15,
  },
});

test('the upload schema accepts a cash sale and defaults discounts to zero', () => {
  const parsed = offlineSyncRequestSchema.parse(validSale());
  assert.equal(parsed.sale.discount, 0);
  assert.equal(parsed.sale.items[0].discount, 0);
  assert.equal(parsed.sale.items[0].quantity, 0.25, 'fractional kilograms survive');
});

test('the upload schema refuses what a till could never send', () => {
  const cases: [string, (input: ReturnType<typeof validSale>) => void][] = [
    ['a non-UUID sale id', (i) => (i.sale.id = 'abc')],
    ['a non-UUID device id', (i) => (i.deviceId = 'device-1')],
    ['an empty basket', (i) => (i.sale.items = [])],
    ['a zero quantity', (i) => (i.sale.items[0].quantity = 0)],
    ['more than three decimals', (i) => (i.sale.items[0].quantity = 0.0005)],
    ['a negative price', (i) => (i.sale.items[0].unitPrice = -1)],
    ['an absurd amount', (i) => (i.sale.cashTendered = 1e12)],
    ['a tax rate over 100%', (i) => (i.sale.taxRate = 101)],
    ['a time that is not a timestamp', (i) => (i.sale.occurredAt = 'yesterday')],
  ];
  for (const [what, spoil] of cases) {
    const input = validSale();
    spoil(input);
    assert.equal(offlineSyncRequestSchema.safeParse(input).success, false, what);
  }
});

test('the upload schema drops anything else a request carries, such as a payment method', () => {
  const input = { ...validSale(), sale: { ...validSale().sale, method: 'GCASH', invoiceNumber: 'INV-1' } };
  const parsed = offlineSyncRequestSchema.parse(input);
  assert.equal('method' in parsed.sale, false);
  assert.equal('invoiceNumber' in parsed.sale, false);
});

test('a sale is filed when it happened, within its shift and never in the future', () => {
  const bounds = { openedAt: at('2026-11-12T00:00:00Z'), now: at('2026-11-12T10:00:00Z') };
  assert.deepEqual(clampOccurredAt(at('2026-11-12T05:00:00Z'), bounds), { at: at('2026-11-12T05:00:00Z'), clamped: false });
  assert.deepEqual(clampOccurredAt(at('2026-11-11T23:00:00Z'), bounds), { at: bounds.openedAt, clamped: true });
  assert.deepEqual(clampOccurredAt(at('2026-11-13T05:00:00Z'), bounds), { at: bounds.now, clamped: true });
  assert.deepEqual(clampOccurredAt(new Date('nope'), bounds), { at: bounds.now, clamped: true });
});

test('prices in effect: today’s price when it never changed', () => {
  assert.deepEqual(pricesInEffect({ current: 25, changes: [], from: at('2026-11-10T00:00Z'), to: at('2026-11-12T00:00Z') }), [25]);
});

test('prices in effect: the old price until a change, then the new one', () => {
  const changes = [{ oldValue: 25, newValue: 28, at: at('2026-11-11T12:00Z') }];
  // Catalogue taken before the change, sale after it: either price is honest.
  assert.deepEqual(pricesInEffect({ current: 28, changes, from: at('2026-11-11T00:00Z'), to: at('2026-11-12T00:00Z') }).sort(), [25, 28]);
  // Both before the change: only the old price.
  assert.deepEqual(pricesInEffect({ current: 28, changes, from: at('2026-11-10T00:00Z'), to: at('2026-11-11T00:00Z') }), [25]);
  // Both after it: only the new one.
  assert.deepEqual(pricesInEffect({ current: 28, changes, from: at('2026-11-11T13:00Z'), to: at('2026-11-12T00:00Z') }), [28]);
});

test('prices in effect: a change after the sale does not count, and order of input does not matter', () => {
  const changes = [
    { oldValue: 30, newValue: 35, at: at('2026-11-13T00:00Z') },
    { oldValue: 25, newValue: 30, at: at('2026-11-11T00:00Z') },
  ];
  assert.deepEqual(pricesInEffect({ current: 35, changes, from: at('2026-11-11T06:00Z'), to: at('2026-11-12T00:00Z') }), [30]);
});

test('a charged price matches to the centavo, never by float accident', () => {
  assert.equal(priceWasInEffect(0.1 + 0.2, [0.3]), true);
  assert.equal(priceWasInEffect(12.5, [12.49]), false);
});

const okBody: SyncResponse = {
  ok: true,
  status: 'recorded',
  sale: { id: 's', invoiceNumber: 'INV-000001', total: 1, paidAmount: 1, changeAmount: 0, receivedAt: '2026-11-12T00:00:00Z' },
  issues: [],
};
const failBody = (retryable: boolean): SyncResponse => ({ ok: false, code: 'X', error: 'x', retryable });

test('upload outcomes: what the till does with each answer', () => {
  assert.equal(classifySyncResult(null, null), 'retry', 'no answer at all');
  assert.equal(classifySyncResult(200, okBody), 'synced');
  assert.equal(classifySyncResult(200, { ...okBody, status: 'duplicate' }), 'synced', 'a repeat is still synced');
  assert.equal(classifySyncResult(401, failBody(false)), 'reauth');
  assert.equal(classifySyncResult(403, failBody(false)), 'blocked');
  assert.equal(classifySyncResult(429, failBody(true)), 'retry');
  assert.equal(classifySyncResult(503, failBody(true)), 'retry');
  assert.equal(classifySyncResult(502, null), 'retry', 'a proxy error page');
  assert.equal(classifySyncResult(422, failBody(false)), 'rejected');
  assert.equal(classifySyncResult(409, failBody(false)), 'rejected');
  assert.equal(classifySyncResult(404, null), 'retry', 'an answer the API did not write says nothing about the sale');
});

test('retry delays double from 2 s, cap at 5 minutes, and add at most 20% jitter', () => {
  const none = () => 0;
  assert.equal(retryDelayMs(1, none), 2_000);
  assert.equal(retryDelayMs(2, none), 4_000);
  assert.equal(retryDelayMs(5, none), 32_000);
  assert.equal(retryDelayMs(50, none), 300_000);
  assert.equal(retryDelayMs(1, () => 1), 2_400);
});
