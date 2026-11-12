import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CheckoutInput } from '@/features/pos/checkout-schema';
import type { OfflineSale } from '@/lib/offline-sale';
import type { ReceiptData } from '@/features/pos/receipt';

/**
 * The till's own database, in the browser's IndexedDB.
 *
 * It holds every sale the till completes until the server has confirmed it,
 * so a reload, a closed tab, a lost response or a dropped connection can never
 * lose one. It is the device's working copy, not a backup: browsers may
 * clear site storage, and a sale is only safe for good once it is synced.
 *
 * Rules every version of this file keeps:
 *   - An unsynced sale is never deleted: not on sign-out, session expiry, app
 *     update or a schema upgrade. Only synced (or refused-at-the-counter)
 *     entries older than the retention period are pruned.
 *   - Every entry names its store and cashier, and the till only ever shows
 *     or uploads the signed-in cashier's own store's entries.
 *   - No passwords, tokens or PIN hashes are ever stored here.
 *
 * Upgrades only add: bump DB_VERSION and add a branch to `upgrade` that
 * creates the new stores or indexes. Never delete or clear `outbox` there.
 */

export const DB_NAME = 'tindahanpromax-pos';
export const DB_VERSION = 1;

/**
 *   pending   waiting to be sent (or being retried after a passing failure)
 *   synced    the server confirmed it; `result` holds the invoice number
 *   declined  refused at the counter while the customer waited: the cashier was
 *             told and nothing was charged. Kept for the record, never sent.
 *   rejected  sent later and refused by the server: needs the owner's attention
 *   blocked   cannot be sent yet (screen locked, another cashier's sale,
 *             store read-only); tried again when that may have changed
 *   reauth    the session ended; tried again after the cashier signs in
 */
export type OutboxStatus = 'pending' | 'synced' | 'declined' | 'rejected' | 'blocked' | 'reauth';

/**
 *   checkout  POST /api/pos/checkout: server-priced, as a live sale
 *   sync      POST /api/pos/sync: as charged, as an offline sale (cash only)
 */
export type OutboxRoute = 'checkout' | 'sync';

export type StoredReceipt = Omit<ReceiptData, 'issuedAt'> & { issuedAt: string };

export interface OutboxResult {
  saleId: string;
  invoiceNumber: string;
  total: number;
  paidAmount: number;
  changeAmount: number;
  receivedAt: string;
  issues: string[];
}

export interface OutboxEntry {
  /** The local transaction id: a UUID, sent as the sale's clientRequestId. */
  id: string;
  storeId: string;
  userId: string;
  deviceId: string;
  /** Printed on a PENDING SYNC receipt, e.g. OFF-3F2A-000012. */
  localReceiptNumber: string;
  createdAt: string;
  updatedAt: string;
  method: 'CASH' | 'GCASH';
  route: OutboxRoute;
  /** The live checkout request (clientRequestId = id). */
  checkout: CheckoutInput;
  /** Cash sales only: the same sale as charged, for /api/pos/sync. */
  offline: OfflineSale | null;
  /** What the customer was (or will be) handed. */
  receipt: StoredReceipt;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms before which a retry waits; null = now. */
  nextAttemptAt: number | null;
  lastError: { code: string; message: string; at: string } | null;
  result: OutboxResult | null;
}

export interface SyncLogEntry {
  id?: number;
  at: string;
  entryId: string;
  storeId: string;
  outcome: string;
  httpStatus: number | null;
  code: string | null;
  message: string | null;
}

export interface DeviceRecord {
  id: string;
  createdAt: string;
}

interface PosSchema extends DBSchema {
  meta: { key: string; value: unknown };
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { byStatus: OutboxStatus; byStore: string; byCreatedAt: string };
  };
  syncLog: { key: number; value: SyncLogEntry; indexes: { byAt: string } };
}

export type PosDb = IDBPDatabase<PosSchema>;

export const META = {
  device: 'device',
  receiptSequence: 'receiptSequence',
  lastSyncAt: 'lastSyncAt',
} as const;

let opening: Promise<PosDb> | null = null;

/**
 * Opens (and on first use creates or upgrades) the database. Shared across
 * callers. Rejects if IndexedDB is unavailable (some private windows, blocked
 * site data); callers treat that as "no local safety net" and say so.
 */
export function openLocalDb(): Promise<PosDb> {
  opening ??= openDB<PosSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('meta');
        const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
        outbox.createIndex('byStatus', 'status');
        outbox.createIndex('byStore', 'storeId');
        outbox.createIndex('byCreatedAt', 'createdAt');
        const log = db.createObjectStore('syncLog', { keyPath: 'id', autoIncrement: true });
        log.createIndex('byAt', 'at');
      }
    },
    blocked() {
      // An older tab still has the previous version open; it closes it below.
    },
    blocking() {
      // A newer version of the app wants to upgrade: let it, and reopen next time.
      void opening?.then((db) => db.close());
      opening = null;
    },
    terminated() {
      opening = null;
    },
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

/** For tests: forget the shared connection. */
export async function closeLocalDb(): Promise<void> {
  const current = opening;
  opening = null;
  if (current) (await current.catch(() => null))?.close();
}

/** This browser's device id, made on first use and kept for good. */
export async function deviceRecord(db: PosDb): Promise<DeviceRecord> {
  const tx = db.transaction('meta', 'readwrite');
  const existing = (await tx.store.get(META.device)) as DeviceRecord | undefined;
  if (existing) {
    await tx.done;
    return existing;
  }
  const created: DeviceRecord = { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  await tx.store.put(created, META.device);
  await tx.done;
  return created;
}

/**
 * Asks the browser to keep this site's storage under pressure (best effort;
 * some browsers grant it only to installed apps). Never throws.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
