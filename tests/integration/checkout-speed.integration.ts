import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * The cashier speed-ups against a real PostgreSQL database (migrations
 * 20261118090000 and 20261119090000): a GCash cash-in / cash-out and a GCash
 * sale payment need no typed reference, a typed one is still unique and
 * checked, a product's quick quantities are bounded, and gram-sized sales of
 * a kilogram product come off stock exactly.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Refuses any host but localhost. Leaves its uniquely named rows in place.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('checkout speed-ups (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run checkout tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;

  let db: PrismaClient;
  const run = randomBytes(4).toString('hex');
  const storeId = `it_speed_${run}`;
  const id = (name: string) => `${name}_${run}`;
  let shiftId = '';

  async function refused(fn: () => Promise<unknown>, pattern: RegExp) {
    await assert.rejects(fn, (error: Error) => pattern.test(error.message));
  }

  // The entry number is assigned by the database.
  const wallet = (_n: number, reference: string | null, extra: Record<string, unknown> = {}) =>
    db.walletTransaction.create({
      data: { storeId, type: 'CASH_IN', amount: 500, fee: 10, reference, shiftId, userId: id('cashier'), ...extra },
    });

  before(async () => {
    ({ platformPrisma: db } = await import('@/lib/prisma'));
    const [row] = await db.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);
    await db.store.create({ data: { id: storeId, name: 'Speed store', slug: storeId.replace(/_/g, '-'), status: 'ACTIVE', plan: 'BUSINESS' } });
    await db.category.create({ data: { id: id('cat'), storeId, name: 'General Merchandise & OTC', slug: 'general' } });
    await db.warehouse.create({ data: { id: id('wh'), storeId, code: 'MAIN', name: 'Main', isDefault: true } });
    const role = await db.role.create({ data: { storeId, name: 'Cashier', slug: 'cashier' } });
    await db.user.create({
      data: { id: id('cashier'), storeId, name: 'Cashier', username: `cashier_${run}`, email: `cashier_${run}@test.invalid`, roleId: role.id, warehouseId: id('wh') },
    });
    shiftId = (await db.cashierShift.create({ data: { storeId, userId: id('cashier'), warehouseId: id('wh'), openingCash: 1000 } })).id;
  });

  after(async () => {
    await db?.$disconnect();
  });

  test('a GCash cash-in needs no reference, and several blank ones can be recorded', async () => {
    const first = await wallet(1, null);
    const second = await wallet(2, null);
    assert.equal(first.reference, null);
    assert.equal(second.reference, null);
  });

  test('a typed GCash reference is still unique while live, and must look like one', async () => {
    await wallet(3, '1012345678901');
    await refused(() => wallet(4, '1012345678901'), /Unique constraint|wallet_transactions_live_reference/);
    await refused(() => wallet(5, 'ABC'), /wallet_transactions_reference_present/);
  });

  test('a blank-reference entry stays append-only', async () => {
    const row = await wallet(6, null);
    await refused(() => db.walletTransaction.update({ where: { id: row.id }, data: { reference: '9999999999999' } }), /append-only/);
  });

  test('a GCash sale payment can be recorded without a reference', async () => {
    const sale = await db.sale.create({
      data: { storeId, invoiceNumber: `INV-${run}`, warehouseId: id('wh'), userId: id('cashier'), shiftId, total: 90, subtotal: 90, paidAmount: 90 },
    });
    const payment = await db.payment.create({
      data: { storeId, paymentNumber: `PAY-${run}`, direction: 'INBOUND', method: 'GCASH', amount: 90, saleId: sale.id, userId: id('cashier'), shiftId },
    });
    assert.equal(payment.reference, null);
    assert.equal(sale.invoiceNumber, `INV-${run}`, 'the system receipt number is untouched');
  });

  test('quick quantities: empty by default, stored exactly, at most 8, all above zero', async () => {
    const product = await db.product.create({
      data: { id: id('rice'), storeId, sku: 'RICE', name: 'Rice', categoryId: id('cat'), sellingPrice: 60, unit: 'KILOGRAM', allowsDecimal: true },
    });
    assert.deepEqual(product.quantityPresets, []);
    const saved = await db.product.update({ where: { id: product.id }, data: { quantityPresets: ['0.25', '0.5', '0.75', '1', '3.25'] } });
    assert.deepEqual(saved.quantityPresets.map(String), ['0.25', '0.5', '0.75', '1', '3.25']);
    await refused(() => db.product.update({ where: { id: product.id }, data: { quantityPresets: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] } }), /products_quantity_presets_valid/);
    await refused(() => db.product.update({ where: { id: product.id }, data: { quantityPresets: ['0.5', '-1'] } }), /products_quantity_presets_valid/);
    await refused(() => db.product.update({ where: { id: product.id }, data: { quantityPresets: ['0', '1'] } }), /products_quantity_presets_valid/);
  });

  test('gram-sized sales of a kilogram product come off stock exactly: 50 g, 100 g, 250 g from 5 kg', async () => {
    await db.inventory.create({ data: { storeId, productId: id('rice'), warehouseId: id('wh'), quantity: 5 } });
    for (const kg of ['0.05', '0.1', '0.25']) {
      const row = await db.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: id('rice'), warehouseId: id('wh') } } });
      const after = row.quantity.minus(kg);
      await db.inventory.update({ where: { id: row.id }, data: { quantity: after } });
      await db.inventoryTransaction.create({
        data: { storeId, productId: id('rice'), warehouseId: id('wh'), type: 'SALE', quantity: `-${kg}`, balanceBefore: row.quantity, balanceAfter: after },
      });
    }
    const row = await db.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: id('rice'), warehouseId: id('wh') } } });
    assert.equal(row.quantity.toString(), '4.6');
  });
}
