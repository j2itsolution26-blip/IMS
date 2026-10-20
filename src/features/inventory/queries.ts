import 'server-only';

import type { InventoryTransactionType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { findProductRefByBarcode } from '@/features/products/queries';

/** Ledger reads for the movements screen. */

export interface MovementQuery {
  search?: string;
  type?: InventoryTransactionType | 'ALL';
  productId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export async function listMovements(query: MovementQuery = {}, { includeCost = false }: { includeCost?: boolean } = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, query.pageSize ?? 40));

  const where: Prisma.InventoryTransactionWhereInput = {
    ...(query.type && query.type !== 'ALL' ? { type: query.type } : {}),
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
      // Cost is the owner's; staff see quantities only.
      unitCost: includeCost ? toNum(row.unitCost) : 0,
      value: includeCost ? Math.abs(toNum(row.quantity)) * toNum(row.unitCost) : 0,
      note: row.note,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      createdAt: row.createdAt,
      productId: row.product.id,
      productName: row.product.name,
      sku: row.product.sku,
      userName: row.user?.name ?? 'System',
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Product picker options for the adjustment and stock-in forms.
 *
 * `costPrice` is zero unless `includeCost` is set: it only feeds the owner's
 * "stock value impact" preview, and the server values every movement at the
 * product's recorded cost regardless of what the browser holds.
 */
export async function getStockPickerProducts({ includeCost = false }: { includeCost?: boolean } = {}) {
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE', isTrackable: true },
    orderBy: { name: 'asc' },
    take: 500,
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      costPrice: true,
      inventory: { select: { quantity: true, reserved: true } },
    },
  });

  return products.map((product) => {
    const onHand = product.inventory.reduce((acc, row) => acc + toNum(row.quantity), 0);
    const reserved = product.inventory.reduce((acc, row) => acc + toNum(row.reserved), 0);

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      costPrice: includeCost ? toNum(product.costPrice) : 0,
      onHand,
      available: onHand - reserved,
    };
  });
}

export type StockPickerProduct = Awaited<ReturnType<typeof getStockPickerProducts>>[number];

/** A scanned code resolved for the inventory screens. */
export type InventoryBarcodeLookup =
  | {
      status: 'found';
      product: StockPickerProduct & {
        productStatus: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
        isTrackable: boolean;
      };
    }
  | { status: 'not-found' };

/**
 * Resolves a scanned code for receiving, counting and search.
 *
 * Unlike the till this finds inactive and non-stock products too, so the
 * screen can say *why* one can't be received or counted rather than claiming
 * it doesn't exist — which would invite a duplicate product.
 */
export async function findInventoryProductByBarcode(
  barcode: string,
  { includeCost = false }: { includeCost?: boolean } = {},
): Promise<InventoryBarcodeLookup> {
  const ref = await findProductRefByBarcode(barcode);
  if (!ref) return { status: 'not-found' };

  const product = await prisma.product.findUnique({
    where: { id: ref.id },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      status: true,
      isTrackable: true,
      costPrice: true,
      inventory: { select: { quantity: true, reserved: true } },
    },
  });
  if (!product) return { status: 'not-found' };

  const onHand = product.inventory.reduce((acc, row) => acc + toNum(row.quantity), 0);
  const reserved = product.inventory.reduce((acc, row) => acc + toNum(row.reserved), 0);

  return {
    status: 'found',
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      costPrice: includeCost ? toNum(product.costPrice) : 0,
      onHand,
      available: onHand - reserved,
      productStatus: product.status,
      isTrackable: product.isTrackable,
    },
  };
}
