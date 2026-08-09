import 'server-only';

import type { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';

/** Purchasing reads. */

export interface PurchaseListQuery {
  search?: string;
  status?: PurchaseOrderStatus | 'ALL';
  supplierId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listPurchaseOrders(query: PurchaseListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 25));

  const where: Prisma.PurchaseOrderWhereInput = {
    ...(query.status && query.status !== 'ALL' ? { status: query.status } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(query.search?.trim()
      ? {
          OR: [
            { orderNumber: { contains: query.search.trim(), mode: 'insensitive' } },
            { supplier: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total, aggregate] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        paidAmount: true,
        expectedDate: true,
        receivedDate: true,
        createdAt: true,
        supplier: { select: { id: true, name: true } },
        warehouse: { select: { name: true } },
        items: { select: { quantity: true, receivedQuantity: true } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.aggregate({
      where: { ...where, status: { not: 'CANCELLED' } },
      _sum: { total: true, paidAmount: true },
    }),
  ]);

  const now = Date.now();

  return {
    rows: rows.map((row) => {
      const ordered = row.items.reduce((acc, item) => acc + toNum(item.quantity), 0);
      const received = row.items.reduce((acc, item) => acc + toNum(item.receivedQuantity), 0);

      return {
        id: row.id,
        orderNumber: row.orderNumber,
        status: row.status,
        total: toNum(row.total),
        paidAmount: toNum(row.paidAmount),
        balance: Math.max(0, toNum(row.total) - toNum(row.paidAmount)),
        expectedDate: row.expectedDate,
        receivedDate: row.receivedDate,
        createdAt: row.createdAt,
        supplierId: row.supplier.id,
        supplierName: row.supplier.name,
        warehouseName: row.warehouse.name,
        lineCount: row.items.length,
        receivedPercent: ordered > 0 ? Math.round((received / ordered) * 100) : 0,
        isLate:
          Boolean(row.expectedDate) &&
          row.expectedDate!.getTime() < now &&
          (row.status === 'ORDERED' || row.status === 'PARTIALLY_RECEIVED'),
      };
    }),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      committed: toNum(aggregate._sum.total),
      outstanding: Math.max(0, toNum(aggregate._sum.total) - toNum(aggregate._sum.paidAmount)),
      count: total,
    },
  };
}

export async function getPurchaseOrder(id: string) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      warehouse: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: { id: true, name: true, sku: true, unit: { select: { abbreviation: true } } },
          },
        },
      },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    expectedDate: order.expectedDate,
    receivedDate: order.receivedDate,
    notes: order.notes,
    subtotal: toNum(order.subtotal),
    taxAmount: toNum(order.taxAmount),
    discount: toNum(order.discount),
    shippingCost: toNum(order.shippingCost),
    total: toNum(order.total),
    paidAmount: toNum(order.paidAmount),
    balance: Math.max(0, toNum(order.total) - toNum(order.paidAmount)),
    supplier: {
      id: order.supplier.id,
      name: order.supplier.name,
      code: order.supplier.code,
      email: order.supplier.email,
      phone: order.supplier.phone,
      leadTimeDays: order.supplier.leadTimeDays,
    },
    warehouse: order.warehouse,
    raisedBy: order.user,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.product.id,
      name: item.product.name,
      sku: item.product.sku,
      unit: item.product.unit.abbreviation,
      quantity: toNum(item.quantity),
      receivedQuantity: toNum(item.receivedQuantity),
      outstanding: toNum(item.quantity) - toNum(item.receivedQuantity),
      unitCost: toNum(item.unitCost),
      taxRate: toNum(item.taxRate),
      discount: toNum(item.discount),
      total: toNum(item.total),
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      paymentNumber: payment.paymentNumber,
      method: payment.method,
      amount: toNum(payment.amount),
      reference: payment.reference,
      createdAt: payment.createdAt,
    })),
  };
}

export type PurchaseOrderDetail = NonNullable<Awaited<ReturnType<typeof getPurchaseOrder>>>;

/** Options for the purchase-order builder. */
export async function getPurchaseFormOptions() {
  const [suppliers, warehouses, products] = await Promise.all([
    prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, leadTimeDays: true },
    }),
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isDefault: true },
    }),
    prisma.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      take: 500,
      select: {
        id: true,
        name: true,
        sku: true,
        costPrice: true,
        taxRate: true,
        supplierId: true,
        reorderQty: true,
        unit: { select: { abbreviation: true } },
        inventory: { select: { quantity: true } },
      },
    }),
  ]);

  return {
    suppliers,
    warehouses,
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit.abbreviation,
      costPrice: toNum(product.costPrice),
      taxRate: toNum(product.taxRate),
      supplierId: product.supplierId,
      reorderQty: toNum(product.reorderQty),
      onHand: product.inventory.reduce((acc, row) => acc + toNum(row.quantity), 0),
    })),
  };
}

export type PurchaseFormProduct = Awaited<ReturnType<typeof getPurchaseFormOptions>>['products'][number];
