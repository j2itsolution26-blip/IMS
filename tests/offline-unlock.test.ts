import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeLocalDb, openLocalDb, type PosDb } from '@/features/offline/local-db';
import { getEntry, recordSale } from '@/features/offline/outbox';
import { loadSnapshot, prepareDevice, withdraws } from '@/features/offline/catalog';
import {
  applyPinFingerprint,
  enrollDevice,
  enrollmentFor,
  listEnrollments,
  revalidateEnrollments,
  unlockGuard,
  unlockKnownCashier,
  unlockOffline,
} from '@/features/offline/offline-unlock';
import {
  CLOCK_TOLERANCE_MS,
  ERASE_AFTER_FAILURES,
  LOCKOUT_FREE_ATTEMPTS,
  LOCKOUT_MAX_WAIT_MS,
  checkGuard,
  deriveVerifier,
  lockoutDelayMs,
  newSalt,
  offlineSessionCheck,
  sameBytes,
} from '@/lib/offline-unlock';
import { sellingEndsAt, storeAccess } from '@/lib/store-access';
import type { OfflineCatalog } from '@/lib/offline-catalog';
import { draft } from './helpers/outbox-draft';

const FAST = 1_000; // PBKDF2 iterations in tests; the app uses PBKDF2_ITERATIONS.
const PIN = '4826';

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await closeLocalDb();
});
afterEach(async () => {
  await closeLocalDb();
});

function catalogFor(storeId: string, userId: string, overrides: Partial<OfflineCatalog> = {}): OfflineCatalog {
  return {
    fetchedAt: new Date(Date.now() - 60_000).toISOString(),
    store: { id: storeId, name: `Store ${storeId}`, currency: 'PHP', taxRate: 0 },
    offlineAccessHours: 24,
    branch: { id: `wh_${storeId}` },
    user: { id: userId, name: `Name ${userId}` },
    permissions: ['pos.create'],
    pinFingerprint: `fp_${userId}`,
    openShift: { id: 'shift_1', number: 1, openedAt: new Date().toISOString(), openingCash: 0, warehouseId: `wh_${storeId}` },
    categories: [],
    products: [],
    truncated: false,
    ...overrides,
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake server for every endpoint the device calls. */
function server(answers: Record<string, (body: unknown) => Response | 'down'>) {
  const calls: { path: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).split('?')[0];
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, body });
    const answer = answers[path]?.(body);
    if (!answer || answer === 'down') throw new TypeError('Failed to fetch');
    return answer;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function prepared(db: PosDb, storeId: string, userId: string, overrides: Partial<OfflineCatalog> = {}) {
  const result = await prepareDevice(
    db,
    { storeId, userId },
    server({
      '/api/pos/devices': () => json(200, { ok: true }),
      '/api/pos/catalog': () => json(200, { ok: true, catalog: catalogFor(storeId, userId, overrides) }),
    }).fetchImpl,
  );
  assert.equal(result.ok, true);
}

async function enrolled(db: PosDb, storeId: string, userId: string, username: string, pin = PIN) {
  const { fetchImpl } = server({
    '/api/pos/offline-unlock': () => json(200, { ok: true, fingerprint: `fp_${userId}`, storeId, user: { id: userId, username, name: `Name ${userId}` } }),
  });
  const result = await enrollDevice(db, { storeId, userId }, pin, fetchImpl, FAST);
  assert.equal(result.ok, true);
}

// --- Policy -----------------------------------------------------------------

test('lockout: free attempts, then a pause that doubles up to a cap', () => {
  for (let i = 0; i < LOCKOUT_FREE_ATTEMPTS; i += 1) assert.equal(lockoutDelayMs(i), 0);
  assert.equal(lockoutDelayMs(LOCKOUT_FREE_ATTEMPTS), 60_000);
  assert.equal(lockoutDelayMs(LOCKOUT_FREE_ATTEMPTS + 1), 120_000);
  assert.equal(lockoutDelayMs(LOCKOUT_FREE_ATTEMPTS + 2), 240_000);
  assert.equal(lockoutDelayMs(50), LOCKOUT_MAX_WAIT_MS);
});

test('a clock moved backwards is refused; small drift is tolerated', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');
  const guard = { failures: 0, lockedUntil: 0, clockHighWater: now };
  assert.equal(checkGuard(guard, now - CLOCK_TOLERANCE_MS + 1000).ok, true);
  const back = checkGuard(guard, now - CLOCK_TOLERANCE_MS - 1000);
  assert.equal(back.ok ? null : back.reason, 'clock');
});

test('the verifier is a salted PBKDF2 value: same PIN and salt agree, another salt or PIN does not', async () => {
  const salt = newSalt();
  const a = await deriveVerifier(PIN, salt, FAST);
  assert.ok(sameBytes(a, await deriveVerifier(PIN, salt, FAST)));
  assert.ok(!sameBytes(a, await deriveVerifier('4827', salt, FAST)));
  assert.ok(!sameBytes(a, await deriveVerifier(PIN, newSalt(), FAST)));
});

test('opening a till needs an unexpired copy for this cashier, the till permission and an open shift', () => {
  const now = Date.now();
  const enrollment = { key: 's:u' } as Parameters<typeof offlineSessionCheck>[1];
  const base = { ...catalogFor('s', 'u'), key: 's:u', deviceId: 'd', accessUntil: new Date(now + 3_600_000).toISOString() };
  assert.deepEqual(offlineSessionCheck(base, enrollment, now), { ok: true });
  assert.deepEqual(offlineSessionCheck(null, enrollment, now), { ok: false, reason: 'not-prepared' });
  assert.deepEqual(offlineSessionCheck({ ...base, key: 's:other' }, enrollment, now), { ok: false, reason: 'not-prepared' });
  assert.deepEqual(offlineSessionCheck({ ...base, accessUntil: new Date(now - 1).toISOString() }, enrollment, now), { ok: false, reason: 'expired' });
  assert.deepEqual(offlineSessionCheck({ ...base, permissions: ['sales.view'] }, enrollment, now), { ok: false, reason: 'not-permitted' });
  assert.deepEqual(offlineSessionCheck({ ...base, openShift: null }, enrollment, now), { ok: false, reason: 'no-shift' });
});

test('only a real refusal withdraws offline access', () => {
  assert.equal(withdraws(403, 'DEVICE_REVOKED'), true);
  assert.equal(withdraws(403, 'OFFLINE_DISABLED'), true);
  assert.equal(withdraws(403, 'FORBIDDEN'), true);
  assert.equal(withdraws(403, 'SESSION_LOCKED'), false);
  assert.equal(withdraws(401, 'UNAUTHORIZED'), false);
  assert.equal(withdraws(null, undefined), false);
  assert.equal(withdraws(503, 'DB_UNAVAILABLE'), false);
});

test('offline access ends when the store would become read-only', () => {
  const now = new Date('2026-11-13T00:00:00Z');
  const active = storeAccess({ plan: 'BASIC', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: new Date('2026-11-20T00:00:00Z') }, now);
  assert.ok(sellingEndsAt(active, now)! > new Date('2026-11-20T00:00:00Z'), 'paid period plus grace');
  const unlimited = storeAccess({ plan: 'BASIC', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null }, now);
  assert.equal(sellingEndsAt(unlimited, now), null);
  const lapsed = storeAccess({ plan: 'BASIC', status: 'PAST_DUE', trialEndsAt: null, currentPeriodEnd: null }, now);
  assert.equal(sellingEndsAt(lapsed, now)?.getTime(), now.getTime(), 'read-only already: no offline access');
});

// --- Enrolment --------------------------------------------------------------

test('allowing offline unlock: the server checks the PIN; the device keeps only a salted verifier', async () => {
  const db = await openLocalDb();
  await prepared(db, 'store_a', 'u1');
  const { fetchImpl, calls } = server({
    '/api/pos/offline-unlock': () => json(200, { ok: true, fingerprint: 'fp_u1', storeId: 'store_a', user: { id: 'u1', username: 'Juan.Cruz', name: 'Juan' } }),
  });
  const result = await enrollDevice(db, { storeId: 'store_a', userId: 'u1' }, PIN, fetchImpl, FAST);
  assert.equal(result.ok, true);
  assert.equal((calls[0].body as { pin: string }).pin, PIN, 'the PIN goes to the server once');

  const stored = await enrollmentFor(db, 'store_a', 'u1');
  assert.equal(stored?.username, 'juan.cruz');
  assert.equal(stored?.iterations, FAST);
  // Nothing on the device holds the PIN itself.
  for (const name of ['meta', 'catalog', 'unlock', 'outbox'] as const) {
    assert.ok(!JSON.stringify(await db.getAll(name)).includes(`"${PIN}"`), `no PIN in ${name}`);
  }
});

test('a refused PIN or another signed-in account stores nothing', async () => {
  const db = await openLocalDb();
  const wrong = server({ '/api/pos/offline-unlock': () => json(422, { ok: false, code: 'PIN_INCORRECT', error: 'That PIN is incorrect.' }) });
  const refused = await enrollDevice(db, { storeId: 'store_a', userId: 'u1' }, '1111', wrong.fetchImpl, FAST);
  assert.deepEqual(refused.ok ? null : refused.code, 'PIN_INCORRECT');

  const other = server({ '/api/pos/offline-unlock': () => json(200, { ok: true, fingerprint: 'x', storeId: 'store_a', user: { id: 'u9', username: 'x', name: 'x' } }) });
  const changed = await enrollDevice(db, { storeId: 'store_a', userId: 'u1' }, PIN, other.fetchImpl, FAST);
  assert.deepEqual(changed.ok ? null : changed.code, 'SESSION_CHANGED');

  const offline = await enrollDevice(db, { storeId: 'store_a', userId: 'u1' }, PIN, server({}).fetchImpl, FAST);
  assert.deepEqual(offline.ok ? null : offline.code, 'NETWORK', 'first-time setup needs the server');
  assert.deepEqual(await listEnrollments(db), []);
});

// --- Unlocking --------------------------------------------------------------

test('a device that never set up offline unlock cannot be unlocked offline', async () => {
  const db = await openLocalDb();
  await prepared(db, 'store_a', 'u1');
  const result = await unlockOffline(db, 'u1', PIN);
  assert.deepEqual(result, { kind: 'wrong', waitUntil: null });
});

test('the right username and PIN unlock; a wrong PIN and an unknown username get the same answer', async () => {
  const db = await openLocalDb();
  await prepared(db, 'store_a', 'u1');
  await enrolled(db, 'store_a', 'u1', 'juan');

  const ok = await unlockOffline(db, '  JUAN ', PIN);
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.kind === 'ok' && ok.enrollment.key, 'store_a:u1');

  const wrongPin = await unlockOffline(db, 'juan', '0000');
  const unknown = await unlockOffline(db, 'nobody', PIN);
  assert.deepEqual(wrongPin, unknown);
});

test('unlocking never extends the access period', async () => {
  const db = await openLocalDb();
  await prepared(db, 'store_a', 'u1');
  await enrolled(db, 'store_a', 'u1', 'juan');
  const before = (await loadSnapshot(db, 'store_a', 'u1'))?.accessUntil;
  await unlockOffline(db, 'juan', PIN);
  assert.equal((await loadSnapshot(db, 'store_a', 'u1'))?.accessUntil, before);
});

test('wrong PINs: a pause after five, success resets, and fifteen erase every offline unlock but no sale', async () => {
  const db = await openLocalDb();
  await prepared(db, 'store_a', 'u1');
  await enrolled(db, 'store_a', 'u1', 'juan');
  const sale = await recordSale(db, draft());
  let now = Date.now();

  for (let i = 1; i < LOCKOUT_FREE_ATTEMPTS; i += 1) assert.deepEqual(await unlockOffline(db, 'juan', '0000', now), { kind: 'wrong', waitUntil: null });
  const fifth = await unlockOffline(db, 'juan', '0000', now);
  assert.equal(fifth.kind === 'wrong' && fifth.waitUntil, now + 60_000);
  const blocked = await unlockOffline(db, 'juan', PIN, now + 1000);
  assert.equal(blocked.kind, 'wait', 'even the right PIN waits');

  now += 61_000;
  assert.equal((await unlockOffline(db, 'juan', PIN, now)).kind, 'ok');
  assert.equal((await unlockGuard(db)).failures, 0, 'success resets the count');

  let last;
  for (let i = 0; i < ERASE_AFTER_FAILURES; i += 1) {
    now += LOCKOUT_MAX_WAIT_MS + 1000;
    last = await unlockOffline(db, 'juan', '0000', now);
  }
  assert.deepEqual(last, { kind: 'erased' });
  assert.deepEqual(await listEnrollments(db), []);
  assert.ok(await getEntry(db, sale.id), 'sales stay');
  assert.ok(await loadSnapshot(db, 'store_a', 'u1'), 'the price list stays for the online till');
});

test('a clock moved back refuses unlock', async () => {
  const db = await openLocalDb();
  await prepared(db, 'store_a', 'u1');
  await enrolled(db, 'store_a', 'u1', 'juan');
  const now = Date.now();
  assert.equal((await unlockOffline(db, 'juan', PIN, now)).kind, 'ok');
  assert.deepEqual(await unlockOffline(db, 'juan', PIN, now - 3_600_000), { kind: 'clock' });
});

test('the online lock screen only checks offline for a cashier set up on this device', async () => {
  const db = await openLocalDb();
  assert.deepEqual(await unlockKnownCashier(db, 'juan', PIN), { kind: 'unavailable' });
  await prepared(db, 'store_a', 'u1');
  await enrolled(db, 'store_a', 'u1', 'juan');
  assert.equal((await unlockKnownCashier(db, 'juan', PIN)).kind, 'ok');
});

test('cashiers of two stores on one device each open only their own copy', async () => {
  const db = await openLocalDb();
  await prepared(db, 'store_a', 'u1');
  await enrolled(db, 'store_a', 'u1', 'ana', '4826');
  await prepared(db, 'store_b', 'u2');
  await enrolled(db, 'store_b', 'u2', 'ben', '7391');

  const ana = await unlockOffline(db, 'ana', '4826');
  const ben = await unlockOffline(db, 'ben', '7391');
  assert.equal(ana.kind === 'ok' && ana.enrollment.storeId, 'store_a');
  assert.equal(ben.kind === 'ok' && ben.enrollment.storeId, 'store_b');
  assert.equal((await unlockOffline(db, 'ana', '7391')).kind, 'wrong', 'one cashier’s PIN never opens another’s till');
  const anaCopy = await loadSnapshot(db, 'store_a', 'u1');
  assert.equal(anaCopy?.store.id, 'store_a');
});

// --- Revocation -------------------------------------------------------------

test('a changed PIN, seen on the next download, drops that cashier’s offline unlock', async () => {
  const db = await openLocalDb();
  await prepared(db, 'store_a', 'u1');
  await enrolled(db, 'store_a', 'u1', 'juan');
  assert.equal(await applyPinFingerprint(db, 'store_a:u1', 'fp_u1'), false, 'unchanged');
  await prepared(db, 'store_a', 'u1', { pinFingerprint: 'fp_new' });
  assert.equal(await enrollmentFor(db, 'store_a', 'u1'), null);
});

test('back online: cashiers the server no longer allows are removed, sales stay; no answer removes nothing', async () => {
  const db = await openLocalDb();
  await prepared(db, 'store_a', 'u1');
  await enrolled(db, 'store_a', 'u1', 'ana');
  await prepared(db, 'store_a', 'u2');
  await enrolled(db, 'store_a', 'u2', 'ben');
  const sale = await recordSale(db, draft({ userId: 'u2' }));

  assert.equal(await revalidateEnrollments(db, server({}).fetchImpl), null);
  assert.equal((await listEnrollments(db)).length, 2);

  const { fetchImpl, calls } = server({
    '/api/pos/offline-unlock/status': () =>
      json(200, {
        ok: true,
        results: [
          { storeId: 'store_a', userId: 'u1', valid: true },
          { storeId: 'store_a', userId: 'u2', valid: false },
        ],
      }),
  });
  assert.deepEqual(await revalidateEnrollments(db, fetchImpl), ['store_a:u2']);
  const sent = calls[0].body as { entries: { userId: string; fingerprint: string; branchId: string }[] };
  assert.deepEqual(
    sent.entries.map((e) => [e.userId, e.fingerprint, e.branchId]).sort(),
    [
      ['u1', 'fp_u1', 'wh_store_a'],
      ['u2', 'fp_u2', 'wh_store_a'],
    ],
  );
  assert.deepEqual((await listEnrollments(db)).map((e) => e.userId), ['u1']);
  assert.equal(await loadSnapshot(db, 'store_a', 'u2'), null);
  assert.ok(await getEntry(db, sale.id), 'the removed cashier’s sale stays');
});
