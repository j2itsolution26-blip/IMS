import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Plan quotas and read-only stores against a real PostgreSQL database.
 *
 * Proves that the quota trigger holds under concurrency (many inserts at once
 * end exactly at the limit), that lowering a limit deletes nothing, that the
 * metered counter cannot be overdrawn, and that a read-only store client
 * refuses writes while reads, audit entries and a writable shift-close client
 * still work.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Local databases only, like the store-isolation suite.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('plan limits (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run plan-limit tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;

  let platform: PrismaClient;
  let storeClient: (storeId: string, options?: { writable?: boolean }) => PrismaClient;
  let takeUsageUnit: typeof import('@/server/services/usage-counter').takeUsageUnit;
  let returnUsageUnit: typeof import('@/server/services/usage-counter').returnUsageUnit;
  const run = randomBytes(4).toString('hex');
  let seq = 0;

  /** A store with an owner and the given quotas. */
  async function makeStore(limits: { productLimit?: number | null; staffLimit?: number | null }) {
    const tag = `${run}_${++seq}`;
    const storeId = `pl_${tag}`;
    await platform.store.create({
      data: { id: storeId, name: `Plan ${tag}`, slug: storeId.replace(/_/g, '-'), status: 'ACTIVE', plan: 'BASIC', ...limits },
    });
    const roleId = `role_${tag}`;
    await platform.role.create({ data: { id: roleId, storeId, name: 'Cashier', slug: 'cashier' } });
    const ownerId = `owner_${tag}`;
    await platform.user.create({
      data: { id: ownerId, storeId, name: 'Owner', email: `${ownerId}@pl.test`, username: ownerId, roleId },
    });
    await platform.store.update({ where: { id: storeId }, data: { ownerId } });
    await platform.category.create({ data: { id: `cat_${tag}`, storeId, name: 'General', slug: 'general' } });
    return { storeId, roleId, ownerId, categoryId: `cat_${tag}`, tag };
  }

  const product = (s: { storeId: string; categoryId: string; tag: string }, n: number, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') => ({
    storeId: s.storeId,
    sku: `SKU-${s.tag}-${n}`,
    name: `Item ${n}`,
    categoryId: s.categoryId,
    sellingPrice: 10,
    costPrice: 5,
    status,
  });

  const staff = (s: { storeId: string; roleId: string; tag: string }, n: number, isActive = true) => ({
    id: `staff_${s.tag}_${n}`,
    storeId: s.storeId,
    name: `Staff ${n}`,
    email: `staff_${s.tag}_${n}@pl.test`,
    username: `staff_${s.tag}_${n}`,
    roleId: s.roleId,
    isActive,
  });

  const isQuota = (error: unknown) => /PLAN_LIMIT/.test(String((error as Error)?.message ?? error));

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    ({ storeClient } = await import('@/lib/tenant/client'));
    ({ takeUsageUnit, returnUsageUnit } = await import('@/server/services/usage-counter'));
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);
  });

  after(async () => {
    await platform?.$disconnect();
  });

  describe('product quota', () => {
    test('50 concurrent creates against a limit of 10 end at exactly 10', async () => {
      const s = await makeStore({ productLimit: 10 });
      const db = storeClient(s.storeId);
      const results = await Promise.allSettled(
        Array.from({ length: 50 }, (_, i) => db.product.create({ data: product(s, i) })),
      );
      const created = results.filter((r) => r.status === 'fulfilled').length;
      const refused = results.filter((r) => r.status === 'rejected');
      assert.equal(created, 10);
      assert.equal(refused.length, 40);
      for (const r of refused) assert.ok(isQuota((r as PromiseRejectedResult).reason), String((r as PromiseRejectedResult).reason));
      assert.equal(await platform.product.count({ where: { storeId: s.storeId } }), 10);
    });

    test('archived products do not count; restoring one over the limit is refused', async () => {
      const s = await makeStore({ productLimit: 2 });
      const db = storeClient(s.storeId);
      await db.product.create({ data: product(s, 1) });
      await db.product.create({ data: product(s, 2) });
      const archived = await db.product.create({ data: product(s, 3, 'ARCHIVED') });
      await assert.rejects(db.product.create({ data: product(s, 4) }), isQuota);
      await assert.rejects(db.product.update({ where: { id: archived.id }, data: { status: 'ACTIVE' } }), isQuota);

      // Archiving frees a place.
      const first = await db.product.findFirstOrThrow({ where: { status: 'ACTIVE' } });
      await db.product.update({ where: { id: first.id }, data: { status: 'ARCHIVED' } });
      await db.product.update({ where: { id: archived.id }, data: { status: 'ACTIVE' } });
    });

    test('a lower limit deletes nothing: existing products stay and can still be edited', async () => {
      const s = await makeStore({ productLimit: null });
      const db = storeClient(s.storeId);
      for (let i = 0; i < 6; i++) await db.product.create({ data: product(s, i) });
      await platform.store.update({ where: { id: s.storeId }, data: { productLimit: 3 } });

      assert.equal(await db.product.count(), 6);
      const one = await db.product.findFirstOrThrow();
      await db.product.update({ where: { id: one.id }, data: { name: 'Renamed', sellingPrice: 12, status: 'INACTIVE' } });
      await assert.rejects(db.product.create({ data: product(s, 99) }), isQuota);
      assert.equal(await db.product.count(), 6);
    });
  });

  describe('Basic plan product limit', () => {
    test('a Basic store takes exactly 1,500 products, including a bulk insert and a racing pair at the edge', async () => {
      const { PLANS } = await import('@/lib/plans');
      const { storedLimits } = await import('@/lib/store-access');
      const limit = PLANS.BASIC.limits.products!;
      assert.equal(limit, 1500);
      const s = await makeStore(storedLimits({ plan: 'BASIC', status: 'ACTIVE' }));
      const db = storeClient(s.storeId);

      // A bulk insert cannot skip the trigger: it is checked row by row.
      await db.product.createMany({ data: Array.from({ length: limit - 1 }, (_, i) => product(s, i)) });
      await assert.rejects(db.product.createMany({ data: [product(s, 5000), product(s, 5001)] }), isQuota);
      assert.equal(await platform.product.count({ where: { storeId: s.storeId } }), limit - 1, 'a refused batch adds nothing');

      // Two creates racing for the last place: exactly one wins.
      const results = await Promise.allSettled([db.product.create({ data: product(s, 6000) }), db.product.create({ data: product(s, 6001) })]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(await platform.product.count({ where: { storeId: s.storeId, status: { not: 'ARCHIVED' } } }), limit);
      await assert.rejects(db.product.create({ data: product(s, 7000) }), (error) => isQuota(error) && /products 1500/.test(String(error)));
    });
  });

  describe('staff quota', () => {
    test('20 concurrent staff accounts against a limit of 3 end at exactly 3, owner not counted', async () => {
      const s = await makeStore({ staffLimit: 3 });
      const db = storeClient(s.storeId);
      const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => db.user.create({ data: staff(s, i) })));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
      for (const r of results) if (r.status === 'rejected') assert.ok(isQuota(r.reason), String(r.reason));
      assert.equal(await db.user.count({ where: { isActive: true } }), 4); // 3 staff + the owner
    });

    test('inactive accounts do not count; reactivating one over the limit is refused', async () => {
      const s = await makeStore({ staffLimit: 1 });
      const db = storeClient(s.storeId);
      await db.user.create({ data: staff(s, 1) });
      const parked = await db.user.create({ data: staff(s, 2, false) });
      await assert.rejects(db.user.update({ where: { id: parked.id }, data: { isActive: true } }), isQuota);
      // Other edits to an over-limit store's accounts still work.
      await db.user.update({ where: { id: parked.id }, data: { name: 'Renamed' } });
    });
  });

  describe('staff accounts per plan (quotas copied by syncLimits)', () => {
    /** Puts the store on a plan the way every platform action does, then tries 15 staff at once. */
    async function concurrentStaffOn(plan: 'BASIC' | 'BUSINESS' | 'ENTERPRISE', status: 'ACTIVE' | 'TRIAL' = 'ACTIVE') {
      const { syncLimits } = await import('@/server/platform/store-setup');
      const s = await makeStore({});
      await platform.store.update({ where: { id: s.storeId }, data: { plan, status } });
      await syncLimits(platform, s.storeId);
      const db = storeClient(s.storeId);
      const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => db.user.create({ data: staff(s, i) })));
      for (const r of results) if (r.status === 'rejected') assert.ok(isQuota(r.reason), String(r.reason));
      return { s, db, created: results.filter((r) => r.status === 'fulfilled').length };
    }

    test('Basic stops at 2 staff accounts, also during a trial', async () => {
      assert.equal((await concurrentStaffOn('BASIC')).created, 2);
      assert.equal((await concurrentStaffOn('BASIC', 'TRIAL')).created, 2);
    });

    test('Business stops at 10 staff accounts', async () => {
      assert.equal((await concurrentStaffOn('BUSINESS')).created, 10);
    });

    test('Enterprise has no staff limit', async () => {
      assert.equal((await concurrentStaffOn('ENTERPRISE')).created, 15);
    });

    test('downgrading keeps every account and blocks new ones; upgrading opens room again', async () => {
      const { syncLimits } = await import('@/server/platform/store-setup');
      const { s, db } = await concurrentStaffOn('BUSINESS');
      await platform.store.update({ where: { id: s.storeId }, data: { plan: 'BASIC' } });
      await syncLimits(platform, s.storeId);
      assert.equal(await db.user.count({ where: { isActive: true, id: { not: s.ownerId } } }), 10);
      await assert.rejects(db.user.create({ data: staff(s, 100) }), isQuota);

      await platform.store.update({ where: { id: s.storeId }, data: { plan: 'ENTERPRISE' } });
      await syncLimits(platform, s.storeId);
      await db.user.create({ data: staff(s, 101) });
    });

    test('an account created inactive takes no seat, even at the limit', async () => {
      const { s, db } = await concurrentStaffOn('BASIC');
      await db.user.create({ data: staff(s, 200, false) });
      assert.equal(await db.user.count({ where: { isActive: false } }), 1);
    });
  });

  describe('metered usage', () => {
    test('30 concurrent takes against a limit of 5 succeed exactly 5 times; a refund frees one', async () => {
      const s = await makeStore({});
      const db = storeClient(s.storeId);
      const results = await Promise.all(Array.from({ length: 30 }, () => takeUsageUnit(db, s.storeId, 'backgroundRemovals', '2026-10', 5)));
      assert.equal(results.filter(Boolean).length, 5);
      const row = await platform.storeUsage.findUniqueOrThrow({
        where: { storeId_metric_period: { storeId: s.storeId, metric: 'backgroundRemovals', period: '2026-10' } },
      });
      assert.equal(row.count, 5);

      await returnUsageUnit(db, s.storeId, 'backgroundRemovals', '2026-10');
      assert.equal(await takeUsageUnit(db, s.storeId, 'backgroundRemovals', '2026-10', 5), true);
      assert.equal(await takeUsageUnit(db, s.storeId, 'backgroundRemovals', '2026-10', 5), false);
      // A new month starts from zero; a zero quota never grants one.
      assert.equal(await takeUsageUnit(db, s.storeId, 'backgroundRemovals', '2026-11', 5), true);
      assert.equal(await takeUsageUnit(db, s.storeId, 'backgroundRemovals', '2026-12', 0), false);
    });
  });

  describe('read-only store', () => {
    test('refuses model and raw writes, allows reads, raw reads and audit entries', async () => {
      const s = await makeStore({});
      const rw = storeClient(s.storeId);
      const shift = await rw.cashierShift.create({ data: { storeId: s.storeId, userId: s.ownerId, openingCash: 500 } });
      const existing = await rw.product.create({ data: product(s, 1) });
      const ro = storeClient(s.storeId, { writable: false });
      const readOnly = (error: unknown) => (error as { code?: string })?.code === 'STORE_READ_ONLY';

      await assert.rejects(ro.product.create({ data: product(s, 2) }), readOnly);
      await assert.rejects(ro.product.update({ where: { id: existing.id }, data: { name: 'x' } }), readOnly);
      await assert.rejects(ro.product.updateMany({ data: { name: 'x' } }), readOnly);
      await assert.rejects(ro.product.upsert({ where: { id: existing.id }, create: product(s, 3), update: { name: 'x' } }), readOnly);
      await assert.rejects(ro.product.deleteMany({}), readOnly);
      await assert.rejects(ro.setting.create({ data: { storeId: s.storeId, key: 'x', value: '1', label: 'x' } }), readOnly);
      await assert.rejects(ro.$transaction(async (tx) => tx.product.create({ data: product(s, 4) })), readOnly);
      await assert.rejects(ro.$executeRaw`UPDATE products SET name = 'x' WHERE "storeId" = ${s.storeId}`, readOnly);
      await assert.rejects(ro.$queryRaw`INSERT INTO store_usage ("storeId", metric, period, count, "updatedAt") VALUES (${s.storeId}, 'm', 'p', 1, now()) RETURNING count`, readOnly);
      await assert.rejects(takeUsageUnit(ro, s.storeId, 'backgroundRemovals', '2026-10', 5), readOnly);

      assert.equal(await ro.product.count(), 1);
      assert.equal((await ro.product.findUniqueOrThrow({ where: { id: existing.id } })).name, 'Item 1');
      const [cte] = await ro.$queryRaw<{ n: number }[]>`WITH p AS (SELECT id FROM products WHERE "storeId" = ${s.storeId}) SELECT count(*)::int AS n FROM p`;
      assert.equal(cte.n, 1);
      await ro.auditLog.create({ data: { storeId: s.storeId, action: 'EXPORT', entity: 'Report', summary: 'export while read-only' } });

      // The shift-close path uses the writable client and still closes the drawer.
      const closed = await rw.cashierShift.update({ where: { id: shift.id }, data: { status: 'CLOSED', closedAt: new Date(), actualCash: 500 } });
      assert.equal(closed.status, 'CLOSED');
      assert.equal(await platform.product.count({ where: { storeId: s.storeId } }), 1);
    });
  });
}
