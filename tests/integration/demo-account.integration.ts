import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * A demonstration account per store (migration 20261115090000): a separate
 * demo store, linked to the real one, with its own owner login and sample
 * data; one per store; never for a demo store; and nothing in it reaches the
 * real store's records.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('demo account (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`Refusing to run demo tests against ${host}; use a local database.`);
  process.env.DATABASE_URL = URL_ENV;

  let platform: PrismaClient;
  let subs: typeof import('@/server/platform/subscription-service');
  let admin: { id: string; name: string };
  const run = randomBytes(4).toString('hex');

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    subs = await import('@/server/platform/subscription-service');
    admin = await platform.user.findFirstOrThrow({ where: { role: { slug: 'system-admin' } }, select: { id: true, name: true } });
  });
  after(async () => {
    await platform?.$disconnect();
  });

  describe('demo account per store', () => {
    test('creates a linked, isolated demo store once per real store', async () => {
      const { storeId } = await subs.createStore(admin, {
        storeName: `Real ${run}`,
        owner: { name: `Owner ${run}`, username: `real${run}`, email: `real${run}@demo.test`, password: 'OwnerPass1!x' },
        allowSimilar: true,
      });
      const demo = await subs.createStoreDemo(admin, { storeId, username: `real${run}.demo`, password: 'DemoPass1!xy' });

      const row = await platform.store.findUniqueOrThrow({ where: { id: demo.storeId }, select: { name: true, isDemo: true, demoOfStoreId: true, status: true } });
      assert.deepEqual(row, { name: `Real ${run} (Demo)`, isDemo: true, demoOfStoreId: storeId, status: 'ACTIVE' });
      assert.notEqual(demo.storeId, storeId, 'a separate store, so store isolation applies');
      const owner = await platform.user.findUniqueOrThrow({ where: { id: demo.ownerId }, select: { storeId: true, mustChangePassword: true, email: true } });
      assert.equal(owner.storeId, demo.storeId);
      assert.equal(owner.mustChangePassword, true);
      assert.match(owner.email, /@demo\.invalid$/);
      // Sample data is in the demo store only.
      assert.ok((await platform.product.count({ where: { storeId: demo.storeId } })) > 0);
      assert.equal(await platform.product.count({ where: { storeId } }), 0, 'the real store gets no sample data');

      await assert.rejects(subs.createStoreDemo(admin, { storeId, username: `real${run}.demo2`, password: 'DemoPass1!xy' }), /already has a demo account/);
      await assert.rejects(subs.createStoreDemo(admin, { storeId: demo.storeId, username: `real${run}.demo3`, password: 'DemoPass1!xy' }), /already a demo store/);
      // The link is fixed in the database too.
      await assert.rejects(platform.store.update({ where: { id: demo.storeId }, data: { demoOfStoreId: null } }));
      await assert.rejects(platform.store.update({ where: { id: storeId }, data: { demoOfStoreId: demo.storeId } }));
    });
  });
}
