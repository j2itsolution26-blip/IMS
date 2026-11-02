import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Branch (location) limits and lifecycle against a real PostgreSQL database
 * (migration 20261112090000): each plan stops at its number of active
 * branches, concurrent creates end exactly at the limit, archived branches
 * free their place, the main branch stays, history is never deleted, a
 * lowered limit deletes nothing, and one store cannot reach another's
 * branches.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Local databases only, like the store-isolation suite.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('branches (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run branch tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;

  let platform: PrismaClient;
  let storeClient: (storeId: string, options?: { writable?: boolean }) => PrismaClient;
  const run = randomBytes(4).toString('hex');
  let seq = 0;

  const isQuota = (error: unknown) => /PLAN_LIMIT: branches/.test(String((error as Error)?.message ?? error));
  const isRule = (error: unknown) => /BRANCH_RULE/.test(String((error as Error)?.message ?? error));

  /** A store on a plan, with quotas copied the way every platform action copies them, and its main branch. */
  async function makeStore(plan: 'BASIC' | 'BUSINESS' | 'ENTERPRISE') {
    const { storedLimits } = await import('@/lib/store-access');
    const tag = `${run}_${++seq}`;
    const storeId = `br_${tag}`;
    await platform.store.create({
      data: { id: storeId, name: `Branch ${tag}`, slug: storeId.replace(/_/g, '-'), status: 'ACTIVE', plan, ...storedLimits({ plan, status: 'ACTIVE' }) },
    });
    const main = await platform.warehouse.create({ data: { storeId, code: 'MAIN', name: 'Main Store', isDefault: true } });
    return { storeId, mainId: main.id, tag };
  }

  const branch = (n: number) => ({ code: `BR${n}`, name: `Branch ${n}` });

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    ({ storeClient } = await import('@/lib/tenant/client'));
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);
  });

  after(async () => {
    await platform?.$disconnect();
  });

  describe('plan limits', () => {
    for (const [plan, limit] of [['BASIC', 1], ['BUSINESS', 3], ['ENTERPRISE', 5]] as const) {
      test(`${plan} runs ${limit} active location(s) and refuses one more`, async () => {
        const s = await makeStore(plan);
        const db = storeClient(s.storeId);
        for (let n = 2; n <= limit; n++) await db.warehouse.create({ data: branch(n) });
        assert.equal(await db.warehouse.count({ where: { isActive: true } }), limit);
        await assert.rejects(db.warehouse.create({ data: branch(limit + 1) }), (error) => isQuota(error) && new RegExp(`branches ${limit}\\b`).test(String(error)));
      });
    }

    test('20 concurrent creates on Business end at exactly 3 active branches', async () => {
      const s = await makeStore('BUSINESS');
      const db = storeClient(s.storeId);
      const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => db.warehouse.create({ data: branch(i + 2) })));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
      for (const r of results) if (r.status === 'rejected') assert.ok(isQuota(r.reason), String(r.reason));
      assert.equal(await db.warehouse.count({ where: { isActive: true } }), 3);
    });

    test('devices and accounts never use a location: only branches count', async () => {
      const s = await makeStore('BASIC');
      const db = storeClient(s.storeId);
      // Sessions, users and settings are per device or person; none is a warehouse.
      assert.equal(await db.warehouse.count({ where: { isActive: true } }), 1);
      await assert.rejects(db.warehouse.create({ data: branch(2) }), isQuota);
    });
  });

  describe('lifecycle', () => {
    test('an archived branch frees its place; reactivating needs a free place again', async () => {
      const s = await makeStore('BUSINESS');
      const db = storeClient(s.storeId);
      const b2 = await db.warehouse.create({ data: branch(2) });
      await db.warehouse.create({ data: branch(3) });
      await db.warehouse.update({ where: { id: b2.id }, data: { isActive: false } });
      const b4 = await db.warehouse.create({ data: branch(4) });
      await assert.rejects(db.warehouse.update({ where: { id: b2.id }, data: { isActive: true } }), isQuota);
      await db.warehouse.update({ where: { id: b4.id }, data: { isActive: false } });
      await db.warehouse.update({ where: { id: b2.id }, data: { isActive: true } });
      assert.equal(await db.warehouse.count({ where: { isActive: true } }), 3);
    });

    test('the main branch cannot be archived or demoted, and there is only one', async () => {
      const s = await makeStore('ENTERPRISE');
      const db = storeClient(s.storeId);
      await assert.rejects(db.warehouse.update({ where: { id: s.mainId }, data: { isActive: false } }), isRule);
      await assert.rejects(db.warehouse.update({ where: { id: s.mainId }, data: { isDefault: false } }), isRule);
      const other = await db.warehouse.create({ data: branch(2) });
      await assert.rejects(db.warehouse.update({ where: { id: other.id }, data: { isDefault: true } }), isRule);
    });

    test('a branch with stock history cannot be deleted; an empty one can', async () => {
      const s = await makeStore('BUSINESS');
      const db = storeClient(s.storeId);
      const used = await db.warehouse.create({ data: branch(2) });
      const empty = await db.warehouse.create({ data: branch(3) });
      const category = await db.category.create({ data: { name: `Cat ${s.tag}`, slug: `cat-${s.tag}` } });
      const product = await db.product.create({ data: { sku: `SKU-${s.tag}`, name: 'Item', categoryId: category.id, sellingPrice: 10, costPrice: 5 } });
      await db.inventoryTransaction.create({
        data: { productId: product.id, warehouseId: used.id, type: 'STOCK_IN', quantity: 5, balanceBefore: 0, balanceAfter: 5 },
      });
      await assert.rejects(platform.warehouse.delete({ where: { id: used.id } }), isRule);
      assert.equal(await db.inventoryTransaction.count({ where: { warehouseId: used.id } }), 1);
      await platform.warehouse.delete({ where: { id: empty.id } });
    });
  });

  describe('downgrade', () => {
    test('lowering the limit deletes nothing and only stops new branches', async () => {
      const { syncLimits } = await import('@/server/platform/store-setup');
      const s = await makeStore('ENTERPRISE');
      const db = storeClient(s.storeId);
      for (let n = 2; n <= 5; n++) await db.warehouse.create({ data: branch(n) });

      await platform.store.update({ where: { id: s.storeId }, data: { plan: 'BASIC' } });
      await syncLimits(platform, s.storeId);
      assert.equal((await platform.store.findUniqueOrThrow({ where: { id: s.storeId } })).branchLimit, 1);

      // Every branch is still there and still editable.
      assert.equal(await db.warehouse.count({ where: { isActive: true } }), 5);
      const extra = await db.warehouse.findFirstOrThrow({ where: { code: 'BR5' } });
      await db.warehouse.update({ where: { id: extra.id }, data: { name: 'Renamed' } });
      // Nothing new until the store is back within the limit.
      await assert.rejects(db.warehouse.create({ data: branch(6) }), isQuota);
      await db.warehouse.update({ where: { id: extra.id }, data: { isActive: false } });
      await assert.rejects(db.warehouse.update({ where: { id: extra.id }, data: { isActive: true } }), isQuota);
    });
  });

  describe('isolation', () => {
    test("a store cannot read, edit or archive another store's branch", async () => {
      const a = await makeStore('BUSINESS');
      const b = await makeStore('BUSINESS');
      const dbA = storeClient(a.storeId);
      assert.equal(await dbA.warehouse.findFirst({ where: { id: b.mainId } }), null);
      const updated = await dbA.warehouse.updateMany({ where: { id: b.mainId }, data: { name: 'Hijacked' } });
      assert.equal(updated.count, 0);
      await assert.rejects(dbA.warehouse.update({ where: { id: b.mainId }, data: { name: 'Hijacked' } }));
      assert.equal((await platform.warehouse.findUniqueOrThrow({ where: { id: b.mainId } })).name, 'Main Store');
    });
  });
}

// ---------------------------------------------------------------------------
// Branch scope for shifts, sales and staff (migration 20261113090000)
// ---------------------------------------------------------------------------

if (process.env.INTEGRATION_DATABASE_URL) {
  let platform: PrismaClient;
  let storeClient: (storeId: string, options?: { writable?: boolean }) => PrismaClient;
  const run = randomBytes(4).toString('hex');
  let seq = 0;
  const isRule = (error: unknown) => /BRANCH_RULE/.test(String((error as Error)?.message ?? error));
  const isStore = (error: unknown) => /another store/.test(String((error as Error)?.message ?? error));

  /** A Business store with two branches, an owner, and a cashier assigned to branch 2. */
  async function makeStore() {
    const { storedLimits } = await import('@/lib/store-access');
    const tag = `${run}_${++seq}`;
    const storeId = `bs_${tag}`;
    await platform.store.create({
      data: { id: storeId, name: `Scope ${tag}`, slug: storeId.replace(/_/g, '-'), status: 'ACTIVE', plan: 'BUSINESS', ...storedLimits({ plan: 'BUSINESS', status: 'ACTIVE' }) },
    });
    const db = storeClient(storeId);
    const main = await db.warehouse.create({ data: { code: 'MAIN', name: 'Main', isDefault: true } });
    const second = await db.warehouse.create({ data: { code: 'BR2', name: 'Second' } });
    const ownerRole = await db.role.create({ data: { name: 'Owner', slug: 'owner', isSystem: true } });
    const cashierRole = await db.role.create({ data: { name: 'Cashier', slug: 'cashier', isSystem: true } });
    const owner = await db.user.create({ data: { name: 'Owner', email: `o_${tag}@bs.test`, username: `o_${tag}`, roleId: ownerRole.id } });
    await platform.store.update({ where: { id: storeId }, data: { ownerId: owner.id } });
    const cashier = await db.user.create({
      data: { name: 'Cashier', email: `c_${tag}@bs.test`, username: `c_${tag}`, roleId: cashierRole.id, warehouseId: second.id },
    });
    return { storeId, db, main, second, owner, cashier, tag };
  }

  describe('branch scope', () => {
    before(async () => {
      ({ platformPrisma: platform } = await import('@/lib/prisma'));
      ({ storeClient } = await import('@/lib/tenant/client'));
    });
    after(async () => {
      await platform?.$disconnect();
    });

    test('a cashier opens a shift only at their own branch; the owner at any active branch', async () => {
      const s = await makeStore();
      await assert.rejects(s.db.cashierShift.create({ data: { userId: s.cashier.id, warehouseId: s.main.id, openingCash: 0 } }), isRule);
      await s.db.cashierShift.create({ data: { userId: s.cashier.id, warehouseId: s.second.id, openingCash: 0 } });
      await s.db.cashierShift.create({ data: { userId: s.owner.id, warehouseId: s.main.id, openingCash: 0 } });
    });

    test("a sale is filed under its shift's branch, and a shift never changes branch", async () => {
      const s = await makeStore();
      const shift = await s.db.cashierShift.create({ data: { userId: s.cashier.id, warehouseId: s.second.id, openingCash: 0 } });
      await assert.rejects(
        s.db.sale.create({ data: { invoiceNumber: `X-${s.tag}`, warehouseId: s.main.id, userId: s.cashier.id, shiftId: shift.id, total: 1 } }),
        isRule,
      );
      await s.db.sale.create({ data: { invoiceNumber: `Y-${s.tag}`, warehouseId: s.second.id, userId: s.cashier.id, shiftId: shift.id, total: 1 } });
      await assert.rejects(s.db.cashierShift.update({ where: { id: shift.id }, data: { warehouseId: s.main.id } }), isRule);
    });

    test('a branch with an open shift or active staff cannot be archived; once clear it can, and then takes nothing new', async () => {
      const s = await makeStore();
      const shift = await s.db.cashierShift.create({ data: { userId: s.cashier.id, warehouseId: s.second.id, openingCash: 0 } });
      await assert.rejects(s.db.warehouse.update({ where: { id: s.second.id }, data: { isActive: false } }), isRule);
      await platform.cashierShift.update({ where: { id: shift.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await assert.rejects(s.db.warehouse.update({ where: { id: s.second.id }, data: { isActive: false } }), isRule);
      await s.db.user.update({ where: { id: s.cashier.id }, data: { warehouseId: s.main.id } });
      await s.db.warehouse.update({ where: { id: s.second.id }, data: { isActive: false } });

      // Archived: no new shift, no new sale, no staff assigned there.
      await assert.rejects(s.db.cashierShift.create({ data: { userId: s.owner.id, warehouseId: s.second.id, openingCash: 0 } }), isRule);
      await assert.rejects(s.db.sale.create({ data: { invoiceNumber: `Z-${s.tag}`, warehouseId: s.second.id, userId: s.owner.id, total: 1 } }), isRule);
      await assert.rejects(s.db.user.update({ where: { id: s.cashier.id }, data: { warehouseId: s.second.id } }), isRule);
      // Its history is still there.
      assert.equal(await s.db.cashierShift.count({ where: { warehouseId: s.second.id } }), 1);
    });

    test("staff and shifts can never point at another store's branch", async () => {
      const a = await makeStore();
      const b = await makeStore();
      await assert.rejects(a.db.user.update({ where: { id: a.cashier.id }, data: { warehouseId: b.main.id } }), isStore);
      await assert.rejects(
        platform.cashierShift.create({ data: { storeId: a.storeId, userId: a.owner.id, warehouseId: b.main.id, openingCash: 0 } }),
        isStore,
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Consolidated figures (migration 20261113090000 + branch-filter.ts)
// ---------------------------------------------------------------------------

if (process.env.INTEGRATION_DATABASE_URL) {
  let platform: PrismaClient;
  let storeClient: (storeId: string, options?: { writable?: boolean }) => PrismaClient;
  const run = randomBytes(4).toString('hex');

  describe('consolidated figures', () => {
    before(async () => {
      ({ platformPrisma: platform } = await import('@/lib/prisma'));
      ({ storeClient } = await import('@/lib/tenant/client'));
    });
    after(async () => {
      await platform?.$disconnect();
    });

    test('per-branch totals add up to the all-branches total, with nothing from another store or counted twice', async () => {
      const { sqlBranch } = await import('@/server/analytics/branch-filter');
      const { buildDataExport } = await import('@/server/services/data-export-service');
      const { storedLimits } = await import('@/lib/store-access');

      const makeStore = async (tag: string) => {
        const storeId = `cf_${run}_${tag}`;
        await platform.store.create({
          data: { id: storeId, name: storeId, slug: storeId.replace(/_/g, '-'), status: 'ACTIVE', plan: 'ENTERPRISE', ...storedLimits({ plan: 'ENTERPRISE', status: 'ACTIVE' }) },
        });
        const db = storeClient(storeId);
        const role = await db.role.create({ data: { name: 'Owner', slug: 'owner', isSystem: true } });
        const user = await db.user.create({ data: { name: 'Owner', email: `${storeId}@cf.test`, username: `own${run}${tag}`, roleId: role.id } });
        const main = await db.warehouse.create({ data: { code: 'MAIN', name: 'Main', isDefault: true } });
        const second = await db.warehouse.create({ data: { code: 'BR2', name: 'Second' } });
        const sell = async (branchId: string, n: number, total: number) => {
          const shift = await db.cashierShift.create({ data: { userId: user.id, warehouseId: branchId, openingCash: 0 } });
          await db.sale.create({ data: { invoiceNumber: `INV-${tag}-${n}`, warehouseId: branchId, userId: user.id, shiftId: shift.id, total } });
          await platform.cashierShift.update({ where: { id: shift.id }, data: { status: 'CLOSED', closedAt: new Date() } });
        };
        return { storeId, db, main, second, sell };
      };

      const a = await makeStore('a');
      const b = await makeStore('b');
      await a.sell(a.main.id, 1, 100);
      await a.sell(a.main.id, 2, 50);
      await a.sell(a.second.id, 3, 30);
      await b.sell(b.main.id, 1, 999);

      const total = async (ids: string[] | null) => {
        const [row] = await a.db.$queryRaw<{ revenue: string; n: number }[]>`
          SELECT COALESCE(SUM(s.total), 0)::text AS revenue, COUNT(*)::int AS n
          FROM sales s WHERE s."storeId" = ${a.storeId}${sqlBranch('s."warehouseId"', ids)}`;
        return { revenue: Number(row.revenue), n: row.n };
      };
      const all = await total(null);
      const main = await total([a.main.id]);
      const second = await total([a.second.id]);
      assert.deepEqual(all, { revenue: 180, n: 3 });
      assert.deepEqual(main, { revenue: 150, n: 2 });
      assert.deepEqual(second, { revenue: 30, n: 1 });
      assert.equal(main.revenue + second.revenue, all.revenue);
      // Another store's branch id never brings its sales in.
      assert.deepEqual(await total([b.main.id]), { revenue: 0, n: 0 });

      // The CSV download follows the same scope.
      const now = new Date(Date.now() + 60_000);
      const invoices = async (branches: string[] | null) =>
        (await buildDataExport(a.db, 'sales', { includeCost: false, now, branches })).result.rows.map((row) => row.invoice).sort();
      assert.deepEqual(await invoices(null), ['INV-a-1', 'INV-a-2', 'INV-a-3']);
      assert.deepEqual(await invoices([a.second.id]), ['INV-a-3']);
      const rows = (await buildDataExport(a.db, 'sales', { includeCost: false, now, branches: null })).result.rows;
      assert.ok(rows.every((row) => row.branch === 'Main' || row.branch === 'Second'));
    });
  });
}
