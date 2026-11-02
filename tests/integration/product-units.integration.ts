import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Product units against a real PostgreSQL database (migrations 20261106090000
 * and 20261116090000): fractional stock is kept exactly, whole-unit products
 * refuse fractions, and a product's unit is fixed once it has moved.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:5432/ims_test npm run test:integration
 *
 * Refuses any host but localhost. Leaves its uniquely named rows in place.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;

if (!URL_ENV) {
  test('product units (integration)', { skip: 'set INTEGRATION_DATABASE_URL to a local database' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to run product-unit tests against ${host}; use a local database.`);
  }
  process.env.DATABASE_URL = URL_ENV;

  let db: PrismaClient;
  const run = randomBytes(4).toString('hex');
  const storeId = `it_units_${run}`;
  const id = (name: string) => `${name}_${run}`;

  /** A product in the test store, with an optional opening stock movement. */
  async function product(
    name: string,
    data: { unit?: 'PIECE' | 'KILOGRAM' | 'METER' | 'SACK'; allowsDecimal?: boolean },
    opening?: number,
  ) {
    await db.product.create({
      data: { id: id(name), storeId, sku: `SKU-${name}`, name, categoryId: id('cat'), sellingPrice: 50, costPrice: 40, ...data },
    });
    if (opening !== undefined) {
      await db.inventory.create({ data: { storeId, productId: id(name), warehouseId: id('wh'), quantity: opening } });
      await db.inventoryTransaction.create({
        data: { storeId, productId: id(name), warehouseId: id('wh'), type: 'STOCK_IN', quantity: opening, balanceBefore: 0, balanceAfter: opening },
      });
    }
    return id(name);
  }

  /** Records a sale-style deduction the way the inventory service does. */
  async function deduct(productId: string, quantity: string) {
    const row = await db.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId: id('wh') } } });
    const after = row.quantity.minus(quantity);
    await db.inventory.update({ where: { id: row.id }, data: { quantity: after } });
    await db.inventoryTransaction.create({
      data: { storeId, productId, warehouseId: id('wh'), type: 'SALE', quantity: `-${quantity}`, balanceBefore: row.quantity, balanceAfter: after },
    });
    return after.toString();
  }

  async function refused(fn: () => Promise<unknown>, pattern: RegExp) {
    await assert.rejects(fn, (error: Error) => pattern.test(error.message));
  }

  before(async () => {
    ({ platformPrisma: db } = await import('@/lib/prisma'));
    const [row] = await db.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);
    await db.store.create({ data: { id: storeId, name: 'Units store', slug: storeId.replace(/_/g, '-'), status: 'ACTIVE', plan: 'BUSINESS' } });
    await db.category.create({ data: { id: id('cat'), storeId, name: 'Rice and Grains', slug: 'rice-and-grains' } });
    await db.warehouse.create({ data: { id: id('wh'), storeId, code: 'MAIN', name: 'Main' } });
  });

  after(async () => {
    await db?.$disconnect();
  });

  test('a new product is a whole piece by default', async () => {
    const p = await db.product.findUniqueOrThrow({ where: { id: await product('plain', {}) } });
    assert.equal(p.unit, 'PIECE');
    assert.equal(p.allowsDecimal, false);
  });

  test('selling 2.5 kg from 10 kg leaves exactly 7.5 kg', async () => {
    const rice = await product('rice', { unit: 'KILOGRAM', allowsDecimal: true }, 10);
    assert.equal(await deduct(rice, '2.5'), '7.5');
    assert.equal(await deduct(rice, '0.125'), '7.375');
  });

  test('selling 1.5 m from 20 m leaves exactly 18.5 m', async () => {
    const wire = await product('wire', { unit: 'METER', allowsDecimal: true }, 20);
    assert.equal(await deduct(wire, '1.5'), '18.5');
  });

  test('a whole-unit product refuses a fractional movement', async () => {
    const soap = await product('soap', {}, 12);
    await refused(() => deduct(soap, '1.5'), /UNIT_PRECISION/);
  });

  test('the unit is fixed once the product has moved', async () => {
    const feeds = await product('feeds', { unit: 'KILOGRAM', allowsDecimal: true }, 25);
    await refused(() => db.product.update({ where: { id: feeds }, data: { unit: 'SACK' } }), /unit cannot change/);
    const kept = await db.product.findUniqueOrThrow({ where: { id: feeds } });
    assert.equal(kept.unit, 'KILOGRAM');
    // Other edits still work.
    await db.product.update({ where: { id: feeds }, data: { name: 'Hog feeds', sellingPrice: 55 } });
  });

  test('a product with no stock or sales can still change its unit', async () => {
    const fresh = await product('fresh', {});
    await db.product.update({ where: { id: fresh }, data: { unit: 'KILOGRAM', allowsDecimal: true } });
    const p = await db.product.findUniqueOrThrow({ where: { id: fresh } });
    assert.equal(p.unit, 'KILOGRAM');
  });

  test('a product that moved in fractions keeps allowing decimals', async () => {
    const oil = await product('oil', { unit: 'METER', allowsDecimal: true }, 5);
    await deduct(oil, '0.5');
    await refused(() => db.product.update({ where: { id: oil }, data: { allowsDecimal: false } }), /moved in fractions/);
  });
}
