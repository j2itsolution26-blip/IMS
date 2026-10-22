import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_SCOPES, StoreScopeError, foreignKeysToVerify, scopeArgs } from '@/lib/tenant/scope';
import { ownsImagePath, storeFolder } from '@/lib/storage-paths';

/**
 * The store-isolation rules, without a database: every call made through a
 * store-scoped client is rewritten by `scopeArgs`. The database-level proof
 * (triggers, raw SQL, two real stores) is the integration suite.
 */

/** The shape the assertions read; `scopeArgs` itself returns a loose record. */
type Scoped = { where?: Record<string, unknown>; data?: unknown; create?: unknown };
const scope = (...args: Parameters<typeof scopeArgs>) => scopeArgs(...args) as Scoped;

const A = 'store_a';
const B = 'store_b';
const refuses = (fn: () => unknown, pattern: RegExp) =>
  assert.throws(fn, (error: unknown) => error instanceof StoreScopeError && pattern.test((error as Error).message));

test('every model has an explicit isolation rule', () => {
  for (const [model, scope] of Object.entries(MODEL_SCOPES)) assert.ok(scope?.kind, model);
  refuses(() => scope('NotAModel', 'findMany', {}, A), /no isolation rule/);
});

test('fails closed without a store', () => {
  refuses(() => scope('Product', 'findMany', {}, ''), /no store selected/);
});

test('reads are confined to the store', () => {
  assert.deepEqual(scope('Product', 'findMany', { where: { name: 'Cola' } }, A).where, { name: 'Cola', storeId: A });
  assert.deepEqual(scope('Sale', 'findUnique', { where: { id: 's1' } }, A).where, { id: 's1', storeId: A });
  assert.deepEqual(scope('Sale', 'count', undefined, A).where, { storeId: A });
  for (const op of ['findFirst', 'findFirstOrThrow', 'findUniqueOrThrow', 'aggregate', 'groupBy']) {
    assert.equal(scope('Inventory', op, { where: {} }, A).where?.storeId, A, op);
  }
});

test('a filter naming another store is refused, not silently replaced', () => {
  refuses(() => scope('Product', 'findMany', { where: { storeId: B } }, A), /names a different store/);
  refuses(() => scope('Product', 'deleteMany', { where: { storeId: B } }, A), /names a different store/);
});

test('updates and deletes only reach the store, and rows cannot move store', () => {
  assert.equal(scope('Product', 'update', { where: { id: 'p1' }, data: { name: 'x' } }, A).where?.storeId, A);
  assert.equal(scope('Product', 'updateMany', { where: {}, data: { name: 'x' } }, A).where?.storeId, A);
  assert.equal(scope('Product', 'delete', { where: { id: 'p1' } }, A).where?.storeId, A);
  refuses(() => scope('Product', 'update', { where: { id: 'p1' }, data: { storeId: B } }, A), /cannot move/);
});

test('creates are tagged with the store; another store in the data is refused', () => {
  assert.equal((scope('Category', 'create', { data: { name: 'Drinks', slug: 'drinks' } }, A).data as { storeId?: string }).storeId, A);
  refuses(() => scope('Category', 'create', { data: { name: 'x', slug: 'x', storeId: B } }, A), /names a different store/);
  const many = scope('Category', 'createMany', { data: [{ name: 'a', slug: 'a' }, { name: 'b', slug: 'b' }] }, A);
  assert.ok((many.data as { storeId: string }[]).every((row) => row.storeId === A));
  refuses(() => scope('Category', 'createMany', { data: [{ name: 'a', slug: 'a', storeId: B }] }, A), /names a different store/);
});

test('a create using relation objects connects the store instead of a raw key', () => {
  const out = scope('Product', 'create', { data: { name: 'Cola', category: { connect: { id: 'c1' } } } }, A).data as Record<string, unknown>;
  assert.deepEqual(out.store, { connect: { id: A } });
  assert.equal(out.storeId, undefined);
  refuses(
    () => scope('Product', 'create', { data: { name: 'x', store: { connect: { id: B } } } }, A),
    /links a different store/,
  );
});

test('a create with raw foreign keys and nested child creates keeps the raw-key style', () => {
  // How checkout creates a sale: raw keys for its own relations, plus its
  // lines as a nested create. Prisma allows that only in the raw-key style,
  // so the store must go in as `storeId`, never as `store: { connect }`.
  const out = scope(
    'Sale',
    'create',
    { data: { invoiceNumber: 'INV-1', warehouseId: 'w1', userId: 'u1', shiftId: 'sh1', items: { create: [{ productId: 'p1' }] } } },
    A,
  ).data as Record<string, unknown> & { items: { create: { storeId: string }[] } };
  assert.equal(out.storeId, A);
  assert.equal(out.store, undefined);
  assert.equal(out.items.create[0].storeId, A);
});

test('nested writes are tagged and connects are confined to the store', () => {
  const out = scope(
    'Sale',
    'create',
    { data: { invoiceNumber: 'INV-1', items: { create: [{ productId: 'p1', quantity: 1 }] }, payments: { create: { amount: 1 } } } },
    A,
  ).data as { items: { create: { storeId: string }[] }; payments: { create: { storeId: string } } };
  assert.equal(out.items.create[0].storeId, A);
  assert.equal(out.payments.create.storeId, A);

  const connected = scope('Sale', 'update', { where: { id: 's1' }, data: { shift: { connect: { id: 'sh1' } } } }, A)
    .data as { shift: { connect: { id: string; storeId: string } } };
  assert.deepEqual(connected.shift.connect, { id: 'sh1', storeId: A });
  refuses(
    () => scope('Sale', 'create', { data: { items: { create: [{ productId: 'p1', storeId: B }] } } }, A),
    /names a different store/,
  );
});

test('upserts are confined on both branches', () => {
  const out = scope(
    'Setting',
    'upsert',
    { where: { storeId_key: { storeId: A, key: 'company.name' } }, create: { key: 'company.name', value: 'x' }, update: { value: 'y' } },
    A,
  );
  assert.equal(out.where?.storeId, A);
  assert.equal((out.create as { storeId: string }).storeId, A);
});

test('a per-store unique key naming another store is refused', () => {
  refuses(
    () => scope('Setting', 'upsert', { where: { storeId_key: { storeId: B, key: 'k' } }, create: { key: 'k' }, update: {} }, A),
    /storeId_key names a different store/,
  );
  refuses(() => scope('Product', 'findUnique', { where: { storeId_sku: { storeId: B, sku: 'x' } } }, A), /names a different store/);
  assert.equal(scope('Product', 'findUnique', { where: { storeId_sku: { storeId: A, sku: 'x' } } }, A).where?.storeId, A);
});

test('platform-only and reference models', () => {
  refuses(() => scope('Verification', 'findMany', {}, A), /not available to a store/);
  assert.deepEqual(scope('Permission', 'findMany', { where: { key: 'pos.view' } }, A).where, { key: 'pos.view' });
  refuses(() => scope('Permission', 'create', { data: {} }, A), /read-only/);
});

test('a store can read only its own store record, and never change it', () => {
  assert.deepEqual(scope('Store', 'findUnique', { where: { id: A } }, A).where, { id: A });
  refuses(() => scope('Store', 'findUnique', { where: { id: B } }, A), /names a different store/);
  refuses(() => scope('Store', 'update', { where: { id: A }, data: { plan: 'ENTERPRISE' } }, A), /cannot update its store record/);
});

test('rows owned through a relation are filtered by it and checked on create', () => {
  assert.deepEqual(scope('Session', 'findMany', { where: { userId: 'u1' } }, A).where, {
    userId: 'u1',
    AND: [{ user: { storeId: A } }],
  });
  assert.deepEqual(foreignKeysToVerify('RolePermission', 'create', { data: { roleId: 'r1', permissionId: 'p1' } }), {
    target: 'Role',
    ids: ['r1'],
  });
  refuses(() => foreignKeysToVerify('RolePermission', 'create', { data: { permissionId: 'p1' } }), /must name its role/);
  assert.equal(foreignKeysToVerify('Product', 'create', { data: {} }), null);
});

test('platform rows (no store) are invisible to a store', () => {
  // AuditLog and User allow a NULL store for platform rows; a store filter
  // never matches NULL, so platform entries never reach a store.
  assert.equal(scope('AuditLog', 'findMany', {}, A).where?.storeId, A);
  assert.equal(scope('User', 'findMany', {}, A).where?.storeId, A);
});

test("a store's files live in its own folder and only those can be removed", () => {
  assert.equal(storeFolder('store_a'), 'stores/store_a/');
  assert.ok(ownsImagePath('stores/store_a/products/x.png', 'store_a'));
  assert.ok(!ownsImagePath('stores/store_b/products/x.png', 'store_a'));
  assert.ok(!ownsImagePath('stores/store_a/../store_b/products/x.png', 'store_a'));
  // Uploads from before stores existed belong to the original store only.
  assert.ok(ownsImagePath('products/x.png', 'store_default'));
  assert.ok(!ownsImagePath('products/x.png', 'store_a'));
  assert.throws(() => storeFolder('../'));
});
