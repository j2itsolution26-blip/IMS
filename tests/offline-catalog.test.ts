import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogKey,
  findByCode,
  offlineReadiness,
  searchCatalog,
  soldSince,
  toSnapshot,
  type CatalogProduct,
  type OfflineCatalog,
} from '@/lib/offline-catalog';

const product = (id: string, patch: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id,
  name: id,
  sku: id.toUpperCase(),
  barcode: null,
  barcodeKey: null,
  categoryId: 'cat_general',
  categoryName: 'General',
  imageUrl: null,
  sellingPrice: 10,
  isTrackable: true,
  unit: 'PIECE',
  allowsDecimal: false,
  quantityPresets: [],
  stock: 10,
  updatedAt: '2026-11-12T00:00:00.000Z',
  ...patch,
});

const catalog: OfflineCatalog = {
  fetchedAt: '2026-11-12T08:00:00.000Z',
  store: { id: 'store_a', name: 'Store', currency: 'PHP', taxRate: 0 },
  offlineAccessHours: 72,
  branch: { id: 'wh_main' },
  user: { id: 'cashier_1' },
  openShift: null,
  categories: [{ id: 'cat_general', name: 'General' }],
  products: [
    product('soap', { name: 'Bath Soap', barcode: '4 800365 221029', barcodeKey: '4800365221029', sellingPrice: 25, stock: 5 }),
    product('rice', { name: 'Rice', unit: 'KILOGRAM', allowsDecimal: true, sellingPrice: 60, stock: 2.5, categoryId: 'cat_grain' }),
    product('load', { name: 'Phone load', isTrackable: false, stock: 0, sellingPrice: 100 }),
  ],
  truncated: false,
};
const snapshot = toSnapshot(catalog, 'device-1');
const now = Date.parse('2026-11-12T09:00:00.000Z');
const context = { storeId: 'store_a', userId: 'cashier_1', branchId: 'wh_main', offlineMode: true, now };

test('a copy is kept per store and cashier, and lasts the access period from its download', () => {
  assert.equal(snapshot.key, catalogKey('store_a', 'cashier_1'));
  assert.equal(snapshot.accessUntil, '2026-11-15T08:00:00.000Z');
});

test('offline selling: only for this store, cashier and branch, within the period, while switched on', () => {
  assert.equal(offlineReadiness(snapshot, context).ready, true);
  const reason = (r: ReturnType<typeof offlineReadiness>) => (r.ready ? 'ready' : r.reason);
  assert.equal(reason(offlineReadiness(snapshot, { ...context, offlineMode: false })), 'disabled');
  assert.equal(reason(offlineReadiness(null, context)), 'not-prepared');
  assert.equal(reason(offlineReadiness(snapshot, { ...context, userId: 'cashier_2' })), 'not-prepared', 'another cashier’s copy');
  assert.equal(reason(offlineReadiness(snapshot, { ...context, storeId: 'store_b' })), 'not-prepared', 'another store’s copy');
  assert.equal(reason(offlineReadiness(snapshot, { ...context, now: Date.parse('2026-11-15T08:00:00.000Z') })), 'expired');
  assert.equal(reason(offlineReadiness(snapshot, { ...context, branchId: 'wh_other' })), 'other-branch');
});

test('stock on the device: the copy less sales made on it since, declined ones and older ones excluded', () => {
  const sold = soldSince(snapshot, [
    { storeId: 'store_a', createdAt: '2026-11-12T08:30:00.000Z', status: 'pending', items: [{ productId: 'rice', quantity: 0.25 }, { productId: 'soap', quantity: 1 }] },
    { storeId: 'store_a', createdAt: '2026-11-12T08:31:00.000Z', status: 'synced', items: [{ productId: 'rice', quantity: 0.5 }] },
    { storeId: 'store_a', createdAt: '2026-11-12T08:32:00.000Z', status: 'declined', items: [{ productId: 'soap', quantity: 3 }] },
    { storeId: 'store_a', createdAt: '2026-11-12T07:00:00.000Z', status: 'synced', items: [{ productId: 'soap', quantity: 2 }] },
    { storeId: 'store_b', createdAt: '2026-11-12T08:40:00.000Z', status: 'pending', items: [{ productId: 'soap', quantity: 4 }] },
  ]);
  assert.equal(sold.get('rice'), 0.75);
  assert.equal(sold.get('soap'), 1);
  const rows = searchCatalog(snapshot, sold, '');
  assert.equal(rows.find((p) => p.id === 'rice')?.available, 1.75, 'kilograms come off exactly');
  assert.equal(rows.find((p) => p.id === 'soap')?.available, 4);
});

test('search on the device: name or SKU contains, category, low stock and sort', () => {
  const none = new Map<string, number>();
  assert.deepEqual(searchCatalog(snapshot, none, 'soap').map((p) => p.id), ['soap']);
  assert.deepEqual(searchCatalog(snapshot, none, 'RIC').map((p) => p.id), ['rice']);
  assert.deepEqual(searchCatalog(snapshot, none, '', { categoryId: 'cat_grain' }).map((p) => p.id), ['rice']);
  assert.deepEqual(searchCatalog(snapshot, none, '', { lowStockAtOrBelow: 3 }).map((p) => p.id), ['rice']);
  assert.deepEqual(searchCatalog(snapshot, none, '', { sort: 'priceDesc' }).map((p) => p.id), ['load', 'rice', 'soap']);
  const soap = searchCatalog(snapshot, none, 'soap')[0];
  assert.deepEqual(Object.keys(soap).sort(), ['allowsDecimal', 'available', 'barcode', 'categoryName', 'id', 'imageUrl', 'isTrackable', 'name', 'quantityPresets', 'sellingPrice', 'sku', 'unit']);
});

test('a scanned code on the device: barcode ignoring pack spacing, else the SKU; unknown is null', () => {
  const none = new Map<string, number>();
  assert.equal(findByCode(snapshot, none, '4800365221029')?.id, 'soap');
  assert.equal(findByCode(snapshot, none, '4-800365-221029')?.id, 'soap');
  assert.equal(findByCode(snapshot, none, 'rice')?.id, 'rice');
  assert.equal(findByCode(snapshot, none, '9999999999999'), null);
  assert.equal(findByCode(snapshot, none, '   '), null);
});

test('a product that is not tracked keeps its stock as is', () => {
  const rows = searchCatalog(snapshot, new Map([['load', 3]]), 'load');
  assert.equal(rows[0].available, 0);
});
