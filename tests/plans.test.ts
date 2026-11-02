import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GRACE_DAYS, PLANS, PLAN_ORDER, STAFF_SLOT_ROLES, isStaffSlotRole, lowestPlanWith, planLimitFromDatabase, roleSlotMessage } from '@/lib/plans';
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
  assert.deepEqual(storedLimits({ plan: 'BASIC', status: 'ACTIVE' }), { productLimit: 1500, staffLimit: 2, staffRoleLimit: 1, branchLimit: 1 });
  assert.deepEqual(storedLimits({ plan: 'BASIC', status: 'TRIAL' }), { productLimit: 1500, staffLimit: 2, staffRoleLimit: 1, branchLimit: 1 });
  assert.deepEqual(storedLimits({ plan: 'BUSINESS', status: 'TRIAL' }), { productLimit: 5000, staffLimit: 10, staffRoleLimit: null, branchLimit: 3 });
  assert.deepEqual(storedLimits({ plan: 'BUSINESS', status: 'PAST_DUE' }), { productLimit: 5000, staffLimit: 10, staffRoleLimit: null, branchLimit: 3 });
  assert.deepEqual(storedLimits({ plan: 'ENTERPRISE', status: 'ACTIVE' }), { productLimit: null, staffLimit: null, staffRoleLimit: null, branchLimit: 5 });
});

test('locations: Basic 1, Business 3, Enterprise 5, and the branch migration backfills the same', () => {
  assert.deepEqual(['BASIC', 'BUSINESS', 'ENTERPRISE'].map((id) => PLANS[id as keyof typeof PLANS].limits.branches), [1, 3, 5]);
  const sql = readFileSync('prisma/migrations/20261112090000_branch_limits/migration.sql', 'utf8');
  const backfill = sql.slice(sql.indexOf('-- Backfill.'), sql.indexOf('-- End backfill.'));
  assert.match(backfill, /'BASIC' THEN 1\s/);
  assert.match(backfill, /'BUSINESS' THEN 3\s/);
  assert.match(backfill, /ELSE 5 END/);
  // The trigger locks the store row, so concurrent creates take turns.
  assert.match(sql, /FROM "stores" WHERE "id" = NEW\."storeId" FOR UPDATE/);
  // Branches are archived, never deleted while they have history.
  assert.match(sql, /BEFORE DELETE ON "warehouses"/);
  assert.doesNotMatch(sql, /DELETE FROM "(warehouses|sales|inventory|inventory_transactions)"/);
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
  assert.match(planLimitFromDatabase('PLAN_LIMIT: role cashier 1') ?? '', /allows 1 active Cashier account\./);
  assert.match(planLimitFromDatabase('PLAN_LIMIT: role inventory-staff 1') ?? '', /1 active Inventory Staff account/);
  assert.match(planLimitFromDatabase('PLAN_LIMIT: custom-role') ?? '', /must be a Cashier or Inventory Staff/);
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

test('every plan includes the core store operations, and nothing announced is sold', async () => {
  const { CORE_FEATURES, COMING_SOON } = await import('@/lib/plans');
  for (const feature of [
    'POS checkout and barcode scanning',
    'Inventory, stock-in and adjustments',
    'Low-stock indicators',
    'Product photos and printable receipts',
    'Cashier shifts and cash reconciliation',
    'Refunds, voids and cash movements',
    'Sales dashboard and standard reports',
  ]) {
    assert.ok((CORE_FEATURES as readonly string[]).includes(feature), `missing core feature: ${feature}`);
  }
  assert.ok(COMING_SOON.some((item) => /stock transfers/i.test(item)));
});

test('changing any role\'s permissions is a paid feature, checked on the server', () => {
  const source = readFileSync('src/features/admin/actions.ts', 'utf8');
  const update = source.slice(source.indexOf('export async function updateRolePermissions'), source.indexOf('export async function deleteRole'));
  assert.match(update, /await requireFeature\('customRoles'\);/, 'built-in and custom roles alike');
  assert.doesNotMatch(update, /if \(!role\.isSystem\) await requireFeature/, 'built-in roles must not be exempt');
  // Creating a role is gated too; assigning and deleting are not.
  const create = source.slice(source.indexOf('export async function createRole'), source.indexOf('export async function updateRolePermissions'));
  assert.match(create, /requireFeature\('customRoles'\)/);
  const del = source.slice(source.indexOf('export async function deleteRole'), source.indexOf('// --- Profile'));
  assert.doesNotMatch(del, /requireFeature/);
  // The editor locks built-in roles on Basic as well (the Owner role is never editable).
  const manager = readFileSync('src/features/admin/roles-manager.tsx', 'utf8');
  assert.match(manager, /const planLocked = Boolean\(customRolesLock\) && selected !== undefined && !isOwner;/);
});

test('printing the shift list is on every plan; only the file export is gated', () => {
  const page = readFileSync('src/app/(app)/shifts/page.tsx', 'utf8');
  const gate = page.slice(page.indexOf('<PlanGate'), page.indexOf('</PlanGate>'));
  assert.doesNotMatch(gate, /print/i);
  assert.match(page, /<PrintButton \/>/);
  assert.doesNotMatch(readFileSync('src/features/shifts/shift-export-menu.tsx', 'utf8'), /window\.print/);
});

test('role slots: Basic has one Cashier and one Inventory Staff; Business and Enterprise any mix', () => {
  assert.equal(PLANS.BASIC.staffPerRole, 1);
  assert.equal(PLANS.BUSINESS.staffPerRole, null);
  assert.equal(PLANS.ENTERPRISE.staffPerRole, null);
  // The slots fit inside the total, so the total never lets a third role in.
  assert.equal(STAFF_SLOT_ROLES.length * (PLANS.BASIC.staffPerRole ?? 0), PLANS.BASIC.limits.staff);
  assert.deepEqual(STAFF_SLOT_ROLES.map((role) => role.slug), ['cashier', 'inventory-staff']);
  assert.equal(isStaffSlotRole('cashier'), true);
  assert.equal(isStaffSlotRole('owner'), false);
  assert.equal(isStaffSlotRole('supervisor'), false);
  assert.match(roleSlotMessage('cashier', 1, 'Maria (@maria)'), /Cashier slot is already used by Maria \(@maria\)/);
});

test('the role-slot migration backfills the plan configuration and guards role changes', () => {
  const sql = readFileSync('prisma/migrations/20261111090000_staff_role_slots/migration.sql', 'utf8');
  const backfill = sql.slice(sql.indexOf('UPDATE "stores"'), sql.indexOf('-- End backfill.'));
  assert.match(backfill, new RegExp(`WHEN "plan" = 'BASIC' THEN ${PLANS.BASIC.staffPerRole}\\b`));
  assert.match(backfill, /ELSE NULL END/);
  // The trigger re-runs on a role change, and the slot roles in SQL match the app's.
  assert.match(sql, /BEFORE INSERT OR UPDATE OF "isActive", "storeId", "roleId" ON "users"/);
  assert.match(sql, new RegExp(`NOT IN \\(${STAFF_SLOT_ROLES.map((role) => `'${role.slug}'`).join(', ')}\\)`));
  // Nothing is deleted or switched off by the migration itself.
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /DELETE FROM|UPDATE "users"|"isActive" = false/i);
});

test('staff actions check role slots on create, role change and reactivation', () => {
  const source = readFileSync('src/features/admin/actions.ts', 'utf8');
  const slice = (from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to));
  assert.match(slice('export async function createUser', 'function errorText'), /requireStaffRoleSlot\(ctx, role\.slug/);
  assert.match(slice('export async function createUser', 'function errorText'), /checkRateLimit\(`staff-create:/);
  assert.match(slice('export async function updateUser', 'const statusSchema'), /requireStaffRoleSlot\(.*newRole\.slug, \{ exceptUserId: id/);
  assert.match(slice('export async function setUserStatus', 'const resetPasswordSchema'), /requireStaffRoleSlot\(ctx, target\.role\.slug, \{ exceptUserId: id \}\)/);
});
