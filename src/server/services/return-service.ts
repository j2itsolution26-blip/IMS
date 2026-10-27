import 'server-only';
import { Prisma, type PaymentMethod } from '@prisma/client';
import { storeDb } from '@/lib/tenant/context';
import { D, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { RefundError, refundAmounts } from '@/lib/refund-math';
import { applyStockMovement, wholePieces } from '@/server/services/inventory-service';
import { refundShiftFor } from '@/server/services/shift-service';
import { lockSale } from '@/server/services/sale-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { recordAudit } from '@/server/services/audit-service';

/**
 * Refunds.
 *
 * A refund always ties back to its original sale — it never creates a fake
 * new sale, and the sale itself is never deleted or rewritten beyond its
 * returned quantities and status. It puts goods back on the shelf (unless
 * they came back damaged, in which case `restock: false` refunds the till
 * without inflating sellable stock), and the sale's status moves to
 * (partially) returned. Who processed it and when is on the return row and
 * in the audit log.
 *
 * The sale row is locked first, so two refunds — or a refund and a void — of
 * one sale take turns: the second sees what the first did. A database rule
 * (migration 20261104090000) also refuses a returned quantity above the
 * quantity sold.
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
  /** One per refund attempt, so a doubled submit refunds once. */
  clientRequestId?: string;
}

export interface CompletedReturn {
  id: string;
  returnNumber: string;
  total: number;
  invoiceNumber: string;
}

async function findRetriedReturn(
  db: Awaited<ReturnType<typeof storeDb>> | Prisma.TransactionClient,
  clientRequestId: string,
  saleId: string,
): Promise<CompletedReturn | null> {
  const existing = await db.return.findFirst({
    where: { clientRequestId },
    select: { id: true, returnNumber: true, total: true, saleId: true, sale: { select: { invoiceNumber: true } } },
  });
  if (!existing) return null;
  if (existing.saleId !== saleId) throw new ConflictError('This refund was already used. Start a new refund.');
  return { id: existing.id, returnNumber: existing.returnNumber, total: toNum(existing.total), invoiceNumber: existing.sale?.invoiceNumber ?? '' };
}

export async function createSaleReturn(input: CreateSaleReturnInput): Promise<CompletedReturn> {
  const db = await storeDb();
  const restock = input.restock ?? true;
  const clientRequestId = input.clientRequestId?.trim() || null;
  const reason = input.reason.trim();
  if (reason.length < 4) throw new ValidationError('Give a reason of at least 4 characters.');

  if (clientRequestId) {
    const retried = await findRetriedReturn(db, clientRequestId, input.saleId);
    if (retried) return retried;
  }

  try {
    return await db.$transaction(
      async (tx) => {
        // Taken before reading anything, so a concurrent refund or void of the
        // same sale waits here and then sees this one's effect.
        if (!(await lockSale(tx, input.saleId))) throw new NotFoundError('Sale');

        const sale = await tx.sale.findUnique({
          where: { id: input.saleId },
          include: {
            items: true,
            returns: { where: { status: 'COMPLETED' }, select: { subtotal: true, total: true } },
          },
        });
        if (!sale) throw new NotFoundError('Sale');
        if (sale.status === 'VOIDED') throw new ConflictError('This sale was voided; there is nothing to return.');
        if (sale.status === 'RETURNED') throw new ConflictError('Everything on this sale has already been refunded.');

        let amounts;
        try {
          amounts = refundAmounts({
            sale,
            items: sale.items,
            request: input.lines.map((line) => ({
              saleItemId: line.saleItemId,
              quantity: wholePieces(line.quantity, 'A returned quantity'),
            })),
            previous: {
              subtotal: sale.returns.reduce((acc, r) => acc.plus(D(r.subtotal)), D(0)),
              total: sale.returns.reduce((acc, r) => acc.plus(D(r.total)), D(0)),
            },
          });
        } catch (error) {
          if (error instanceof RefundError) throw new ValidationError(error.message);
          throw error;
        }

        const itemsById = new Map(sale.items.map((item) => [item.id, item]));
        const returnNumber = await nextDocumentNumber('RETURN', tx);

        const saleReturn = await tx.return.create({
          data: {
            returnNumber,
            status: 'COMPLETED',
            saleId: sale.id,
            userId: input.userId,
            reason,
            // Ex-tax, after the order discount share: what reports net off revenue.
            subtotal: amounts.subtotal,
            // What is handed back: the price paid, tax included.
            total: amounts.total,
            restock,
            clientRequestId,
            items: {
              create: amounts.lines.map((line) => {
                const item = itemsById.get(line.saleItemId)!;
                return {
                  productId: item.productId,
                  saleItemId: item.id,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  unitCost: D(item.unitCost),
                  total: line.exTax,
                };
              }),
            },
          },
          select: { id: true, returnNumber: true },
        });

        for (const line of amounts.lines) {
          const item = itemsById.get(line.saleItemId)!;
          await tx.saleItem.update({
            where: { id: item.id },
            data: { returnedQuantity: { increment: line.quantity } },
          });

          if (restock) {
            await applyStockMovement(tx, {
              productId: item.productId,
              warehouseId: sale.warehouseId,
              type: 'SALE_RETURN',
              quantity: line.quantity,
              unitCost: D(item.unitCost),
              referenceType: 'RETURN',
              referenceId: saleReturn.id,
              note: `Return ${saleReturn.returnNumber} against ${sale.invoiceNumber}`,
              userId: input.userId,
            });
          }
        }

        // Refund is money leaving the till — the drawer of whoever pays it out
        // (or the sale's shift, if still open). None open: recorded outside a
        // shift and reported separately, never charged to a closed drawer.
        // A GCash refund is recorded the same way but never counts as drawer cash.
        if (amounts.total.greaterThan(0)) {
          await tx.payment.create({
            data: {
              paymentNumber: await nextDocumentNumber('PAYMENT', tx),
              direction: 'OUTBOUND',
              method: input.refundMethod ?? 'CASH',
              amount: amounts.total,
              note: `Refund for ${saleReturn.returnNumber}`,
              returnId: saleReturn.id,
              shiftId: await refundShiftFor(tx, input.userId, sale.shiftId),
              userId: input.userId,
            },
          });
        }

        await tx.sale.update({
          where: { id: sale.id },
          data: { status: amounts.closesSale ? 'RETURNED' : 'PARTIALLY_RETURNED' },
        });

        await recordAudit(
          {
            action: 'RETURN',
            entity: 'Return',
            entityId: saleReturn.id,
            summary: `Refund ${saleReturn.returnNumber} for ${toNum(amounts.total)} (${input.refundMethod ?? 'CASH'}) against ${sale.invoiceNumber}: ${reason.slice(0, 120)}`,
            changes: {
              saleId: sale.id,
              total: amounts.total.toString(),
              exTax: amounts.subtotal.toString(),
              restock,
              lines: amounts.lines.map((line) => ({ saleItemId: line.saleItemId, quantity: line.quantity.toString() })),
            },
            userId: input.userId,
          },
          tx,
        );

        return {
          id: saleReturn.id,
          returnNumber: saleReturn.returnNumber,
          total: toNum(amounts.total),
          invoiceNumber: sale.invoiceNumber,
        };
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    // A doubled submit raced this one and committed first; hand back its refund.
    if (
      clientRequestId &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      String((error.meta as { target?: unknown } | undefined)?.target ?? '').includes('clientRequestId')
    ) {
      const retried = await findRetriedReturn(db, clientRequestId, input.saleId);
      if (retried) return retried;
    }
    throw error;
  }
}
