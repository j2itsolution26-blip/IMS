import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countByFilter, filterRows, matchesFilter, type SubscriptionRow } from '@/lib/subscription-filters';

const base: SubscriptionRow = {
  storeId: 's',
  storeName: 'Sari Store',
  owner: { name: 'Maria Santos', username: 'maria', email: 'maria@example.test', phone: null },
  plan: 'BUSINESS',
  lifecycle: 'TRIAL',
  billing: null,
  grace: false,
  readOnly: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  openInvoice: null,
  pendingPaymentId: null,
  lastVerifiedPayment: null,
  lastPaymentStatus: null,
};
const row = (over: Partial<SubscriptionRow>): SubscriptionRow => ({ ...base, ...over });

test('active trials include trials ending soon; ending soon is its own filter', () => {
  assert.equal(matchesFilter(row({ lifecycle: 'TRIAL' }), 'trial'), true);
  assert.equal(matchesFilter(row({ lifecycle: 'TRIAL_ENDING_SOON' }), 'trial'), true);
  assert.equal(matchesFilter(row({ lifecycle: 'TRIAL_ENDING_SOON' }), 'trial-ending'), true);
  assert.equal(matchesFilter(row({ lifecycle: 'TRIAL' }), 'trial-ending'), false);
  assert.equal(matchesFilter(row({ lifecycle: 'TRIAL_EXPIRED' }), 'trial'), false);
});

test('billing filters follow the billing flag, independent of the lifecycle', () => {
  const pending = row({ lifecycle: 'TRIAL_EXPIRED', billing: 'PAYMENT_PENDING' });
  assert.equal(matchesFilter(pending, 'pending'), true);
  assert.equal(matchesFilter(pending, 'trial-expired'), true);
  assert.equal(matchesFilter(pending, 'past-due'), false);
  assert.equal(matchesFilter(row({ billing: 'PAST_DUE' }), 'past-due'), true);
  assert.equal(matchesFilter(row({ billing: 'PLAN_SELECTED' }), 'plan-selected'), true);
  assert.equal(matchesFilter(row({ billing: 'PAYMENT_DUE' }), 'payment-due'), true);
});

test('an expired trial without an invoice owes nothing and is in no billing filter', () => {
  const expired = row({ lifecycle: 'TRIAL_EXPIRED', billing: null });
  for (const filter of ['plan-selected', 'payment-due', 'pending', 'past-due'] as const) {
    assert.equal(matchesFilter(expired, filter), false, filter);
  }
});

test('grace, paid and suspended filters', () => {
  assert.equal(matchesFilter(row({ lifecycle: 'TRIAL_EXPIRED', grace: true }), 'grace'), true);
  assert.equal(matchesFilter(row({ lifecycle: 'ACTIVE_PAID' }), 'paid'), true);
  assert.equal(matchesFilter(row({ lifecycle: 'SUSPENDED' }), 'suspended'), true);
  assert.equal(matchesFilter(row({ lifecycle: 'SUSPENDED' }), 'paid'), false);
});

test('counts cover every filter and search matches store, owner, email and invoice', () => {
  const rows = [
    row({ storeId: 'a', storeName: 'Aling Nena', lifecycle: 'TRIAL_ENDING_SOON' }),
    row({
      storeId: 'b',
      storeName: 'Bodega',
      lifecycle: 'ACTIVE_PAID',
      billing: 'PLAN_SELECTED',
      openInvoice: { id: 'i', number: 'INV-20261029-ABC123', plan: 'BASIC', interval: 'MONTHLY', amount: 499, currency: 'PHP', dueAt: new Date() },
    }),
    row({ storeId: 'c', storeName: 'Carinderia', lifecycle: 'SUSPENDED', owner: null }),
  ];
  const counts = countByFilter(rows);
  assert.equal(counts.all, 3);
  assert.equal(counts.trial, 1);
  assert.equal(counts['trial-ending'], 1);
  assert.equal(counts.paid, 1);
  assert.equal(counts['plan-selected'], 1);
  assert.equal(counts.suspended, 1);

  assert.deepEqual(filterRows(rows, 'all', 'abc123').map((r) => r.storeId), ['b']);
  assert.deepEqual(filterRows(rows, 'all', 'MARIA@').map((r) => r.storeId), ['a', 'b']);
  assert.deepEqual(filterRows(rows, 'paid', 'aling').map((r) => r.storeId), []);
  assert.deepEqual(filterRows(rows, 'all', '').length, 3);
});
