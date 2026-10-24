import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Administrator notifications against a real PostgreSQL database: one row
 * per event however often it is raised, read state kept per administrator,
 * the author of an event getting it already read, and store clients unable
 * to reach platform notifications.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Local databases only. Needs every migration applied (including
 * 20261030090000_platform_notification_reads) and bootstrap run.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('notifications (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run notification tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;

  const run = randomBytes(4).toString('hex');
  let platform: PrismaClient;
  let service: typeof import('@/server/platform/platform-notification-service');
  let storeClient: (storeId: string) => PrismaClient;
  let adminA: string;
  let adminB: string;

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    service = await import('@/server/platform/platform-notification-service');
    ({ storeClient } = await import('@/lib/tenant/client'));
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);

    const role = await platform.role.findFirstOrThrow({ where: { slug: 'system-admin' }, select: { id: true } });
    const make = (tag: string) =>
      platform.user.create({
        data: { name: `Admin ${tag}`, email: `${tag}${run}@notify.test`, username: `${tag}${run}`, roleId: role.id },
        select: { id: true },
      });
    adminA = (await make('na')).id;
    adminB = (await make('nb')).id;
  });

  after(async () => {
    await platform.$disconnect();
  });

  describe('platform notifications', () => {
    test('raising the same event ten times stores it once', async () => {
      const key = `test:${run}:once`;
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          service.raisePlatformNotification({ kind: 'STORE_CREATED', title: 'Once', body: 'Once', dedupeKey: key }),
        ),
      );
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await platform.platformNotification.count({ where: { dedupeKey: key } }), 1);
    });

    test('read state is per administrator', async () => {
      const key = `test:${run}:per-admin`;
      await service.raisePlatformNotification({ kind: 'PLAN_SELECTED', title: 'Per admin', body: 'x', dedupeKey: key });
      const id = (await platform.platformNotification.findUniqueOrThrow({ where: { dedupeKey: key } })).id;

      const beforeA = await service.listPlatformNotificationsFor(adminA, { filter: 'unread', take: 100 });
      assert.ok(beforeA.items.some((item) => item.id === id));

      await service.markPlatformNotificationsRead(adminA, [id]);
      const afterA = await service.listPlatformNotificationsFor(adminA, { filter: 'unread', take: 100 });
      const afterB = await service.listPlatformNotificationsFor(adminB, { filter: 'unread', take: 100 });
      assert.ok(!afterA.items.some((item) => item.id === id), 'read for A');
      assert.ok(afterB.items.some((item) => item.id === id), 'still unread for B');
      assert.equal(afterB.unread - afterA.unread >= 1, true);
    });

    test('the administrator who caused an event gets it already read', async () => {
      const key = `test:${run}:author`;
      await service.raisePlatformNotification({ kind: 'STORE_SUSPENDED', title: 'Mine', body: 'x', dedupeKey: key }, { readBy: adminA });
      const id = (await platform.platformNotification.findUniqueOrThrow({ where: { dedupeKey: key } })).id;
      const a = await service.listPlatformNotificationsFor(adminA, { take: 100 });
      const b = await service.listPlatformNotificationsFor(adminB, { take: 100 });
      assert.equal(a.items.find((item) => item.id === id)?.read, true);
      assert.equal(b.items.find((item) => item.id === id)?.read, false);
    });

    test('marking unknown ids changes nothing', async () => {
      assert.equal(await service.markPlatformNotificationsRead(adminA, [`missing-${run}`]), 0);
    });

    test('a store client cannot read platform notifications or reads', async () => {
      const store = await platform.store.findFirst({ select: { id: true } });
      if (!store) return;
      const db = storeClient(store.id);
      await assert.rejects(db.platformNotification.findMany({ take: 1 }));
      await assert.rejects(db.platformNotificationRead.findMany({ take: 1 }));
    });
  });
}
