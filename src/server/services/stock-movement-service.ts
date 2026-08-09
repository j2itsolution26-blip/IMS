import 'server-only';

import { prisma } from '@/lib/prisma';
import { D, money, qty as q3, toNum, type Numeric } from '@/lib/decimal';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { applyStockMovement, evaluateStockAlerts } from '@/server/services/inventory-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { notify } from '@/server/services/notification-service';
import { recordAudit } from '@/server/services/audit-service';

/**
 * Manual stock operations: adjustments (stock counts, shrinkage, opening
 * balances) and inter-warehouse transfers.
 */

export interface AdjustmentLineInput {
  productId: string;
  /** The counted quantity when mode is ABSOLUTE, or the delta when RELATIVE. */
  quantity: Numeric;
  unitCost?: Numeric;
}

export type AdjustmentMode = 'ABSOLUTE' | 'RELATIVE';

export interface CreateAdjustmentInput {
  warehouseId: string;
  mode: AdjustmentMode;
  lines: AdjustmentLineInput[];
  reason: string;
  isOpeningBalance?: boolean;
  userId: string;
}

/**
 * Records a stock adjustment.
 *
 * ABSOLUTE is what a physical stock count produces ("there are 47 on the
 * shelf") and the delta is derived; RELATIVE takes the delta directly
 * ("write off 3 broken units").
 */
export async function createAdjustment(input: CreateAdjustmentInput) {
  if (!input.reason.trim()) {
    throw new ValidationError('A reason is required for every stock adjustment.', {
      reason: ['Explain why stock is being adjusted.'],
    });
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const reference = await nextDocumentNumber('ADJUSTMENT', tx);
      const applied: { productId: string; delta: number; name: string }[] = [];

      for (const line of input.lines) {
        const current = await tx.inventory.findUnique({
          where: { productId_warehouseId: { productId: line.productId, warehouseId: input.warehouseId } },
          select: { quantity: true },
        });

        const onHand = D(current?.quantity ?? 0);
        const delta =
          input.mode === 'ABSOLUTE' ? q3(line.quantity).minus(onHand) : q3(line.quantity);

        if (delta.isZero()) continue;

        const product = await tx.product.findUnique({
          where: { id: line.productId },
          select: { name: true, costPrice: true },
        });
        if (!product) throw new NotFoundError('Product');

        await applyStockMovement(tx, {
          productId: line.productId,
          warehouseId: input.warehouseId,
          type: input.isOpeningBalance
            ? 'OPENING_BALANCE'
            : delta.greaterThan(0)
              ? 'ADJUSTMENT_IN'
              : 'ADJUSTMENT_OUT',
          quantity: delta,
          unitCost: money(line.unitCost ?? product.costPrice),
          referenceType: 'ADJUSTMENT',
          referenceId: reference,
          note: `${reference}: ${input.reason.trim()}`,
          userId: input.userId,
        });

        applied.push({ productId: line.productId, delta: toNum(delta), name: product.name });
      }

      if (applied.length === 0) {
        throw new ValidationError('Nothing to adjust — every line matches the current stock level.');
      }

      await recordAudit(
        {
          action: 'INVENTORY_CHANGE',
          entity: 'Inventory',
          entityId: reference,
          summary: `Stock adjustment ${reference} on ${applied.length} product(s): ${input.reason.trim()}`,
          changes: { lines: applied },
          userId: input.userId,
        },
        tx,
      );

      return { reference, applied };
    },
    { timeout: 30_000 },
  );

  await evaluateStockAlerts(
    result.applied.map((a) => a.productId),
    input.warehouseId,
  );

  await notify({
    type: 'INVENTORY_ADJUSTMENT',
    title: `Stock adjusted: ${result.reference}`,
    message: `${result.applied.length} product(s) adjusted — ${input.reason.trim()}`,
    link: '/inventory/movements',
  });

  return result;
}

export interface TransferLineInput {
  productId: string;
  quantity: Numeric;
}

export interface CreateTransferInput {
  fromWarehouseId: string;
  toWarehouseId: string;
  lines: TransferLineInput[];
  note?: string;
  userId: string;
}

/**
 * Moves stock between warehouses.
 *
 * Both legs are written in one transaction, so a transfer can never leave
 * units deducted from the source without arriving at the destination.
 */
export async function createTransfer(input: CreateTransferInput) {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new ValidationError('Source and destination warehouses must be different.', {
      toWarehouseId: ['Pick a different destination.'],
    });
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const reference = await nextDocumentNumber('TRANSFER', tx);
      const lines = input.lines
        .map((l) => ({ productId: l.productId, quantity: q3(l.quantity) }))
        .filter((l) => l.quantity.greaterThan(0));

      if (lines.length === 0) throw new ValidationError('Enter a quantity for at least one product.');

      const [from, to] = await Promise.all([
        tx.warehouse.findUnique({ where: { id: input.fromWarehouseId }, select: { name: true } }),
        tx.warehouse.findUnique({ where: { id: input.toWarehouseId }, select: { name: true } }),
      ]);
      if (!from || !to) throw new NotFoundError('Warehouse');

      for (const line of lines) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          select: { costPrice: true },
        });
        if (!product) throw new NotFoundError('Product');

        // Out first: if the source is short, this throws and the whole
        // transfer rolls back before anything arrives at the destination.
        await applyStockMovement(tx, {
          productId: line.productId,
          warehouseId: input.fromWarehouseId,
          type: 'TRANSFER_OUT',
          quantity: line.quantity.negated(),
          unitCost: product.costPrice,
          referenceType: 'TRANSFER',
          referenceId: reference,
          note: `${reference}: ${from.name} → ${to.name}`,
          userId: input.userId,
        });

        await applyStockMovement(tx, {
          productId: line.productId,
          warehouseId: input.toWarehouseId,
          type: 'TRANSFER_IN',
          quantity: line.quantity,
          unitCost: product.costPrice,
          referenceType: 'TRANSFER',
          referenceId: reference,
          note: `${reference}: ${from.name} → ${to.name}`,
          userId: input.userId,
        });
      }

      await recordAudit(
        {
          action: 'INVENTORY_CHANGE',
          entity: 'Inventory',
          entityId: reference,
          summary: `Transfer ${reference}: ${lines.length} product(s) from ${from.name} to ${to.name}`,
          userId: input.userId,
        },
        tx,
      );

      return { reference, productIds: lines.map((l) => l.productId) };
    },
    { timeout: 30_000 },
  );

  await Promise.all([
    evaluateStockAlerts(result.productIds, input.fromWarehouseId),
    evaluateStockAlerts(result.productIds, input.toWarehouseId),
  ]);

  return result;
}
