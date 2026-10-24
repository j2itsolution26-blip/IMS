import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';

/**
 * First-time setup against a real PostgreSQL database that starts empty.
 *
 *   SETUP_DATABASE_URL=postgresql://…@localhost:5432/ims_setup_test npm run test:integration
 *
 * Unlike the other suites this one needs a *dedicated* database, because it
 * empties it before every test (a fresh installation is the thing under
 * test). It therefore refuses any host but localhost and any database whose
 * name does not end in `_setup_test`. Apply every migration to it first
 * (`prisma migrate deploy`); bootstrap is not needed — setup installs the role
 * catalogue itself.
 */

const URL_ENV = process.env.SETUP_DATABASE_URL;

if (!URL_ENV) {
  test('first-time setup (integration)', { skip: 'set SETUP_DATABASE_URL to a dedicated local *_setup_test database' }, () => {});
} else {
  const url = new URL(URL_ENV);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || !url.pathname.endsWith('_setup_test')) {
    throw new Error('Refusing: SETUP_DATABASE_URL must be a local database whose name ends in _setup_test.');
  }
  process.env.DATABASE_URL = URL_ENV;

  let platform: PrismaClient;
  let setup: typeof import('@/server/platform/setup-service');
  let auth: typeof import('@/lib/auth').auth;
  let storeClient: (storeId: string) => PrismaClient;
  let n = 0;

  const valid = (overrides: Partial<{ name: string; username: string; email: string; password: string; setupKey: string }> = {}) => {
    n += 1;
    return { name: 'Ana Admin', username: `admin_${n}`, email: `admin${n}@setup.test`, password: 'Str0ng!Passw0rd', ...overrides };
  };
  const code = (error: unknown) => (error as { code?: string })?.code;

  /** A fresh installation: every table emptied (row triggers do not fire on TRUNCATE). */
  async function emptyDatabase() {
    const [row] = await platform.$queryRaw<{ db: string }[]>`select current_database() as db`;
    if (!row.db.endsWith('_setup_test')) throw new Error(`Refusing to empty ${row.db}`);
    await platform.$executeRawUnsafe(`
      DO $$ DECLARE t text; BEGIN
        SELECT string_agg(format('%I', tablename), ', ') INTO t FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
        EXECUTE 'TRUNCATE ' || t || ' CASCADE';
      END $$;`);
  }

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    setup = await import('@/server/platform/setup-service');
    ({ auth } = await import('@/lib/auth'));
    ({ storeClient } = await import('@/lib/tenant/client'));
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);
  });

  beforeEach(async () => {
    delete process.env.SETUP_KEY;
    await emptyDatabase();
  });

  after(async () => {
    await platform?.$disconnect();
  });

  describe('a fresh installation', () => {
    test('needs setup, and checking that creates nothing', async () => {
      assert.equal(await setup.isSetupRequired(), true);
      assert.equal(await setup.isSetupRequired(), true);
      assert.equal(await platform.user.count(), 0);
      assert.equal(await platform.installation.count(), 0);
      assert.equal(await platform.store.count(), 0);
    });

    test('a valid submission creates exactly one System Administrator, hashed, and closes setup', async () => {
      const input = valid();
      const { userId } = await setup.completeSetup(input);
      const users = await platform.user.findMany({ include: { role: true, accounts: true } });
      assert.equal(users.length, 1);
      const [admin] = users;
      assert.equal(admin.id, userId);
      assert.equal(admin.role.slug, 'system-admin');
      assert.equal(admin.role.storeId, null);
      assert.equal(admin.storeId, null);
      assert.equal(admin.isActive, true);
      const password = admin.accounts.find((a) => a.providerId === 'credential')?.password ?? '';
      assert.ok(password.length > 40 && !password.includes(input.password), 'stored as a hash');

      const installation = await platform.installation.findUniqueOrThrow({ where: { id: 1 } });
      assert.equal(installation.status, 'COMPLETED');
      assert.equal(installation.completedById, userId);
      assert.equal(installation.claimToken, null);
      assert.equal(await setup.isSetupRequired(), false);
      assert.equal(await platform.store.count(), 0, 'no store is created');

      const audit = await platform.auditLog.findFirstOrThrow({ where: { entityId: userId, action: 'CREATE' } });
      assert.equal(audit.storeId, null);
      assert.match(audit.summary, /Initial System Administrator/);
      assert.ok(!JSON.stringify(audit.changes).includes(input.password));
    });

    test('invalid input creates no account and leaves setup open', async () => {
      await assert.rejects(setup.completeSetup(valid({ password: 'weakpass' })), (e) => code(e) === 'VALIDATION_ERROR');
      await assert.rejects(setup.completeSetup(valid({ username: 'x' })), (e) => code(e) === 'VALIDATION_ERROR');
      assert.equal(await platform.user.count(), 0);
      assert.equal(await platform.installation.count(), 0, 'the claim was released');
      assert.equal(await setup.isSetupRequired(), true);
      await setup.completeSetup(valid());
      assert.equal(await platform.user.count(), 1);
    });

    test('20 simultaneous submissions create exactly one administrator', async () => {
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => setup.completeSetup(valid())));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      for (const r of results) {
        if (r.status === 'rejected') assert.ok(['FORBIDDEN', 'CONFLICT'].includes(code(r.reason) ?? ''), String(r.reason));
      }
      assert.equal(await platform.user.count(), 1);
      assert.equal((await platform.installation.findUniqueOrThrow({ where: { id: 1 } })).status, 'COMPLETED');
    });

    test('the same username or email cannot be used twice, even at the same moment', async () => {
      const same = { username: 'only_admin', email: 'only@setup.test' };
      const results = await Promise.allSettled([setup.completeSetup(valid(same)), setup.completeSetup(valid(same))]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(await platform.user.count({ where: { username: 'only_admin' } }), 1);
    });
  });

  describe('after setup', () => {
    test('every later attempt is refused', async () => {
      await setup.completeSetup(valid());
      await assert.rejects(setup.completeSetup(valid()), (e) => code(e) === 'FORBIDDEN' && /already been completed/.test((e as Error).message));
      assert.equal(await platform.user.count(), 1);
    });

    test('deactivating or losing the administrator does not reopen setup', async () => {
      await setup.completeSetup(valid());
      await platform.user.updateMany({ data: { isActive: false } });
      assert.equal(await setup.isSetupRequired(), false);
      // A completed record with no account left at all (e.g. accounts removed by hand).
      await emptyDatabase();
      await platform.installation.create({ data: { id: 1, status: 'COMPLETED', completedAt: new Date() } });
      assert.equal(await setup.isSetupRequired(), false);
      await assert.rejects(setup.completeSetup(valid()), (e) => code(e) === 'FORBIDDEN');
      assert.equal(await platform.user.count(), 0);
    });

    test('the completed record cannot be reopened or deleted', async () => {
      await setup.completeSetup(valid());
      await assert.rejects(
        platform.installation.update({ where: { id: 1 }, data: { status: 'IN_PROGRESS', claimToken: 'x', claimedAt: new Date(), completedAt: null } }),
        /cannot be reopened/,
      );
      await assert.rejects(platform.installation.delete({ where: { id: 1 } }), /cannot be reset/);
      await assert.rejects(platform.installation.create({ data: { id: 2, status: 'COMPLETED', completedAt: new Date() } }));
    });
  });

  describe('existing installations', () => {
    test('accounts without an installation record keep setup closed, and the migration marks them completed', async () => {
      const role = await platform.role.create({ data: { name: 'System Administrator', slug: 'system-admin', isSystem: true } });
      await platform.user.create({ data: { name: 'Old Admin', email: 'old@setup.test', username: 'old_admin', roleId: role.id } });
      assert.equal(await setup.isSetupRequired(), false);
      await assert.rejects(setup.completeSetup(valid()), (e) => code(e) === 'FORBIDDEN');
      assert.equal(await platform.user.count(), 1);

      const sql = readFileSync('prisma/migrations/20261027090000_installation_setup/migration.sql', 'utf8');
      const backfill = sql.slice(sql.lastIndexOf('INSERT INTO "installation"'));
      await platform.$executeRawUnsafe(backfill);
      const installation = await platform.installation.findUniqueOrThrow({ where: { id: 1 } });
      assert.equal(installation.status, 'COMPLETED');
      assert.ok(installation.completedById);
    });

    test('a fresh database loses the unused default store; one with anything in it keeps it', async () => {
      const sql = readFileSync('prisma/migrations/20261027090000_installation_setup/migration.sql', 'utf8');
      const cleanup = sql.slice(sql.indexOf("-- 3. A fresh database's unused default store."), sql.indexOf('-- Existing systems'));
      const seedDefault = () =>
        platform.store.create({ data: { id: 'store_default', name: 'My Store', slug: 'main', plan: 'ENTERPRISE', status: 'ACTIVE' } });

      await seedDefault();
      await platform.$executeRawUnsafe(cleanup);
      assert.equal(await platform.store.count(), 0, 'empty default store removed');

      await seedDefault();
      await platform.role.create({ data: { storeId: 'store_default', name: 'Owner', slug: 'owner' } });
      await platform.$executeRawUnsafe(cleanup);
      assert.equal(await platform.store.count(), 1, 'kept: a role belongs to it');

      await emptyDatabase();
      await seedDefault();
      const role = await platform.role.create({ data: { name: 'System Administrator', slug: 'system-admin' } });
      await platform.user.create({ data: { name: 'A', email: 'a@setup.test', username: 'a_admin', roleId: role.id } });
      await platform.$executeRawUnsafe(cleanup);
      assert.equal(await platform.store.count(), 1, 'kept: the installation has accounts');
    });

    test('the backfill does nothing on an empty database', async () => {
      const sql = readFileSync('prisma/migrations/20261027090000_installation_setup/migration.sql', 'utf8');
      await platform.$executeRawUnsafe(sql.slice(sql.lastIndexOf('INSERT INTO "installation"')));
      assert.equal(await platform.installation.count(), 0);
      assert.equal(await setup.isSetupRequired(), true);
    });
  });

  describe('a database without its tables', () => {
    test('is reported as needing migrations, not as closed or unreachable', async () => {
      assert.equal(await setup.getSetupStatus(), 'required');
      // Simulates a new database before `prisma migrate deploy` on this dedicated test database.
      await platform.$executeRawUnsafe('ALTER TABLE installation RENAME TO installation_hidden_for_test');
      try {
        assert.equal(await setup.getSetupStatus(), 'needs-migrations');
        await assert.rejects(setup.completeSetup(valid()));
        assert.equal(await platform.user.count(), 0, 'nothing created');
      } finally {
        await platform.$executeRawUnsafe('ALTER TABLE installation_hidden_for_test RENAME TO installation');
      }
      assert.equal(await setup.getSetupStatus(), 'required');
    });

    test('after setup the status is closed', async () => {
      await setup.completeSetup(valid());
      assert.equal(await setup.getSetupStatus(), 'closed');
    });
  });

  describe('claims and keys', () => {
    test('a request that died mid-setup blocks others for 5 minutes, then can be taken over', async () => {
      await platform.installation.create({ data: { id: 1, status: 'IN_PROGRESS', claimToken: 'fresh', claimedAt: new Date() } });
      await assert.rejects(setup.completeSetup(valid()), (e) => code(e) === 'CONFLICT');
      await platform.installation.update({ where: { id: 1 }, data: { claimedAt: new Date(Date.now() - 10 * 60_000) } });
      await setup.completeSetup(valid());
      assert.equal(await platform.user.count(), 1);
    });

    test('with SETUP_KEY set, the wrong key creates nothing and takes no claim', async () => {
      process.env.SETUP_KEY = 'correct horse battery staple';
      assert.equal(setup.isSetupKeyRequired(), true);
      await assert.rejects(setup.completeSetup(valid({ setupKey: 'wrong' })), (e) => code(e) === 'VALIDATION_ERROR');
      await assert.rejects(setup.completeSetup(valid()), (e) => code(e) === 'VALIDATION_ERROR');
      assert.equal(await platform.installation.count(), 0);
      assert.equal(await platform.user.count(), 0);
      await setup.completeSetup(valid({ setupKey: '  correct horse battery staple ' }));
      assert.equal(await platform.user.count(), 1);
    });
  });

  describe('no other way in', () => {
    test('public sign-up through Better Auth is refused, before and after setup', async () => {
      const attempt = () =>
        auth.api.signUpEmail({ body: { name: 'Intruder', email: `in${++n}@setup.test`, password: 'Str0ng!Passw0rd', username: `intruder_${n}` } });
      await assert.rejects(attempt(), /Public sign-up is disabled/);
      assert.equal(await platform.user.count(), 0);
      await setup.completeSetup(valid());
      await assert.rejects(attempt(), /Public sign-up is disabled/);
      assert.equal(await platform.user.count(), 1);
    });

    test('a store account cannot be given the System Administrator role', async () => {
      await setup.completeSetup(valid());
      const adminRole = await platform.role.findFirstOrThrow({ where: { slug: 'system-admin', storeId: null } });
      const store = await platform.store.create({ data: { name: 'Shop', slug: 'shop-setup-test', status: 'ACTIVE', plan: 'BASIC' } });
      const cashierRole = await platform.role.create({ data: { storeId: store.id, name: 'Cashier', slug: 'cashier' } });
      const cashier = await platform.user.create({
        data: { storeId: store.id, name: 'Cashier', email: 'c@setup.test', username: 'cashier_setup', roleId: cashierRole.id },
      });
      const db = storeClient(store.id);
      await assert.rejects(db.user.update({ where: { id: cashier.id }, data: { roleId: adminRole.id } }));
      await assert.rejects(platform.user.update({ where: { id: cashier.id }, data: { roleId: adminRole.id } }), /another store/);
      assert.equal((await platform.user.findUniqueOrThrow({ where: { id: cashier.id } })).roleId, cashierRole.id);
    });
  });
}
