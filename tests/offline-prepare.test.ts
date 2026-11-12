import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { openDB } from 'idb';
import { DB_NAME, closeLocalDb, openLocalDb } from '@/features/offline/local-db';
import { getEntry, recordSale } from '@/features/offline/outbox';
import { forgetLastTill, lastTill, localFind, localSearch, loadSnapshot, prepareDevice } from '@/features/offline/catalog';
import type { OfflineCatalog } from '@/lib/offline-catalog';
import { draft } from './helpers/outbox-draft';

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  await closeLocalDb();
});
afterEach(async () => {
  await closeLocalDb();
});

const catalog: OfflineCatalog = {
  fetchedAt: new Date(Date.now() - 60_000).toISOString(),
  store: { id: 'store_a', name: 'Store', currency: 'PHP', taxRate: 0 },
  offlineAccessHours: 72,
  branch: { id: 'wh_1' },
  user: { id: 'cashier_1' },
  openShift: null,
  categories: [],
  products: [
    {
      id: 'p1',
      name: 'Soap',
      sku: 'SOAP',
      barcode: '4800365221029',
      barcodeKey: '4800365221029',
      categoryId: 'c',
      categoryName: 'General',
      imageUrl: null,
      sellingPrice: 15,
      isTrackable: true,
      unit: 'PIECE',
      allowsDecimal: false,
      quantityPresets: [],
      stock: 10,
      updatedAt: new Date().toISOString(),
    },
  ],
  truncated: false,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake server for /api/pos/devices and /api/pos/catalog. */
function server(answers: { devices?: Response | 'down'; catalog?: Response | 'down' }) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const path = String(url);
    calls.push(path.split('?')[0]);
    const answer = path.startsWith('/api/pos/devices') ? answers.devices : answers.catalog;
    if (answer === 'down' || !answer) throw new TypeError('Failed to fetch');
    return answer.clone();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const scope = { storeId: 'store_a', userId: 'cashier_1' };

test('upgrading the device database keeps every unsent sale (version 1 → 2)', async () => {
  // A till still on version 1, with a sale waiting.
  const v1 = await openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('meta');
      const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('byStatus', 'status');
      outbox.createIndex('byStore', 'storeId');
      outbox.createIndex('byCreatedAt', 'createdAt');
      const log = db.createObjectStore('syncLog', { keyPath: 'id', autoIncrement: true });
      log.createIndex('byAt', 'at');
    },
  });
  const sale = { ...draft(), deviceId: 'd', localReceiptNumber: 'OFF-0000-000001', updatedAt: '', attempts: 0, nextAttemptAt: null, lastError: null, result: null };
  await v1.put('outbox', sale);
  v1.close();

  const db = await openLocalDb();
  assert.equal(db.version, 2);
  assert.ok(db.objectStoreNames.contains('catalog'));
  assert.equal((await getEntry(db, sale.id))?.localReceiptNumber, 'OFF-0000-000001');
});

test('preparing registers the device, then keeps the catalogue copy', async () => {
  const db = await openLocalDb();
  const { fetchImpl, calls } = server({ devices: json(200, { ok: true, device: {} }), catalog: json(200, { ok: true, catalog }) });
  const result = await prepareDevice(db, scope, fetchImpl);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['/api/pos/devices', '/api/pos/catalog']);
  const stored = await loadSnapshot(db, 'store_a', 'cashier_1');
  assert.equal(stored?.products.length, 1);
  assert.equal(stored?.deviceId.length, 36, 'the device’s own id');
});

test('a refusal (offline selling off, device revoked) removes the copy; a network failure keeps it', async () => {
  const db = await openLocalDb();
  await prepareDevice(db, scope, server({ devices: json(200, { ok: true }), catalog: json(200, { ok: true, catalog }) }).fetchImpl);

  const down = await prepareDevice(db, scope, server({ devices: 'down' }).fetchImpl);
  assert.deepEqual(down.ok ? null : [down.code, down.withdrawn], ['NETWORK', false]);
  assert.ok(await loadSnapshot(db, 'store_a', 'cashier_1'), 'kept while unreachable');

  const revoked = await prepareDevice(
    db,
    scope,
    server({ devices: json(200, { ok: true }), catalog: json(403, { ok: false, code: 'DEVICE_REVOKED', error: 'removed', retryable: false }) }).fetchImpl,
  );
  assert.deepEqual(revoked.ok ? null : [revoked.code, revoked.withdrawn], ['DEVICE_REVOKED', true]);
  assert.equal(await loadSnapshot(db, 'store_a', 'cashier_1'), null, 'offline selling ends on this device');
});

test('removing the copy never touches the sales on the device', async () => {
  const db = await openLocalDb();
  const sale = await recordSale(db, draft());
  await prepareDevice(db, scope, server({ devices: json(403, { ok: false, code: 'OFFLINE_DISABLED', error: 'off' }) }).fetchImpl);
  assert.ok(await getEntry(db, sale.id));
});

test('a copy for another account is not kept', async () => {
  const db = await openLocalDb();
  const other = { ...catalog, user: { id: 'cashier_9' } };
  const result = await prepareDevice(db, scope, server({ devices: json(200, { ok: true }), catalog: json(200, { ok: true, catalog: other }) }).fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(await loadSnapshot(db, 'store_a', 'cashier_1'), null);
});

test('searching and scanning on the device use the copy and this device’s sales', async () => {
  const db = await openLocalDb();
  assert.equal(await localSearch(db, scope, ''), null, 'not prepared');
  assert.equal(await localFind(db, scope, '4800365221029'), undefined, 'not prepared');
  await prepareDevice(db, scope, server({ devices: json(200, { ok: true }), catalog: json(200, { ok: true, catalog }) }).fetchImpl);
  await recordSale(db, draft({ checkout: { items: [{ productId: 'p1', quantity: 3 }], payments: [{ method: 'CASH', amount: 50 }] } }));
  const found = await localFind(db, scope, '4 800365 221029');
  assert.equal(found?.id, 'p1');
  assert.equal(found?.available, 7, '10 in the copy, 3 sold on this device since');
  assert.equal(await localFind(db, scope, 'nope'), null);
});

test('the till opened with no connection is the one last prepared here, until sign-out or a refusal', async () => {
  const db = await openLocalDb();
  assert.equal(await lastTill(db), null, 'nothing prepared');
  const ok = () => server({ devices: json(200, { ok: true }), catalog: json(200, { ok: true, catalog }) }).fetchImpl;
  await prepareDevice(db, scope, ok());
  assert.deepEqual((await lastTill(db))?.scope, scope);

  const sale = await recordSale(db, draft());
  await forgetLastTill(db);
  assert.equal(await lastTill(db), null, 'signed out: no till opens offline');
  assert.equal(await loadSnapshot(db, 'store_a', 'cashier_1'), null, 'and the price list is gone');
  assert.ok(await getEntry(db, sale.id), 'unsent sales stay');

  await prepareDevice(db, scope, ok());
  await prepareDevice(db, scope, server({ devices: json(403, { ok: false, code: 'DEVICE_REVOKED', error: 'removed' }) }).fetchImpl);
  assert.equal(await lastTill(db), null, 'a revoked device stops opening offline');
});
