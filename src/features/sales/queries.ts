import 'server-only';

import type { Prisma, SaleStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';

/** Sales reads. Listing pages in the database; detail loads the full document. */

export interface SaleListQuery {
  search?: string;
  status?: SaleStatus | 'ALL';
  customerId?: string;
  userId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listSales(query: SaleListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 25));

  const where: Prisma.SaleWhereInput = {
    ...(query.status && query.status !== 'ALL' ? { status: query.status } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(query.search?.trim()
      ? {
          OR: [
            { invoiceNumber: { contains: query.search.trim(), mode: 'insensitive' } },
            { customer: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
          ],
        }
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
        total: true,
        paidAmount: true,
        taxAmount: true,
        costOfGoods: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
        user: { select: { name: true } },
        warehouse: { select: { name: true } },
        _count: { select: { items: true } },
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
      total: toNum(row.total),
      paidAmount: toNum(row.paidAmount),
      balance: Math.max(0, toNum(row.total) - toNum(row.paidAmount)),
      profit: toNum(row.total) - toNum(row.taxAmount) - toNum(row.costOfGoods),
      createdAt: row.createdAt,
      customerId: row.customer?.id ?? null,
      customerName: row.customer?.name ?? 'Walk-in',
      cashierName: row.user.name,
      warehouseName: row.warehouse.name,
      itemCount: row._count.items,
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: { revenue, profit: revenue - tax - cogs, count: total },
  };
}

export type SaleListRow = Awaited<ReturnType<typeof listSales>>['rows'][number];

export async function getSale(id: string) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      warehouse: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { id: true, name: true, sku: true, unit: { select: { abbreviation: true } } } } },
      },
      payments: { orderBy: { createdAt: 'asc' } },
      returns: {
        select: { id: true, returnNumber: true, total: true, createdAt: true, reason: true },
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
    costOfGoods: toNum(sale.costOfGoods),
    profit: toNum(sale.total) - toNum(sale.taxAmount) - toNum(sale.costOfGoods),
    balance: Math.max(0, toNum(sale.total) - toNum(sale.paidAmount)),
    customer: sale.customer ? { id: sale.customer.id, name: sale.customer.name, code: sale.customer.code } : null,
    warehouse: sale.warehouse,
    cashier: sale.user,
    items: sale.items.map((item) => ({
      id: item.id,
      productId: item.product.id,
      name: item.product.name,
      sku: item.product.sku,
      unit: item.product.unit.abbreviation,
      quantity: toNum(item.quantity),
      returnedQuantity: toNum(item.returnedQuantity),
      returnable: toNum(item.quantity) - toNum(item.returnedQuantity),
      unitPrice: toNum(item.unitPrice),
      unitCost: toNum(item.unitCost),
      taxRate: toNum(item.taxRate),
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
    })),
  };
}

export type SaleDetail = NonNullable<Awaited<ReturnType<typeof getSale>>>;
