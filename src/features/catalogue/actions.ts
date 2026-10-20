'use server';

import { prisma } from '@/lib/prisma';
import { blockIfUsed, createResourceActions } from '@/server/crud/resource';
import { slugify } from '@/lib/utils';
import { categorySchema } from '@/features/catalogue/schemas';

/**
 * Reference-data actions.
 *
 * Categories use the factory in `@/server/crud/resource`, which handles the
 * permission check, validation, audit trail, and cache invalidation. The
 * delete guard and the derived slug are declared here.
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
