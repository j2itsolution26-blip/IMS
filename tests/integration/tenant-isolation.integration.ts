import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Store isolation against a real PostgreSQL database.
 *
 * Builds two complete stores, A and B, then proves that a client scoped to A
 * cannot read, count, change, delete or link to anything of B's, that forged
 * or missing store context is refused, and that the database's own guards
 * reject cross-store links even from raw SQL.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * The database needs every migration applied (`prisma migrate deploy`). The
 * suite refuses any host but localhost, so it can never run against a shared
 * or production database. It adds rows for two uniquely named stores and
 * leaves them in place: several tables are append-only by design.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run store-isolation tests against ${host}; use a local database.`);
  }
}

type Fixture = Record<string, string> & { storeId: string };

if (!URL_ENV) {
  test('store isolation (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  assertLocal(URL_ENV);
  process.env.DATABASE_URL = URL_ENV;

  let platform: PrismaClient;
  let storeClient: (storeId: string) => PrismaClient;
  let StoreScopeError: new (...args: never[]) => Error;
  let A: Fixture;
  let B: Fixture;
  let dbA: PrismaClient;
  const run = randomBytes(4).toString('hex');

  /** One complete store: a row in every store-owned table, all linked together. */
  async function seedStore(tag: string): Promise<Fixture> {
    const p = platform;
    const storeId = `it_${tag}_${run}`;
    const id = (name: string) => `${name}_${tag}_${run}`;
    await p.store.create({ data: { id: storeId, name: `Store ${tag}`, slug: storeId.replace(/_/g, '-'), status: 'ACTIVE', plan: 'BUSINESS' } });
    await p.role.create({ data: { id: id('role'), storeId, name: `Owner ${tag}`, slug: 'owner' } });
    await p.user.create({ data: { id: id('user'), storeId, name: `Owner ${tag}`, email: `${id('user')}@it.test`, username: id('user').toLowerCase(), roleId: id('role') } });
    await p.session.create({ data: { id: id('session'), token: id('token'), userId: id('user'), expiresAt: new Date(Date.now() + 3600_000) } });
    await p.category.create({ data: { id: id('cat'), storeId, name: `Drinks ${tag}`, slug: `drinks-${tag}` } });
    await p.product.create({ data: { id: id('prod'), storeId, sku: `SKU-${tag}`, barcode: `BAR-${tag}`, name: `Product ${tag} ${run}`, categoryId: id('cat'), sellingPrice: 95, costPrice: 60 } });
    await p.priceHistory.create({ data: { id: id('price'), storeId, productId: id('prod'), field: 'SELLING', oldValue: 90, newValue: 95 } });
    await p.warehouse.create({ data: { id: id('wh'), storeId, code: 'MAIN', name: `Main ${tag}` } });
    await p.inventory.create({ data: { id: id('inv'), storeId, productId: id('prod'), warehouseId: id('wh'), quantity: 50 } });
    await p.inventoryTransaction.create({ data: { id: id('itx'), storeId, productId: id('prod'), warehouseId: id('wh'), type: 'STOCK_IN', quantity: 50, balanceBefore: 0, balanceAfter: 50 } });
    await p.cashierShift.create({ data: { id: id('shift'), storeId, userId: id('user'), openingCash: 1000 } });
    await p.cashMovement.create({ data: { id: id('cash'), storeId, shiftId: id('shift'), type: 'CASH_IN', amount: 100, reason: 'coins', userId: id('user') } });
    await p.shiftAdjustment.create({ data: { id: id('adj'), storeId, shiftId: id('shift'), amount: 5, reason: 'recount', userId: id('user') } });
    await p.notification.create({ data: { id: id('note'), storeId, type: 'SHIFT_OPENED', title: 'Shift opened', body: tag, dedupeKey: id('dedupe') } });
    await p.sale.create({ data: { id: id('sale'), storeId, invoiceNumber: `INV-${tag}`, warehouseId: id('wh'), userId: id('user'), shiftId: id('shift'), total: 95 } });
    await p.saleItem.create({ data: { id: id('item'), storeId, saleId: id('sale'), productId: id('prod'), quantity: 1, unitPrice: 95, unitCost: 60, total: 95 } });
    await p.payment.create({ data: { id: id('pay'), storeId, paymentNumber: `PAY-${tag}`, direction: 'INBOUND', method: 'CASH', amount: 95, saleId: id('sale'), userId: id('user'), shiftId: id('shift') } });
    await p.return.create({ data: { id: id('ret'), storeId, returnNumber: `RET-${tag}`, saleId: id('sale'), userId: id('user'), total: 95 } });
    await p.returnItem.create({ data: { id: id('retitem'), storeId, returnId: id('ret'), productId: id('prod'), saleItemId: id('item'), quantity: 1, unitPrice: 95, total: 95 } });
    await p.setting.create({ data: { id: id('setting'), storeId, key: 'company.name', value: `Store ${tag}`, label: 'Store name' } });
    await p.auditLog.create({ data: { id: id('audit'), storeId, action: 'CREATE', entity: 'Product', summary: `seeded ${tag}`, userId: id('user') } });
    return {
      storeId,
      role: id('role'), user: id('user'), session: id('session'), cat: id('cat'), prod: id('prod'), price: id('price'),
      wh: id('wh'), inv: id('inv'), itx: id('itx'), shift: id('shift'), cash: id('cash'), adj: id('adj'), note: id('note'),
      sale: id('sale'), item: id('item'), pay: id('pay'), ret: id('ret'), retitem: id('retitem'), setting: id('setting'), audit: id('audit'),
    };
  }

  /** Every store-owned model, its delegate and the fixture key of its row. */
  const MODELS: [delegate: string, key: string][] = [
    ['category', 'cat'], ['product', 'prod'], ['priceHistory', 'price'], ['warehouse', 'wh'], ['inventory', 'inv'],
    ['inventoryTransaction', 'itx'], ['cashierShift', 'shift'], ['cashMovement', 'cash'], ['shiftAdjustment', 'adj'],
    ['notification', 'note'], ['sale', 'sale'], ['saleItem', 'item'], ['payment', 'pay'], ['return', 'ret'],
    ['returnItem', 'retitem'], ['setting', 'setting'], ['auditLog', 'audit'], ['user', 'user'], ['role', 'role'],
  ];
  type Delegate = {
    findMany: (a?: unknown) => Promise<{ id: string; storeId: string | null }[]>;
    findUnique: (a: unknown) => Promise<unknown>;
    findFirst: (a: unknown) => Promise<unknown>;
    count: (a?: unknown) => Promise<number>;
    deleteMany: (a: unknown) => Promise<{ count: number }>;
    updateMany: (a: unknown) => Promise<{ count: number }>;
  };
  const delegate = (client: PrismaClient, name: string) => (client as unknown as Record<string, Delegate>)[name];

  /** Rejects with a store-isolation error or a database guard, never succeeds. */
  async function rejects(fn: () => Promise<unknown>, label: string) {
    await assert.rejects(fn, (error: unknown) => {
      const message = String((error as Error)?.message ?? error);
      return error instanceof StoreScopeError || /another store|cannot move|No record was found|not found|Store isolation|violat|Unique constraint|null value|Null constraint|23502|Failing row|cannot be changed|append-only|UNIT_PRECISION|check constraint/i.test(message);
    }, label);
  }

  before(async () => {
    ({ platformPrisma: platform } = await import('@/lib/prisma'));
    ({ storeClient } = await import('@/lib/tenant/client'));
    ({ StoreScopeError } = (await import('@/lib/tenant/scope')) as unknown as { StoreScopeError: new () => Error });
    const [row] = await platform.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);
    A = await seedStore('a');
    B = await seedStore('b');
    dbA = storeClient(A.storeId);
  });

  after(async () => {
    await platform?.$disconnect();
  });

  describe('reads', () => {
    for (const [name, key] of MODELS) {
      test(`${name}: A sees only its own rows`, async () => {
        const rows = await delegate(dbA, name).findMany({ select: { id: true, storeId: true } });
        assert.ok(rows.some((r) => r.id === A[key]), 'own row visible');
        assert.ok(rows.every((r) => r.storeId === A.storeId), 'no foreign rows');
        assert.equal(await delegate(dbA, name).count(), await delegate(platform, name).count({ where: { storeId: A.storeId } }));
        assert.equal(await delegate(dbA, name).findUnique({ where: { id: B[key] } }), null, 'B by id is not found');
        assert.equal(await delegate(dbA, name).findFirst({ where: { id: B[key] } }), null);
      });
    }

    test('aggregate and groupBy only cover the store', async () => {
      const total = await dbA.sale.aggregate({ _sum: { total: true }, _count: { _all: true } });
      assert.equal(total._count._all, await platform.sale.count({ where: { storeId: A.storeId } }));
      const groups = await dbA.payment.groupBy({ by: ['storeId'], _count: { _all: true } });
      assert.deepEqual(groups.map((g) => g.storeId), [A.storeId]);
    });

    test('relations read through a store row stay in the store', async () => {
      const sale = await dbA.sale.findUnique({ where: { id: A.sale }, include: { items: true, payments: true } });
      assert.ok(sale && sale.items.every((i) => i.storeId === A.storeId) && sale.payments.every((p) => p.storeId === A.storeId));
    });

    test('rows owned through a user (sessions) are filtered by that user’s store', async () => {
      const sessions = await dbA.session.findMany({ select: { id: true } });
      assert.ok(sessions.some((s) => s.id === A.session));
      assert.ok(!sessions.some((s) => s.id === B.session));
    });

    test('platform rows (no store) are invisible to a store', async () => {
      const entry = await platform.auditLog.create({ data: { storeId: null, action: 'UPDATE', entity: 'Platform', summary: `platform ${run}` } });
      assert.equal(await dbA.auditLog.findUnique({ where: { id: entry.id } }), null);
    });
  });

  describe('writes', () => {
    for (const [name, key] of MODELS) {
      test(`${name}: A cannot delete B's row`, async () => {
        const { count } = await delegate(dbA, name).deleteMany({ where: { id: B[key] } });
        assert.equal(count, 0);
        assert.equal(await delegate(platform, name).count({ where: { id: B[key] } }), 1, 'B row still there');
      });
    }

    test('A cannot update B rows, singly or in bulk', async () => {
      await rejects(() => dbA.product.update({ where: { id: B.prod }, data: { name: 'hijacked' } }), 'update by id');
      const { count } = await dbA.product.updateMany({ where: { id: B.prod }, data: { name: 'hijacked' } });
      assert.equal(count, 0);
      const bulk = await dbA.category.updateMany({ data: { description: `touched ${run}` } });
      assert.equal(bulk.count, await platform.category.count({ where: { storeId: A.storeId } }));
      assert.equal((await platform.category.findUnique({ where: { id: B.cat } }))?.description ?? null, null, 'B untouched by bulk update');
      assert.equal((await platform.product.findUnique({ where: { id: B.prod } }))?.name, `Product b ${run}`);
    });

    test('A cannot upsert into B', async () => {
      await dbA.setting.upsert({
        where: { storeId_key: { storeId: A.storeId, key: 'company.name' } },
        create: { key: 'company.name', value: 'x', label: 'Store name' },
        update: { value: `A ${run}` },
      });
      assert.equal((await platform.setting.findUnique({ where: { id: B.setting } }))?.value, 'Store b');
      await rejects(
        () => dbA.setting.upsert({ where: { storeId_key: { storeId: B.storeId, key: 'company.name' } }, create: { key: 'k', value: 'v', label: 'l' }, update: { value: 'hijacked' } }),
        'upsert naming B',
      );
    });

    test('A cannot create rows that point at B', async () => {
      await rejects(() => dbA.product.create({ data: { sku: `X-${run}`, name: 'x', categoryId: B.cat } }), 'product in B category');
      await rejects(() => dbA.inventory.create({ data: { productId: B.prod, warehouseId: A.wh } }), 'inventory for B product');
      await rejects(() => dbA.sale.create({ data: { invoiceNumber: `X-${run}`, warehouseId: B.wh, userId: A.user } }), 'sale in B warehouse');
      await rejects(() => dbA.saleItem.create({ data: { saleId: A.sale, productId: B.prod, quantity: 1, unitPrice: 1, unitCost: 1, total: 1 } }), 'line of B product');
      await rejects(() => dbA.payment.create({ data: { paymentNumber: `X-${run}`, direction: 'INBOUND', method: 'CASH', amount: 1, saleId: B.sale, userId: A.user } }), 'payment on B sale');
      await rejects(() => dbA.cashMovement.create({ data: { shiftId: B.shift, type: 'CASH_IN', amount: 1, reason: 'x', userId: A.user } }), 'movement on B shift');
      await rejects(() => dbA.user.create({ data: { name: 'x', email: `x${run}@it.test`, username: `x${run}`, roleId: B.role } }), 'user with B role');
    });

    test('A cannot connect a B row through a relation', async () => {
      await rejects(
        () => dbA.product.create({ data: { sku: `Y-${run}`, name: 'y', category: { connect: { id: B.cat } } } }),
        'connect B category',
      );
      await rejects(() => dbA.sale.update({ where: { id: A.sale }, data: { shift: { connect: { id: B.shift } } } }), 'connect B shift');
    });

    test('nested creates are tagged with A', async () => {
      const sale = await dbA.sale.create({
        data: {
          invoiceNumber: `NEST-${run}`, warehouseId: A.wh, userId: A.user, total: 1,
          items: { create: [{ productId: A.prod, quantity: 1, unitPrice: 1, unitCost: 1, total: 1 }] },
        },
        include: { items: true },
      });
      assert.equal(sale.storeId, A.storeId);
      assert.ok(sale.items.every((i) => i.storeId === A.storeId));
    });

    test('a checkout request id records one sale per store, and never blocks another store', async () => {
      const requestId = `00000000-0000-4000-8000-${run.padStart(12, '0').slice(-12)}`;
      const sale = (n: string) => ({ invoiceNumber: `REQ-${n}-${run}`, warehouseId: A.wh, userId: A.user, total: 1, clientRequestId: requestId });
      const results = await Promise.allSettled([dbA.sale.create({ data: sale('1') }), dbA.sale.create({ data: sale('2') })]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      assert.equal((refused.reason as { code?: string }).code, 'P2002');
      assert.equal(await dbA.sale.count({ where: { clientRequestId: requestId } }), 1);
      // The same id in another store is a different checkout.
      await storeClient(B.storeId).sale.create({ data: { invoiceNumber: `REQ-B-${run}`, warehouseId: B.wh, userId: B.user, total: 1, clientRequestId: requestId } });
    });

    test('a role permission cannot be granted on B’s role', async () => {
      const permission = await platform.permission.findFirst({ select: { id: true } });
      if (!permission) return;
      await rejects(() => dbA.rolePermission.create({ data: { roleId: B.role, permissionId: permission.id } }), 'grant on B role');
    });
  });

  describe('forged and missing store context', () => {
    test('a filter or value naming B is refused', async () => {
      await rejects(() => dbA.product.findMany({ where: { storeId: B.storeId } }), 'filter B');
      await rejects(() => dbA.category.create({ data: { name: 'x', slug: `x-${run}`, storeId: B.storeId } }), 'create in B');
      await rejects(() => dbA.product.update({ where: { id: A.prod }, data: { storeId: B.storeId } }), 'move to B');
    });

    test('A cannot read or change another store record', async () => {
      await rejects(() => dbA.store.findUnique({ where: { id: B.storeId } }), 'read B store');
      await rejects(() => dbA.store.update({ where: { id: A.storeId }, data: { plan: 'ENTERPRISE' } }), 'upgrade own plan');
      const own = await dbA.store.findMany();
      assert.deepEqual(own.map((s) => s.id), [A.storeId]);
    });

    test('no store means no client', () => {
      assert.throws(() => storeClient(''));
    });

    test('a transaction on A’s client stays in A', async () => {
      const ids = await dbA.$transaction(async (tx) => (await tx.product.findMany({ select: { storeId: true } })).map((p) => p.storeId));
      assert.ok(ids.length > 0 && ids.every((s) => s === A.storeId));
      await rejects(() => dbA.$transaction(async (tx) => tx.product.update({ where: { id: B.prod }, data: { name: 'tx' } })), 'update B in tx');
    });

    test('platform-only data is refused', async () => {
      await rejects(() => dbA.verification.findMany(), 'verification');
    });
  });

  describe('database guards (independent of the client)', () => {
    test('raw SQL cannot link a row to another store’s row', async () => {
      await rejects(
        () => platform.$executeRawUnsafe(`INSERT INTO inventory (id, "storeId", "productId", "warehouseId", quantity, "updatedAt") VALUES ('raw_${run}', '${A.storeId}', '${B.prod}', '${A.wh}', 1, now())`),
        'raw cross-store inventory',
      );
      await rejects(
        () => platform.$executeRawUnsafe(`INSERT INTO sale_items (id, "storeId", "saleId", "productId", quantity, "unitPrice", "unitCost", total) VALUES ('raw2_${run}', '${A.storeId}', '${A.sale}', '${B.prod}', 1, 1, 1, 1)`),
        'raw cross-store sale line',
      );
    });

    test('cash movements are numbered, corrected once by a linked entry, and never edited', async () => {
      const original = await platform.cashMovement.create({
        data: { storeId: A.storeId, shiftId: A.shift, type: 'CASH_OUT', amount: 50, reason: 'ice', category: 'SUPPLIER_PAYMENT', userId: A.user },
      });
      assert.ok(original.number > 0);
      // A correction must say so, and only a correction may link to another movement.
      await rejects(
        () => platform.cashMovement.create({ data: { storeId: A.storeId, shiftId: A.shift, type: 'CASH_IN', amount: 50, reason: 'x', correctsId: original.id, userId: A.user } }),
        'link without CORRECTION',
      );
      await rejects(
        () => platform.cashMovement.create({ data: { storeId: A.storeId, shiftId: A.shift, type: 'CASH_IN', amount: 50, reason: 'x', category: 'CORRECTION', userId: A.user } }),
        'CORRECTION without link',
      );
      const fix = { storeId: A.storeId, shiftId: A.shift, type: 'CASH_IN' as const, amount: 50, reason: 'typo', category: 'CORRECTION' as const, correctsId: original.id, userId: A.user };
      await platform.cashMovement.create({ data: fix });
      await rejects(() => platform.cashMovement.create({ data: fix }), 'second correction');
      // Another store cannot correct it, and nobody can edit or delete it.
      await rejects(
        () => platform.cashMovement.create({ data: { ...fix, storeId: B.storeId, shiftId: B.shift, userId: B.user } }),
        'cross-store correction',
      );
      await rejects(() => platform.cashMovement.update({ where: { id: original.id }, data: { amount: 1 } }), 'edit');
      await rejects(() => platform.cashMovement.delete({ where: { id: original.id } }), 'delete');
    });

    test('fractions are refused for whole-unit products, allowed for decimal ones, and a decimal product cannot turn back', async () => {
      const prod = `units_${run}`;
      await platform.product.create({
        data: { id: prod, storeId: A.storeId, sku: `KG-${run}`, name: `Rice ${run}`, categoryId: A.cat, sellingPrice: 52, costPrice: 45 },
      });
      // Created as a whole-piece product (the default): no fractions anywhere.
      await rejects(
        () => platform.inventory.create({ data: { storeId: A.storeId, productId: prod, warehouseId: A.wh, quantity: 2.5 } }),
        'fractional stock of a piece product',
      );
      await rejects(
        () => platform.saleItem.create({ data: { storeId: A.storeId, saleId: A.sale, productId: prod, quantity: 1.5, unitPrice: 52, unitCost: 45, total: 78 } }),
        'fractional sale line of a piece product',
      );
      await rejects(() => platform.product.update({ where: { id: prod }, data: { reorderLevel: 2.5 } }), 'fractional threshold');

      // Sold by the kilogram with decimals: fractions are fine, to 3 places.
      await platform.product.update({ where: { id: prod }, data: { unit: 'KILOGRAM', allowsDecimal: true, reorderLevel: 2.5 } });
      await platform.inventory.create({ data: { storeId: A.storeId, productId: prod, warehouseId: A.wh, quantity: 12.75 } });
      await platform.inventoryTransaction.create({
        data: { storeId: A.storeId, productId: prod, warehouseId: A.wh, type: 'STOCK_IN', quantity: 12.75, balanceBefore: 0, balanceAfter: 12.75 },
      });
      await platform.saleItem.create({ data: { storeId: A.storeId, saleId: A.sale, productId: prod, quantity: 1.25, unitPrice: 52, unitCost: 45, total: 65 } });

      // Having moved in fractions, it cannot go back to whole units.
      await rejects(() => platform.product.update({ where: { id: prod }, data: { allowsDecimal: false, reorderLevel: 2 } }), 'turn back to whole units');
    });

    test('a returned quantity can never exceed the quantity sold', async () => {
      await rejects(
        () => platform.$executeRawUnsafe(`UPDATE sale_items SET "returnedQuantity" = quantity + 1 WHERE id = '${A.item}'`),
        'over-return',
      );
      await rejects(() => platform.$executeRawUnsafe(`UPDATE sale_items SET "returnedQuantity" = -1 WHERE id = '${A.item}'`), 'negative return');
    });

    test('a void records who, when and why, is final, and cannot name another store’s user', async () => {
      const voided = `void_${run}`;
      await platform.sale.create({
        data: { id: voided, storeId: A.storeId, invoiceNumber: `VOID-${run}`, warehouseId: A.wh, userId: A.user, total: 10 },
      });
      // Voided without its details, or with details while not voided: refused.
      await rejects(() => platform.sale.update({ where: { id: voided }, data: { status: 'VOIDED' } }), 'void without details');
      await rejects(() => platform.sale.update({ where: { id: voided }, data: { voidReason: 'x' } }), 'details without void');
      await rejects(
        () => platform.sale.update({ where: { id: voided }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: 'test', voidedById: B.user } }),
        'voided by another store’s user',
      );
      await platform.sale.update({ where: { id: voided }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: 'test', voidedById: A.user } });
      await rejects(() => platform.sale.update({ where: { id: voided }, data: { status: 'COMPLETED', voidedAt: null, voidedById: null, voidReason: null } }), 'un-void');
      await rejects(() => platform.sale.update({ where: { id: voided }, data: { voidReason: 'changed' } }), 'rewrite reason');
      // Other fields of a voided sale (e.g. notes) can still be written.
      await platform.sale.update({ where: { id: voided }, data: { notes: 'checked' } });
    });

    test('raw SQL cannot move a row to another store', async () => {
      await rejects(() => platform.$executeRawUnsafe(`UPDATE products SET "storeId" = '${B.storeId}' WHERE id = '${A.prod}'`), 'move product');
    });

    test('a store-owned row cannot be written without a store', async () => {
      await rejects(
        () => platform.$executeRawUnsafe(`INSERT INTO categories (id, name, slug, "createdAt", "updatedAt") VALUES ('nostore_${run}', 'x', 'x-${run}', now(), now())`),
        'category without store',
      );
    });

    test('per-store unique keys allow the same SKU and invoice number in both stores', async () => {
      const a = await platform.product.findUnique({ where: { storeId_sku: { storeId: A.storeId, sku: 'SKU-shared' } } });
      if (!a) {
        await platform.product.create({ data: { storeId: A.storeId, sku: 'SKU-shared', name: 'shared', categoryId: A.cat } });
        await platform.product.create({ data: { storeId: B.storeId, sku: 'SKU-shared', name: 'shared', categoryId: B.cat } });
      }
      assert.equal(await platform.product.count({ where: { sku: 'SKU-shared', storeId: { in: [A.storeId, B.storeId] } } }), 2);
      await rejects(
        () => platform.product.create({ data: { storeId: A.storeId, sku: 'SKU-shared', name: 'dup', categoryId: A.cat } }),
        'duplicate SKU within a store',
      );
    });
  });
}
