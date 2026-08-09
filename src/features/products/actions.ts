'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { D, money, toNum } from '@/lib/decimal';
import { diff, recordAudit } from '@/server/services/audit-service';
import { notify } from '@/server/services/notification-service';
import { evaluateStockAlerts } from '@/server/services/inventory-service';
import { deleteProductImage, uploadProductImage } from '@/server/services/storage-service';
import { productSchema } from '@/features/products/schema';

const PATHS = ['/products', '/inventory', '/dashboard', '/pos'];

function invalidate(id?: string) {
  for (const path of PATHS) revalidatePath(path);
  if (id) revalidatePath(`/products/${id}`);
}

/**
 * Records a price change and raises a notification.
 *
 * Price movement is one of the few things that silently changes margin across
 * every future sale, so it gets its own history table rather than living only
 * in the generic audit diff.
 */
async function trackPriceChanges(
  productId: string,
  before: { costPrice: unknown; sellingPrice: unknown; name: string },
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

  for (const change of changes) {
    const direction = change.newValue > change.oldValue ? 'increased' : 'decreased';
    await notify({
      type: 'PRICE_CHANGE',
      title: `${change.field === 'COST' ? 'Cost' : 'Selling'} price ${direction}: ${before.name}`,
      message: `Changed from ${change.oldValue.toFixed(2)} to ${change.newValue.toFixed(2)}.`,
      link: `/products/${productId}`,
    });
  }
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
        brandId: values.brandId,
        supplierId: values.supplierId,
        costPrice: money(values.costPrice),
        sellingPrice: money(values.sellingPrice),
        taxRate: D(values.taxRate),
        minStock: D(values.minStock),
        maxStock: D(values.maxStock),
        reorderLevel: D(values.reorderLevel),
        reorderQty: D(values.reorderQty),
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
        brandId: values.brandId,
        supplierId: values.supplierId,
        costPrice: money(values.costPrice),
        sellingPrice: money(values.sellingPrice),
        taxRate: D(values.taxRate),
        minStock: D(values.minStock),
        maxStock: D(values.maxStock),
        reorderLevel: D(values.reorderLevel),
        reorderQty: D(values.reorderQty),
        status: values.status,
        isTrackable: values.isTrackable,
      },
      select: { id: true, name: true, sku: true },
    });

    await trackPriceChanges(
      id,
      { costPrice: before.costPrice, sellingPrice: before.sellingPrice, name: before.name },
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

    // Thresholds may have moved, so re-evaluate the standing stock alerts.
    const stockRows = await prisma.inventory.findMany({
      where: { productId: id },
      select: { warehouseId: true },
    });
    await Promise.all(stockRows.map((row) => evaluateStockAlerts([id], row.warehouseId)));

    // A replaced image leaves the old object orphaned in the bucket.
    if (before.imageUrl && before.imageUrl !== values.imageUrl) {
      await deleteProductImage(before.imageUrl).catch(() => undefined);
    }

    invalidate(id);
    return { id: updated.id };
  });
}

/**
 * Deletes a product, but only when it has no trading history.
 *
 * Once a product appears on a sale or a purchase order, deleting it would tear
 * a hole in every historical report. Those are discontinued instead.
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
        _count: { select: { saleItems: true, purchaseItems: true, returnItems: true } },
        inventory: { select: { quantity: true } },
      },
    });
    if (!product) throw new NotFoundError('Product');

    const { saleItems, purchaseItems, returnItems } = product._count;
    if (saleItems + purchaseItems + returnItems > 0) {
      throw new ConflictError(
        'This product has trading history and cannot be deleted. Set its status to Discontinued instead — that keeps past reports accurate.',
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
      await deleteProductImage(product.imageUrl).catch(() => undefined);
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
