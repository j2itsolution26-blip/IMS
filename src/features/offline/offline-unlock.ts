import { META, deviceRecord, type PosDb } from '@/features/offline/local-db';
import { catalogKey } from '@/lib/offline-catalog';
import { normalizeUsername } from '@/lib/username';
import {
  DUMMY_SALT,
  EMPTY_GUARD,
  ERASE_AFTER_FAILURES,
  PBKDF2_ITERATIONS,
  checkGuard,
  claimAttempt,
  clearFailures,
  deriveVerifier,
  newSalt,
  sameBytes,
  type UnlockEnrollment,
  type UnlockGuard,
} from '@/lib/offline-unlock';

/**
 * Offline unlock on the device: allowing a cashier (online, PIN checked by the
 * server), unlocking with that PIN offline, and dropping cashiers the server
 * no longer allows. Rules and limits: src/lib/offline-unlock.ts.
 *
 * Nothing here ever deletes or changes a sale.
 */

const TIMEOUT_MS = 20_000;

async function post(fetchImpl: typeof fetch, url: string, body: unknown): Promise<{ status: number | null; body: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) return { status: 401, body: null };
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = (await response.json()) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  } catch {
    return { status: null, body: null };
  } finally {
    clearTimeout(timer);
  }
}

// --- Reading and removing ---------------------------------------------------

export async function listEnrollments(db: PosDb): Promise<UnlockEnrollment[]> {
  return db.getAll('unlock');
}

export async function enrollmentFor(db: PosDb, storeId: string, userId: string): Promise<UnlockEnrollment | null> {
  return (await db.get('unlock', catalogKey(storeId, userId))) ?? null;
}

async function readGuard(db: PosDb): Promise<UnlockGuard> {
  return ((await db.get('meta', META.unlockGuard)) as UnlockGuard | undefined) ?? EMPTY_GUARD;
}

export async function unlockGuard(db: PosDb): Promise<UnlockGuard> {
  return readGuard(db);
}

/**
 * Ends one cashier's offline access on this device: their catalogue copy and
 * offline unlock. Their unsent sales stay and are sent at their next sign-in.
 */
export async function removeOfflineAccess(db: PosDb, key: string): Promise<void> {
  const tx = db.transaction(['catalog', 'unlock', 'meta'], 'readwrite');
  await tx.objectStore('catalog').delete(key);
  await tx.objectStore('unlock').delete(key);
  const last = (await tx.objectStore('meta').get(META.lastTill)) as { storeId: string; userId: string } | undefined;
  if (last && catalogKey(last.storeId, last.userId) === key) await tx.objectStore('meta').delete(META.lastTill);
  await tx.done;
}

/** A catalogue refresh carried the cashier's current PIN fingerprint: drop an unlock made with another PIN. */
export async function applyPinFingerprint(db: PosDb, key: string, fingerprint: string | null | undefined): Promise<boolean> {
  if (fingerprint === undefined) return false;
  const existing = await db.get('unlock', key);
  if (!existing || existing.fingerprint === fingerprint) return false;
  await db.delete('unlock', key);
  return true;
}

// --- Allowing a cashier (online) --------------------------------------------

export type EnrollResult = { ok: true; enrollment: UnlockEnrollment } | { ok: false; code: string; message: string };

/**
 * Allows the signed-in cashier to unlock this device offline. The server
 * checks the PIN; only then does the device make and keep its verifier.
 */
export async function enrollDevice(
  db: PosDb,
  scope: { storeId: string; userId: string },
  pin: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  iterations = PBKDF2_ITERATIONS,
): Promise<EnrollResult> {
  const device = await deviceRecord(db);
  const answer = await post(fetchImpl, '/api/pos/offline-unlock', { deviceId: device.id, pin });
  if (answer.status === null) return { ok: false, code: 'NETWORK', message: 'The server could not be reached. Try again when you are online.' };
  if (answer.status !== 200 || answer.body?.ok !== true) {
    return {
      ok: false,
      code: String(answer.body?.code ?? `HTTP_${answer.status}`),
      message: String(answer.body?.error ?? `The server answered ${answer.status}.`),
    };
  }
  const user = answer.body.user as { id: string; username: string; name: string };
  if (user?.id !== scope.userId || answer.body.storeId !== scope.storeId) {
    return { ok: false, code: 'SESSION_CHANGED', message: 'Another account is signed in. Reload the page.' };
  }
  const salt = newSalt();
  const enrollment: UnlockEnrollment = {
    key: catalogKey(scope.storeId, scope.userId),
    storeId: scope.storeId,
    userId: scope.userId,
    username: normalizeUsername(user.username),
    name: user.name,
    deviceId: device.id,
    salt,
    iterations,
    verifier: await deriveVerifier(pin, salt, iterations),
    fingerprint: String(answer.body.fingerprint),
    enrolledAt: new Date().toISOString(),
  };
  await db.put('unlock', enrollment);
  return { ok: true, enrollment };
}

// --- Unlocking (offline) ----------------------------------------------------

export type UnlockAttempt =
  | { kind: 'ok'; enrollment: UnlockEnrollment }
  /** Wrong username or PIN. `waitUntil`: the next try must wait until then. */
  | { kind: 'wrong'; waitUntil: number | null }
  | { kind: 'wait'; until: number }
  /** The device clock went backwards: refuse until the server is reached. */
  | { kind: 'clock' }
  /** Too many wrong PINs: every offline unlock on this device was erased. */
  | { kind: 'erased' };

let queue: Promise<unknown> = Promise.resolve();

/** One attempt at a time on this page, so two quick submits cannot slip past the count. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Checks a username and PIN against this device's offline unlocks. The
 * attempt is counted before the PIN is checked and cleared only on success.
 * An unknown username costs the same work and gets the same answer as a
 * wrong PIN.
 */
export function unlockOffline(db: PosDb, username: string, pin: string, now = Date.now()): Promise<UnlockAttempt> {
  return serial(async () => {
    const verdict = checkGuard(await readGuard(db), now);
    if (!verdict.ok) {
      await db.put('meta', verdict.guard, META.unlockGuard);
      return verdict.reason === 'clock' ? { kind: 'clock' } : { kind: 'wait', until: verdict.until };
    }
    const claimed = claimAttempt(verdict.guard, now);
    await db.put('meta', claimed, META.unlockGuard);

    const name = normalizeUsername(username);
    const matches = name ? await db.getAllFromIndex('unlock', 'byUsername', name) : [];
    const enrollment = matches[0];
    const derived = await deriveVerifier(pin, enrollment?.salt ?? DUMMY_SALT, enrollment?.iterations ?? PBKDF2_ITERATIONS);
    if (enrollment && sameBytes(derived, enrollment.verifier)) {
      await db.put('meta', clearFailures(claimed), META.unlockGuard);
      return { kind: 'ok', enrollment };
    }

    if (claimed.failures >= ERASE_AFTER_FAILURES) {
      const tx = db.transaction(['unlock', 'meta'], 'readwrite');
      await tx.objectStore('unlock').clear();
      await tx.objectStore('meta').put(clearFailures(claimed), META.unlockGuard);
      await tx.done;
      return { kind: 'erased' };
    }
    return { kind: 'wrong', waitUntil: claimed.lockedUntil || null };
  });
}

/** The PIN of an already-known cashier (the online lock screen, offline). */
export async function unlockKnownCashier(db: PosDb, username: string, pin: string): Promise<UnlockAttempt | { kind: 'unavailable' }> {
  const name = normalizeUsername(username);
  if (!name || (await db.getAllFromIndex('unlock', 'byUsername', name)).length === 0) return { kind: 'unavailable' };
  return unlockOffline(db, username, pin);
}

// --- Revalidating (online) --------------------------------------------------

/**
 * Asks the server whether every cashier this device may unlock offline is
 * still allowed, and removes those who are not (disabled, PIN changed or
 * removed, moved branch, lost the till permission, device removed, store
 * suspended or read-only, offline sales switched off). A cashier whose copy
 * is gone is removed too. Returns the keys removed, or null when the server
 * could not be asked. Never extends anyone's access.
 */
export async function revalidateEnrollments(db: PosDb, fetchImpl: typeof fetch = (...args) => fetch(...args)): Promise<string[] | null> {
  const enrollments = await listEnrollments(db);
  if (enrollments.length === 0) return [];
  const removed: string[] = [];
  const entries = [];
  for (const enrollment of enrollments) {
    const snapshot = await db.get('catalog', enrollment.key);
    if (!snapshot) {
      await removeOfflineAccess(db, enrollment.key);
      removed.push(enrollment.key);
      continue;
    }
    entries.push({ storeId: enrollment.storeId, userId: enrollment.userId, fingerprint: enrollment.fingerprint, branchId: snapshot.branch.id });
  }
  if (entries.length === 0) return removed;

  const device = await deviceRecord(db);
  const answer = await post(fetchImpl, '/api/pos/offline-unlock/status', { deviceId: device.id, entries: entries.slice(0, 20) });
  if (answer.status !== 200 || answer.body?.ok !== true || !Array.isArray(answer.body.results)) return null;
  for (const result of answer.body.results as { storeId: string; userId: string; valid: boolean }[]) {
    if (result.valid === false) {
      const key = catalogKey(result.storeId, result.userId);
      await removeOfflineAccess(db, key);
      removed.push(key);
    }
  }
  return removed;
}
