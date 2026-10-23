import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Subscription administration against a real PostgreSQL database: store
 * creation with its trial, manual payments (once per reference, even when
 * submitted concurrently), permanence of payment records, voiding, plan and
 * status changes, and that a store cannot write its own payment records.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Local databases only. Needs every migration applied and bootstrap run (the
 * permission catalogue and the platform role).
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('subscriptions (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run subscription tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;

  const DAY = 86_400_000;
  const run = randomBytes(4).toString('hex');
  let seq = 0;
  let platform: PrismaClient;
  let svc: typeof import('@/server/platform/subscription-service');
  let storeClient: (storeId: string) => PrismaClient;
  let SETTING_COUNT: number;
  let admin: { id: string; name: string };

  async function newStore(overrides: { allowSimilar?: boolean; name?: string; phone?: string } = {}) {
    const tag = `${run}${++seq}`;
    const name = overrides.name ?? `Sari ${tag}`;
    const result = await svc.createStore(admin, {
      storeName: name,
      owner: { name: `Owner ${tag}`, username: `own${tag}`, email: `own${tag}@sub.test`, password: 'OwnerPass1!x', phone: overrides.phone },
      allowSimilar: overrides.allowSimilar ?? false,
    });
    return { ...result, name, tag };
  }

  const pay = (storeId: string, reference: string, extra: Partial<Parameters<typeof svc.recordManualPayment>[1]> = {}) =>
    svc.recordManualPayment(admin, {
      storeId, plan: 'BUSINESS', amount: 499, method: 'GCASH', reference, paidAt: new Date(), months: 1, ...extra,
    });

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    ({ storeClient } = await import('@/lib/tenant/client'));
    svc = await import('@/server/platform/subscription-service');
    ({ SETTING_DEFINITIONS: { length: SETTING_COUNT } } = await import('@/lib/settings-definitions'));
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);

    const role = await platform.role.findFirstOrThrow({ where: { slug: 'system-admin', storeId: null } });
    const user = await platform.user.create({
      data: { name: 'Platform Admin', email: `admin${run}@sub.test`, username: `admin${run}`, roleId: role.id, storeId: null },
    });
    admin = { id: user.id, name: user.name };
  });

  after(async () => {
    await platform?.$disconnect();
  });

  describe('creating a store', () => {
    test('sets up roles, warehouse, settings and owner, with a 14-day Business trial and audit entries', async () => {
      const before = Date.now();
      const { storeId, ownerId, name } = await newStore();
      const store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.equal(store.status, 'TRIAL');
      assert.equal(store.plan, 'BUSINESS');
      assert.equal(store.ownerId, ownerId);
      const trialMs = (store.trialEndsAt as Date).getTime() - before;
      assert.ok(Math.abs(trialMs - 14 * DAY) < 60_000, `trial length ${trialMs}`);
      assert.deepEqual([store.productLimit, store.staffLimit], [5000, 15]);

      const roles = await platform.role.findMany({ where: { storeId }, include: { permissions: { include: { permission: true } } } });
      assert.deepEqual(roles.map((r) => r.slug).sort(), ['cashier', 'inventory-staff', 'owner']);
      const owner = roles.find((r) => r.slug === 'owner')!;
      assert.ok(owner.permissions.some((p) => p.permission.key === 'billing.view'));
      assert.ok(!owner.permissions.some((p) => p.permission.key.startsWith('platform.')));
      assert.equal(await platform.warehouse.count({ where: { storeId, code: 'MAIN' } }), 1);
      assert.equal(await platform.setting.count({ where: { storeId } }), SETTING_COUNT);
      assert.equal((await platform.setting.findFirstOrThrow({ where: { storeId, key: 'company.name' } })).value, name);

      const ownerUser = await platform.user.findUniqueOrThrow({ where: { id: ownerId }, include: { role: true } });
      assert.equal(ownerUser.storeId, storeId);
      assert.equal(ownerUser.role.slug, 'owner');

      const audits = await platform.auditLog.findMany({ where: { entity: 'Store', entityId: storeId, action: 'CREATE' } });
      assert.equal(audits.length, 2);
      assert.ok(audits.some((a) => a.storeId === storeId && a.userId === null));
      assert.ok(audits.some((a) => a.storeId === null && a.userId === admin.id));
    });

    test('a store with the same name or owner phone needs explicit confirmation', async () => {
      const first = await newStore({ phone: `0917${run}` });
      await assert.rejects(newStore({ name: first.name.toUpperCase() }), (e: Error & { code?: string }) => e.code === 'SIMILAR_STORE');
      await assert.rejects(newStore({ phone: `0917${run}` }), (e: Error & { code?: string }) => e.code === 'SIMILAR_STORE');
      const confirmed = await newStore({ name: first.name, allowSimilar: true });
      assert.ok(confirmed.storeId);
    });

    test('a taken email or username is refused before anything is created', async () => {
      const first = await newStore();
      const count = await platform.store.count();
      await assert.rejects(
        svc.createStore(admin, {
          storeName: `Other ${run}`,
          owner: { name: 'X', username: `fresh${run}`, email: `own${first.tag}@sub.test`, password: 'OwnerPass1!x' },
          allowSimilar: true,
        }),
        /already has an account/,
      );
      assert.equal(await platform.store.count(), count);
    });
  });

  describe('manual payments', () => {
    test('the same reference submitted 20 times at once is recorded exactly once', async () => {
      const { storeId } = await newStore();
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => pay(storeId, `GC-RACE-${run}`)));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      for (const r of results) if (r.status === 'rejected') assert.match(String(r.reason?.message), /already recorded/);
      // Stored normalised (uppercase, no spaces).
      assert.equal(await platform.subscriptionPayment.count({ where: { reference: `GC-RACE-${run}`.toUpperCase() } }), 1);
      const store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.equal(store.status, 'ACTIVE');
    });

    test('a reference typed differently is still a duplicate; another method is not', async () => {
      const { storeId } = await newStore();
      await pay(storeId, `ab 77 ${run}`);
      await assert.rejects(pay(storeId, `AB77${run.toUpperCase()}`), /already recorded/);
      await pay(storeId, `AB77${run}`, { method: 'BANK_TRANSFER' });
    });

    test('paying during a trial starts after the trial; paying early stacks; limits follow the plan', async () => {
      const { storeId } = await newStore();
      const trialEnd = (await platform.store.findUniqueOrThrow({ where: { id: storeId } })).trialEndsAt as Date;
      const first = await pay(storeId, `P1-${run}${seq}`, { plan: 'BASIC', months: 1 });
      const p1 = await platform.subscriptionPayment.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(p1.periodStart.getTime(), trialEnd.getTime());
      let store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.deepEqual([store.plan, store.status, store.productLimit, store.staffLimit], ['BASIC', 'ACTIVE', 500, 3]);
      assert.equal(store.currentPeriodEnd?.getTime(), p1.periodEnd.getTime());

      const second = await pay(storeId, `P2-${run}${seq}`, { plan: 'ENTERPRISE', months: 3 });
      const p2 = await platform.subscriptionPayment.findUniqueOrThrow({ where: { id: second.id } });
      assert.equal(p2.periodStart.getTime(), p1.periodEnd.getTime());
      store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.deepEqual([store.plan, store.productLimit, store.staffLimit], ['ENTERPRISE', null, null]);

      const audits = await platform.auditLog.count({ where: { entity: 'SubscriptionPayment', entityId: { in: [first.id, second.id] }, action: 'PAYMENT' } });
      assert.equal(audits, 4);
    });

    test('a future date and a suspended store are refused', async () => {
      const { storeId } = await newStore();
      await assert.rejects(pay(storeId, `FUT-${run}`, { paidAt: new Date(Date.now() + 2 * DAY) }), /future/);
      await pay(storeId, `OK-${run}${seq}`);
      await svc.setStoreStatus(admin, { storeId, status: 'SUSPENDED', reason: 'test suspension' });
      await assert.rejects(pay(storeId, `SUS-${run}`), /suspended/);
    });

    test('payment records cannot be edited or deleted, only voided once', async () => {
      const { storeId } = await newStore();
      const { id } = await pay(storeId, `PERM-${run}`);
      const blocked = /cannot be (edited|deleted)|already void/;
      await assert.rejects(platform.subscriptionPayment.update({ where: { id }, data: { amount: 1 } }), blocked);
      await assert.rejects(platform.subscriptionPayment.delete({ where: { id } }), blocked);
      await assert.rejects(platform.$executeRaw`UPDATE subscription_payments SET reference = 'X' WHERE id = ${id}`, blocked);
      await svc.voidPayment(admin, { paymentId: id, reason: 'entered twice' });
      await assert.rejects(svc.voidPayment(admin, { paymentId: id, reason: 'again' }), /already void/);
      await assert.rejects(
        platform.subscriptionPayment.update({ where: { id }, data: { voidReason: 'changed my mind' } }),
        blocked,
      );
    });

    test('only the latest payment can be voided, and voiding takes back its time', async () => {
      const { storeId } = await newStore();
      const a = await pay(storeId, `VA-${run}`);
      const b = await pay(storeId, `VB-${run}`);
      await assert.rejects(svc.voidPayment(admin, { paymentId: a.id, reason: 'wrong one' }), /most recent/);
      const pb = await platform.subscriptionPayment.findUniqueOrThrow({ where: { id: b.id } });
      await svc.voidPayment(admin, { paymentId: b.id, reason: 'bounced' });
      const store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.equal(store.currentPeriodEnd?.getTime(), pb.periodStart.getTime());
      // Now the earlier one is the latest and can be voided.
      await svc.voidPayment(admin, { paymentId: a.id, reason: 'also wrong' });
    });

    test('a store client can read its own payments but cannot create or change them', async () => {
      const s1 = await newStore();
      const s2 = await newStore();
      await pay(s1.storeId, `ISO1-${run}`);
      await pay(s2.storeId, `ISO2-${run}`);
      const db1 = storeClient(s1.storeId);
      const mine = await db1.subscriptionPayment.findMany();
      assert.deepEqual(mine.map((p) => p.reference), [`ISO1-${run}`.toUpperCase()]);
      await assert.rejects(
        db1.subscriptionPayment.create({
          data: {
            storeId: s1.storeId, plan: 'ENTERPRISE', amount: 1, method: 'OTHER', reference: `FAKE-${run}`, paidAt: new Date(),
            months: 12, periodStart: new Date(), periodEnd: new Date(Date.now() + DAY), recordedById: admin.id,
          },
        }),
        /written by the platform only/,
      );
      await assert.rejects(db1.subscriptionPayment.updateMany({ data: { months: 12 } }), /written by the platform only/);
      await assert.rejects(db1.store.update({ where: { id: s1.storeId }, data: { plan: 'ENTERPRISE' } }), /cannot update its store record/);
    });
  });

  describe('plan, status and trial changes', () => {
    test('a downgrade keeps everything, reports what is over, and lowers the stored limits', async () => {
      const { storeId } = await newStore();
      await pay(storeId, `DG-${run}`, { plan: 'BUSINESS' });
      const category = await platform.category.create({ data: { storeId, name: 'General', slug: 'general' } });
      await platform.$executeRaw`
        INSERT INTO products (id, "storeId", sku, name, "categoryId", "sellingPrice", "costPrice", "createdAt", "updatedAt")
        SELECT 'dg_' || ${run} || '_' || g, ${storeId}, 'DG-' || g, 'Item ' || g, ${category.id}, 10, 5, now(), now() FROM generate_series(1, 510) g`;
      const result = await svc.changePlan(admin, { storeId, plan: 'BASIC', reason: 'customer downgraded' });
      assert.equal(result.overLimits.length, 1);
      assert.match(result.overLimits[0], /510 products/);
      assert.equal(await platform.product.count({ where: { storeId } }), 510);
      const store = await platform.store.findUniqueOrThrow({ where: { id: storeId } });
      assert.deepEqual([store.plan, store.productLimit, store.staffLimit], ['BASIC', 500, 3]);
      await assert.rejects(svc.changePlan(admin, { storeId, plan: 'BASIC', reason: 'again' }), /already on/);
    });

    test('a trial cannot be activated without a payment; status changes are audited both ways', async () => {
      const { storeId } = await newStore();
      await assert.rejects(svc.setStoreStatus(admin, { storeId, status: 'ACTIVE', reason: 'free ride' }), /Record the payment/);
      await svc.setStoreStatus(admin, { storeId, status: 'SUSPENDED', reason: 'abuse report' });
      const audits = await platform.auditLog.findMany({ where: { entity: 'Store', entityId: storeId, action: 'SUBSCRIPTION' } });
      assert.equal(audits.length, 2);
      const storeEntry = audits.find((a) => a.storeId === storeId)!;
      assert.match(storeEntry.summary, /Trial to Suspended — abuse report/);
      assert.equal((storeEntry.changes as { actor: { id: string } }).actor.id, admin.id);
    });

    test('a trial extends from its end date, and only a trial can be extended', async () => {
      const { storeId } = await newStore();
      const before = (await platform.store.findUniqueOrThrow({ where: { id: storeId } })).trialEndsAt as Date;
      const { trialEndsAt } = await svc.extendTrial(admin, { storeId, days: 5, reason: 'onboarding delay' });
      assert.equal(trialEndsAt.getTime() - before.getTime(), 5 * DAY);
      await assert.rejects(svc.extendTrial(admin, { storeId, days: 31, reason: 'too long' }), /1 to 30/);
      await pay(storeId, `TR-${run}`);
      await assert.rejects(svc.extendTrial(admin, { storeId, days: 5, reason: 'not a trial' }), /Only a store on trial/);
    });
  });
}
