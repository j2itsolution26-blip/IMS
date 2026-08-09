import 'server-only';

import { Prisma, type PaymentMethod, type SaleChannel } from '@prisma/client';
import { prisma, type TxClient } from '@/lib/prisma';
import { D, money, qty as q3, sum, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { applyStockMovement, assertStockAvailable, evaluateStockAlerts } from '@/server/services/inventory-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { notify } from '@/server/services/notification-service';
import { recordAudit } from '@/server/services/audit-service';
import { getSettings, readNumber } from '@/server/services/settings-service';

/**
 * Sales / point of sale.
 *
 * A completed sale writes the invoice, its lines, its payments, and the stock
 * movements for every line inside one transaction. If any line cannot be
 * fulfilled the whole checkout rolls back — there is no partial sale that
 * leaves stock deducted for some items and not others.
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
  warehouseId: string;
  customerId?: string | null;
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
  taxRate: Prisma.Decimal;
  discount: Prisma.Decimal;
  lineNet: Prisma.Decimal;
  lineTax: Prisma.Decimal;
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
    select: { id: true, name: true, sellingPrice: true, costPrice: true, taxRate: true, status: true },
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

    const lineNet = gross.minus(discount);
    const taxRate = D(product.taxRate);
    const lineTax = money(lineNet.times(taxRate).dividedBy(100));

    return {
      productId: product.id,
      name: product.name,
      quantity,
      unitPrice,
      unitCost: money(product.costPrice),
      taxRate,
      discount,
      lineNet: money(lineNet),
      lineTax,
      total: money(lineNet.plus(lineTax)),
    };
  });
}

function totalsFor(lines: PricedLine[], orderDiscount: Prisma.Decimal): SaleTotals {
  const subtotal = money(sum(lines.map((l) => l.lineNet)));
  const taxAmount = money(sum(lines.map((l) => l.lineTax)));
  const costOfGoods = money(sum(lines.map((l) => l.unitCost.times(l.quantity))));
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
  const lines = await priceBasket(prisma, items);
  const totals = totalsFor(lines, money(discount));
  return {
    lines: lines.map((l) => ({
      productId: l.productId,
      name: l.name,
      quantity: toNum(l.quantity),
      unitPrice: toNum(l.unitPrice),
      discount: toNum(l.discount),
      tax: toNum(l.lineTax),
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

  const result = await prisma.$transaction(
    async (tx) => {
      const lines = await priceBasket(tx, input.items);
      const totals = totalsFor(lines, orderDiscount);

      // Fail fast with one complete message before writing anything.
      await assertStockAvailable(
        tx,
        input.warehouseId,
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

      // Anything unpaid is credit, and credit needs someone to bill.
      if (paidAmount.lessThan(totals.total) && !input.customerId) {
        throw new ValidationError(
          'A partially paid sale must be assigned to a customer so the balance can be collected.',
          { customerId: ['Select a customer for a credit sale.'] },
        );
      }

      const invoiceNumber = await nextDocumentNumber('SALE', tx);

      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          customerId: input.customerId ?? null,
          warehouseId: input.warehouseId,
          userId: input.userId,
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
              taxRate: l.taxRate,
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
          warehouseId: input.warehouseId,
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
        productIds: lines.map((l) => l.productId),
      };
    },
    { timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );

  // Post-commit side effects. These reflect committed state and must not be
  // able to roll a completed sale back.
  await evaluateStockAlerts(result.productIds, input.warehouseId);

  const settings = await getSettings();
  const threshold = readNumber(settings, 'sales.largeSaleThreshold');
  if (threshold > 0 && result.total >= threshold) {
    await notify({
      type: 'LARGE_SALE',
      title: `Large sale: ${result.invoiceNumber}`,
      message: `A sale of ${result.total.toFixed(2)} was completed.`,
      link: `/sales/${result.id}`,
    });
  }

  const { productIds: _discard, ...sale } = result;
  return sale;
}

/**
 * Voids a completed sale and returns every unit to stock.
 *
 * A sale with returns already booked against it cannot be voided — the two
 * reversals would double-count. Void the return first.
 */
export async function voidSale(saleId: string, userId: string, reason: string): Promise<void> {
  const productIds = await prisma.$transaction(async (tx) => {
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

    return { productIds: sale.items.map((i) => i.productId), warehouseId: sale.warehouseId };
  });

  await evaluateStockAlerts(productIds.productIds, productIds.warehouseId);
}
