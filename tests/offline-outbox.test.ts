import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeLocalDb, openLocalDb, type PosDb } from '@/features/offline/local-db';
import {
  RETENTION_MS,
  entriesToSend,
  getEntry,
  localReceiptNumber,
  prune,
  recordSale,
  summarize,
  updateEntry,
} from '@/features/offline/outbox';
import { draft } from './helpers/outbox-draft';

let db: PosDb;

beforeEach(async () => {
  // A fresh, empty browser database for every test.
  globalThis.indexedDB = new IDBFactory();
  await closeLocalDb();
  db = await openLocalDb();
});

afterEach(async () => {
  await closeLocalDb();
});

test('a receipt number names the device and counts up', () => {
  assert.equal(localReceiptNumber('3f2a9c00-0000-4000-8000-000000000000', 12), 'OFF-3F2A-000012');
});

test('saving a sale numbers it, and the as-charged copy carries the same number', async () => {
  const first = await recordSale(db, draft());
  const second = await recordSale(db, draft());
  assert.match(first.localReceiptNumber, /^OFF-[0-9A-F]{4}-000001$/);
  assert.match(second.localReceiptNumber, /^OFF-[0-9A-F]{4}-000002$/);
  assert.equal(first.offline?.localReceiptNumber, first.localReceiptNumber);
  assert.equal(first.deviceId, second.deviceId, 'one device id per browser');
  assert.equal(first.attempts, 0);
  assert.equal(first.result, null);
});

test('saving the same sale twice keeps the first copy and uses no new number', async () => {
  const sale = draft();
  const first = await recordSale(db, sale);
  const again = await recordSale(db, { ...sale, receipt: { ...sale.receipt, total: 999 } });
  assert.equal(again.localReceiptNumber, first.localReceiptNumber);
  assert.equal(again.receipt.total, 15, 'the first copy is untouched');
  const next = await recordSale(db, draft());
  assert.match(next.localReceiptNumber, /-000002$/);
});

test('a save that fails writes nothing at all, not even a receipt number', async () => {
  await assert.rejects(recordSale(db, draft({ id: undefined as unknown as string })));
  const next = await recordSale(db, draft());
  assert.match(next.localReceiptNumber, /-000001$/, 'the failed save did not use a number');
});

test('a sale survives the database being closed and reopened (a reload)', async () => {
  const saved = await recordSale(db, draft());
  await closeLocalDb();
  db = await openLocalDb();
  const found = await getEntry(db, saved.id);
  assert.equal(found?.localReceiptNumber, saved.localReceiptNumber);
  assert.equal(found?.status, 'pending');
});

test('counts are per store and cashier; another cashier’s unsent sales are counted apart', async () => {
  await recordSale(db, draft());
  const refused = await recordSale(db, draft());
  await updateEntry(db, refused.id, (e) => ({ ...e, status: 'rejected' }));
  await recordSale(db, draft({ userId: 'cashier_2' }));
  await recordSale(db, draft({ storeId: 'store_b' }));
  const synced = await recordSale(db, draft());
  await updateEntry(db, synced.id, (e) => ({ ...e, status: 'synced' }));

  assert.deepEqual(await summarize(db, { storeId: 'store_a', userId: 'cashier_1' }), { pending: 1, attention: 1, othersUnsynced: 1 });
  assert.deepEqual(await summarize(db, { storeId: 'store_c', userId: 'cashier_1' }), { pending: 0, attention: 0, othersUnsynced: 0 });
});

test('what a pass sends: due pending sales; held ones only on a fresh start; refused ones only by name', async () => {
  const now = Date.now();
  const due = await recordSale(db, draft());
  const later = await recordSale(db, draft(), { holdUntil: now + 60_000 });
  const held = await recordSale(db, draft());
  await updateEntry(db, held.id, (e) => ({ ...e, status: 'reauth' }));
  const refused = await recordSale(db, draft());
  await updateEntry(db, refused.id, (e) => ({ ...e, status: 'rejected' }));
  await recordSale(db, draft({ userId: 'cashier_2' }));

  const scope = { storeId: 'store_a', userId: 'cashier_1' };
  const ids = async (options: Parameters<typeof entriesToSend>[2]) => (await entriesToSend(db, scope, options)).map((e) => e.id);
  assert.deepEqual(await ids({ now, includeHeld: false }), [due.id]);
  assert.deepEqual(await ids({ now, includeHeld: true }), [due.id, held.id]);
  assert.deepEqual(await ids({ now: now + 61_000, includeHeld: false }), [due.id, later.id]);
  assert.deepEqual(await ids({ now, includeHeld: false, onlyIds: [refused.id] }), [refused.id]);
});

test('pruning removes only old sent or declined sales, never an unsent one', async () => {
  const old = new Date(Date.now() - RETENTION_MS - 60_000).toISOString();
  const sent = await recordSale(db, draft({ createdAt: old }));
  await updateEntry(db, sent.id, (e) => ({ ...e, status: 'synced' }));
  const declined = await recordSale(db, draft({ createdAt: old }));
  await updateEntry(db, declined.id, (e) => ({ ...e, status: 'declined' }));
  const unsent = await recordSale(db, draft({ createdAt: old }));
  const refused = await recordSale(db, draft({ createdAt: old }));
  await updateEntry(db, refused.id, (e) => ({ ...e, status: 'rejected' }));
  const recent = await recordSale(db, draft());
  await updateEntry(db, recent.id, (e) => ({ ...e, status: 'synced' }));

  assert.equal(await prune(db), 2);
  assert.equal(await getEntry(db, sent.id), undefined);
  assert.equal(await getEntry(db, declined.id), undefined);
  assert.ok(await getEntry(db, unsent.id), 'an unsent sale is kept however old');
  assert.ok(await getEntry(db, refused.id), 'a refused sale is kept for review');
  assert.ok(await getEntry(db, recent.id));
});
