import 'server-only';

import { Prisma, type PaymentMethod, type PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { D, money, qty as q3, sum, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { applyStockMovement, evaluateStockAlerts } from '@/server/services/inventory-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { notify, supplierDelayKey } from '@/server/services/notification-service';
import { recordAudit } from '@/server/services/audit-service';

/**
 * Purchasing.
 *
 * Ordering and receiving are separate steps. Creating a PO changes no stock;
 * only `receivePurchaseOrder` does, and it supports receiving a partial
 * quantity so a split delivery is recorded as it actually arrives.
 */

export interface PurchaseLineInput {
  productId: string;
  quantity: Numeric;
  unitCost: Numeric;
  taxRate?: Numeric;
  discount?: Numeric;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  warehouseId: string;
  items: PurchaseLineInput[];
  discount?: Numeric;
  shippingCost?: Numeric;
  expectedDate?: Date | null;
  notes?: string;
  /** DRAFT keeps it editable; ORDERED signals it has been sent to the supplier. */
  status?: Extract<PurchaseOrderStatus, 'DRAFT' | 'ORDERED'>;
  userId: string;
}

interface PricedPurchaseLine {
  productId: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  discount: Prisma.Decimal;
  net: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
}

function priceLines(items: PurchaseLineInput[]): PricedPurchaseLine[] {
  if (items.length === 0) {
    throw new ValidationError('Add at least one product to the purchase order.', {
      items: ['The order has no lines.'],
    });
  }

  return items.map((item) => {
    const quantity = q3(item.quantity);
    if (quantity.lessThanOrEqualTo(0)) {
      throw new ValidationError('Every line must have a quantity greater than zero.');
    }

    const unitCost = money(item.unitCost);
    if (unitCost.lessThan(0)) throw new ValidationError('Unit cost cannot be negative.');

    const discount = money(item.discount ?? 0);
    const gross = unitCost.times(quantity);
    if (discount.greaterThan(gross)) {
      throw new ValidationError('A line discount cannot exceed the line total.');
    }

    const net = money(gross.minus(discount));
    const taxRate = D(item.taxRate ?? 0);
    const tax = money(net.times(taxRate).dividedBy(100));

    return { productId: item.productId, quantity, unitCost, taxRate, discount, net, tax, total: money(net.plus(tax)) };
  });
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput) {
  const lines = priceLines(input.items);
  const subtotal = money(sum(lines.map((l) => l.net)));
  const taxAmount = money(sum(lines.map((l) => l.tax)));
  const orderDiscount = money(input.discount ?? 0);
  const shipping = money(input.shippingCost ?? 0);
  const total = money(subtotal.plus(taxAmount).plus(shipping).minus(orderDiscount));

  if (total.lessThan(0)) {
    throw new ValidationError('The order discount is larger than the order total.', {
      discount: ['Discount exceeds the order total.'],
    });
  }

  return prisma.$transaction(async (tx) => {
    const orderNumber = await nextDocumentNumber('PURCHASE_ORDER', tx);

    const order = await tx.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        userId: input.userId,
        status: input.status ?? 'DRAFT',
        subtotal,
        taxAmount,
        discount: orderDiscount,
        shippingCost: shipping,
        total,
        expectedDate: input.expectedDate ?? null,
        notes: input.notes?.trim() || null,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitCost: l.unitCost,
            taxRate: l.taxRate,
            discount: l.discount,
            total: l.total,
          })),
        },
      },
      select: { id: true, orderNumber: true },
    });

    await recordAudit(
      {
        action: 'PURCHASE',
        entity: 'PurchaseOrder',
        entityId: order.id,
        summary: `Created purchase order ${order.orderNumber} for ${toNum(total)}`,
        userId: input.userId,
      },
      tx,
    );

    return order;
  });
}

export interface ReceiveLineInput {
  purchaseItemId: string;
  /** Quantity arriving now, not the cumulative total. */
  quantity: Numeric;
  /** Actual landed cost, if it differs from the ordered cost. */
  unitCost?: Numeric;
}

export interface ReceivePurchaseOrderInput {
  purchaseOrderId: string;
  lines: ReceiveLineInput[];
  note?: string;
  userId: string;
}

/**
 * Receives stock against a purchase order.
 *
 * Adds only what arrived, moves the order to PARTIALLY_RECEIVED or RECEIVED
 * accordingly, and re-averages each product's cost from the real landed cost.
 */
export async function receivePurchaseOrder(input: ReceivePurchaseOrderInput) {
  const result = await prisma.$transaction(
    async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id: input.purchaseOrderId },
        include: { items: true, supplier: { select: { name: true } } },
      });
      if (!order) throw new NotFoundError('Purchase order');
      if (order.status === 'CANCELLED') throw new ConflictError('This purchase order was cancelled.');
      if (order.status === 'RECEIVED') throw new ConflictError('This purchase order is already fully received.');

      const itemsById = new Map(order.items.map((i) => [i.id, i]));
      const received: { productId: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }[] = [];

      for (const line of input.lines) {
        const item = itemsById.get(line.purchaseItemId);
        if (!item) throw new NotFoundError('Purchase order line');

        const incoming = q3(line.quantity);
        if (incoming.lessThanOrEqualTo(0)) continue;

        const outstanding = D(item.quantity).minus(D(item.receivedQuantity));
        if (incoming.greaterThan(outstanding)) {
          throw new ValidationError(
            `Cannot receive more than was ordered. ${toNum(outstanding)} still outstanding on this line.`,
          );
        }

        const unitCost = money(line.unitCost ?? item.unitCost);

        await tx.purchaseItem.update({
          where: { id: item.id },
          data: {
            receivedQuantity: D(item.receivedQuantity).plus(incoming),
            // Record the cost actually paid so reporting reflects reality.
            ...(line.unitCost != null ? { unitCost } : {}),
          },
        });

        await applyStockMovement(tx, {
          productId: item.productId,
          warehouseId: order.warehouseId,
          type: 'PURCHASE_RECEIPT',
          quantity: incoming,
          unitCost,
          referenceType: 'PURCHASE_ORDER',
          referenceId: order.id,
          note: input.note?.trim() || `Received on ${order.orderNumber}`,
          userId: input.userId,
        });

        received.push({ productId: item.productId, quantity: incoming, unitCost });
      }

      if (received.length === 0) {
        throw new ValidationError('Enter a quantity for at least one line to receive.');
      }

      // Re-read to decide the new status from committed line state.
      const refreshed = await tx.purchaseItem.findMany({
        where: { purchaseOrderId: order.id },
        select: { quantity: true, receivedQuantity: true },
      });
      const fullyReceived = refreshed.every((i) =>
        D(i.receivedQuantity).greaterThanOrEqualTo(D(i.quantity)),
      );

      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          receivedDate: fullyReceived ? new Date() : order.receivedDate,
        },
      });

      await recordAudit(
        {
          action: 'PURCHASE',
          entity: 'PurchaseOrder',
          entityId: order.id,
          summary: `${fullyReceived ? 'Fully' : 'Partially'} received ${order.orderNumber} (${received.length} line(s))`,
          userId: input.userId,
        },
        tx,
      );

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        supplierName: order.supplier.name,
        warehouseId: order.warehouseId,
        productIds: received.map((r) => r.productId),
        fullyReceived,
        lineCount: received.length,
      };
    },
    { timeout: 30_000 },
  );

  await evaluateStockAlerts(result.productIds, result.warehouseId);

  await notify({
    type: 'PURCHASE_RECEIVED',
    title: `Stock received: ${result.orderNumber}`,
    message: `${result.lineCount} line(s) received from ${result.supplierName}${
      result.fullyReceived ? ' — order complete.' : ' — order partially received.'
    }`,
    link: `/purchases/${result.orderId}`,
  });

  // Receiving clears any outstanding late-delivery alert for this order.
  await prisma.notification.deleteMany({ where: { dedupeKey: supplierDelayKey(result.orderId) } });

  return result;
}

export async function cancelPurchaseOrder(orderId: string, userId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: { select: { receivedQuantity: true } } },
    });
    if (!order) throw new NotFoundError('Purchase order');
    if (order.status === 'CANCELLED') throw new ConflictError('This order is already cancelled.');

    // Cancelling after goods have landed would strand the stock already booked in.
    const anyReceived = order.items.some((i) => D(i.receivedQuantity).greaterThan(0));
    if (anyReceived) {
      throw new ConflictError(
        'Stock has already been received against this order. Raise a purchase return instead of cancelling.',
      );
    }

    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', notes: [order.notes, `CANCELLED: ${reason}`].filter(Boolean).join('\n') },
    });

    await recordAudit(
      {
        action: 'UPDATE',
        entity: 'PurchaseOrder',
        entityId: orderId,
        summary: `Cancelled purchase order ${order.orderNumber}: ${reason}`,
        userId,
      },
      tx,
    );
  });
}

export interface RecordSupplierPaymentInput {
  purchaseOrderId: string;
  method: PaymentMethod;
  amount: Numeric;
  reference?: string;
  userId: string;
}

export async function recordSupplierPayment(input: RecordSupplierPaymentInput) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      select: { id: true, orderNumber: true, total: true, paidAmount: true },
    });
    if (!order) throw new NotFoundError('Purchase order');

    const amount = money(input.amount);
    if (amount.lessThanOrEqualTo(0)) throw new ValidationError('Payment amount must be greater than zero.');

    const outstanding = D(order.total).minus(D(order.paidAmount));
    if (amount.greaterThan(outstanding)) {
      throw new ValidationError(
        `That is more than the outstanding balance of ${toNum(outstanding)} on this order.`,
        { amount: ['Amount exceeds the outstanding balance.'] },
      );
    }

    await tx.payment.create({
      data: {
        paymentNumber: await nextDocumentNumber('PAYMENT', tx),
        direction: 'OUTBOUND',
        method: input.method,
        amount,
        reference: input.reference?.trim() || null,
        purchaseOrderId: order.id,
        userId: input.userId,
      },
    });

    await tx.purchaseOrder.update({
      where: { id: order.id },
      data: { paidAmount: D(order.paidAmount).plus(amount) },
    });

    await recordAudit(
      {
        action: 'CREATE',
        entity: 'Payment',
        entityId: order.id,
        summary: `Paid ${toNum(amount)} against ${order.orderNumber}`,
        userId: input.userId,
      },
      tx,
    );
  });
}

/**
 * Flags purchase orders that are past their expected delivery date.
 * Called when the purchasing screens load, so alerts stay current without a cron.
 */
export async function detectSupplierDelays(): Promise<number> {
  const overdue = await prisma.purchaseOrder.findMany({
    where: {
      status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] },
      expectedDate: { lt: new Date() },
    },
    select: { id: true, orderNumber: true, expectedDate: true, supplier: { select: { name: true } } },
    take: 50,
  });

  for (const order of overdue) {
    const daysLate = Math.floor((Date.now() - order.expectedDate!.getTime()) / 86_400_000);
    await notify({
      type: 'SUPPLIER_DELAY',
      title: `Late delivery: ${order.orderNumber}`,
      message: `${order.supplier.name} is ${daysLate} day(s) past the expected delivery date.`,
      link: `/purchases/${order.id}`,
      dedupeKey: supplierDelayKey(order.id),
    });
  }

  return overdue.length;
}
