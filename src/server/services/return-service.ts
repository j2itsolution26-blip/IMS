import 'server-only';

import { Prisma, type PaymentMethod } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { D, money, qty as q3, sum, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { applyStockMovement } from '@/server/services/inventory-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { recordAudit } from '@/server/services/audit-service';

/**
 * Refunds.
 *
 * A refund always ties back to its original sale — it never creates a fake
 * new sale. It puts goods back on the shelf (unless they came back damaged,
 * in which case `restock: false` refunds the till without inflating sellable
 * stock), and the sale's status moves to (partially) returned. Who processed
 * it and when is captured by the existing audit-log entry.
 */

export interface SaleReturnLineInput {
  saleItemId: string;
  quantity: Numeric;
}

export interface CreateSaleReturnInput {
  saleId: string;
  lines: SaleReturnLineInput[];
  reason: string;
  /** False when goods come back damaged and cannot be resold. */
  restock?: boolean;
  refundMethod?: PaymentMethod;
  userId: string;
}

export async function createSaleReturn(input: CreateSaleReturnInput) {
  const restock = input.restock ?? true;

  const result = await prisma.$transaction(
    async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: input.saleId },
        include: { items: true },
      });
      if (!sale) throw new NotFoundError('Sale');
      if (sale.status === 'VOIDED') throw new ConflictError('This sale was voided; there is nothing to return.');

      const itemsById = new Map(sale.items.map((i) => [i.id, i]));
      const lines: {
        productId: string;
        saleItemId: string;
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
        unitCost: Prisma.Decimal;
        total: Prisma.Decimal;
      }[] = [];

      for (const line of input.lines) {
        const item = itemsById.get(line.saleItemId);
        if (!item) throw new NotFoundError('Sale line');

        const quantity = q3(line.quantity);
        if (quantity.lessThanOrEqualTo(0)) continue;

        // Cannot return more than was bought, across all returns on this sale.
        const returnable = D(item.quantity).minus(D(item.returnedQuantity));
        if (quantity.greaterThan(returnable)) {
          throw new ValidationError(
            `Only ${toNum(returnable)} of that line remains returnable.`,
          );
        }

        // Refund at the price actually paid, net of the share of any line discount.
        const effectiveUnitPrice = D(item.quantity).isZero()
          ? D(item.unitPrice)
          : D(item.unitPrice).minus(D(item.discount).dividedBy(D(item.quantity)));

        const total = money(effectiveUnitPrice.times(quantity));

        lines.push({
          productId: item.productId,
          saleItemId: item.id,
          quantity,
          unitPrice: money(effectiveUnitPrice),
          unitCost: D(item.unitCost),
          total,
        });
      }

      if (lines.length === 0) {
        throw new ValidationError('Enter a quantity for at least one line to return.');
      }

      const total = money(sum(lines.map((l) => l.total)));

      const returnNumber = await nextDocumentNumber('RETURN', tx);

      const saleReturn = await tx.return.create({
        data: {
          returnNumber,
          status: 'COMPLETED',
          saleId: sale.id,
          userId: input.userId,
          reason: input.reason.trim(),
          subtotal: total,
          total,
          restock,
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              saleItemId: l.saleItemId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              unitCost: l.unitCost,
              total: l.total,
            })),
          },
        },
        select: { id: true, returnNumber: true },
      });

      for (const line of lines) {
        await tx.saleItem.update({
          where: { id: line.saleItemId },
          data: { returnedQuantity: { increment: line.quantity } },
        });

        if (restock) {
          await applyStockMovement(tx, {
            productId: line.productId,
            warehouseId: sale.warehouseId,
            type: 'SALE_RETURN',
            quantity: line.quantity,
            unitCost: line.unitCost,
            referenceType: 'RETURN',
            referenceId: saleReturn.id,
            note: `Return ${saleReturn.returnNumber} against ${sale.invoiceNumber}`,
            userId: input.userId,
          });
        }
      }

      // Refund is money leaving the till.
      await tx.payment.create({
        data: {
          paymentNumber: await nextDocumentNumber('PAYMENT', tx),
          direction: 'OUTBOUND',
          method: input.refundMethod ?? 'CASH',
          amount: total,
          note: `Refund for ${saleReturn.returnNumber}`,
          returnId: saleReturn.id,
          userId: input.userId,
        },
      });

      // Fully returned or only partly?
      const refreshed = await tx.saleItem.findMany({
        where: { saleId: sale.id },
        select: { quantity: true, returnedQuantity: true },
      });
      const fullyReturned = refreshed.every((i) =>
        D(i.returnedQuantity).greaterThanOrEqualTo(D(i.quantity)),
      );

      await tx.sale.update({
        where: { id: sale.id },
        data: { status: fullyReturned ? 'RETURNED' : 'PARTIALLY_RETURNED' },
      });

      await recordAudit(
        {
          action: 'RETURN',
          entity: 'Return',
          entityId: saleReturn.id,
          summary: `Refund ${saleReturn.returnNumber} for ${toNum(total)} against ${sale.invoiceNumber}`,
          userId: input.userId,
        },
        tx,
      );

      return {
        id: saleReturn.id,
        returnNumber: saleReturn.returnNumber,
        total: toNum(total),
        invoiceNumber: sale.invoiceNumber,
      };
    },
    { timeout: 20_000 },
  );

  return result;
}
