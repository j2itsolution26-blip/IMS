import 'server-only';

import {
  Prisma,
  type InventoryTransactionType,
  type ReferenceType,
} from '@prisma/client';
import { prisma, type DbClient, type TxClient } from '@/lib/prisma';
import { D, qty as q3, money, toNum, type Numeric } from '@/lib/decimal';
import { InsufficientStockError, NotFoundError, ValidationError } from '@/lib/errors';
import { notify, resolveNotification, stockAlertKey } from '@/server/services/notification-service';
import { getSettings, readBoolean, readNumber } from '@/server/services/settings-service';

/**
 * The stock engine.
 *
 * Every change to on-hand quantity in this system goes through
 * `applyStockMovement`. It is the only place that writes `inventory.quantity`,
 * and it always writes a matching `inventory_transactions` row in the same
 * transaction — so the ledger and the balance cannot disagree.
 *
 * Concurrency: the inventory row is locked with `SELECT ... FOR UPDATE` before
 * it is read. Two tills selling the last unit at the same moment are therefore
 * serialised, and the second one correctly fails instead of both succeeding.
 *
 * Callers MUST pass a transaction client (`tx`) obtained from
 * `prisma.$transaction`, so the movement commits atomically with the sale,
 * receipt, or return that caused it.
 */

export interface StockMovementInput {
  productId: string;
  warehouseId: string;
  type: InventoryTransactionType;
  /** Signed: positive adds stock, negative removes it. */
  quantity: Numeric;
  /** Unit cost at the moment of the movement. Defaults to the product's current cost. */
  unitCost?: Numeric;
  referenceType?: ReferenceType;
  referenceId?: string;
  note?: string;
  userId?: string | null;
}

export interface StockMovementResult {
  productId: string;
  warehouseId: string;
  balanceBefore: number;
  balanceAfter: number;
  unitCost: number;
}

interface LockedRow {
  id: string;
  quantity: Prisma.Decimal;
  reserved: Prisma.Decimal;
}

/** Movement types that increase on-hand stock and therefore re-average cost. */
const RECEIPT_TYPES = new Set<InventoryTransactionType>([
  'PURCHASE_RECEIPT',
  'OPENING_BALANCE',
]);

/**
 * Locks (creating if absent) the inventory row for a product/warehouse pair.
 * The insert is done with ON CONFLICT DO NOTHING so two concurrent first-ever
 * movements for the same product cannot both fail on the unique constraint.
 */
async function lockInventoryRow(
  tx: TxClient,
  productId: string,
  warehouseId: string,
): Promise<LockedRow> {
  await tx.$executeRaw`
    INSERT INTO inventory (id, "productId", "warehouseId", quantity, reserved, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${productId}, ${warehouseId}, 0, 0, now(), now())
    ON CONFLICT ("productId", "warehouseId") DO NOTHING
  `;

  const rows = await tx.$queryRaw<LockedRow[]>`
    SELECT id, quantity, reserved
    FROM inventory
    WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
    FOR UPDATE
  `;

  const row = rows[0];
  if (!row) throw new NotFoundError('Inventory record');
  return row;
}

/**
 * Recalculates the product's moving-average cost after a receipt.
 *
 * Weighted across every warehouse, because `Product.costPrice` is a single
 * company-wide figure: newAvg = (onHand * oldAvg + received * receiptCost) / (onHand + received)
 */
async function updateMovingAverageCost(
  tx: TxClient,
  productId: string,
  receivedQty: Prisma.Decimal,
  receiptUnitCost: Prisma.Decimal,
): Promise<void> {
  if (receivedQty.lessThanOrEqualTo(0)) return;

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { costPrice: true },
  });
  if (!product) return;

  const totals = await tx.inventory.aggregate({
    where: { productId },
    _sum: { quantity: true },
  });

  // Stock on hand *before* this receipt landed.
  const priorQty = D(totals._sum.quantity ?? 0).minus(receivedQty);

  const newCost = priorQty.lessThanOrEqualTo(0)
    ? receiptUnitCost
    : priorQty
        .times(D(product.costPrice))
        .plus(receivedQty.times(receiptUnitCost))
        .dividedBy(priorQty.plus(receivedQty));

  await tx.product.update({
    where: { id: productId },
    data: { costPrice: money(newCost) },
  });
}

/**
 * Applies one stock movement. Must run inside a transaction.
 */
export async function applyStockMovement(
  tx: TxClient,
  input: StockMovementInput,
): Promise<StockMovementResult> {
  const delta = q3(input.quantity);
  if (delta.isZero()) {
    // A zero movement would write a ledger row that says nothing happened.
    throw new ValidationError('A stock movement must change the quantity by a non-zero amount.');
  }

  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { id: true, name: true, costPrice: true, isTrackable: true, reorderLevel: true, minStock: true },
  });
  if (!product) throw new NotFoundError('Product');

  const unitCost = money(input.unitCost ?? product.costPrice);

  // Non-trackable products (services, fees) still get a ledger entry for the
  // audit trail, but no balance is maintained for them.
  if (!product.isTrackable) {
    await tx.inventoryTransaction.create({
      data: {
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: input.type,
        quantity: delta,
        balanceBefore: 0,
        balanceAfter: 0,
        unitCost,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        note: input.note ?? null,
        userId: input.userId ?? null,
      },
    });
    return {
      productId: input.productId,
      warehouseId: input.warehouseId,
      balanceBefore: 0,
      balanceAfter: 0,
      unitCost: toNum(unitCost),
    };
  }

  const row = await lockInventoryRow(tx, input.productId, input.warehouseId);
  const balanceBefore = D(row.quantity);
  const balanceAfter = balanceBefore.plus(delta);

  if (balanceAfter.lessThan(0)) {
    const settings = await getSettings();
    if (!readBoolean(settings, 'inventory.allowNegativeStock')) {
      throw new InsufficientStockError(
        product.name,
        toNum(balanceBefore),
        toNum(delta.abs()),
      );
    }
  }

  const isReceipt = delta.greaterThan(0);

  // Only genuine receipts and genuine sales move these timestamps. An
  // adjustment or a transfer must not make dead stock look freshly sold.
  const timestamps: { lastReceivedAt?: Date; lastSoldAt?: Date } = {};
  if (input.type === 'PURCHASE_RECEIPT' || input.type === 'OPENING_BALANCE') {
    timestamps.lastReceivedAt = new Date();
  } else if (input.type === 'SALE') {
    timestamps.lastSoldAt = new Date();
  }

  await tx.inventory.update({
    where: { id: row.id },
    data: { quantity: balanceAfter, ...timestamps },
  });

  await tx.inventoryTransaction.create({
    data: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      quantity: delta,
      balanceBefore,
      balanceAfter,
      unitCost,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      note: input.note ?? null,
      userId: input.userId ?? null,
    },
  });

  if (RECEIPT_TYPES.has(input.type) && isReceipt) {
    await updateMovingAverageCost(tx, input.productId, delta, unitCost);
  }

  return {
    productId: input.productId,
    warehouseId: input.warehouseId,
    balanceBefore: toNum(balanceBefore),
    balanceAfter: toNum(balanceAfter),
    unitCost: toNum(unitCost),
  };
}

/**
 * Raises or clears the low/out-of-stock alert for a product.
 *
 * Deliberately called *after* the transaction commits: a notification is not
 * worth rolling a completed sale back for, and the alert should reflect
 * committed state.
 */
export async function evaluateStockAlerts(
  productIds: string[],
  warehouseId: string,
): Promise<void> {
  if (productIds.length === 0) return;

  try {
    const settings = await getSettings();
    const criticalRatio = readNumber(settings, 'inventory.criticalStockRatio') || 0.5;

    const rows = await prisma.inventory.findMany({
      where: { productId: { in: productIds }, warehouseId },
      select: {
        quantity: true,
        reserved: true,
        warehouse: { select: { name: true } },
        product: {
          select: { id: true, name: true, sku: true, reorderLevel: true, minStock: true, isTrackable: true },
        },
      },
    });

    for (const row of rows) {
      const { product } = row;
      if (!product.isTrackable) continue;

      const key = stockAlertKey(product.id, warehouseId);
      const available = D(row.quantity).minus(D(row.reserved));
      const threshold = D(product.reorderLevel).greaterThan(0)
        ? D(product.reorderLevel)
        : D(product.minStock);
      const link = `/products/${product.id}`;

      if (available.lessThanOrEqualTo(0)) {
        await notify({
          type: 'OUT_OF_STOCK',
          severity: 'CRITICAL',
          title: `Out of stock: ${product.name}`,
          message: `${product.name} (${product.sku}) has no available stock at ${row.warehouse.name}.`,
          link,
          dedupeKey: key,
        });
        continue;
      }

      if (threshold.greaterThan(0) && available.lessThanOrEqualTo(threshold)) {
        const critical = available.lessThanOrEqualTo(threshold.times(criticalRatio));
        await notify({
          type: 'LOW_STOCK',
          severity: critical ? 'CRITICAL' : 'WARNING',
          title: `${critical ? 'Critically low' : 'Low'} stock: ${product.name}`,
          message: `${toNum(available)} left at ${row.warehouse.name} — reorder level is ${toNum(threshold)}.`,
          link,
          dedupeKey: key,
        });
        continue;
      }

      // Back above the threshold: clear any standing alert.
      await resolveNotification(key);
    }
  } catch (error) {
    console.error('[inventory] stock alert evaluation failed', error);
  }
}

/**
 * Moves committed-but-unfulfilled quantity in and out of `reserved`.
 * Used when a POS order is held (draft) and when it is completed or discarded.
 */
export async function adjustReservation(
  tx: TxClient,
  productId: string,
  warehouseId: string,
  delta: Numeric,
): Promise<void> {
  const change = q3(delta);
  if (change.isZero()) return;

  const row = await lockInventoryRow(tx, productId, warehouseId);
  const next = D(row.reserved).plus(change);

  await tx.inventory.update({
    where: { id: row.id },
    // Reservations must never go negative even if a release is replayed.
    data: { reserved: next.lessThan(0) ? new Prisma.Decimal(0) : next },
  });
}

/** Available = on hand − reserved, per warehouse. */
export async function getAvailableQuantity(
  productId: string,
  warehouseId: string,
  db: DbClient = prisma,
): Promise<number> {
  const row = await db.inventory.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { quantity: true, reserved: true },
  });
  if (!row) return 0;
  return toNum(D(row.quantity).minus(D(row.reserved)));
}

/**
 * Verifies a basket can be fulfilled before any writes happen, so the user gets
 * one clear error listing everything short rather than failing on line 1 of 20.
 */
export async function assertStockAvailable(
  tx: TxClient,
  warehouseId: string,
  lines: { productId: string; quantity: Numeric }[],
): Promise<void> {
  const settings = await getSettings();
  if (readBoolean(settings, 'inventory.allowNegativeStock')) return;

  const productIds = lines.map((l) => l.productId);
  const [rows, products] = await Promise.all([
    tx.inventory.findMany({
      where: { productId: { in: productIds }, warehouseId },
      select: { productId: true, quantity: true, reserved: true },
    }),
    tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, isTrackable: true },
    }),
  ]);

  const stockByProduct = new Map(rows.map((r) => [r.productId, D(r.quantity).minus(D(r.reserved))]));
  const productById = new Map(products.map((p) => [p.id, p]));

  for (const line of lines) {
    const product = productById.get(line.productId);
    if (!product) throw new NotFoundError('Product');
    if (!product.isTrackable) continue;

    const available = stockByProduct.get(line.productId) ?? D(0);
    if (available.lessThan(q3(line.quantity))) {
      throw new InsufficientStockError(product.name, toNum(available), toNum(line.quantity));
    }
  }
}
