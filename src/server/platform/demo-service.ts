import 'server-only';

import type { Prisma } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { slugify } from '@/lib/utils';
import { DEMO_CATEGORIES, DEMO_PRODUCTS } from '@/lib/demo-seed';
import { audit, lockStore, type Actor } from '@/server/platform/subscription-service';

/**
 * Demonstration stores: sample data, separate from every real store.
 *
 * A demo store is an ordinary store row with "isDemo" set at creation. The
 * database keeps that flag fixed for ever, so a real store can never be
 * turned into one. Store isolation is the same as for any store: demo users
 * belong to the demo store only, and the store-scoped client and the tenant
 * triggers keep its rows apart. It is never billed and stays out of the
 * platform's store figures and reminders.
 *
 * Reset (this file only) deletes the demo store's business data — sales,
 * refunds, shifts, cash and GCash entries, stock, products, categories,
 * notifications — and loads the sample catalogue again. Accounts, settings,
 * audit logs, billing records and support tickets stay. The guards that
 * normally refuse those deletes allow them only for a demo store whose id
 * this transaction names (migration 20261108090000).
 */

type Tx = Prisma.TransactionClient;
const TX = { timeout: 60_000, maxWait: 10_000 } as const;

/** Loads the sample catalogue into an empty demo store, with opening stock in the ledger. */
export async function seedDemoData(tx: Tx, storeId: string): Promise<{ products: number }> {
  const store = await tx.store.findUnique({ where: { id: storeId }, select: { isDemo: true } });
  if (!store?.isDemo) throw new ConflictError('Sample data can only be loaded into a demo store.');
  const warehouse = await tx.warehouse.findFirst({ where: { storeId, isDefault: true }, select: { id: true } });
  if (!warehouse) throw new ConflictError('The demo store has no stock location yet.');

  const categoryIds = new Map<string, string>();
  for (const name of DEMO_CATEGORIES) {
    const category = await tx.category.upsert({
      where: { storeId_name: { storeId, name } },
      create: { storeId, name, slug: slugify(name), description: 'Sample category (demo)' },
      update: {},
      select: { id: true },
    });
    categoryIds.set(name, category.id);
  }

  for (const item of DEMO_PRODUCTS) {
    const product = await tx.product.create({
      data: {
        storeId,
        sku: item.sku,
        name: item.name,
        categoryId: categoryIds.get(item.category)!,
        unit: item.unit,
        allowsDecimal: item.allowsDecimal,
        costPrice: item.costPrice,
        sellingPrice: item.sellingPrice,
        reorderLevel: item.reorderLevel,
        description: 'Sample product (demo)',
      },
      select: { id: true },
    });
    await tx.inventory.create({ data: { storeId, productId: product.id, warehouseId: warehouse.id, quantity: item.stock, lastReceivedAt: new Date() } });
    if (item.stock > 0) {
      await tx.inventoryTransaction.create({
        data: {
          storeId,
          productId: product.id,
          warehouseId: warehouse.id,
          type: 'OPENING_BALANCE',
          quantity: item.stock,
          balanceBefore: 0,
          balanceAfter: item.stock,
          unitCost: item.costPrice,
          note: 'Demo sample stock',
        },
      });
    }
  }
  return { products: DEMO_PRODUCTS.length };
}

/**
 * Wipes a demo store's business data and loads the sample catalogue again.
 * The administrator types the store's name to confirm. Refused for any store
 * that is not a demo store, before anything is touched.
 */
export async function resetDemoStore(actor: Actor, input: { storeId: string; confirmName: string }): Promise<{ products: number }> {
  return platformPrisma.$transaction(async (tx) => {
    const store = await lockStore(tx, input.storeId);
    const row = await tx.store.findUnique({ where: { id: input.storeId }, select: { isDemo: true, name: true } });
    if (!row) throw new NotFoundError('Store');
    if (!row.isDemo) throw new ConflictError('Only a demo store can be reset. Real store data is never deleted.');
    if (input.confirmName.trim() !== row.name) throw new ValidationError('Type the demo store’s name exactly to confirm the reset.');

    // Names this store, for this transaction only, to the guards that allow the deletes.
    await tx.$executeRaw`SELECT set_config('app.demo_reset_store', ${input.storeId}, true)`;
    const where = { storeId: input.storeId };
    await tx.walletTransaction.deleteMany({ where });
    await tx.cashMovement.deleteMany({ where });
    await tx.shiftAdjustment.deleteMany({ where });
    await tx.notification.deleteMany({ where });
    await tx.payment.deleteMany({ where });
    await tx.returnItem.deleteMany({ where });
    await tx.return.deleteMany({ where });
    await tx.saleItem.deleteMany({ where });
    await tx.sale.deleteMany({ where });
    await tx.cashierShift.deleteMany({ where });
    await tx.inventoryTransaction.deleteMany({ where });
    await tx.inventory.deleteMany({ where });
    await tx.priceHistory.deleteMany({ where });
    await tx.product.deleteMany({ where });
    await tx.category.deleteMany({ where });
    await tx.storeUsage.deleteMany({ where });
    // Back to a clean numbering scope is not needed: numbers are unique per store and keep counting.

    const seeded = await seedDemoData(tx, input.storeId);
    // The platform audit takes CREATE, SUBSCRIPTION or PAYMENT; the summary says it was a reset.
    await audit(tx, actor, store, {
      action: 'CREATE',
      entity: 'Store',
      entityId: input.storeId,
      summary: `Demo data reset: sales, shifts, cash, GCash entries, stock and products removed; ${seeded.products} sample products loaded`,
      changes: { demoReset: true },
    });
    return seeded;
  }, TX);
}
