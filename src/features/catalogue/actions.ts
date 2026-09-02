'use server';

import { prisma } from '@/lib/prisma';
import { blockIfUsed, createResourceActions } from '@/server/crud/resource';
import { slugify } from '@/lib/utils';
import { categorySchema, unitSchema } from '@/features/catalogue/schemas';

/**
 * Reference-data actions.
 *
 * Both share the factory in `@/server/crud/resource`, which handles the
 * permission check, validation, audit trail, and cache invalidation. What
 * differs per entity — the delete guard and any derived fields — is declared here.
 */

// --- Categories -------------------------------------------------------------

const categoryActions = createResourceActions({
  model: 'category',
  label: 'category',
  entity: 'Category',
  permissions: { create: 'categories.create', update: 'categories.update', delete: 'categories.delete' },
  createSchema: categorySchema,
  updateSchema: categorySchema,
  revalidate: ['/inventory', '/products', '/pos'],
  transform: (input) => ({ ...input, slug: slugify(String(input.name)) }),
  guardDelete: async (id) => {
    const [products, children] = await Promise.all([
      prisma.product.count({ where: { categoryId: id } }),
      prisma.category.count({ where: { parentId: id } }),
    ]);
    return blockIfUsed(products, 'product', 'category') ?? blockIfUsed(children, 'sub-category', 'category');
  },
});

export async function createCategory(input: unknown) {
  return categoryActions.create(input);
}
export async function updateCategory(id: string, input: unknown) {
  return categoryActions.update(id, input);
}
export async function deleteCategory(id: string) {
  return categoryActions.remove(id);
}

// --- Units ------------------------------------------------------------------

const unitActions = createResourceActions({
  model: 'unit',
  label: 'unit',
  entity: 'Unit',
  permissions: { create: 'units.create', update: 'units.update', delete: 'units.delete' },
  createSchema: unitSchema,
  updateSchema: unitSchema,
  revalidate: ['/inventory', '/products', '/pos'],
  guardDelete: async (id) =>
    blockIfUsed(await prisma.product.count({ where: { unitId: id } }), 'product', 'unit'),
});

export async function createUnit(input: unknown) {
  return unitActions.create(input);
}
export async function updateUnit(id: string, input: unknown) {
  return unitActions.update(id, input);
}
export async function deleteUnit(id: string) {
  return unitActions.remove(id);
}
