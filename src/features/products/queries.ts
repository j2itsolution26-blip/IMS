import 'server-only';

import type { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { getDefaultWarehouseId } from '@/server/services/warehouse-service';
import { normalizeBarcode } from '@/lib/barcode';

/**
 * Product reads.
 *
 * Listing pages against a growing table page in the database — the browser is
 * never sent the whole catalogue to filter client-side.
 */

export interface ProductListQuery {
  search?: string;
  categoryId?: string;
  status?: ProductStatus | 'ALL';
  page?: number;
  pageSize?: number;
  sort?: 'name' | 'sku' | 'price' | 'stock' | 'created';
  direction?: 'asc' | 'desc';
}

export interface ProductListRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  categoryName: string;
  unitAbbreviation: string;
  costPrice: number;
  sellingPrice: number;
  marginPercent: number;
  onHand: number;
  reorderLevel: number;
  status: ProductStatus;
  isTrackable: boolean;
}

export async function listProducts(query: ProductListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 20));

  const where: Prisma.ProductWhereInput = {
    ...(query.status && query.status !== 'ALL' ? { status: query.status } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.search?.trim()
      ? {
          OR: [
            { name: { contains: query.search.trim(), mode: 'insensitive' } },
            { sku: { contains: query.search.trim(), mode: 'insensitive' } },
            { barcode: { contains: query.search.trim(), mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const direction = query.direction ?? 'asc';
  const orderBy: Prisma.ProductOrderByWithRelationInput =
    query.sort === 'sku'
      ? { sku: direction }
      : query.sort === 'price'
        ? { sellingPrice: direction }
        : query.sort === 'created'
          ? { createdAt: direction }
          : { name: direction };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        imageUrl: true,
        costPrice: true,
        sellingPrice: true,
        reorderLevel: true,
        minStock: true,
        status: true,
        isTrackable: true,
        category: { select: { name: true } },
        unit: { select: { abbreviation: true } },
        inventory: { select: { quantity: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const mapped: ProductListRow[] = rows.map((row) => {
    const costPrice = toNum(row.costPrice);
    const sellingPrice = toNum(row.sellingPrice);
    const reorderLevel = toNum(row.reorderLevel) || toNum(row.minStock);

    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      imageUrl: row.imageUrl,
      categoryName: row.category.name,
      unitAbbreviation: row.unit.abbreviation,
      costPrice,
      sellingPrice,
      marginPercent: sellingPrice > 0 ? Number((((sellingPrice - costPrice) / sellingPrice) * 100).toFixed(1)) : 0,
      onHand: row.inventory.reduce((acc, i) => acc + toNum(i.quantity), 0),
      reorderLevel,
      status: row.status,
      isTrackable: row.isTrackable,
    };
  });

  return {
    rows: mapped,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Reference lists for the product form's select inputs. */
export async function getProductFormOptions() {
  const [categories, units] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.unit.findMany({
      where: { isActive: true },
      select: { id: true, name: true, abbreviation: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return { categories, units };
}

export async function getProduct(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      unit: { select: { id: true, name: true, abbreviation: true } },
      inventory: {
        select: {
          quantity: true,
          reserved: true,
          lastSoldAt: true,
          lastReceivedAt: true,
          warehouse: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Trading history for one product: recent movements, sales performance, and
 * price changes. Everything an owner needs to decide whether to keep stocking it.
 */
export async function getProductHistory(id: string, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000);

  const [movements, performance, priceHistory] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        type: true,
        quantity: true,
        balanceAfter: true,
        unitCost: true,
        note: true,
        createdAt: true,
        warehouse: { select: { name: true } },
        user: { select: { name: true } },
      },
    }),
    prisma.$queryRaw<{ unitsSold: string; revenue: string; profit: string; orders: number }[]>`
      SELECT
        COALESCE(SUM(si.quantity), 0)::text  AS "unitsSold",
        COALESCE(SUM(si.total), 0)::text     AS "revenue",
        COALESCE(SUM(si.total - si."unitCost" * si.quantity), 0)::text AS "profit",
        COUNT(DISTINCT s.id)::int            AS "orders"
      FROM sale_items si
      JOIN sales s ON s.id = si."saleId"
      WHERE si."productId" = ${id} AND s.status <> 'VOIDED' AND s."createdAt" >= ${since}
    `,
    prisma.priceHistory.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const stats = performance[0];

  return {
    movements: movements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: toNum(m.quantity),
      balanceAfter: toNum(m.balanceAfter),
      unitCost: toNum(m.unitCost),
      note: m.note,
      createdAt: m.createdAt,
      warehouseName: m.warehouse.name,
      userName: m.user?.name ?? 'System',
    })),
    performance: {
      windowDays: days,
      unitsSold: Number(stats?.unitsSold ?? 0),
      revenue: Number(stats?.revenue ?? 0),
      profit: Number(stats?.profit ?? 0),
      orders: stats?.orders ?? 0,
    },
    priceHistory: priceHistory.map((p) => ({
      id: p.id,
      field: p.field,
      oldValue: toNum(p.oldValue),
      newValue: toNum(p.newValue),
      createdAt: p.createdAt,
    })),
  };
}

export type SellableSort = 'name' | 'priceAsc' | 'priceDesc';

const SELLABLE_ORDER: Record<SellableSort, Prisma.ProductOrderByWithRelationInput> = {
  name: { name: 'asc' },
  priceAsc: { sellingPrice: 'asc' },
  priceDesc: { sellingPrice: 'desc' },
};

export interface SellableFilters {
  categoryId?: string;
  /** Stock at or under this level, and above zero — the till's "Low stock" chip. */
  lowStockAtOrBelow?: number;
  sort?: SellableSort;
}

/** Product lookup for the POS — active, sellable lines with live availability. */
export async function searchSellableProducts(term: string, limit = 24, filters: SellableFilters = {}) {
  const trimmed = term.trim();
  const warehouseId = await getDefaultWarehouseId();

  const products = await prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      // Compares stock on hand rather than availability: Prisma cannot subtract
      // `reserved` in a filter, and the till never reserves stock, so the two
      // are the same figure here.
      ...(filters.lowStockAtOrBelow != null
        ? {
            inventory: {
              some: { warehouseId, quantity: { lte: filters.lowStockAtOrBelow, gt: 0 } },
            },
          }
        : {}),
      ...(trimmed
        ? {
            OR: [
              { name: { contains: trimmed, mode: 'insensitive' } },
              { sku: { contains: trimmed, mode: 'insensitive' } },
              { barcode: { equals: trimmed } },
            ],
          }
        : {}),
    },
    orderBy: SELLABLE_ORDER[filters.sort ?? 'name'],
    take: limit,
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      imageUrl: true,
      sellingPrice: true,
      isTrackable: true,
      unit: { select: { abbreviation: true, allowDecimal: true } },
      category: { select: { name: true } },
      inventory: {
        where: { warehouseId },
        select: { quantity: true, reserved: true },
      },
    },
  });

  return products.map((p) => {
    const row = p.inventory[0];
    const available = row ? toNum(row.quantity) - toNum(row.reserved) : 0;

    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      imageUrl: p.imageUrl,
      sellingPrice: toNum(p.sellingPrice),
      isTrackable: p.isTrackable,
      unitAbbreviation: p.unit.abbreviation,
      allowDecimal: p.unit.allowDecimal,
      categoryName: p.category.name,
      available,
    };
  });
}

export type SellableProduct = Awaited<ReturnType<typeof searchSellableProducts>>[number];

export interface PosCategoryChip {
  id: string;
  name: string;
  count: number;
}

/**
 * Counts behind the till's category chips.
 *
 * Counted across the whole catalogue rather than the page of products on
 * screen, so a chip never claims a number the grid cannot produce.
 */
export async function getPosCategories(lowStockAtOrBelow: number): Promise<{
  total: number;
  lowStock: number;
  categories: PosCategoryChip[];
}> {
  const warehouseId = await getDefaultWarehouseId();

  const [total, lowStock, grouped, categories] = await Promise.all([
    prisma.product.count({ where: { status: 'ACTIVE' } }),
    prisma.product.count({
      where: {
        status: 'ACTIVE',
        inventory: { some: { warehouseId, quantity: { lte: lowStockAtOrBelow, gt: 0 } } },
      },
    }),
    prisma.product.groupBy({
      by: ['categoryId'],
      where: { status: 'ACTIVE' },
      _count: { _all: true },
    }),
    prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  const counts = new Map(grouped.map((row) => [row.categoryId, row._count._all]));

  return {
    total,
    lowStock,
    categories: categories
      .map((category) => ({ ...category, count: counts.get(category.id) ?? 0 }))
      // An empty category is noise on a till screen.
      .filter((category) => category.count > 0),
  };
}

/**
 * Finds a sellable product by barcode the way a scanner reads it.
 *
 * An EAN-13 is printed on the pack as "4 800365 221029" but scans as
 * "4800365221029", and catalogues end up holding either form depending on
 * whether the code was typed or scanned when the product was added. Comparing
 * both sides with the separators removed means a scan matches regardless.
 */
export async function findSellableByBarcode(barcode: string): Promise<SellableProduct | null> {
  const normalized = normalizeBarcode(barcode);
  if (!normalized) return null;

  const rows = await prisma.$queryRaw<{ barcode: string }[]>`
    SELECT barcode FROM products
    WHERE status = 'ACTIVE'
      AND barcode IS NOT NULL
      AND upper(regexp_replace(barcode, '[^0-9A-Za-z]', '', 'g')) = ${normalized}
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  // Hand the stored spelling back to the main query so price and stock are
  // still read in exactly one place.
  const matches = await searchSellableProducts(rows[0].barcode, 5);
  return matches.find((p) => p.barcode === rows[0].barcode) ?? null;
}

/**
 * Looks up a product by its exact barcode, so the barcode field (whether
 * typed or scanned) can warn about a duplicate before the owner saves a
 * second product for something already in the catalogue. `excludeId` lets
 * the edit form check without matching the product it's already editing.
 */
export async function findProductByBarcode(barcode: string, excludeId?: string) {
  const trimmed = barcode.trim();
  if (!trimmed) return null;

  const product = await prisma.product.findFirst({
    where: { barcode: trimmed, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: {
      id: true,
      name: true,
      sellingPrice: true,
      inventory: { select: { quantity: true } },
    },
  });
  if (!product) return null;

  return {
    id: product.id,
    name: product.name,
    sellingPrice: toNum(product.sellingPrice),
    onHand: product.inventory.reduce((sum, row) => sum + toNum(row.quantity), 0),
  };
}

export type BarcodeMatch = Awaited<ReturnType<typeof findProductByBarcode>>;
