import 'server-only';

import type { ProductUnit } from '@prisma/client';
import { getStoreContext } from '@/lib/tenant/context';
import { toNum } from '@/lib/decimal';
import { normalizeBarcode } from '@/lib/barcode';
import { getCompanyProfile, getSettings, readNumber } from '@/server/services/settings-service';
import { getOpenShift } from '@/server/services/shift-service';
import { posBranchId } from '@/server/services/warehouse-service';

/**
 * The catalogue copy a till keeps for offline selling (GET /api/pos/catalog).
 *
 * Only what the till shows and sells with: names, codes, selling prices,
 * units and this branch's stock. Never cost prices, suppliers or other
 * branches' figures. Scoped to the signed-in store and to the branch the
 * cashier sells at (their open shift's, else their operating branch).
 */

/** A store with more active products than this gets the first N by name and a warning. */
export const CATALOG_PRODUCT_LIMIT = 20_000;

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  /** The barcode as a scanner reads it (see normalizeBarcode), for exact lookups. */
  barcodeKey: string | null;
  categoryId: string;
  categoryName: string;
  imageUrl: string | null;
  sellingPrice: number;
  isTrackable: boolean;
  unit: ProductUnit;
  allowsDecimal: boolean;
  quantityPresets: number[];
  /** On hand minus reserved at this branch when the copy was taken. */
  stock: number;
  updatedAt: string;
}

export interface OfflineCatalog {
  /** Server time the copy was taken: the device sends it back with each sale. */
  fetchedAt: string;
  store: { id: string; name: string; currency: string; taxRate: number };
  branch: { id: string };
  user: { id: string };
  openShift: { id: string; number: number; openedAt: string; openingCash: number; warehouseId: string } | null;
  categories: { id: string; name: string }[];
  products: CatalogProduct[];
  truncated: boolean;
}

export async function getOfflineCatalog(userId: string): Promise<OfflineCatalog> {
  const { db, storeId } = await getStoreContext();
  const fetchedAt = new Date();
  const warehouseId = await posBranchId();

  const [company, settings, openShift, categories, products] = await Promise.all([
    getCompanyProfile(),
    getSettings(),
    getOpenShift(userId),
    db.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      take: CATALOG_PRODUCT_LIMIT + 1,
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        imageUrl: true,
        sellingPrice: true,
        isTrackable: true,
        unit: true,
        allowsDecimal: true,
        quantityPresets: true,
        updatedAt: true,
        categoryId: true,
        category: { select: { name: true } },
        inventory: { where: { warehouseId }, select: { quantity: true, reserved: true } },
      },
    }),
  ]);

  const truncated = products.length > CATALOG_PRODUCT_LIMIT;

  return {
    fetchedAt: fetchedAt.toISOString(),
    store: { id: storeId, name: company.name, currency: company.currency, taxRate: readNumber(settings, 'sales.defaultTaxRate') },
    branch: { id: warehouseId },
    user: { id: userId },
    openShift: openShift
      ? {
          id: openShift.id,
          number: openShift.number,
          openedAt: openShift.openedAt.toISOString(),
          openingCash: openShift.openingCash,
          warehouseId: openShift.warehouseId,
        }
      : null,
    categories,
    products: products.slice(0, CATALOG_PRODUCT_LIMIT).map((product) => {
      const row = product.inventory[0];
      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        barcodeKey: product.barcode ? normalizeBarcode(product.barcode) || null : null,
        categoryId: product.categoryId,
        categoryName: product.category.name,
        imageUrl: product.imageUrl,
        sellingPrice: toNum(product.sellingPrice),
        isTrackable: product.isTrackable,
        unit: product.unit,
        allowsDecimal: product.allowsDecimal,
        quantityPresets: product.quantityPresets.map((preset) => toNum(preset)),
        stock: row ? toNum(row.quantity) - toNum(row.reserved) : 0,
        updatedAt: product.updatedAt.toISOString(),
      };
    }),
    truncated,
  };
}
