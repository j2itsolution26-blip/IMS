import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GRACE_DAYS, PLANS, PLAN_ORDER, lowestPlanWith, planLimitFromDatabase } from '@/lib/plans';
import { effectivePlanId, storeAccess, storedLimits, type StoreSubscription } from '@/lib/store-access';
import { isRawWrite, isReadOnlyRefused } from '@/lib/tenant/scope';

/**
 * Subscription plans and what a store may do at a given moment — the pure
 * half of step 2. The database half (the quota trigger under concurrency,
 * read-only clients) is in the integration suite.
 */

const DAY = 86_400_000;
const END = new Date('2026-11-01T00:00:00Z');
const at = (offsetMs: number) => new Date(END.getTime() + offsetMs);
const sub = (overrides: Partial<StoreSubscription>): StoreSubscription => ({
  plan: 'BASIC',
  status: 'ACTIVE',
  trialEndsAt: null,
  currentPeriodEnd: END,
  ...overrides,
});

test('plans grow monotonically: a higher plan never allows less', () => {
  for (let i = 1; i < PLAN_ORDER.length; i++) {
    const lower = PLANS[PLAN_ORDER[i - 1]];
    const higher = PLANS[PLAN_ORDER[i]];
    for (const key of Object.keys(lower.limits) as (keyof typeof lower.limits)[]) {
      const a = lower.limits[key];
      const b = higher.limits[key];
      assert.ok(b === null || (a !== null && b >= a), `${higher.id}.${key} must be >= ${lower.id}.${key}`);
    }
    for (const feature of Object.keys(lower.features) as (keyof typeof lower.features)[]) {
      assert.ok(!lower.features[feature] || higher.features[feature], `${higher.id} must keep ${feature}`);
    }
  }
});

test('locked-feature messages name the cheapest plan that has it', () => {
  assert.equal(lowestPlanWith('reportExports')?.id, 'BUSINESS');
  assert.equal(lowestPlanWith('customRoles')?.id, 'BUSINESS');
  assert.equal(lowestPlanWith('backgroundRemoval')?.id, 'BUSINESS');
});

test('staff accounts per plan: Basic 2, Business 10, Enterprise unlimited', () => {
  assert.equal(PLANS.BASIC.limits.staff, 2);
  assert.equal(PLANS.BUSINESS.limits.staff, 10);
  assert.equal(PLANS.ENTERPRISE.limits.staff, null);
  assert.equal(PLANS.BASIC.limits.products, 1500);
});

test('a trial follows the plan recorded on the store, never a higher one', () => {
  assert.equal(effectivePlanId({ plan: 'BASIC', status: 'TRIAL' }), 'BASIC');
  assert.equal(effectivePlanId({ plan: 'BUSINESS', status: 'TRIAL' }), 'BUSINESS');
  assert.equal(effectivePlanId({ plan: 'ENTERPRISE', status: 'TRIAL' }), 'ENTERPRISE');
  assert.equal(effectivePlanId({ plan: 'BASIC', status: 'ACTIVE' }), 'BASIC');
  assert.equal(effectivePlanId({ plan: 'BUSINESS', status: 'PAST_DUE' }), 'BUSINESS');
});

test('an active subscription is writable until its period ends', () => {
  assert.deepEqual(
    [storeAccess(sub({}), at(-1)).state, storeAccess(sub({}), at(-1)).writable],
    ['ACTIVE', true],
  );
  // No end date (e.g. a manually managed account) never lapses.
  assert.equal(storeAccess(sub({ currentPeriodEnd: null }), at(400 * DAY)).state, 'ACTIVE');
});

test('the grace period lasts exactly GRACE_DAYS, then the store is read-only', () => {
  assert.equal(GRACE_DAYS, 7);
  const onEnd = storeAccess(sub({}), at(0));
  assert.equal(onEnd.state, 'GRACE');
  assert.equal(onEnd.writable, true);
  assert.equal(onEnd.graceEndsAt?.toISOString(), at(7 * DAY).toISOString());

  assert.equal(storeAccess(sub({}), at(7 * DAY - 1)).state, 'GRACE');
  const after = storeAccess(sub({}), at(7 * DAY));
  assert.equal(after.state, 'READ_ONLY');
  assert.equal(after.writable, false);
  assert.equal(storeAccess(sub({}), at(8 * DAY)).state, 'READ_ONLY');
});

test('trials count from the trial end date', () => {
  const trial = sub({ status: 'TRIAL', trialEndsAt: END, currentPeriodEnd: null });
  assert.equal(storeAccess(trial, at(-DAY)).state, 'TRIAL');
  assert.equal(storeAccess(trial, at(DAY)).state, 'GRACE');
  assert.equal(storeAccess(trial, at(7 * DAY)).state, 'READ_ONLY');
  // A trial with no end date (stores created before trials had one) keeps working.
  assert.equal(storeAccess(sub({ status: 'TRIAL', trialEndsAt: null }), at(999 * DAY)).state, 'TRIAL');
});

test('past due counts the grace period from the period end, or is read-only without one', () => {
  const pastDue = sub({ status: 'PAST_DUE' });
  // Marked past due before the period end: in grace already, until 7 days after the end.
  assert.equal(storeAccess(pastDue, at(-3 * DAY)).state, 'GRACE');
  assert.equal(storeAccess(pastDue, at(6 * DAY)).state, 'GRACE');
  assert.equal(storeAccess(pastDue, at(7 * DAY)).state, 'READ_ONLY');
  assert.equal(storeAccess(sub({ status: 'PAST_DUE', currentPeriodEnd: null }), at(0)).state, 'READ_ONLY');
});

test('a suspended store is never writable', () => {
  const suspended = storeAccess(sub({ status: 'SUSPENDED', currentPeriodEnd: at(30 * DAY) }), at(0));
  assert.equal(suspended.state, 'SUSPENDED');
  assert.equal(suspended.writable, false);
});

test('the quotas copied onto the store row follow the effective plan', () => {
  assert.deepEqual(storedLimits({ plan: 'BASIC', status: 'ACTIVE' }), { productLimit: 1500, staffLimit: 2 });
  assert.deepEqual(storedLimits({ plan: 'BASIC', status: 'TRIAL' }), { productLimit: 1500, staffLimit: 2 });
  assert.deepEqual(storedLimits({ plan: 'BUSINESS', status: 'TRIAL' }), { productLimit: 5000, staffLimit: 10 });
  assert.deepEqual(storedLimits({ plan: 'BUSINESS', status: 'PAST_DUE' }), { productLimit: 5000, staffLimit: 10 });
  assert.deepEqual(storedLimits({ plan: 'ENTERPRISE', status: 'ACTIVE' }), { productLimit: null, staffLimit: null });
});

test('the latest migration backfill uses the same numbers as the plan configuration', () => {
  const sql = readFileSync('prisma/migrations/20261109090000_basic_product_limit/migration.sql', 'utf8');
  const backfill = sql.slice(sql.indexOf('UPDATE "stores"'), sql.indexOf('-- End backfill.'));
  // Trials are no longer lifted to another plan's quotas.
  assert.doesNotMatch(backfill, /TRIAL/);
  const numbers = (column: string) =>
    [...backfill.slice(backfill.indexOf(`"${column}" = CASE`)).matchAll(/THEN (\d+)|ELSE (\d+)/g)]
      .slice(0, 2)
      .map((m) => Number(m[1] ?? m[2]));
  assert.deepEqual(numbers('productLimit'), [PLANS.BUSINESS.limits.products, PLANS.BASIC.limits.products]);
  assert.deepEqual(numbers('staffLimit'), [PLANS.BUSINESS.limits.staff, PLANS.BASIC.limits.staff]);
  assert.equal(PLANS.ENTERPRISE.limits.products, null);
  assert.equal(PLANS.ENTERPRISE.limits.staff, null);
});

test('a quota the database refused becomes a plan message', () => {
  assert.match(planLimitFromDatabase('ERROR: PLAN_LIMIT: products 500') ?? '', /allows 500 products/);
  assert.match(planLimitFromDatabase('PLAN_LIMIT: staff 2') ?? '', /allows 2 active staff accounts/);
  assert.equal(planLimitFromDatabase('duplicate key value'), null);
});

test('a read-only client refuses every model write except audit entries', () => {
  for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
    assert.equal(isReadOnlyRefused('Product', op), true, op);
  }
  for (const op of ['findMany', 'findUnique', 'findFirst', 'count', 'aggregate', 'groupBy']) {
    assert.equal(isReadOnlyRefused('Product', op), false, op);
  }
  assert.equal(isReadOnlyRefused('AuditLog', 'create'), false);
  assert.equal(isReadOnlyRefused('AuditLog', 'deleteMany'), true);
});

test('a read-only client tells raw writes from raw reads', () => {
  const tagged = (strings: string[]) => [Object.assign([...strings], { raw: strings }), 1];
  assert.equal(isRawWrite(tagged(['INSERT INTO store_usage VALUES (', ')'])), true);
  assert.equal(isRawWrite(tagged(['\n  update products set x = ', ''])), true);
  assert.equal(isRawWrite('DELETE FROM products'), true);
  assert.equal(isRawWrite(['TRUNCATE sales']), true);
  assert.equal(isRawWrite({ strings: ['WITH gone AS (DELETE FROM products WHERE id = ', ') SELECT 1'] }), true);

  assert.equal(isRawWrite(tagged(['SELECT id FROM cashier_shifts WHERE id = ', ' FOR UPDATE'])), false);
  assert.equal(isRawWrite({ strings: ['WITH qualifying AS (SELECT "updatedAt" FROM sales) SELECT * FROM qualifying'] }), false);
  assert.equal(isRawWrite('SELECT 1'), false);
});
