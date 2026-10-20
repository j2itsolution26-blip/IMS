import 'server-only';

import { prisma } from '@/lib/prisma';
import type { CategoryRow } from '@/features/catalogue/managers';

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
