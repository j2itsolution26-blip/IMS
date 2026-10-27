import 'server-only';

import { Prisma, type PaymentMethod, type SaleChannel } from '@prisma/client';
import { type TxClient } from '@/lib/prisma';
import { getStoreContext, storeDb } from '@/lib/tenant/context';
import { D, money, sum, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { applyStockMovement, assertStockAvailable, wholePieces } from '@/server/services/inventory-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { recordAudit } from '@/server/services/audit-service';
import { getSettings, readNumber } from '@/server/services/settings-service';
import { getDefaultWarehouseId } from '@/server/services/warehouse-service';
import { lockShiftIfOpen, requireOpenShift } from '@/server/services/shift-service';
import { GCASH_REFERENCE_HINT, normalizeGcashReference } from '@/lib/tender';

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
  /**
   * GCash only: the cashier confirmed the money arrived in the store's GCash
   * account (its notification or transaction history, not the customer's
   * screen). A reference number on its own is not proof of payment.
   */
  confirmedReceived?: boolean;
}

export interface CreateSaleInput {
  channel?: SaleChannel;
  items: SaleLineInput[];
  /** Order-level discount, applied after line discounts. */
  discount?: Numeric;
  payments: SalePaymentInput[];
  notes?: string;
  userId: string;
  /**
   * One id per checkout attempt, made by the till. A retried or doubled
   * request with the same id returns the sale already recorded instead of
   * ringing it up twice (unique per store, migration 20261103090000).
   */
  clientRequestId?: string;
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

    const quantity = wholePieces(item.quantity, `Quantity for ${product.name}`);
    if (quantity.lessThan(1)) {
      throw new ValidationError(`Quantity for ${product.name} must be at least 1 piece.`);
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
  const db = await storeDb();
  const [lines, settings] = await Promise.all([priceBasket(db, items), getSettings()]);
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

const COMPLETED_SALE_SELECT = {
  id: true,
  invoiceNumber: true,
  total: true,
  paidAmount: true,
  changeAmount: true,
  taxAmount: true,
  costOfGoods: true,
  userId: true,
} as const;

type CompletedSaleRow = Prisma.SaleGetPayload<{ select: typeof COMPLETED_SALE_SELECT }>;

function toCompletedSale(sale: CompletedSaleRow): CompletedSale {
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    total: toNum(sale.total),
    paidAmount: toNum(sale.paidAmount),
    changeAmount: toNum(sale.changeAmount),
    profit: toNum(D(sale.total).minus(D(sale.taxAmount)).minus(D(sale.costOfGoods))),
  };
}

/** The sale an earlier attempt with this id already recorded, if any. Only ever the same cashier's. */
async function findRetriedSale(db: TxClient, clientRequestId: string, userId: string): Promise<CompletedSale | null> {
  const existing = await db.sale.findFirst({ where: { clientRequestId }, select: COMPLETED_SALE_SELECT });
  if (!existing) return null;
  if (existing.userId !== userId) throw new ConflictError('This checkout was already used. Start a new sale.');
  return toCompletedSale(existing);
}

function isClientRequestConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    String((error.meta as { target?: unknown } | undefined)?.target ?? '').includes('clientRequestId')
  );
}

type CheckedPayment = Omit<SalePaymentInput, 'reference'> & { reference: string | null };

/**
 * Checks the tenders before anything is written. GCash needs a reference that
 * looks real and the cashier's confirmation that the money arrived.
 */
function checkedPayments(payments: SalePaymentInput[]): CheckedPayment[] {
  return payments.map((payment) => {
    if (payment.method !== 'GCASH') return { ...payment, reference: payment.reference?.trim() || null };
    const reference = normalizeGcashReference(payment.reference);
    if (!reference) throw new ValidationError(GCASH_REFERENCE_HINT, { reference: [GCASH_REFERENCE_HINT] });
    if (payment.confirmedReceived !== true) {
      throw new ValidationError(
        'Check the store GCash account and confirm the payment arrived before completing the sale.',
        { confirmedReceived: ['Confirm the payment arrived.'] },
      );
    }
    return { ...payment, reference };
  });
}

export async function createSale(input: CreateSaleInput): Promise<CompletedSale> {
  const db = await storeDb();
  const clientRequestId = input.clientRequestId?.trim() || null;
  if (clientRequestId) {
    const retried = await findRetriedSale(db, clientRequestId, input.userId);
    if (retried) return retried;
  }
  const payments = checkedPayments(input.payments);
  const orderDiscount = money(input.discount ?? 0);
  const [warehouseId, shift, settings] = await Promise.all([
    getDefaultWarehouseId(),
    requireOpenShift(input.userId),
    getSettings(),
  ]);
  const taxRate = D(readNumber(settings, 'sales.defaultTaxRate'));

  try {
    return await createSaleInTransaction(db, input, { payments, clientRequestId, orderDiscount, warehouseId, shift, taxRate });
  } catch (error) {
    // Two copies of one checkout raced: the first committed and this one
    // rolled back entirely, so no stock moved. Hand back the recorded sale.
    if (clientRequestId && isClientRequestConflict(error)) {
      const retried = await findRetriedSale(db, clientRequestId, input.userId);
      if (retried) return retried;
    }
    throw error;
  }
}

async function createSaleInTransaction(
  db: Awaited<ReturnType<typeof storeDb>>,
  input: CreateSaleInput,
  {
    payments,
    clientRequestId,
    orderDiscount,
    warehouseId,
    shift,
    taxRate,
  }: {
    payments: CheckedPayment[];
    clientRequestId: string | null;
    orderDiscount: Prisma.Decimal;
    warehouseId: string;
    shift: { id: string };
    taxRate: Prisma.Decimal;
  },
): Promise<CompletedSale> {
  return db.$transaction(
    async (tx) => {
      // Holds the shift open until this sale commits; a close that started
      // first wins and this sale is refused rather than landing on it.
      if (!(await lockShiftIfOpen(tx, shift.id, 'share'))) {
        throw new ConflictError('Your shift was closed. Open a new shift to keep selling.');
      }

      const lines = await priceBasket(tx, input.items);
      const totals = totalsFor(lines, orderDiscount, taxRate);

      // Fail fast with one complete message before writing anything.
      await assertStockAvailable(
        tx,
        warehouseId,
        lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      );

      if (payments.some((p) => D(p.amount).lessThan(0))) {
        throw new ValidationError('Payment amounts cannot be negative.');
      }
      const tendered = money(sum(payments.map((p) => p.amount)));

      // Change only ever comes out of cash. GCash and other rails are charged
      // an exact amount, so together they may cover at most the total;
      // otherwise the sale would record more paid than it cost.
      const nonCash = money(sum(payments.filter((p) => p.method !== 'CASH').map((p) => p.amount)));
      if (nonCash.greaterThan(totals.total)) {
        throw new ValidationError('The GCash amount cannot be more than the total. Enter the exact amount due.', {
          payments: ['GCash must be for the exact amount due.'],
        });
      }
      const hasCash = payments.some((p) => p.method === 'CASH');
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
          clientRequestId,
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

      for (const payment of payments) {
        const amount = money(payment.amount);
        if (amount.lessThanOrEqualTo(0)) continue;
        await tx.payment.create({
          data: {
            paymentNumber: await nextDocumentNumber('PAYMENT', tx),
            direction: 'INBOUND',
            method: payment.method,
            amount,
            reference: payment.reference,
            note: payment.method === 'GCASH' ? 'Cashier confirmed the payment arrived in the store GCash account.' : null,
            saleId: sale.id,
            shiftId: shift.id,
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
}

/**
 * Locks one sale row of the signed-in store until the transaction ends, so
 * refunds and voids of that sale take turns. False if there is no such sale.
 */
export async function lockSale(tx: Prisma.TransactionClient, saleId: string): Promise<boolean> {
  const { storeId } = await getStoreContext();
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM sales WHERE id = ${saleId} AND "storeId" = ${storeId} FOR UPDATE`;
  return rows.length > 0;
}

/**
 * Voids a completed sale and returns every unit to stock. The sale is kept,
 * marked VOIDED with who voided it, when and why; it never counts as revenue
 * or drawer cash again.
 *
 * Only a sale with nothing refunded yet, rung up in a shift that is still
 * open: that drawer still holds the money to hand back. Anything later is a
 * refund, which records the money going out of whichever drawer pays it.
 */
export async function voidSale(saleId: string, userId: string, reason: string): Promise<void> {
  const db = await storeDb();
  const trimmed = reason.trim();
  if (trimmed.length < 4) throw new ValidationError('Give a reason of at least 4 characters.');

  await db.$transaction(async (tx) => {
    // Taken first, so a concurrent void or refund of this sale waits and then
    // sees this one's effect instead of reversing the stock a second time.
    if (!(await lockSale(tx, saleId))) throw new NotFoundError('Sale');

    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: { items: true, returns: { select: { id: true } } },
    });
    if (!sale) throw new NotFoundError('Sale');
    if (sale.status === 'VOIDED') throw new ConflictError('This sale has already been voided.');
    if (sale.status !== 'COMPLETED' || sale.returns.length > 0) {
      throw new ConflictError('Part of this sale has already been refunded, so it cannot be voided. Refund the remaining items instead.');
    }
    // Holds the shift open until the void commits, so a close cannot freeze
    // its figures with this sale still counted.
    if (!sale.shiftId || !(await lockShiftIfOpen(tx, sale.shiftId, 'share'))) {
      throw new ConflictError('The shift this sale was rung up in is closed. Process a refund instead, so the money paid back is recorded.');
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
        note: `Void of ${sale.invoiceNumber}: ${trimmed}`,
        userId,
      });
    }

    await tx.sale.update({
      where: { id: sale.id },
      data: { status: 'VOIDED', voidedAt: new Date(), voidedById: userId, voidReason: trimmed },
    });

    await recordAudit(
      {
        action: 'UPDATE',
        entity: 'Sale',
        entityId: sale.id,
        summary: `Voided sale ${sale.invoiceNumber}: ${trimmed}`,
        changes: { status: { from: sale.status, to: 'VOIDED' }, total: sale.total.toString(), reason: trimmed },
        userId,
      },
      tx,
    );
  });
}
