import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Mandatory first-sign-in password change, against a real PostgreSQL
 * database: a new store's owner is created with the requirement, the
 * temporary password is stored only as a hash, existing kinds of account are
 * unaffected, and Better Auth's own endpoints cannot be used to get around it.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Local databases only. Needs every migration applied (including
 * 20261028090000_must_change_password) and bootstrap run.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('first-login password change (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run first-login tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;

  const run = randomBytes(4).toString('hex');
  const TEMPORARY = 'Temporary-Pass1!x';
  let platform: PrismaClient;
  let svc: typeof import('@/server/platform/subscription-service');
  let authModule: typeof import('@/lib/auth');
  let admin: { id: string; name: string };
  let owner: { id: string; username: string; storeId: string };

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    svc = await import('@/server/platform/subscription-service');
    authModule = await import('@/lib/auth');
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);

    const systemAdmin = await platform.user.findFirst({
      where: { role: { slug: 'system-administrator' } },
      select: { id: true, name: true },
    });
    admin = systemAdmin ?? { id: 'integration-admin', name: 'Integration admin' };

    const username = `first${run}`;
    const { storeId, ownerId } = await svc.createStore(admin, {
      storeName: `First Login ${run}`,
      owner: { name: `Owner ${run}`, username, email: `${username}@first.test`, password: TEMPORARY },
      allowSimilar: true,
    });
    owner = { id: ownerId, username, storeId };
  });

  after(async () => {
    await platform.$disconnect();
  });

  describe('first-login password change', () => {
    test('a new store owner must change their password', async () => {
      const row = await platform.user.findUniqueOrThrow({ where: { id: owner.id }, select: { mustChangePassword: true } });
      assert.equal(row.mustChangePassword, true);
    });

    test('the temporary password is stored only as a hash that verifies', async () => {
      const account = await platform.account.findFirstOrThrow({
        where: { userId: owner.id, providerId: 'credential' },
        select: { password: true },
      });
      assert.ok(account.password);
      assert.notEqual(account.password, TEMPORARY);
      assert.ok(!account.password!.includes(TEMPORARY));
      const ctx = await authModule.auth.$context;
      assert.equal(await ctx.password.verify({ hash: account.password!, password: TEMPORARY }), true);
    });

    test('the creation audit records the requirement and never the password', async () => {
      const entries = await platform.auditLog.findMany({ where: { storeId: owner.storeId }, select: { summary: true, changes: true } });
      assert.ok(entries.some((entry) => /must be changed at first sign-in/.test(entry.summary)));
      for (const entry of entries) {
        assert.ok(!JSON.stringify(entry).includes(TEMPORARY), 'no password in the audit trail');
      }
    });

    test('accounts not created by an administrator default to no requirement', async () => {
      const others = await platform.user.count({ where: { mustChangePassword: true, id: { not: owner.id }, email: { endsWith: '@first.test' } } });
      assert.equal(others, 0);
    });

    test('the owner can sign in, but Better Auth cannot change the password around our flow', async () => {
      const response = await authModule.auth.api.signInUsername({
        body: { username: owner.username, password: TEMPORARY },
        asResponse: true,
      });
      assert.equal(response.status, 200, 'signing in still works');
      const cookie = response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie, 'a session cookie was issued');

      await assert.rejects(
        authModule.auth.api.changePassword({
          headers: new Headers({ cookie: cookie! }),
          body: { currentPassword: TEMPORARY, newPassword: 'Owner-Chosen2026!', revokeOtherSessions: false },
        }),
        /Change your temporary password/,
      );
      await assert.rejects(
        authModule.auth.api.updateUser({ headers: new Headers({ cookie: cookie! }), body: { name: 'Renamed' } }),
        /Change your temporary password/,
      );

      const row = await platform.user.findUniqueOrThrow({ where: { id: owner.id }, select: { mustChangePassword: true, name: true } });
      assert.equal(row.mustChangePassword, true, 'still required');
      assert.notEqual(row.name, 'Renamed');
    });

    test('a public sign-up cannot set the flag, even when asked to', async () => {
      await assert.rejects(
        authModule.auth.api.signUpEmail({
          body: { name: 'Mallory', email: `mallory${run}@first.test`, password: 'Mallory-Pass1!', username: `mallory${run}`, mustChangePassword: false } as never,
        }),
      );
    });
  });
}
