import 'server-only';

import { Prisma, type SyncIssueKind } from '@prisma/client';
import { getStoreContext } from '@/lib/tenant/context';
import { D, money, toNum } from '@/lib/decimal';
import { AppError, StoreReadOnlyError, ValidationError } from '@/lib/errors';
import {
  PRICE_LOOKBACK_MS,
  clampOccurredAt,
  priceWasInEffect,
  pricesInEffect,
  type OfflineSale,
} from '@/lib/offline-sale';
import { applyStockMovement, quantityFor } from '@/server/services/inventory-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { recordAudit } from '@/server/services/audit-service';
import { getSettings, readNumber } from '@/server/services/settings-service';
import { lockShiftIfOpen } from '@/server/services/shift-service';
import { findRetriedSale, isClientRequestConflict, totalsFor } from '@/server/services/sale-service';
import { deviceForUpload } from '@/server/services/pos-device-service';

/**
 * Records a sale rung up while the till was offline (POST /api/pos/sync).
 *
 * The rules differ from a live checkout on purpose. A live checkout can
 * refuse: the customer is still at the counter. An offline sale already
 * happened — the goods are gone and the cash is in the drawer — so refusing
 * it would only make the books wrong. It is therefore recorded as charged,
 * and anything that does not add up is put in front of the owner as a
 * `sync_issue` beside the sale:
 *
 *   - stock that was short or goes below zero          → STOCK_SHORTFALL
 *   - a price the product did not have at the time     → PRICE_MISMATCH
 *   - a tax rate other than the store's                → TAX_RATE_MISMATCH
 *   - a device total that is not the server's sum      → TOTAL_MISMATCH
 *   - a product archived or deactivated since          → PRODUCT_UNAVAILABLE
 *   - a shift already closed when the sale arrived     → CLOSED_SHIFT
 *   - a device the owner revoked                       → DEVICE_REVOKED
 *
 * What is still refused, because the sale cannot be recorded truthfully:
 * another cashier's sale, a shift that is not this cashier's or is at another
 * branch, a product that does not exist, an impossible quantity, and a payment
 * that does not cover the device's own total. Refused sales stay on the
 * device for the cashier and owner to look at; they are never deleted.
 *
 * Idempotent: the sale id is the clientRequestId, unique per store, so an
 * upload repeated after a lost response returns the sale already recorded.
 * Prices, totals, stock and payment are written in one transaction.
 */

export interface RecordedOfflineSale {
  status: 'recorded' | 'duplicate';
  sale: { id: string; invoiceNumber: string; total: number; paidAmount: number; changeAmount: number; receivedAt: string };
  issues: SyncIssueKind[];
}

/** A refusal the device should keep and show, with a stable code. */
class OfflineSaleRefused extends AppError {
  constructor(message: string, code: string, status = 422) {
    super(message, code, status);
  }
}

interface PendingIssue {
  kind: SyncIssueKind;
  message: string;
  details: Prisma.InputJsonObject;
  productId?: string;
}

/** The device's total and the server's may differ by rounding of a single centavo. */
const TOTAL_TOLERANCE = 0.01;

const peso = (value: Prisma.Decimal | number) => `₱${toNum(money(value)).toFixed(2)}`;

export async function recordOfflineSale(input: { userId: string; deviceId: string; sale: OfflineSale }): Promise<RecordedOfflineSale> {
  const { sale } = input;
  const { db, access } = await getStoreContext();

  // Only the cashier who rang it up may send it: it is their drawer and shift.
  if (sale.userId !== input.userId) {
    throw new OfflineSaleRefused('This sale was rung up by another cashier. It will upload when they sign in on this device.', 'OTHER_CASHIER', 403);
  }

  // Already recorded: hand back what the server has, whatever the store's state now.
  const retried = await existingResult(db, sale.id, input.userId);
  if (retried) return retried;

  // Kept on the device, not refused: it goes up once the subscription is renewed.
  if (!access.writable) throw new StoreReadOnlyError();

  const shift = await db.cashierShift.findUnique({
    where: { id: sale.shiftId },
    select: { id: true, number: true, userId: true, warehouseId: true, status: true, openedAt: true, closedAt: true, reviewStatus: true },
  });
  if (!shift || shift.userId !== input.userId) {
    throw new OfflineSaleRefused('The shift this sale was rung up in was not found for your account.', 'SHIFT_NOT_FOUND');
  }
  if (shift.warehouseId !== sale.warehouseId) {
    throw new OfflineSaleRefused('This sale names a different branch from its shift.', 'BRANCH_MISMATCH');
  }

  const device = await deviceForUpload({ deviceId: input.deviceId, userId: input.userId, warehouseId: shift.warehouseId });

  const now = new Date();
  const { at: soldAt, clamped } = clampOccurredAt(new Date(sale.occurredAt), { openedAt: shift.openedAt, now });

  const productIds = [...new Set(sale.items.map((item) => item.productId))];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sellingPrice: true, costPrice: true, status: true, unit: true, allowsDecimal: true },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  const missing = productIds.filter((productId) => !productById.has(productId));
  if (missing.length > 0) {
    throw new OfflineSaleRefused('A product in this sale no longer exists in the store catalogue.', 'PRODUCT_NOT_FOUND');
  }

  const issues: PendingIssue[] = [];

  // Prices: any selling price in force from when the device downloaded its
  // catalogue (at most a week before the sale) until the sale.
  const catalogAt = new Date(sale.catalogFetchedAt);
  const priceFrom = new Date(Math.max(Math.min(catalogAt.getTime(), soldAt.getTime()), soldAt.getTime() - PRICE_LOOKBACK_MS));
  const history = await db.priceHistory.findMany({
    // Every change, later ones included: a change after the sale tells what
    // the price was before it (its old value).
    where: { productId: { in: productIds }, field: 'SELLING' },
    select: { productId: true, oldValue: true, newValue: true, createdAt: true },
  });

  const lines = sale.items.map((item, index) => {
    const product = productById.get(item.productId)!;
    const quantity = quantityFor(item.quantity, `Quantity for ${product.name}`, product);
    if (quantity.lessThanOrEqualTo(0)) throw new ValidationError(`Quantity for ${product.name} must be more than zero.`);
    const unitPrice = money(item.unitPrice);
    const discount = money(item.discount);
    const gross = unitPrice.times(quantity);
    if (discount.greaterThan(gross)) throw new ValidationError(`Discount on ${product.name} cannot exceed the line total.`);

    const prices = pricesInEffect({
      current: toNum(product.sellingPrice),
      changes: history
        .filter((change) => change.productId === product.id)
        .map((change) => ({ oldValue: toNum(change.oldValue), newValue: toNum(change.newValue), at: change.createdAt })),
      from: priceFrom,
      to: soldAt,
    });
    if (!priceWasInEffect(toNum(unitPrice), prices)) {
      issues.push({
        kind: 'PRICE_MISMATCH',
        productId: product.id,
        message: `${product.name} was sold at ${peso(unitPrice)}, which was not its price at the time (${prices.map(peso).join(' or ')}).`,
        details: { line: index, charged: toNum(unitPrice), pricesInEffect: prices, currentPrice: toNum(product.sellingPrice) },
      });
    }
    if (product.status !== 'ACTIVE') {
      issues.push({
        kind: 'PRODUCT_UNAVAILABLE',
        productId: product.id,
        message: `${product.name} was sold offline but is now ${product.status.toLowerCase()}.`,
        details: { line: index, status: product.status },
      });
    }

    return {
      productId: product.id,
      name: product.name,
      quantity,
      unitPrice,
      unitCost: money(product.costPrice),
      discount,
      total: money(gross.minus(discount)),
    };
  });

  const settings = await getSettings();
  const storeTaxRate = readNumber(settings, 'sales.defaultTaxRate');
  if (Math.abs(storeTaxRate - sale.taxRate) > 1e-9) {
    issues.push({
      kind: 'TAX_RATE_MISMATCH',
      message: `The device charged ${sale.taxRate}% tax; the store's rate is ${storeTaxRate}%.`,
      details: { deviceTaxRate: sale.taxRate, storeTaxRate },
    });
  }

  // The server's arithmetic on the lines as charged, at the device's tax rate.
  const totals = totalsFor(lines, money(sale.discount), D(sale.taxRate));
  if (Math.abs(toNum(totals.total) - sale.total) > TOTAL_TOLERANCE) {
    issues.push({
      kind: 'TOTAL_MISMATCH',
      message: `The device showed a total of ${peso(sale.total)}; the items add up to ${peso(totals.total)}.`,
      details: { deviceTotal: sale.total, serverTotal: toNum(totals.total) },
    });
  }

  const tendered = money(sale.cashTendered);
  if (tendered.lessThan(money(sale.total))) {
    throw new OfflineSaleRefused('The cash recorded for this sale does not cover its total.', 'UNDERPAID');
  }
  const changeAmount = tendered.greaterThan(totals.total) ? money(tendered.minus(totals.total)) : money(0);
  const paidAmount = money(tendered.minus(changeAmount));

  if (device.revoked) {
    issues.push({
      kind: 'DEVICE_REVOKED',
      message: 'This sale was uploaded from a device the owner had removed.',
      details: { deviceId: input.deviceId },
    });
  }

  try {
    return await db.$transaction(
      async (tx) => {
        // An open shift is held open until this sale commits; a closed one is
        // recorded against as a late sale.
        const open = await lockShiftIfOpen(tx, shift.id, 'share');
        const invoiceNumber = await nextDocumentNumber('SALE', tx);

        const created = await tx.sale.create({
          data: {
            invoiceNumber,
            warehouseId: shift.warehouseId,
            userId: input.userId,
            shiftId: shift.id,
            status: 'COMPLETED',
            channel: 'POS',
            origin: 'OFFLINE',
            deviceId: input.deviceId,
            localReceiptNumber: sale.localReceiptNumber,
            clientRequestId: sale.id,
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            discount: totals.discount,
            total: totals.total,
            paidAmount,
            changeAmount,
            costOfGoods: totals.costOfGoods,
            notes: sale.notes?.trim() || null,
            createdAt: soldAt,
            items: {
              create: lines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                unitCost: line.unitCost,
                discount: line.discount,
                total: line.total,
              })),
            },
          },
          select: { id: true, invoiceNumber: true, receivedAt: true },
        });

        for (const line of lines) {
          const moved = await applyStockMovement(tx, {
            productId: line.productId,
            warehouseId: shift.warehouseId,
            type: 'SALE',
            quantity: line.quantity.negated(),
            unitCost: line.unitCost,
            referenceType: 'SALE',
            referenceId: created.id,
            note: `Sold offline on ${created.invoiceNumber} (${sale.localReceiptNumber})`,
            userId: input.userId,
            allowNegative: true,
          });
          if (moved.balanceAfter < 0) {
            issues.push({
              kind: 'STOCK_SHORTFALL',
              productId: line.productId,
              message: `${line.name}: the system had ${moved.balanceBefore} when this sale of ${toNum(line.quantity)} arrived, so stock is now ${moved.balanceAfter}. Count it and adjust.`,
              details: { balanceBefore: moved.balanceBefore, sold: toNum(line.quantity), balanceAfter: moved.balanceAfter },
            });
          }
        }

        await tx.payment.create({
          data: {
            paymentNumber: await nextDocumentNumber('PAYMENT', tx),
            direction: 'INBOUND',
            method: 'CASH',
            amount: tendered,
            note: `Cash taken offline on ${sale.localReceiptNumber}.`,
            saleId: created.id,
            shiftId: shift.id,
            userId: input.userId,
            createdAt: soldAt,
          },
        });

        if (!open) {
          // The count was frozen without this sale. If it happened before the
          // close, its cash was in the drawer that was counted, so the
          // variance is corrected by an adjustment beside the frozen figures.
          const beforeClose = shift.closedAt !== null && soldAt.getTime() < shift.closedAt.getTime();
          const drawerCash = money(paidAmount);
          if (beforeClose && drawerCash.greaterThan(0)) {
            await tx.shiftAdjustment.create({
              data: {
                shiftId: shift.id,
                amount: drawerCash.negated(),
                reason: `Offline sale ${created.invoiceNumber} (${sale.localReceiptNumber}) uploaded after the shift closed; its cash was in the counted drawer.`.slice(0, 500),
                userId: input.userId,
              },
            });
          }
          if (shift.reviewStatus === 'NOT_REQUIRED') {
            await tx.cashierShift.updateMany({ where: { id: shift.id, reviewStatus: 'NOT_REQUIRED' }, data: { reviewStatus: 'PENDING' } });
          }
          issues.push({
            kind: 'CLOSED_SHIFT',
            message: beforeClose
              ? `Uploaded after shift SH-${String(shift.number).padStart(6, '0')} closed. Its ${peso(drawerCash)} was added as an adjustment to that shift's count.`
              : `Rung up after shift SH-${String(shift.number).padStart(6, '0')} had been closed elsewhere. Its ${peso(drawerCash)} is not in that shift's count; check the drawer.`,
            details: { shiftNumber: shift.number, closedAt: shift.closedAt?.toISOString() ?? null, soldAt: soldAt.toISOString(), cash: toNum(drawerCash), adjusted: beforeClose },
          });
        }

        if (issues.length > 0) {
          await tx.syncIssue.createMany({
            data: issues.map((issue) => ({
              kind: issue.kind,
              message: issue.message.slice(0, 1000),
              details: issue.details,
              saleId: created.id,
              warehouseId: shift.warehouseId,
              productId: issue.productId ?? null,
              shiftId: shift.id,
              deviceId: input.deviceId,
            })),
          });
        }

        await recordAudit(
          {
            action: 'SALE',
            entity: 'Sale',
            entityId: created.id,
            summary: `Recorded offline sale ${created.invoiceNumber} (${sale.localReceiptNumber}) for ${toNum(totals.total)}${issues.length > 0 ? `, ${issues.length} to review` : ''}`,
            changes: {
              origin: 'OFFLINE',
              deviceId: input.deviceId,
              occurredAt: sale.occurredAt,
              ...(clamped ? { filedAt: soldAt.toISOString() } : {}),
              issues: issues.map((issue) => issue.kind),
            },
            userId: input.userId,
          },
          tx,
        );

        return {
          status: 'recorded' as const,
          sale: {
            id: created.id,
            invoiceNumber: created.invoiceNumber,
            total: toNum(totals.total),
            paidAmount: toNum(paidAmount),
            changeAmount: toNum(changeAmount),
            receivedAt: created.receivedAt.toISOString(),
          },
          issues: issues.map((issue) => issue.kind),
        };
      },
      { timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    // Two uploads of the same sale raced; the other committed and this one
    // rolled back entirely. Answer with the recorded sale.
    if (isClientRequestConflict(error)) {
      const raced = await existingResult(db, sale.id, input.userId);
      if (raced) return raced;
    }
    throw error;
  }
}

async function existingResult(
  db: Awaited<ReturnType<typeof getStoreContext>>['db'],
  saleId: string,
  userId: string,
): Promise<RecordedOfflineSale | null> {
  const found = await findRetriedSale(db, saleId, userId);
  if (!found) return null;
  const [row, issues] = await Promise.all([
    db.sale.findUnique({ where: { id: found.id }, select: { receivedAt: true } }),
    db.syncIssue.findMany({ where: { saleId: found.id }, select: { kind: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  return {
    status: 'duplicate',
    sale: {
      id: found.id,
      invoiceNumber: found.invoiceNumber,
      total: found.total,
      paidAmount: found.paidAmount,
      changeAmount: found.changeAmount,
      receivedAt: (row?.receivedAt ?? new Date()).toISOString(),
    },
    issues: issues.map((issue) => issue.kind),
  };
}

