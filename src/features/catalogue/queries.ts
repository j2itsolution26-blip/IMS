import 'server-only';

import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import type {
  BrandRow,
  CategoryRow,
  CustomerRow,
  SupplierRow,
  UnitRow,
  WarehouseRow,
} from '@/features/catalogue/managers';

/**
 * Reads for the reference-data screens.
 *
 * Each row carries the usage counts the delete guards enforce, so the table
 * shows why something cannot be removed before the user tries.
 */

export async function listCategories(): Promise<CategoryRow[]> {
  const rows = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      parentId: true,
      isActive: true,
      parent: { select: { name: true } },
      _count: { select: { products: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    parentId: row.parentId,
    parentName: row.parent?.name ?? null,
    productCount: row._count.products,
    isActive: row.isActive,
  }));
}

export async function listBrands(): Promise<BrandRow[]> {
  const rows = await prisma.brand.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      logoUrl: true,
      isActive: true,
      _count: { select: { products: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    logoUrl: row.logoUrl,
    productCount: row._count.products,
    isActive: row.isActive,
  }));
}

export async function listUnits(): Promise<UnitRow[]> {
  const rows = await prisma.unit.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      abbreviation: true,
      factor: true,
      allowDecimal: true,
      isActive: true,
      _count: { select: { products: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    abbreviation: row.abbreviation,
    factor: toNum(row.factor),
    allowDecimal: row.allowDecimal,
    productCount: row._count.products,
    isActive: row.isActive,
  }));
}

export async function listWarehouses(): Promise<WarehouseRow[]> {
  const [warehouses, values] = await Promise.all([
    prisma.warehouse.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, address: true, isDefault: true, isActive: true },
    }),
    // Stock value per warehouse, priced at each product's current average cost.
    prisma.$queryRaw<{ warehouseId: string; value: string; lines: number }[]>`
      SELECT
        i."warehouseId"                                    AS "warehouseId",
        COALESCE(SUM(i.quantity * p."costPrice"), 0)::text AS "value",
        COUNT(*) FILTER (WHERE i.quantity > 0)::int        AS "lines"
      FROM inventory i
      JOIN products p ON p.id = i."productId"
      GROUP BY i."warehouseId"
    `,
  ]);

  const byWarehouse = new Map(values.map((row) => [row.warehouseId, row]));

  return warehouses.map((warehouse) => {
    const stats = byWarehouse.get(warehouse.id);
    return {
      ...warehouse,
      stockValue: stats ? Number(stats.value) : 0,
      productCount: stats?.lines ?? 0,
    };
  });
}

export async function listSuppliers(): Promise<SupplierRow[]> {
  const rows = await prisma.supplier.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      contactName: true,
      email: true,
      phone: true,
      address: true,
      taxNumber: true,
      leadTimeDays: true,
      notes: true,
      isActive: true,
      purchaseOrders: {
        where: { status: { not: 'CANCELLED' } },
        select: { total: true, paidAmount: true },
      },
    },
  });

  return rows.map((row) => {
    const totalSpend = row.purchaseOrders.reduce((acc, order) => acc + toNum(order.total), 0);
    const paid = row.purchaseOrders.reduce((acc, order) => acc + toNum(order.paidAmount), 0);

    return {
      id: row.id,
      code: row.code,
      name: row.name,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      address: row.address,
      taxNumber: row.taxNumber,
      leadTimeDays: row.leadTimeDays,
      notes: row.notes,
      isActive: row.isActive,
      orderCount: row.purchaseOrders.length,
      totalSpend,
      outstanding: Math.max(0, totalSpend - paid),
    };
  });
}

export async function listCustomers(): Promise<CustomerRow[]> {
  const rows = await prisma.customer.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      taxNumber: true,
      creditLimit: true,
      notes: true,
      isActive: true,
      sales: {
        where: { status: { not: 'VOIDED' } },
        select: { total: true, createdAt: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    taxNumber: row.taxNumber,
    creditLimit: toNum(row.creditLimit),
    notes: row.notes,
    isActive: row.isActive,
    orderCount: row.sales.length,
    totalSpent: row.sales.reduce((acc, sale) => acc + toNum(sale.total), 0),
    lastPurchase: row.sales.reduce<Date | null>(
      (latest, sale) => (!latest || sale.createdAt > latest ? sale.createdAt : latest),
      null,
    ),
  }));
}
