import 'server-only';

import type { InventoryTransactionType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';

/** Ledger reads for the movements screen. */

export interface MovementQuery {
  search?: string;
  type?: InventoryTransactionType | 'ALL';
  warehouseId?: string;
  productId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listMovements(query: MovementQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, query.pageSize ?? 40));

  const where: Prisma.InventoryTransactionWhereInput = {
    ...(query.type && query.type !== 'ALL' ? { type: query.type } : {}),
    ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(query.search?.trim()
      ? {
          product: {
            OR: [
              { name: { contains: query.search.trim(), mode: 'insensitive' } },
              { sku: { contains: query.search.trim(), mode: 'insensitive' } },
            ],
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        quantity: true,
        balanceBefore: true,
        balanceAfter: true,
        unitCost: true,
        note: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
        product: { select: { id: true, name: true, sku: true } },
        warehouse: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      type: row.type,
      quantity: toNum(row.quantity),
      balanceBefore: toNum(row.balanceBefore),
      balanceAfter: toNum(row.balanceAfter),
      unitCost: toNum(row.unitCost),
      value: Math.abs(toNum(row.quantity)) * toNum(row.unitCost),
      note: row.note,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      createdAt: row.createdAt,
      productId: row.product.id,
      productName: row.product.name,
      sku: row.product.sku,
      warehouseName: row.warehouse.name,
      userName: row.user?.name ?? 'System',
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Product picker options for the adjustment and transfer forms. */
export async function getStockPickerProducts(warehouseId?: string) {
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE', isTrackable: true },
    orderBy: { name: 'asc' },
    take: 500,
    select: {
      id: true,
      name: true,
      sku: true,
      costPrice: true,
      unit: { select: { abbreviation: true } },
      inventory: warehouseId
        ? { where: { warehouseId }, select: { quantity: true, reserved: true } }
        : { select: { quantity: true, reserved: true } },
    },
  });

  return products.map((product) => {
    const onHand = product.inventory.reduce((acc, row) => acc + toNum(row.quantity), 0);
    const reserved = product.inventory.reduce((acc, row) => acc + toNum(row.reserved), 0);

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit.abbreviation,
      costPrice: toNum(product.costPrice),
      onHand,
      available: onHand - reserved,
    };
  });
}

export type StockPickerProduct = Awaited<ReturnType<typeof getStockPickerProducts>>[number];

export async function listActiveWarehouses() {
  return prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, isDefault: true },
  });
}
