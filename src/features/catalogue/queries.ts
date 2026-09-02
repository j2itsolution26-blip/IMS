import 'server-only';

import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import type { CategoryRow, UnitRow } from '@/features/catalogue/managers';

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
