import { META, deviceRecord, type PosDb } from '@/features/offline/local-db';
import { entriesForStore } from '@/features/offline/outbox';
import { applyPinFingerprint, removeOfflineAccess } from '@/features/offline/offline-unlock';
import {
  catalogKey,
  findByCode,
  searchCatalog,
  soldSince,
  toSnapshot,
  type CatalogSnapshot,
  type DeviceSale,
  type LocalSearchFilters,
  type LocalSellable,
  type OfflineCatalog,
} from '@/lib/offline-catalog';

/**
 * Preparing a till for offline selling, and selling from its catalogue copy.
 *
 * Preparing = registering this browser's device id with the store, then
 * downloading the catalogue copy (GET /api/pos/catalog) and keeping it in
 * IndexedDB. It is refreshed while the till is online. A refusal from the
 * server (offline selling switched off, device revoked, store read-only or
 * suspended, staff no longer allowed to sell) removes the copy and the
 * cashier's offline unlock, which ends offline selling for them on this
 * device. A network failure keeps both, and so do:
 *   - 401: this browser is not signed in, which says nothing about the
 *     cashier whose copy it is (they may have signed out and still unlock
 *     with their PIN). Their access is rechecked without a session
 *     (revalidateEnrollments) and in any case ends with its access period.
 *   - 403 SESSION_LOCKED: the screen is locked, nothing was withdrawn.
 */

export type PrepareResult =
  | { ok: true; snapshot: CatalogSnapshot }
  | { ok: false; code: string; message: string; withdrawn: boolean };

const TIMEOUT_MS = 30_000;

type Answer = { status: number | null; body: Record<string, unknown> | null };

async function call(fetchImpl: typeof fetch, url: string, body?: unknown): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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

/** A refusal about this account, device or store, as opposed to a passing failure. */
export function withdraws(status: number | null, code: unknown): boolean {
  return status === 403 && code !== 'SESSION_LOCKED' && code !== 'CROSS_ORIGIN';
}

async function failure(db: PosDb, key: string, answer: Answer): Promise<PrepareResult> {
  const withdrawn = withdraws(answer.status, answer.body?.code);
  if (withdrawn) await removeOfflineAccess(db, key);
  if (answer.status === null) return { ok: false, code: 'NETWORK', message: 'The server could not be reached.', withdrawn: false };
  return {
    ok: false,
    code: String(answer.body?.code ?? `HTTP_${answer.status}`),
    message: String(answer.body?.error ?? `The server answered ${answer.status}.`),
    withdrawn,
  };
}

export async function prepareDevice(
  db: PosDb,
  scope: { storeId: string; userId: string; label?: string },
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<PrepareResult> {
  const key = catalogKey(scope.storeId, scope.userId);
  const device = await deviceRecord(db);

  const registered = await call(fetchImpl, '/api/pos/devices', { deviceId: device.id, ...(scope.label ? { label: scope.label } : {}) });
  if (registered.status !== 200 || registered.body?.ok !== true) return failure(db, key, registered);

  const answer = await call(fetchImpl, `/api/pos/catalog?deviceId=${encodeURIComponent(device.id)}`);
  if (answer.status !== 200 || answer.body?.ok !== true) return failure(db, key, answer);

  const catalog = answer.body.catalog as OfflineCatalog;
  // The session changed under the till (another account signed in elsewhere).
  if (catalog.store.id !== scope.storeId || catalog.user.id !== scope.userId) {
    return { ok: false, code: 'SESSION_CHANGED', message: 'Another account is signed in. Reload the page.', withdrawn: false };
  }
  const snapshot = toSnapshot(catalog, device.id);
  const tx = db.transaction(['catalog', 'meta'], 'readwrite');
  await tx.objectStore('catalog').put(snapshot);
  await tx.objectStore('meta').put({ storeId: scope.storeId, userId: scope.userId } satisfies TillScope, META.lastTill);
  await tx.done;
  // The PIN was changed or removed since this cashier allowed offline unlock here.
  await applyPinFingerprint(db, key, catalog.pinFingerprint);
  return { ok: true, snapshot };
}

/** Which till this device opens with no connection. */
export interface TillScope {
  storeId: string;
  userId: string;
}

/** The till last prepared on this device, if its copy is still here. */
export async function lastTill(db: PosDb): Promise<{ scope: TillScope; snapshot: CatalogSnapshot } | null> {
  const scope = (await db.get('meta', META.lastTill)) as TillScope | undefined;
  if (!scope?.storeId || !scope.userId) return null;
  const snapshot = await loadSnapshot(db, scope.storeId, scope.userId);
  return snapshot ? { scope, snapshot } : null;
}

export async function loadSnapshot(db: PosDb, storeId: string, userId: string): Promise<CatalogSnapshot | null> {
  return (await db.get('catalog', catalogKey(storeId, userId))) ?? null;
}

/** The sales on this device, as far as stock is concerned. */
export async function deviceSales(db: PosDb, storeId: string): Promise<DeviceSale[]> {
  const entries = await entriesForStore(db, storeId);
  return entries.map((entry) => ({
    storeId: entry.storeId,
    createdAt: entry.createdAt,
    status: entry.status,
    items: entry.checkout.items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })),
  }));
}

/** The till's search on the device copy; null when the device is not prepared. */
export async function localSearch(
  db: PosDb,
  scope: { storeId: string; userId: string },
  term: string,
  filters: LocalSearchFilters = {},
): Promise<LocalSellable[] | null> {
  const snapshot = await loadSnapshot(db, scope.storeId, scope.userId);
  if (!snapshot) return null;
  return searchCatalog(snapshot, soldSince(snapshot, await deviceSales(db, scope.storeId)), term, filters);
}

/** A scanned code on the device copy: the product, `null` if unknown, undefined if not prepared. */
export async function localFind(db: PosDb, scope: { storeId: string; userId: string }, code: string): Promise<LocalSellable | null | undefined> {
  const snapshot = await loadSnapshot(db, scope.storeId, scope.userId);
  if (!snapshot) return undefined;
  return findByCode(snapshot, soldSince(snapshot, await deviceSales(db, scope.storeId)), code);
}
