import 'server-only';

import { Prisma, type PaymentMethod } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { D, money, qty as q3, sum, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { applyStockMovement, evaluateStockAlerts } from '@/server/services/inventory-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { notify } from '@/server/services/notification-service';
import { recordAudit } from '@/server/services/audit-service';

/**
 * Returns.
 *
 * A sale return puts goods back on the shelf (unless they came back damaged,
 * in which case `restock: false` refunds the customer without inflating
 * sellable stock) and refunds the customer. A purchase return sends goods back
 * to a supplier and takes them out of stock.
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
        taxRate: Prisma.Decimal;
        net: Prisma.Decimal;
        tax: Prisma.Decimal;
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

        const net = money(effectiveUnitPrice.times(quantity));
        const tax = money(net.times(D(item.taxRate)).dividedBy(100));

        lines.push({
          productId: item.productId,
          saleItemId: item.id,
          quantity,
          unitPrice: money(effectiveUnitPrice),
          unitCost: D(item.unitCost),
          taxRate: D(item.taxRate),
          net,
          tax,
          total: money(net.plus(tax)),
        });
      }

      if (lines.length === 0) {
        throw new ValidationError('Enter a quantity for at least one line to return.');
      }

      const subtotal = money(sum(lines.map((l) => l.net)));
      const taxAmount = money(sum(lines.map((l) => l.tax)));
      const total = money(subtotal.plus(taxAmount));

      const returnNumber = await nextDocumentNumber('RETURN', tx);

      const saleReturn = await tx.return.create({
        data: {
          returnNumber,
          type: 'SALE_RETURN',
          status: 'COMPLETED',
          saleId: sale.id,
          customerId: sale.customerId,
          userId: input.userId,
          reason: input.reason.trim(),
          subtotal,
          taxAmount,
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
          summary: `Sale return ${saleReturn.returnNumber} for ${toNum(total)} against ${sale.invoiceNumber}`,
          userId: input.userId,
        },
        tx,
      );

      return {
        id: saleReturn.id,
        returnNumber: saleReturn.returnNumber,
        total: toNum(total),
        productIds: restock ? lines.map((l) => l.productId) : [],
        warehouseId: sale.warehouseId,
        invoiceNumber: sale.invoiceNumber,
      };
    },
    { timeout: 20_000 },
  );

  if (result.productIds.length > 0) {
    await evaluateStockAlerts(result.productIds, result.warehouseId);
  }

  await notify({
    type: 'RETURN_PROCESSED',
    title: `Return processed: ${result.returnNumber}`,
    message: `${result.total.toFixed(2)} refunded against ${result.invoiceNumber}.`,
    link: `/returns/${result.id}`,
  });

  return result;
}

export interface PurchaseReturnLineInput {
  productId: string;
  quantity: Numeric;
  unitCost: Numeric;
}

export interface CreatePurchaseReturnInput {
  warehouseId: string;
  lines: PurchaseReturnLineInput[];
  reason: string;
  userId: string;
}

/** Sends goods back to a supplier and removes them from stock. */
export async function createPurchaseReturn(input: CreatePurchaseReturnInput) {
  const result = await prisma.$transaction(async (tx) => {
    const lines = input.lines
      .map((l) => ({
        productId: l.productId,
        quantity: q3(l.quantity),
        unitCost: money(l.unitCost),
      }))
      .filter((l) => l.quantity.greaterThan(0));

    if (lines.length === 0) {
      throw new ValidationError('Enter a quantity for at least one line.');
    }

    const total = money(sum(lines.map((l) => l.unitCost.times(l.quantity))));
    const returnNumber = await nextDocumentNumber('RETURN', tx);

    const purchaseReturn = await tx.return.create({
      data: {
        returnNumber,
        type: 'PURCHASE_RETURN',
        status: 'COMPLETED',
        userId: input.userId,
        reason: input.reason.trim(),
        subtotal: total,
        total,
        restock: false,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitCost,
            unitCost: l.unitCost,
            total: money(l.unitCost.times(l.quantity)),
          })),
        },
      },
      select: { id: true, returnNumber: true },
    });

    for (const line of lines) {
      await applyStockMovement(tx, {
        productId: line.productId,
        warehouseId: input.warehouseId,
        type: 'PURCHASE_RETURN',
        quantity: line.quantity.negated(),
        unitCost: line.unitCost,
        referenceType: 'RETURN',
        referenceId: purchaseReturn.id,
        note: `Purchase return ${purchaseReturn.returnNumber}: ${input.reason}`,
        userId: input.userId,
      });
    }

    await recordAudit(
      {
        action: 'RETURN',
        entity: 'Return',
        entityId: purchaseReturn.id,
        summary: `Purchase return ${purchaseReturn.returnNumber} for ${toNum(total)}`,
        userId: input.userId,
      },
      tx,
    );

    return {
      id: purchaseReturn.id,
      returnNumber: purchaseReturn.returnNumber,
      total: toNum(total),
      productIds: lines.map((l) => l.productId),
    };
  });

  await evaluateStockAlerts(result.productIds, input.warehouseId);
  return result;
}
