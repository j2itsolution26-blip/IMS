import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Offline unlock on a trusted device, the server's side, end to end: real
 * sign-in, real HTTP to /api/pos/offline-unlock, /api/pos/offline-unlock/status,
 * /api/pos/session and /api/pos/catalog on a running app, and the rows in
 * PostgreSQL.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:54333/ims_test
 *   OFFLINE_API_URL=http://localhost:3107       (next dev/start on that database)
 *   npm run test:integration
 *
 * Refuses any database host but localhost. Leaves its uniquely named rows.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;
const APP = process.env.OFFLINE_API_URL;

if (!URL_ENV || !APP) {
  test('offline unlock API (integration)', { skip: 'set INTEGRATION_DATABASE_URL and OFFLINE_API_URL (a local app on that database)' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`Refusing to run offline unlock tests against ${host}; use a local database.`);
  if (!['localhost', '127.0.0.1'].includes(new URL(APP).hostname)) throw new Error('OFFLINE_API_URL must be a local app.');
  process.env.DATABASE_URL = URL_ENV;

  const run = randomBytes(4).toString('hex');
  const password = 'OwnerPass1!x';
  const PIN = '4826';
  let db: PrismaClient;
  let cookie = '';
  let hashPassword: (value: string) => Promise<string>;

  const a = { storeId: '', ownerId: '', username: '', warehouseId: '' };
  const b = { storeId: '', ownerId: '' };
  const deviceId = randomUUID();
  const strangerDevice = randomUUID();
  let fingerprint = '';

  async function call(path: string, init: { body?: unknown; auth?: boolean; cookieOverride?: string } = {}) {
    const response = await fetch(`${APP}${path}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        origin: APP!,
        ...(init.auth === false ? {} : { cookie: init.cookieOverride ?? cookie }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual',
    });
    const text = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    return { status: response.status, body };
  }

  const status = (entries: { storeId: string; userId: string; fingerprint: string; branchId: string }[], device = deviceId) =>
    call('/api/pos/offline-unlock/status', { body: { deviceId: device, entries }, auth: false });
  const entryA = () => ({ storeId: a.storeId, userId: a.ownerId, fingerprint, branchId: a.warehouseId });
  const isValid = async (entry = entryA(), device = deviceId) => {
    const answer = await status([entry], device);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    return answer.body.results[0].valid as boolean;
  };

  async function newStore(label: string) {
    const subs = await import('@/server/platform/subscription-service');
    const admin = await db.user.findFirstOrThrow({ where: { role: { slug: 'system-admin' } }, select: { id: true, name: true } });
    const username = `u${label}${run}`;
    const { storeId, ownerId } = await subs.createStore(admin, {
      storeName: `Unlock ${label} ${run}`,
      owner: { name: `Owner ${label}`, username, email: `${username}@unlock.test`, password },
      allowSimilar: true,
    });
    await db.user.update({ where: { id: ownerId }, data: { mustChangePassword: false } });
    await db.setting.upsert({
      where: { storeId_key: { storeId, key: 'pos.offlineMode' } },
      create: { storeId, key: 'pos.offlineMode', value: 'true', type: 'BOOLEAN', group: 'sales', label: 'Offline cash sales' },
      update: { value: 'true' },
    });
    const warehouse = await db.warehouse.findFirstOrThrow({ where: { storeId, isDefault: true }, select: { id: true } });
    await db.cashierShift.create({ data: { storeId, userId: ownerId, warehouseId: warehouse.id, openingCash: 0 } });
    return { storeId, ownerId, username, warehouseId: warehouse.id };
  }

  before(async () => {
    ({ platformPrisma: db } = await import('@/lib/prisma'));
    ({ hashPassword } = await import('better-auth/crypto'));
    const [row] = await db.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);

    Object.assign(a, await newStore('a'));
    const storeB = await newStore('b');
    Object.assign(b, { storeId: storeB.storeId, ownerId: storeB.ownerId });

    const signIn = await fetch(`${APP}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP! },
      body: JSON.stringify({ username: a.username, password }),
    });
    assert.equal(signIn.status, 200, `sign-in failed: ${await signIn.text()}`);
    cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  });

  after(async () => {
    await db?.$disconnect();
  });

  describe('allowing offline unlock', () => {
    test('needs a session', async () => {
      const answer = await call('/api/pos/offline-unlock', { body: { deviceId, pin: PIN }, auth: false });
      assert.equal(answer.status, 401);
    });

    test('needs a prepared device and a PIN on the account', async () => {
      const unprepared = await call('/api/pos/offline-unlock', { body: { deviceId, pin: PIN } });
      assert.equal(unprepared.status, 409, JSON.stringify(unprepared.body));

      assert.equal((await call('/api/pos/devices', { body: { deviceId } })).status, 200);
      const noPin = await call('/api/pos/offline-unlock', { body: { deviceId, pin: PIN } });
      assert.equal(noPin.body.code, 'PIN_REQUIRED');
    });

    test('a wrong PIN is refused; the right one returns the fingerprint and is audited', async () => {
      await db.user.update({ where: { id: a.ownerId }, data: { posPinHash: await hashPassword(PIN) } });
      const wrong = await call('/api/pos/offline-unlock', { body: { deviceId, pin: '9999' } });
      assert.equal(wrong.status, 422);
      assert.equal(wrong.body.code, 'PIN_INCORRECT');

      const ok = await call('/api/pos/offline-unlock', { body: { deviceId, pin: PIN } });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.user.id, a.ownerId);
      assert.equal(ok.body.storeId, a.storeId);
      assert.match(ok.body.fingerprint, /^[A-Za-z0-9_-]{32}$/);
      assert.ok(!JSON.stringify(ok.body).includes('scrypt') && !JSON.stringify(ok.body).includes(PIN), 'no hash or PIN comes back');
      fingerprint = ok.body.fingerprint;

      const audit = await db.auditLog.findFirst({ where: { storeId: a.storeId, entity: 'PosDevice', entityId: deviceId }, select: { summary: true } });
      assert.match(audit?.summary ?? '', /Allowed offline unlock/);
    });
  });

  describe('the catalogue copy', () => {
    test('carries the PIN fingerprint, the cached permissions and a 24-hour access period by default', async () => {
      const answer = await call(`/api/pos/catalog?deviceId=${deviceId}`);
      assert.equal(answer.status, 200, JSON.stringify(answer.body));
      const catalog = answer.body.catalog;
      assert.equal(catalog.pinFingerprint, fingerprint);
      assert.ok(catalog.permissions.includes('pos.create'));
      assert.equal(catalog.offlineAccessHours, 24);
      assert.equal(Date.parse(catalog.accessUntil) - Date.parse(catalog.fetchedAt), 24 * 3_600_000);
    });

    test('never runs past the end of the subscription’s grace period', async () => {
      const { GRACE_DAYS } = await import('@/lib/plans');
      // The paid period ended long enough ago that the grace period ends in 2 hours.
      const graceEnds = Date.now() + 2 * 3_600_000;
      await db.store.update({
        where: { id: a.storeId },
        data: { status: 'ACTIVE', currentPeriodEnd: new Date(graceEnds - GRACE_DAYS * 86_400_000) },
      });
      try {
        const answer = await call(`/api/pos/catalog?deviceId=${deviceId}`);
        assert.equal(answer.status, 200, JSON.stringify(answer.body));
        assert.ok(Math.abs(Date.parse(answer.body.catalog.accessUntil) - graceEnds) < 60_000, 'capped at the grace end');
      } finally {
        await db.store.update({ where: { id: a.storeId }, data: { currentPeriodEnd: null } });
      }
    });

    test('a locked screen is a wait (SESSION_LOCKED), not a withdrawal', async () => {
      const session = await db.session.findFirstOrThrow({ where: { userId: a.ownerId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      await db.session.update({ where: { id: session.id }, data: { lockedAt: new Date() } });
      try {
        const answer = await call(`/api/pos/catalog?deviceId=${deviceId}`);
        assert.equal(answer.status, 403);
        assert.equal(answer.body.code, 'SESSION_LOCKED');
      } finally {
        await db.session.update({ where: { id: session.id }, data: { lockedAt: null } });
      }
    });
  });

  describe('who is signed in', () => {
    test('the session route names the account, or answers 401', async () => {
      const mine = await call('/api/pos/session');
      assert.equal(mine.status, 200);
      assert.equal(mine.body.user.id, a.ownerId);
      assert.equal(mine.body.user.mustChangePassword, false);
      assert.equal((await call('/api/pos/session', { auth: false })).status, 401);
    });
  });

  describe('revalidation without a session', () => {
    test('a valid cashier is confirmed; a wrong fingerprint, another store or a stranger device is not', async () => {
      assert.equal(await isValid(), true);
      assert.equal(await isValid({ ...entryA(), fingerprint: 'x'.repeat(32) }), false);
      assert.equal(await isValid({ ...entryA(), storeId: b.storeId }), false, 'the device belongs to store A');
      assert.equal(await isValid(entryA(), strangerDevice), false, 'an unknown device');
    });

    test('a changed PIN, a disabled account, a revoked device, offline sales off, or a suspended store all end it', async () => {
      const restore = async () => {
        await db.user.update({ where: { id: a.ownerId }, data: { isActive: true } });
        await db.posDevice.update({ where: { id: deviceId }, data: { revokedAt: null, revokedById: null } });
        await db.setting.update({ where: { storeId_key: { storeId: a.storeId, key: 'pos.offlineMode' } }, data: { value: 'true' } });
        await db.store.update({ where: { id: a.storeId }, data: { status: 'ACTIVE' } });
      };
      const original = await db.user.findUniqueOrThrow({ where: { id: a.ownerId }, select: { posPinHash: true } });

      await db.user.update({ where: { id: a.ownerId }, data: { posPinHash: await hashPassword('7391') } });
      assert.equal(await isValid(), false, 'PIN changed');
      await db.user.update({ where: { id: a.ownerId }, data: { posPinHash: original.posPinHash } });
      assert.equal(await isValid(), true, 'the same hash again');

      await db.user.update({ where: { id: a.ownerId }, data: { isActive: false } });
      assert.equal(await isValid(), false, 'account disabled');
      await restore();

      await db.posDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date(), revokedById: a.ownerId } });
      assert.equal(await isValid(), false, 'device revoked');
      await restore();

      await db.setting.update({ where: { storeId_key: { storeId: a.storeId, key: 'pos.offlineMode' } }, data: { value: 'false' } });
      assert.equal(await isValid(), false, 'offline sales switched off');
      await restore();

      await db.store.update({ where: { id: a.storeId }, data: { status: 'SUSPENDED' } });
      assert.equal(await isValid(), false, 'store suspended');
      await restore();

      assert.equal(await isValid(), true);
    });

    test('a revoked device cannot allow offline unlock again', async () => {
      await db.posDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date(), revokedById: a.ownerId } });
      try {
        const answer = await call('/api/pos/offline-unlock', { body: { deviceId, pin: PIN } });
        assert.equal(answer.status, 403);
        assert.equal(answer.body.code, 'DEVICE_REVOKED');
      } finally {
        await db.posDevice.update({ where: { id: deviceId }, data: { revokedAt: null, revokedById: null } });
      }
    });

    test('malformed requests are refused', async () => {
      assert.equal((await call('/api/pos/offline-unlock/status', { body: { deviceId: 'nope', entries: [] }, auth: false })).status, 422);
      const many = Array.from({ length: 21 }, () => entryA());
      assert.equal((await status(many)).status, 422);
    });
  });
}
