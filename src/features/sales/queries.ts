import 'server-only';

import type { PaymentMethod, Prisma, SaleStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';

/** Sales reads. Listing pages in the database; detail loads the full document. */

export interface SaleListQuery {
  search?: string;
  status?: SaleStatus | 'ALL';
  /** Leave voided sales out, as every money figure does. Ignored when `status` is set. */
  excludeVoided?: boolean;
  userId?: string;
  paymentMethod?: PaymentMethod;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
  /** Profit is the owner's. Without this every profit figure comes back as zero. */
  includeCost?: boolean;
}

/** Cashiers who actually have sales, for the sales-history filter. */
export async function listCashiers(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: { sales: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function listSales(query: SaleListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 25));

  const where: Prisma.SaleWhereInput = {
    ...(query.status && query.status !== 'ALL'
      ? { status: query.status }
      : query.excludeVoided
        ? { status: { not: 'VOIDED' } }
        : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.paymentMethod ? { payments: { some: { method: query.paymentMethod } } } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(query.search?.trim()
      ? { invoiceNumber: { contains: query.search.trim(), mode: 'insensitive' } }
      : {}),
  };

  const [rows, total, aggregate] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        channel: true,
        discount: true,
        total: true,
        paidAmount: true,
        taxAmount: true,
        costOfGoods: true,
        createdAt: true,
        user: { select: { name: true } },
        payments: { select: { method: true }, orderBy: { createdAt: 'asc' } },
        // Every line, because the list gives each product its own row.
        items: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            discount: true,
            total: true,
            product: { select: { id: true, name: true, imageUrl: true } },
          },
        },
      },
    }),
    prisma.sale.count({ where }),
    // Totals for the whole filtered set, not just the visible page.
    prisma.sale.aggregate({
      where: { ...where, status: { not: 'VOIDED' } },
      _sum: { total: true, taxAmount: true, costOfGoods: true },
    }),
  ]);

  const revenue = toNum(aggregate._sum.total);
  const tax = toNum(aggregate._sum.taxAmount);
  const cogs = toNum(aggregate._sum.costOfGoods);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      status: row.status,
      channel: row.channel,
      // Before any discount, so subtotal − discount + tax reads as the total.
      grossAmount: row.items.reduce((acc, item) => acc + toNum(item.quantity) * toNum(item.unitPrice), 0),
      discountAmount: row.items.reduce((acc, item) => acc + toNum(item.discount), toNum(row.discount)),
      taxAmount: toNum(row.taxAmount),
      total: toNum(row.total),
      paidAmount: toNum(row.paidAmount),
      balance: Math.max(0, toNum(row.total) - toNum(row.paidAmount)),
      profit: query.includeCost ? toNum(row.total) - toNum(row.taxAmount) - toNum(row.costOfGoods) : 0,
      createdAt: row.createdAt,
      cashierName: row.user.name,
      paymentMethod: row.payments.length === 0 ? null : row.payments.length > 1 ? 'Split' : row.payments[0].method,
      itemCount: row.items.length,
      items: row.items.map((item) => ({
        id: item.id,
        productId: item.product.id,
        name: item.product.name,
        imageUrl: item.product.imageUrl,
        quantity: toNum(item.quantity),
        unitPrice: toNum(item.unitPrice),
        lineTotal: toNum(item.total),
      })),
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: { revenue, profit: query.includeCost ? revenue - tax - cogs : 0, count: total },
  };
}

export type SaleListRow = Awaited<ReturnType<typeof listSales>>['rows'][number];

/**
 * One sale with its lines, payments and returns.
 *
 * Cost of goods, line costs and profit are zeroed unless `includeCost` is set,
 * so a page that hands the sale to a client component cannot leak them.
 */
export async function getSale(id: string, { includeCost = false }: { includeCost?: boolean } = {}) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: { id: true, name: true, sku: true, imageUrl: true },
          },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
      returns: {
        select: { id: true, returnNumber: true, total: true, createdAt: true, reason: true, userId: true, user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!sale) return null;

  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    status: sale.status,
    channel: sale.channel,
    createdAt: sale.createdAt,
    notes: sale.notes,
    subtotal: toNum(sale.subtotal),
    taxAmount: toNum(sale.taxAmount),
    discount: toNum(sale.discount),
    total: toNum(sale.total),
    paidAmount: toNum(sale.paidAmount),
    changeAmount: toNum(sale.changeAmount),
    costOfGoods: includeCost ? toNum(sale.costOfGoods) : 0,
    profit: includeCost ? toNum(sale.total) - toNum(sale.taxAmount) - toNum(sale.costOfGoods) : 0,
    balance: Math.max(0, toNum(sale.total) - toNum(sale.paidAmount)),
    warehouse: sale.warehouse,
    cashier: sale.user,
    items: sale.items.map((item) => ({
      id: item.id,
      productId: item.product.id,
      name: item.product.name,
      sku: item.product.sku,
      imageUrl: item.product.imageUrl,
      quantity: toNum(item.quantity),
      returnedQuantity: toNum(item.returnedQuantity),
      returnable: toNum(item.quantity) - toNum(item.returnedQuantity),
      unitPrice: toNum(item.unitPrice),
      unitCost: includeCost ? toNum(item.unitCost) : 0,
      discount: toNum(item.discount),
      total: toNum(item.total),
    })),
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      method: payment.method,
      amount: toNum(payment.amount),
      reference: payment.reference,
      createdAt: payment.createdAt,
    })),
    returns: sale.returns.map((item) => ({
      id: item.id,
      returnNumber: item.returnNumber,
      total: toNum(item.total),
      createdAt: item.createdAt,
      reason: item.reason,
      processedBy: item.user.name,
    })),
  };
}

export type SaleDetail = NonNullable<Awaited<ReturnType<typeof getSale>>>;

/**
 * Assembles the same receipt shape the till prints, for "View/Print receipt"
 * after the fact. With `cashierId` set, a sale rung up by anyone else comes
 * back as null — see `salesScopeUserId`.
 */
export async function getReceiptData(id: string, { cashierId = null }: { cashierId?: string | null } = {}) {
  const sale = await getSale(id);
  if (!sale || (cashierId !== null && sale.cashier.id !== cashierId)) return null;

  return {
    invoiceNumber: sale.invoiceNumber,
    issuedAt: sale.createdAt,
    cashierName: sale.cashier.name,
    lines: sale.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      total: item.total,
    })),
    subtotal: sale.subtotal,
    tax: sale.taxAmount,
    discount: sale.discount,
    total: sale.total,
    paid: sale.paidAmount,
    change: sale.changeAmount,
    payments: sale.payments.map((p) => ({ method: p.method, amount: p.amount })),
  };
}
