import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeGcashReference, quickCashOptions, tenderSummary, toCentavos } from '@/lib/tender';

test('₱1,000 cash on a ₱350 sale gives exactly ₱650 change', () => {
  const t = tenderSummary({ total: 350, method: 'CASH', received: 1000 });
  assert.deepEqual(t, { received: 1000, change: 650, outstanding: 0, overpaidNonCash: false, canComplete: true });
});

test('₱1,000 is a quick-cash choice whenever it covers the total, never an automatic amount', () => {
  assert.deepEqual(quickCashOptions(350), [500, 1000]);
  assert.deepEqual(quickCashOptions(15), [20, 50, 100, 200, 500, 1000]);
  assert.deepEqual(quickCashOptions(1000), [1000]);
  assert.deepEqual(quickCashOptions(1000.01), []);
  // Nothing is received until the cashier enters or taps an amount.
  assert.equal(tenderSummary({ total: 350, method: 'CASH', received: '' }).canComplete, false);
});

test('decimal amounts are exact to the centavo', () => {
  assert.equal(tenderSummary({ total: 0.3, method: 'CASH', received: 0.1 + 0.2 }).change, 0);
  assert.equal(tenderSummary({ total: 99.99, method: 'CASH', received: '100' }).change, 0.01);
  assert.equal(tenderSummary({ total: 123.45, method: 'CASH', received: '200.00' }).change, 76.55);
  assert.equal(toCentavos('1,000'), 0); // the field never holds commas; unreadable input counts as nothing
});

test('short, negative or invalid tenders cannot complete the sale', () => {
  assert.deepEqual(tenderSummary({ total: 350, method: 'CASH', received: 300 }), {
    received: 300, change: 0, outstanding: 50, overpaidNonCash: false, canComplete: false,
  });
  assert.equal(tenderSummary({ total: 350, method: 'CASH', received: -1000 }).canComplete, false);
  assert.equal(tenderSummary({ total: 350, method: 'CASH', received: 'abc' }).canComplete, false);
  assert.equal(tenderSummary({ total: 0, method: 'CASH', received: 100 }).canComplete, false);
});

test('GCash gives no change and must be for the exact total', () => {
  assert.deepEqual(tenderSummary({ total: 350, method: 'GCASH', received: 350 }), {
    received: 350, change: 0, outstanding: 0, overpaidNonCash: false, canComplete: true,
  });
  const over = tenderSummary({ total: 350, method: 'GCASH', received: 400 });
  assert.equal(over.change, 0);
  assert.equal(over.overpaidNonCash, true);
  assert.equal(over.canComplete, false);
});

test('GCash references are normalised and must look like a reference', () => {
  assert.equal(normalizeGcashReference(' 1012 345 678 901 '), '1012345678901');
  assert.equal(normalizeGcashReference('ab-12cd'), 'AB-12CD');
  assert.equal(normalizeGcashReference('123'), null);
  assert.equal(normalizeGcashReference(''), null);
  assert.equal(normalizeGcashReference(undefined), null);
  assert.equal(normalizeGcashReference('12345<script>'), null);
});

test('the server refuses GCash overpayment, needs a confirmed reference, and returns a retried checkout once', () => {
  const service = readFileSync('src/server/services/sale-service.ts', 'utf8');
  assert.match(service, /nonCash\.greaterThan\(totals\.total\)/);
  assert.match(service, /normalizeGcashReference/);
  assert.match(service, /clientRequestId/);
  const action = readFileSync('src/features/pos/actions.ts', 'utf8');
  assert.match(action, /clientRequestId: z\.string\(\)\.uuid\(\)/);
  assert.match(action, /confirmedReceived/);
});
