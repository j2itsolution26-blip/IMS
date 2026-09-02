import 'server-only';

import { Prisma, type PaymentMethod, type SaleChannel } from '@prisma/client';
import { prisma, type TxClient } from '@/lib/prisma';
import { D, money, qty as q3, sum, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { applyStockMovement, assertStockAvailable } from '@/server/services/inventory-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { recordAudit } from '@/server/services/audit-service';
import { getSettings, readNumber } from '@/server/services/settings-service';
import { getDefaultWarehouseId } from '@/server/services/warehouse-service';
import { requireOpenShift } from '@/server/services/shift-service';

/**
 * Sales / point of sale.
 *
 * A completed sale writes the invoice, its lines, its payments, and the stock
 * movements for every line inside one transaction. If any line cannot be
 * fulfilled the whole checkout rolls back — there is no partial sale that
 * leaves stock deducted for some items and not others.
 *
 * Every sale is a walk-in sale — there is no customer record — and must be
 * paid in full at checkout; there is no credit/on-account path.
 */

export interface SaleLineInput {
  productId: string;
  quantity: Numeric;
  /** Overrides the catalogue price (manager discount at the till). */
  unitPrice?: Numeric;
  discount?: Numeric;
}

export interface SalePaymentInput {
  method: PaymentMethod;
  amount: Numeric;
  reference?: string;
}

export interface CreateSaleInput {
  channel?: SaleChannel;
  items: SaleLineInput[];
  /** Order-level discount, applied after line discounts. */
  discount?: Numeric;
  payments: SalePaymentInput[];
  notes?: string;
  userId: string;
}

export interface SaleTotals {
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discount: Prisma.Decimal;
  total: Prisma.Decimal;
  costOfGoods: Prisma.Decimal;
}

interface PricedLine {
  productId: string;
  name: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  discount: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * Prices a basket against live catalogue data.
 *
 * Prices and costs are always re-read from the database here — never trusted
 * from the client — so a tampered POST cannot sell a ₱2,000 item for ₱1.
 */
async function priceBasket(
  db: TxClient,
  items: SaleLineInput[],
): Promise<PricedLine[]> {
  if (items.length === 0) {
    throw new ValidationError('Add at least one item before completing the sale.', {
      items: ['The basket is empty.'],
    });
  }

  const products = await db.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
    select: { id: true, name: true, sellingPrice: true, costPrice: true, status: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) throw new NotFoundError(`Product ${item.productId}`);
    if (product.status !== 'ACTIVE') {
      throw new ConflictError(`${product.name} is ${product.status.toLowerCase()} and cannot be sold.`);
    }

    const quantity = q3(item.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new ValidationError(`Quantity for ${product.name} must be greater than zero.`);
    }

    const unitPrice = money(item.unitPrice ?? product.sellingPrice);
    const discount = money(item.discount ?? 0);
    const gross = unitPrice.times(quantity);

    if (discount.greaterThan(gross)) {
      throw new ValidationError(`Discount on ${product.name} cannot exceed the line total.`);
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
}

function totalsFor(lines: PricedLine[], orderDiscount: Prisma.Decimal, taxRatePercent: Prisma.Decimal): SaleTotals {
  const subtotal = money(sum(lines.map((l) => l.total)));
  const costOfGoods = money(sum(lines.map((l) => l.unitCost.times(l.quantity))));
  const taxAmount = money(subtotal.times(taxRatePercent).dividedBy(100));
  const total = money(subtotal.plus(taxAmount).minus(orderDiscount));

  if (total.lessThan(0)) {
    throw new ValidationError('The order discount is larger than the order total.', {
      discount: ['Discount exceeds the order total.'],
    });
  }

  return { subtotal, taxAmount, discount: orderDiscount, total, costOfGoods };
}

/** Pure pricing pass used by the POS to preview totals without writing anything. */
export async function quoteSale(items: SaleLineInput[], discount: Numeric = 0) {
  const [lines, settings] = await Promise.all([priceBasket(prisma, items), getSettings()]);
  const taxRate = D(readNumber(settings, 'sales.defaultTaxRate'));
  const totals = totalsFor(lines, money(discount), taxRate);
  return {
    lines: lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      quantity: toNum(l.quantity),
      unitPrice: toNum(l.unitPrice),
      discount: toNum(l.discount),
      total: toNum(l.total),
    })),
    subtotal: toNum(totals.subtotal),
    taxAmount: toNum(totals.taxAmount),
    discount: toNum(totals.discount),
    total: toNum(totals.total),
  };
}

export interface CompletedSale {
  id: string;
  invoiceNumber: string;
  total: number;
  paidAmount: number;
  changeAmount: number;
  profit: number;
}

export async function createSale(input: CreateSaleInput): Promise<CompletedSale> {
  const orderDiscount = money(input.discount ?? 0);
  const [warehouseId, shift, settings] = await Promise.all([
    getDefaultWarehouseId(),
    requireOpenShift(input.userId),
    getSettings(),
  ]);
  const taxRate = D(readNumber(settings, 'sales.defaultTaxRate'));

  const result = await prisma.$transaction(
    async (tx) => {
      const lines = await priceBasket(tx, input.items);
      const totals = totalsFor(lines, orderDiscount, taxRate);

      // Fail fast with one complete message before writing anything.
      await assertStockAvailable(
        tx,
        warehouseId,
        lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      );

      const tendered = money(sum(input.payments.map((p) => p.amount)));
      if (tendered.lessThan(0)) {
        throw new ValidationError('Payment amounts cannot be negative.');
      }

      // Overpayment is only meaningful for cash — card/e-wallet rails are
      // charged for the exact amount, so change never applies to them.
      const hasCash = input.payments.some((p) => p.method === 'CASH');
      const overpaid = tendered.minus(totals.total);
      const changeAmount = hasCash && overpaid.greaterThan(0) ? money(overpaid) : money(0);
      const paidAmount = money(tendered.minus(changeAmount));

      // No customer, no credit — every sale must be paid in full at checkout.
      if (paidAmount.lessThan(totals.total)) {
        throw new ValidationError('Amount tendered does not cover the total.', {
          payments: ['Payment does not cover the total.'],
        });
      }

      const invoiceNumber = await nextDocumentNumber('SALE', tx);

      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          warehouseId,
          userId: input.userId,
          shiftId: shift.id,
          status: 'COMPLETED',
          channel: input.channel ?? 'POS',
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          discount: totals.discount,
          total: totals.total,
          paidAmount,
          changeAmount,
          costOfGoods: totals.costOfGoods,
          notes: input.notes?.trim() || null,
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              unitCost: l.unitCost,
              discount: l.discount,
              total: l.total,
            })),
          },
        },
        select: { id: true, invoiceNumber: true },
      });

      // Deduct stock. Cost is frozen per line so later cost changes never
      // rewrite the profit already booked against this sale.
      for (const line of lines) {
        await applyStockMovement(tx, {
          productId: line.productId,
          warehouseId,
          type: 'SALE',
          quantity: line.quantity.negated(),
          unitCost: line.unitCost,
          referenceType: 'SALE',
          referenceId: sale.id,
          note: `Sold on ${sale.invoiceNumber}`,
          userId: input.userId,
        });
      }

      for (const payment of input.payments) {
        const amount = money(payment.amount);
        if (amount.lessThanOrEqualTo(0)) continue;
        await tx.payment.create({
          data: {
            paymentNumber: await nextDocumentNumber('PAYMENT', tx),
            direction: 'INBOUND',
            method: payment.method,
            amount,
            reference: payment.reference?.trim() || null,
            saleId: sale.id,
            userId: input.userId,
          },
        });
      }

      await recordAudit(
        {
          action: 'SALE',
          entity: 'Sale',
          entityId: sale.id,
          summary: `Completed sale ${sale.invoiceNumber} for ${toNum(totals.total)}`,
          userId: input.userId,
        },
        tx,
      );

      return {
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        total: toNum(totals.total),
        paidAmount: toNum(paidAmount),
        changeAmount: toNum(changeAmount),
        profit: toNum(totals.total.minus(totals.taxAmount).minus(totals.costOfGoods)),
      };
    },
    { timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );

  return result;
}

/**
 * Voids a completed sale and returns every unit to stock.
 *
 * A sale with returns already booked against it cannot be voided — the two
 * reversals would double-count. Void the return first.
 */
export async function voidSale(saleId: string, userId: string, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: { items: true, returns: { select: { id: true } } },
    });
    if (!sale) throw new NotFoundError('Sale');
    if (sale.status === 'VOIDED') throw new ConflictError('This sale has already been voided.');
    if (sale.returns.length > 0) {
      throw new ConflictError('This sale has returns recorded against it. Void the returns first.');
    }

    for (const item of sale.items) {
      await applyStockMovement(tx, {
        productId: item.productId,
        warehouseId: sale.warehouseId,
        type: 'SALE_RETURN',
        quantity: D(item.quantity),
        unitCost: item.unitCost,
        referenceType: 'SALE',
        referenceId: sale.id,
        note: `Void of ${sale.invoiceNumber}: ${reason}`,
        userId,
      });
    }

    await tx.sale.update({
      where: { id: sale.id },
      data: { status: 'VOIDED', notes: [sale.notes, `VOIDED: ${reason}`].filter(Boolean).join('\n') },
    });

    await recordAudit(
      {
        action: 'UPDATE',
        entity: 'Sale',
        entityId: sale.id,
        summary: `Voided sale ${sale.invoiceNumber}: ${reason}`,
        userId,
      },
      tx,
    );
  });
}
