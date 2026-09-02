'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { money, toNum } from '@/lib/decimal';
import { diff, recordAudit } from '@/server/services/audit-service';
import { deleteProductImage, uploadProductImage } from '@/server/services/storage-service';
import { productSchema } from '@/features/products/schema';

const PATHS = ['/products', '/inventory', '/dashboard', '/pos'];

function invalidate(id?: string) {
  for (const path of PATHS) revalidatePath(path);
  if (id) revalidatePath(`/products/${id}`);
}

/**
 * Records a price change.
 *
 * Price movement is one of the few things that silently changes margin across
 * every future sale, so it gets its own history table rather than living only
 * in the generic audit diff.
 */
async function trackPriceChanges(
  productId: string,
  before: { costPrice: unknown; sellingPrice: unknown },
  after: { costPrice: number; sellingPrice: number },
  userId: string,
): Promise<void> {
  const changes: { field: 'COST' | 'SELLING'; oldValue: number; newValue: number }[] = [];

  const beforeCost = toNum(before.costPrice as never);
  const beforeSelling = toNum(before.sellingPrice as never);

  if (beforeCost !== after.costPrice) {
    changes.push({ field: 'COST', oldValue: beforeCost, newValue: after.costPrice });
  }
  if (beforeSelling !== after.sellingPrice) {
    changes.push({ field: 'SELLING', oldValue: beforeSelling, newValue: after.sellingPrice });
  }

  if (changes.length === 0) return;

  await prisma.priceHistory.createMany({
    data: changes.map((change) => ({
      productId,
      field: change.field,
      oldValue: money(change.oldValue),
      newValue: money(change.newValue),
      changedBy: userId,
    })),
  });
}

export async function createProduct(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize('products.create');
    const values = parseInput(productSchema, input);

    const product = await prisma.product.create({
      data: {
        name: values.name,
        sku: values.sku.toUpperCase(),
        barcode: values.barcode,
        description: values.description,
        imageUrl: values.imageUrl,
        categoryId: values.categoryId,
        unitId: values.unitId,
        costPrice: money(values.costPrice),
        sellingPrice: money(values.sellingPrice),
        minStock: values.minStock,
        maxStock: values.maxStock,
        reorderLevel: values.reorderLevel,
        reorderQty: values.reorderQty,
        status: values.status,
        isTrackable: values.isTrackable,
      },
      select: { id: true, name: true, sku: true },
    });

    await recordAudit({
      action: 'CREATE',
      entity: 'Product',
      entityId: product.id,
      summary: `Created product ${product.name} (${product.sku})`,
      userId: user.id,
    });

    invalidate(product.id);
    return { id: product.id };
  });
}

export async function updateProduct(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize('products.update');
    const values = parseInput(productSchema, input);

    const before = await prisma.product.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Product');

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: values.name,
        sku: values.sku.toUpperCase(),
        barcode: values.barcode,
        description: values.description,
        imageUrl: values.imageUrl,
        categoryId: values.categoryId,
        unitId: values.unitId,
        costPrice: money(values.costPrice),
        sellingPrice: money(values.sellingPrice),
        minStock: values.minStock,
        maxStock: values.maxStock,
        reorderLevel: values.reorderLevel,
        reorderQty: values.reorderQty,
        status: values.status,
        isTrackable: values.isTrackable,
      },
      select: { id: true, name: true, sku: true },
    });

    await trackPriceChanges(
      id,
      { costPrice: before.costPrice, sellingPrice: before.sellingPrice },
      { costPrice: values.costPrice, sellingPrice: values.sellingPrice },
      user.id,
    );

    await recordAudit({
      action: 'UPDATE',
      entity: 'Product',
      entityId: id,
      summary: `Updated product ${updated.name} (${updated.sku})`,
      changes: diff(
        { ...before, costPrice: toNum(before.costPrice), sellingPrice: toNum(before.sellingPrice) },
        {
          ...before,
          ...values,
          sku: values.sku.toUpperCase(),
        } as never,
      ),
      userId: user.id,
    });

    // A replaced image leaves the old object orphaned in the bucket.
    // Only after the new image has been saved, so a failure here can never
    // leave the product pointing at a file that no longer exists.
    if (before.imageUrl && before.imageUrl !== values.imageUrl) {
      const removal = await deleteProductImage(before.imageUrl);
      if (removal.status === 'failed') {
        console.error(`[products] replaced image for ${id} but could not remove the old object`, removal);
      }
    }

    invalidate(id);
    return { id: updated.id };
  });
}

/**
 * Archives a product instead of deleting it. Archived products drop out of
 * the POS and the default product list, but every past sale/return record
 * that references them stays intact.
 */
export async function archiveProductAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authorize('products.update');

    const product = await prisma.product.findUnique({ where: { id }, select: { name: true, sku: true } });
    if (!product) throw new NotFoundError('Product');

    await prisma.product.update({ where: { id }, data: { status: 'ARCHIVED' } });

    await recordAudit({
      action: 'UPDATE',
      entity: 'Product',
      entityId: id,
      summary: `Archived product ${product.name} (${product.sku})`,
      userId: user.id,
    });

    invalidate(id);
  });
}

/**
 * Deletes a product, but only when it has no trading history.
 *
 * Once a product appears on a sale, deleting it would tear a hole in every
 * historical report. Those are archived instead.
 */
export async function deleteProduct(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authorize('products.delete');

    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        sku: true,
        imageUrl: true,
        _count: { select: { saleItems: true, returnItems: true } },
        inventory: { select: { quantity: true } },
      },
    });
    if (!product) throw new NotFoundError('Product');

    const { saleItems, returnItems } = product._count;
    if (saleItems + returnItems > 0) {
      throw new ConflictError(
        'This product has trading history and cannot be deleted. Archive it instead — that keeps past reports accurate.',
      );
    }

    const onHand = product.inventory.reduce((acc, row) => acc + toNum(row.quantity), 0);
    if (onHand !== 0) {
      throw new ConflictError(
        `This product still holds ${onHand} unit(s) of stock. Adjust it to zero before deleting.`,
      );
    }

    await prisma.product.delete({ where: { id } });

    if (product.imageUrl) {
      const removal = await deleteProductImage(product.imageUrl);
      if (removal.status === 'failed') {
        console.error(`[products] deleted product ${id} but could not remove its image`, removal);
      }
    }

    await recordAudit({
      action: 'DELETE',
      entity: 'Product',
      entityId: id,
      summary: `Deleted product ${product.name} (${product.sku})`,
      userId: user.id,
    });

    invalidate();
  });
}

/** Handles the image upload separately so the form can preview before saving. */
export async function uploadProductImageAction(formData: FormData): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    await authorize('products.update');

    const file = formData.get('file');
    const sku = String(formData.get('sku') ?? 'product');

    if (!(file instanceof File)) {
      throw new ConflictError('No file was received.');
    }

    const url = await uploadProductImage(file, sku);
    return { url };
  });
}
