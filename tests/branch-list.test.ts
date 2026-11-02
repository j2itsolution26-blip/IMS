import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLANS } from '@/lib/plans';
import { PLAN_ORDER } from '@/lib/plans';
import { branchCapacity, branchParamsQuery, branchSummary, filterBranches, parseBranchParams, staffByRole, upgradePath } from '@/lib/branch-list';

const branch = (id: string, name: string, code: string, isActive: boolean, day: number, isDefault = false) => ({
  id,
  name,
  code,
  isActive,
  isDefault,
  createdAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
});

const rows = [
  branch('main', 'Zamboanga Main', 'BR1', true, 1, true),
  branch('b2', 'Agdao Branch', 'AGD', true, 5),
  branch('b3', 'Bajada Outlet', 'BJD', false, 3),
  branch('b4', 'Calinan Store', 'CLN', true, 9),
];
const ids = (list: { id: string }[]) => list.map((row) => row.id);

test('search matches the branch name or code, ignoring case', () => {
  assert.deepEqual(ids(filterBranches(rows, { q: 'agdao', status: 'all', sort: 'name' })), ['b2']);
  assert.deepEqual(ids(filterBranches(rows, { q: 'cln', status: 'all', sort: 'name' })), ['b4']);
  assert.deepEqual(ids(filterBranches(rows, { q: 'nothing', status: 'all', sort: 'name' })), []);
});

test('the status filter keeps active or inactive branches only', () => {
  assert.deepEqual(ids(filterBranches(rows, { q: '', status: 'active', sort: 'name' })), ['main', 'b2', 'b4']);
  assert.deepEqual(ids(filterBranches(rows, { q: '', status: 'inactive', sort: 'name' })), ['b3']);
  assert.deepEqual(ids(filterBranches(rows, { q: 'agdao', status: 'inactive', sort: 'name' })), []);
});

test('sorting: name (main first), recently added (newest first), status (active first)', () => {
  assert.deepEqual(ids(filterBranches(rows, { q: '', status: 'all', sort: 'name' })), ['main', 'b2', 'b3', 'b4']);
  assert.deepEqual(ids(filterBranches(rows, { q: '', status: 'all', sort: 'recent' })), ['b4', 'b2', 'b3', 'main']);
  assert.deepEqual(ids(filterBranches(rows, { q: '', status: 'all', sort: 'status' })), ['main', 'b2', 'b4', 'b3']);
});

test('capacity for each plan uses the plan configuration, not numbers of its own', () => {
  assert.deepEqual([PLANS.BASIC.limits.branches, PLANS.BUSINESS.limits.branches, PLANS.ENTERPRISE.limits.branches], [1, 3, 5]);

  const basic = branchCapacity(1, PLANS.BASIC.limits.branches);
  assert.deepEqual(basic, { used: 1, limit: 1, remaining: 0, percent: 100, full: true, over: false });

  const business = branchCapacity(2, PLANS.BUSINESS.limits.branches);
  assert.deepEqual(business, { used: 2, limit: 3, remaining: 1, percent: 67, full: false, over: false });

  const enterprise = branchCapacity(4, PLANS.ENTERPRISE.limits.branches);
  assert.deepEqual(enterprise, { used: 4, limit: 5, remaining: 1, percent: 80, full: false, over: false });
});

test('after a downgrade the capacity reads as over, with no negative slots and a capped bar', () => {
  assert.deepEqual(branchCapacity(3, 1), { used: 3, limit: 1, remaining: 0, percent: 100, full: true, over: true });
  assert.deepEqual(branchCapacity(7, null), { used: 7, limit: null, remaining: null, percent: 0, full: false, over: false });
});

test('the summary counts listed branches and each staff account once', () => {
  const staff = [
    { id: 'u1', branchId: 'main' },
    { id: 'u2', branchId: 'b2' },
    { id: 'u2', branchId: 'b2' }, // a repeated row is still one person
    { id: 'u9', branchId: 'other-store-branch' }, // not a listed branch
  ];
  assert.deepEqual(branchSummary(rows, staff), { total: 4, active: 3, inactive: 1, assignedStaff: 2 });
  assert.deepEqual(branchSummary([], staff), { total: 0, active: 0, inactive: 0, assignedStaff: 0 });
});

test('list choices survive the address: unknown values fall back, defaults stay out of the URL', () => {
  assert.deepEqual(parseBranchParams({}), { q: '', status: 'all', sort: 'name', view: 'list' });
  assert.deepEqual(parseBranchParams({ q: ' agd ', status: 'inactive', sort: 'recent', view: 'grid' }), { q: 'agd', status: 'inactive', sort: 'recent', view: 'grid' });
  assert.deepEqual(parseBranchParams({ status: 'deleted', sort: ['status', 'x'], view: 'table' }), { q: '', status: 'all', sort: 'status', view: 'list' });
  assert.equal(branchParamsQuery({ q: '', status: 'all', sort: 'name', view: 'list' }), '');
  assert.equal(branchParamsQuery({ q: 'a b', status: 'active', sort: 'name', view: 'grid' }), '?q=a+b&status=active&view=grid');
});

test('the branch page reads branches and staff through the store-scoped client and the viewer’s branch scope', () => {
  const page = readFileSync('src/app/(app)/settings/branches/page.tsx', 'utf8');
  assert.match(page, /getStoreContext\(\)/);
  assert.match(page, /scope\.visibleIds/);
  assert.match(page, /ctx\.db\.user\.findMany/);
  assert.match(page, /STORE_ACCOUNT_WHERE/);
  assert.doesNotMatch(page, /platformPrisma|prisma\./);
  const manager = readFileSync('src/features/branches/branches-manager.tsx', 'utf8');
  assert.doesNotMatch(manager, /limit[^=]*=\s*[135]\b/, 'no plan limit written into the screen');
});

test('staff by role reads "2 Cashier, 1 Inventory Staff", largest group first', () => {
  assert.equal(staffByRole(['Inventory Staff', 'Cashier', 'Cashier']), '2 Cashier, 1 Inventory Staff');
  assert.equal(staffByRole([]), '');
});

test('the upgrade path lists the higher plans with their own branch limits', () => {
  const above = (id: (typeof PLAN_ORDER)[number]) =>
    PLAN_ORDER.slice(PLAN_ORDER.indexOf(id) + 1).map((plan) => ({ name: PLANS[plan].name, branches: PLANS[plan].limits.branches }));
  assert.equal(upgradePath(above('BASIC')), 'Upgrade to Business (up to 3) or Enterprise (up to 5)');
  assert.equal(upgradePath(above('BUSINESS')), 'Upgrade to Enterprise (up to 5)');
  assert.equal(upgradePath(above('ENTERPRISE')), null);
});
