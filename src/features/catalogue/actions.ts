'use server';

import { storeDb } from '@/lib/tenant/context';
import { blockIfUsed, createResourceActions } from '@/server/crud/resource';
import { slugify } from '@/lib/utils';
import { categorySchema } from '@/features/catalogue/schemas';
import { revalidatePath } from 'next/cache';
import { authorize } from '@/lib/session';
import { runAction, type ActionResult } from '@/lib/action';
import { recordAudit } from '@/server/services/audit-service';
import { requireWritable } from '@/server/services/entitlements';
import { CATEGORY_TEMPLATES, missingTemplates } from '@/lib/category-templates';

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
    const db = await storeDb();
    const [products, children] = await Promise.all([
      db.product.count({ where: { categoryId: id } }),
      db.category.count({ where: { parentId: id } }),
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

// --- Suggested categories ------------------------------------------------------

/**
 * Adds the suggested sari-sari categories the store does not have yet. Names
 * the store already uses (or a common alias of them) are skipped, and the
 * per-store unique name and slug make a repeated click harmless.
 */
export async function addSuggestedCategories(): Promise<ActionResult<{ added: string[]; skipped: number }>> {
  return runAction(async () => {
    const user = await authorize('categories.create');
    await requireWritable();
    const db = await storeDb();
    const existing = await db.category.findMany({ select: { name: true } });
    const missing = missingTemplates(existing.map((category) => category.name));

    const added: string[] = [];
    for (const template of missing) {
      const result = await db.category.createMany({
        data: [{ name: template.name, slug: slugify(template.name), description: template.description }],
        skipDuplicates: true,
      });
      if (result.count > 0) added.push(template.name);
    }

    if (added.length > 0) {
      await recordAudit({
        action: 'CREATE',
        entity: 'Category',
        summary: `Added suggested categories: ${added.join(', ')}`,
        userId: user.id,
      });
    }
    revalidatePath('/products/categories');
    revalidatePath('/products');
    revalidatePath('/pos');
    return { added, skipped: CATEGORY_TEMPLATES.length - added.length };
  });
}
