import { deviceCode } from '@/lib/sync-review';
import { META, type DeviceRecord, type OutboxEntry, type OutboxStatus, type PosDb, type SyncLogEntry } from '@/features/offline/local-db';

/**
 * Reading and writing the till's outbox of sales (see local-db.ts).
 *
 * `recordSale` is the one write that matters: the entry and its receipt
 * number are committed together in one IndexedDB transaction, so either the
 * sale is on the device with a number, or nothing was written at all.
 */

/** Synced and declined entries are kept this long for reprints and the history list. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type NewOutboxEntry = Omit<OutboxEntry, 'deviceId' | 'localReceiptNumber' | 'updatedAt' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'result'>;

export function localReceiptNumber(deviceId: string, sequence: number): string {
  return `OFF-${deviceCode(deviceId)}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Saves a completed sale on the device. Idempotent on `id`: saving the same
 * sale twice returns the first copy untouched.
 */
export async function recordSale(db: PosDb, entry: NewOutboxEntry, options: { holdUntil?: number } = {}): Promise<OutboxEntry> {
  const tx = db.transaction(['meta', 'outbox'], 'readwrite');
  const meta = tx.objectStore('meta');
  const outbox = tx.objectStore('outbox');

  const existing = await outbox.get(entry.id);
  if (existing) {
    await tx.done;
    return existing;
  }

  let device = (await meta.get(META.device)) as DeviceRecord | undefined;
  if (!device) {
    device = { id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    await meta.put(device, META.device);
  }
  const sequence = (Number(await meta.get(META.receiptSequence)) || 0) + 1;
  await meta.put(sequence, META.receiptSequence);

  const number = localReceiptNumber(device.id, sequence);
  const saved: OutboxEntry = {
    ...entry,
    deviceId: device.id,
    localReceiptNumber: number,
    offline: entry.offline ? { ...entry.offline, localReceiptNumber: number } : null,
    receipt: entry.receipt,
    updatedAt: entry.createdAt,
    attempts: 0,
    // While the customer waits, the counter sends it; background passes wait.
    nextAttemptAt: options.holdUntil ?? null,
    lastError: null,
    result: null,
  };
  await outbox.add(saved);
  await tx.done;
  return saved;
}

/** Reads, changes and writes one entry in a single transaction. */
export async function updateEntry(db: PosDb, id: string, change: (entry: OutboxEntry) => OutboxEntry): Promise<OutboxEntry | null> {
  const tx = db.transaction('outbox', 'readwrite');
  const entry = await tx.store.get(id);
  if (!entry) {
    await tx.done;
    return null;
  }
  const next = { ...change(entry), id: entry.id, updatedAt: new Date().toISOString() };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function getEntry(db: PosDb, id: string): Promise<OutboxEntry | undefined> {
  return db.get('outbox', id);
}

const UNSYNCED: OutboxStatus[] = ['pending', 'rejected', 'blocked', 'reauth'];

export function isUnsynced(entry: Pick<OutboxEntry, 'status'>): boolean {
  return UNSYNCED.includes(entry.status);
}

/**
 * Every entry for this store, in the order the sales happened: by time, then
 * by the device's receipt sequence for sales within the same millisecond.
 */
export async function entriesForStore(db: PosDb, storeId: string): Promise<OutboxEntry[]> {
  const rows = await db.getAllFromIndex('outbox', 'byStore', storeId);
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.localReceiptNumber.localeCompare(b.localReceiptNumber));
}

export interface OutboxSummary {
  /** This cashier's sales still to send. */
  pending: number;
  /** This cashier's sales that were refused or are held up. */
  attention: number;
  /** Other cashiers' unsent sales for this store on this device. */
  othersUnsynced: number;
}

export async function summarize(db: PosDb, scope: { storeId: string; userId: string }): Promise<OutboxSummary> {
  const rows = await db.getAllFromIndex('outbox', 'byStore', scope.storeId);
  const summary: OutboxSummary = { pending: 0, attention: 0, othersUnsynced: 0 };
  for (const row of rows) {
    if (!isUnsynced(row)) continue;
    if (row.userId !== scope.userId) summary.othersUnsynced += 1;
    else if (row.status === 'pending') summary.pending += 1;
    else summary.attention += 1;
  }
  return summary;
}

/**
 * The entries a sync pass should try, oldest first: this cashier's due
 * pending ones, plus (on a fresh start, reconnection or manual retry) those
 * waiting on sign-in or an unblock. Refused ones only when asked by id.
 */
export async function entriesToSend(
  db: PosDb,
  scope: { storeId: string; userId: string },
  options: { now: number; includeHeld: boolean; onlyIds?: string[] },
): Promise<OutboxEntry[]> {
  const rows = await entriesForStore(db, scope.storeId);
  return rows.filter((row) => {
    if (row.userId !== scope.userId) return false;
    if (options.onlyIds) return options.onlyIds.includes(row.id) && isUnsynced(row);
    if (row.status === 'pending') return row.nextAttemptAt === null || row.nextAttemptAt <= options.now;
    if (row.status === 'blocked' || row.status === 'reauth') return options.includeHeld;
    return false;
  });
}

/** When the next pending entry is due, if any (epoch ms). */
export async function nextDueAt(db: PosDb, scope: { storeId: string; userId: string }): Promise<number | null> {
  const rows = await entriesForStore(db, scope.storeId);
  let next: number | null = null;
  for (const row of rows) {
    if (row.userId !== scope.userId || row.status !== 'pending') continue;
    const due = row.nextAttemptAt ?? 0;
    next = next === null ? due : Math.min(next, due);
  }
  return next;
}

export async function appendLog(db: PosDb, entry: Omit<SyncLogEntry, 'id'>): Promise<void> {
  await db.add('syncLog', entry);
}

/**
 * Removes synced and declined entries, and log lines, older than the
 * retention period. Never touches an unsynced sale.
 */
export async function prune(db: PosDb, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - RETENTION_MS).toISOString();
  const tx = db.transaction(['outbox', 'syncLog'], 'readwrite');
  let removed = 0;
  let cursor = await tx.objectStore('outbox').index('byCreatedAt').openCursor(IDBKeyRange.upperBound(cutoff));
  while (cursor) {
    if (cursor.value.status === 'synced' || cursor.value.status === 'declined') {
      await cursor.delete();
      removed += 1;
    }
    cursor = await cursor.continue();
  }
  let log = await tx.objectStore('syncLog').index('byAt').openCursor(IDBKeyRange.upperBound(cutoff));
  while (log) {
    await log.delete();
    log = await log.continue();
  }
  await tx.done;
  return removed;
}

export async function readMeta<T>(db: PosDb, key: string): Promise<T | undefined> {
  return (await db.get('meta', key)) as T | undefined;
}

export async function writeMeta(db: PosDb, key: string, value: unknown): Promise<void> {
  await db.put('meta', value, key);
}
