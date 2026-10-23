import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRIAL_DAYS,
  addMonths,
  daysUntil,
  newTrial,
  normalizeReference,
  paymentPeriod,
  shouldWarn,
} from '@/lib/subscription';
import { storeAccess } from '@/lib/store-access';
import { ALL_PERMISSIONS, STORE_PERMISSION_KEYS, ROUTE_PERMISSIONS } from '@/lib/permissions';
import { StoreScopeError, scopeArgs } from '@/lib/tenant/scope';

/**
 * Step 3's pure rules: payment periods, trials, warnings, and the isolation
 * rule for payment records. The database half is
 * tests/integration/subscriptions.integration.ts.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-10-23T04:00:00Z');

test('addMonths keeps the time and clamps to the end of shorter months', () => {
  assert.equal(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString(), '2026-02-28T10:00:00.000Z');
  assert.equal(addMonths(new Date('2028-01-31T10:00:00Z'), 1).toISOString(), '2028-02-29T10:00:00.000Z');
  assert.equal(addMonths(new Date('2026-03-15T00:00:00Z'), 12).toISOString(), '2027-03-15T00:00:00.000Z');
  assert.equal(addMonths(new Date('2026-08-31T00:00:00Z'), 6).toISOString(), '2027-02-28T00:00:00.000Z');
  assert.equal(addMonths(new Date('2026-11-30T00:00:00Z'), 3).toISOString(), '2027-02-28T00:00:00.000Z');
});

test('a payment extends from the later of now or the time already paid for', () => {
  // Early renewal: starts when the current period ends, so no day is lost.
  const later = new Date(NOW.getTime() + 10 * DAY);
  assert.equal(paymentPeriod({ status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: later }, 1, NOW).start.getTime(), later.getTime());
  // Lapsed: starts now, never backdated.
  const earlier = new Date(NOW.getTime() - 20 * DAY);
  assert.equal(paymentPeriod({ status: 'PAST_DUE', trialEndsAt: null, currentPeriodEnd: earlier }, 3, NOW).start.getTime(), NOW.getTime());
  // A running trial: the paid time starts when the trial ends.
  const trialEnd = new Date(NOW.getTime() + 5 * DAY);
  const fromTrial = paymentPeriod({ status: 'TRIAL', trialEndsAt: trialEnd, currentPeriodEnd: null }, 1, NOW);
  assert.equal(fromTrial.start.getTime(), trialEnd.getTime());
  assert.equal(fromTrial.end.toISOString(), addMonths(trialEnd, 1).toISOString());
  // An ended trial, or no dates at all: starts now.
  assert.equal(paymentPeriod({ status: 'TRIAL', trialEndsAt: earlier, currentPeriodEnd: null }, 1, NOW).start.getTime(), NOW.getTime());
  assert.equal(paymentPeriod({ status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null }, 12, NOW).start.getTime(), NOW.getTime());
});

test('the same reference typed differently is the same payment', () => {
  assert.equal(normalizeReference(' ab 12-34 \n'), 'AB12-34');
  assert.equal(normalizeReference('AB12-34'), 'AB12-34');
  assert.equal(normalizeReference('   '), '');
});

test('a new store gets a Business trial of TRIAL_DAYS days', () => {
  assert.equal(TRIAL_DAYS, 14);
  const trial = newTrial(NOW);
  assert.equal(trial.plan, 'BUSINESS');
  assert.equal(trial.status, 'TRIAL');
  assert.equal(trial.trialEndsAt.getTime() - NOW.getTime(), 14 * DAY);
  assert.equal(storeAccess({ ...trial, currentPeriodEnd: null }, NOW).state, 'TRIAL');
  assert.equal(storeAccess({ ...trial, currentPeriodEnd: null }, NOW).plan.id, 'BUSINESS');
});

test('days left round up and stop at zero', () => {
  assert.equal(daysUntil(new Date(NOW.getTime() + 1), NOW), 1);
  assert.equal(daysUntil(new Date(NOW.getTime() + 3 * DAY), NOW), 3);
  assert.equal(daysUntil(new Date(NOW.getTime() - DAY), NOW), 0);
  assert.equal(daysUntil(null, NOW), null);
});

test('the banner shows in a trial’s last week, in grace and when read-only — not before', () => {
  const trial = (days: number) => storeAccess({ plan: 'BUSINESS', status: 'TRIAL', trialEndsAt: new Date(NOW.getTime() + days * DAY), currentPeriodEnd: null }, NOW);
  assert.equal(shouldWarn(trial(10), NOW), false);
  assert.equal(shouldWarn(trial(7), NOW), true);
  assert.equal(shouldWarn(trial(1), NOW), true);
  const paid = (days: number) => storeAccess({ plan: 'BASIC', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: new Date(NOW.getTime() + days * DAY) }, NOW);
  assert.equal(shouldWarn(paid(3), NOW), false);
  assert.equal(shouldWarn(paid(-2), NOW), true); // grace
  assert.equal(shouldWarn(paid(-9), NOW), true); // read-only
  assert.equal(shouldWarn(storeAccess({ plan: 'ENTERPRISE', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null }, NOW), NOW), false);
});

test('a store client may read its own payments but never write one', () => {
  const where = (scopeArgs('SubscriptionPayment', 'findMany', {}, 'store_a') as { where: Record<string, unknown> }).where;
  assert.equal(where.storeId, 'store_a');
  assert.throws(() => scopeArgs('SubscriptionPayment', 'findMany', { where: { storeId: 'store_b' } }, 'store_a'), StoreScopeError);
  for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
    assert.throws(() => scopeArgs('SubscriptionPayment', op, { data: {} }, 'store_a'), StoreScopeError, op);
  }
});

test('billing.view: a store permission owners hold, guarding the subscription page', () => {
  assert.ok(STORE_PERMISSION_KEYS.includes('billing.view'));
  assert.ok(ROUTE_PERMISSIONS.some((r) => r.prefix === '/settings/subscription' && r.permission === 'billing.view'));
  // The migration inserts the row by hand; it must match the catalogue bootstrap would write.
  const definition = ALL_PERMISSIONS.find((p) => p.key === 'billing.view');
  const sql = readFileSync('prisma/migrations/20261026090000_subscriptions/migration.sql', 'utf8');
  assert.ok(definition && sql.includes(`'billing.view', 'billing', 'view', '${definition.description}'`), definition?.description);
  // /settings/subscription must win over the broader /settings rule.
  const index = (prefix: string) => ROUTE_PERMISSIONS.findIndex((r) => r.prefix === prefix);
  assert.ok(index('/settings/subscription') < index('/settings'));
});
