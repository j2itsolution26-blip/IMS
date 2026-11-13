/**
 * Database steps for the browser tests (e2e/). Run by e2e/support/db.ts with
 * tsx; never imported by the app.
 *
 *   seed [offline]            a new store with an owner (lock-screen PIN 4826), two products and an open shift
 *   disable-owner <store>     the store owner's account is deactivated
 *   zero-stock <store> <prod> the shelf count changes on the server
 *   shift <store>             the store's shift id
 *   state <store>             sales, stock, sync issues, devices, audit entries
 *
 * Refuses any database that is not on this machine: these steps create and
 * change records freely.
 */
import { randomBytes } from 'node:crypto';

const url = process.env.DATABASE_URL ?? '';
if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('e2e database steps run against a local throwaway database only (DATABASE_URL on localhost).');
  process.exit(2);
}

async function main() {
  const { platformPrisma: db } = await import('../../src/lib/prisma');
  const [command, storeId, productId] = process.argv.slice(2);

  if (command === 'seed') {
    const { createStore } = await import('../../src/server/platform/subscription-service');
    const run = randomBytes(3).toString('hex');
    const username = `e2e${run}`;
    const password = 'E2ePass1!x';
    const admin = await db.user.findFirst({ where: { role: { slug: 'system-admin' } }, select: { id: true, name: true } });
    if (!admin) throw new Error('No system administrator in this database: run the bootstrap first.');
    const created = await createStore(admin, {
      storeName: `E2E ${run}`,
      owner: { name: 'Till Owner', username, email: `${username}@e2e.test`, password },
      allowSimilar: true,
    });
    // The same hasher the app uses for PINs (Better Auth's scrypt).
    const { hashPassword } = await import('better-auth/crypto');
    const pin = '4826';
    await db.user.update({ where: { id: created.ownerId }, data: { mustChangePassword: false, posPinHash: await hashPassword(pin) } });
    const warehouse = await db.warehouse.findFirstOrThrow({ where: { storeId: created.storeId, isDefault: true } });
    const category = await db.category.create({ data: { storeId: created.storeId, name: 'General', slug: `general-${run}` } });
    const soap = await db.product.create({
      data: { storeId: created.storeId, categoryId: category.id, sku: `SOAP${run}`, name: 'Bath Soap', barcode: `480${run}1`, sellingPrice: 25, costPrice: 18 },
    });
    const rice = await db.product.create({
      data: { storeId: created.storeId, categoryId: category.id, sku: `RICE${run}`, name: 'Rice', sellingPrice: 60, costPrice: 45, unit: 'KILOGRAM', allowsDecimal: true },
    });
    await db.inventory.create({ data: { storeId: created.storeId, productId: soap.id, warehouseId: warehouse.id, quantity: 50 } });
    await db.inventory.create({ data: { storeId: created.storeId, productId: rice.id, warehouseId: warehouse.id, quantity: 20 } });
    if (storeId === 'offline') {
      await db.setting.update({ where: { storeId_key: { storeId: created.storeId, key: 'pos.offlineMode' } }, data: { value: 'true' } });
    }
    await db.cashierShift.create({ data: { storeId: created.storeId, userId: created.ownerId, warehouseId: warehouse.id, openingCash: 1000 } });
    console.log(JSON.stringify({ storeId: created.storeId, username, password, pin, soap: soap.id, rice: rice.id, soapBarcode: soap.barcode }));
  } else if (command === 'disable-owner') {
    const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { ownerId: true } });
    await db.user.update({ where: { id: store.ownerId as string }, data: { isActive: false } });
    console.log(JSON.stringify({ ok: true }));
  } else if (command === 'zero-stock') {
    await db.inventory.updateMany({ where: { storeId, productId }, data: { quantity: 0 } });
    console.log(JSON.stringify({ ok: true }));
  } else if (command === 'shift') {
    const shift = await db.cashierShift.findFirstOrThrow({ where: { storeId }, select: { id: true } });
    console.log(JSON.stringify({ id: shift.id }));
  } else if (command === 'state') {
    const [sales, stock, issues, devices, audits] = await Promise.all([
      db.sale.findMany({ where: { storeId }, orderBy: { createdAt: 'asc' }, select: { origin: true, total: true, localReceiptNumber: true, clientRequestId: true } }),
      db.inventory.findMany({ where: { storeId }, select: { quantity: true, product: { select: { name: true } } } }),
      db.syncIssue.findMany({ where: { storeId }, select: { kind: true, status: true, resolutionNote: true } }),
      db.posDevice.findMany({ where: { storeId }, select: { id: true, revokedAt: true } }),
      db.auditLog.findMany({ where: { storeId, entity: { in: ['SyncIssue', 'PosDevice'] } }, select: { entity: true } }),
    ]);
    console.log(
      JSON.stringify({
        sales: sales.map((s) => ({ origin: s.origin, total: Number(s.total), localReceiptNumber: s.localReceiptNumber, clientRequestId: s.clientRequestId })),
        stock: Object.fromEntries(stock.map((row) => [row.product.name, Number(row.quantity)])),
        issues,
        devices: devices.map((d) => ({ id: d.id, revoked: d.revokedAt !== null })),
        audits: audits.map((a) => a.entity),
      }),
    );
  } else {
    throw new Error(`Unknown step: ${command}`);
  }
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
