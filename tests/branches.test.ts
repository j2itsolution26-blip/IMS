import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_BRANCHES, chooseBranch, rankBranches, seesAllBranches } from '@/lib/branch-choice';

const read = (path: string) => readFileSync(path, 'utf8');
const at = (n: number) => new Date(Date.UTC(2026, 0, n));

test('only the owner account, with no branch of its own, sees every branch', () => {
  assert.equal(seesAllBranches({ branchId: null, role: { slug: 'owner' } }), true);
  assert.equal(seesAllBranches({ branchId: 'b2', role: { slug: 'owner' } }), false);
  assert.equal(seesAllBranches({ branchId: null, role: { slug: 'cashier' } }), false);
  assert.equal(seesAllBranches({ branchId: 'b2', role: { slug: 'inventory-staff' } }), false);
});

test('staff always get their own branch, whatever the cookie says', () => {
  const visible = ['b2'];
  for (const preference of [undefined, ALL_BRANCHES, 'main', 'other-store-branch']) {
    assert.equal(chooseBranch({ visible, mainId: 'main', assignedId: 'b2', canSwitch: false, preference }), 'b2');
  }
});

test("the owner's choice is used only when it is one of the store's active branches", () => {
  const visible = ['main', 'b2', 'b3'];
  const owner = (preference: string | undefined) => chooseBranch({ visible, mainId: 'main', assignedId: null, canSwitch: true, preference });
  assert.equal(owner(undefined), 'main');
  assert.equal(owner('b3'), 'b3');
  assert.equal(owner(ALL_BRANCHES), ALL_BRANCHES);
  // Another store's branch, or an archived one, falls back to the main branch.
  assert.equal(owner('foreign'), 'main');
  // A single-branch store never offers "all branches".
  assert.equal(chooseBranch({ visible: ['main'], mainId: 'main', assignedId: null, canSwitch: false, preference: ALL_BRANCHES }), 'main');
});

test('after a downgrade the main branch and the oldest ones stay usable; the rest are restricted', () => {
  const rows = [
    { id: 'b3', isDefault: false, createdAt: at(3) },
    { id: 'main', isDefault: true, createdAt: at(5) },
    { id: 'b2', isDefault: false, createdAt: at(2) },
    { id: 'b4', isDefault: false, createdAt: at(4) },
  ];
  assert.deepEqual(
    rankBranches(rows, 3).map((b) => [b.id, b.restricted]),
    [
      ['main', false],
      ['b2', false],
      ['b3', false],
      ['b4', true],
    ],
  );
  assert.deepEqual(
    rankBranches(rows, 1).map((b) => b.restricted),
    [false, true, true, true],
  );
  assert.ok(rankBranches(rows, null).every((b) => !b.restricted));
});

test('every write takes its branch from the server, never from the request', () => {
  const shifts = read('src/server/services/shift-service.ts');
  assert.match(shifts, /const warehouseId = await writableBranchId\(\);/);
  assert.match(shifts, /data: \{ userId: input\.userId, warehouseId,/);

  const sales = read('src/server/services/sale-service.ts');
  assert.match(sales, /const warehouseId = shift\.warehouseId;/, "a sale goes to its shift's branch");
  assert.doesNotMatch(sales, /getDefaultWarehouseId/);

  const stock = read('src/server/services/stock-movement-service.ts');
  assert.equal((stock.match(/await writableBranchId\(\)/g) ?? []).length, 2, 'stock-in and adjustments');
  assert.doesNotMatch(stock, /input\.warehouseId/);
});

test('branch management is for the owner account; the branch cookie is checked before it is kept', () => {
  const actions = read('src/features/branches/actions.ts');
  assert.match(actions, /authorize\('branches\.manage'\)/);
  assert.match(actions, /isStoreOwner\(user\.id, user\.store\.id\)/);
  for (const name of ['createBranchAction', 'updateBranchAction', 'archiveBranchAction', 'reactivateBranchAction']) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 300), /await requireOwner\(\)/, `${name} checks the owner`);
  }
  const select = actions.slice(actions.indexOf('export async function selectBranchAction'));
  assert.match(select, /scope\.canSwitch && scope\.branches\.some/);
  assert.match(select, /httpOnly: true/);
});

test('every dashboard, report, list and export over sales, stock or shifts applies the branch scope', () => {
  // Each of these reads branch-owned rows; each must take the account's branch scope.
  const readers = [
    'src/server/analytics/dashboard.ts',
    'src/server/analytics/dashboard-overview.ts',
    'src/server/analytics/sales-analytics.ts',
    'src/server/analytics/inventory-analytics.ts',
    'src/server/analytics/inventory-dashboard.ts',
    'src/server/analytics/badges.ts',
    'src/features/sales/queries.ts',
    'src/features/inventory/queries.ts',
    'src/features/products/queries.ts',
    'src/server/services/shift-service.ts',
    'src/server/services/cash-movement-queries.ts',
    'src/server/services/wallet-service.ts',
    'src/server/reports/registry.ts',
    'src/app/(app)/returns/page.tsx',
    'src/app/(app)/returns/[id]/page.tsx',
    'src/app/api/data-export/[dataset]/route.ts',
  ];
  for (const file of readers) {
    assert.match(read(file), /readBranchIds|visibleBranchIds|operatingBranchId|posBranchId/, `${file} applies the branch scope`);
  }
  // Single records are checked against the branches the account may open.
  assert.match(read('src/features/sales/queries.ts'), /findFirst\(\{\s*where: \{ id, \.\.\.whereBranch\(await visibleBranchIds\(\)\) \}/);
  assert.match(read('src/server/services/shift-service.ts'), /where: \{ id: shiftId, \.\.\.whereBranch\(await visibleBranchIds\(\)\) \}/);
  for (const file of ['src/server/services/sale-service.ts', 'src/server/services/return-service.ts']) {
    assert.match(read(file), /assertRecordBranchVisible\(sale\.warehouseId, 'Sale'\)/, `${file}: voids and refunds stay within the branch`);
  }
});

test('"all branches" means the whole store for the owner; staff and a picked branch filter to one', () => {
  const branch = read('src/lib/tenant/branch.ts');
  assert.match(branch, /filterIds: selected === ALL_BRANCHES \? null : \[selected\]/);
  assert.match(branch, /visibleIds: all \? null : visible\.map/);
});
