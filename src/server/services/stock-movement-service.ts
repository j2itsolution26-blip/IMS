import 'server-only';

import { prisma } from '@/lib/prisma';
import { D, money, qty as q3, toNum, type Numeric } from '@/lib/decimal';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { applyStockMovement } from '@/server/services/inventory-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { recordAudit } from '@/server/services/audit-service';
import { getDefaultWarehouseId } from '@/server/services/warehouse-service';

/**
 * Manual stock operations: a simple "Stock In" for received goods, and
 * adjustments (stock counts, shrinkage, opening balances).
 */

export interface StockInInput {
  productId: string;
  quantity: Numeric;
  unitCost?: Numeric;
  userId: string;
}

/**
 * Records stock received into the store. Deliberately lighter than
 * `createAdjustment` — no reason required, one product per call — to match
 * the "Stock In → Enter Quantity → Save" workflow.
 */
export async function createStockIn(input: StockInInput) {
  if (q3(input.quantity).lessThanOrEqualTo(0)) {
    throw new ValidationError('Enter a quantity greater than zero.');
  }

  const warehouseId = await getDefaultWarehouseId();

  return prisma.$transaction(async (tx) => {
    const reference = await nextDocumentNumber('ADJUSTMENT', tx);
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { name: true, costPrice: true },
    });
    if (!product) throw new NotFoundError('Product');

    const result = await applyStockMovement(tx, {
      productId: input.productId,
      warehouseId,
      type: 'STOCK_IN',
      quantity: input.quantity,
      unitCost: money(input.unitCost ?? product.costPrice),
      referenceType: 'ADJUSTMENT',
      referenceId: reference,
      note: `${reference}: Stock in — ${product.name}`,
      userId: input.userId,
    });

    await recordAudit(
      {
        action: 'INVENTORY_CHANGE',
        entity: 'Inventory',
        entityId: reference,
        summary: `Stock in ${reference}: ${product.name} +${toNum(q3(input.quantity))}`,
        userId: input.userId,
      },
      tx,
    );

    return { reference, ...result };
  });
}

export interface AdjustmentLineInput {
  productId: string;
  /** The counted quantity when mode is ABSOLUTE, or the delta when RELATIVE. */
  quantity: Numeric;
  unitCost?: Numeric;
}

export type AdjustmentMode = 'ABSOLUTE' | 'RELATIVE';

export interface CreateAdjustmentInput {
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

  const warehouseId = await getDefaultWarehouseId();

  const result = await prisma.$transaction(
    async (tx) => {
      const reference = await nextDocumentNumber('ADJUSTMENT', tx);
      const applied: { productId: string; delta: number; name: string }[] = [];

      for (const line of input.lines) {
        const current = await tx.inventory.findUnique({
          where: { productId_warehouseId: { productId: line.productId, warehouseId } },
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
          warehouseId,
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

  return result;
}
