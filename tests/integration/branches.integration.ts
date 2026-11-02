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
