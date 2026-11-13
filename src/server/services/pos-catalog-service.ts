import 'server-only';

import type { OfflineCatalog } from '@/lib/offline-catalog';
import { getStoreContext } from '@/lib/tenant/context';
import { toNum } from '@/lib/decimal';
import { normalizeBarcode } from '@/lib/barcode';
import { getCompanyProfile, getSettings, readBoolean, readNumber } from '@/server/services/settings-service';
import { AppError } from '@/lib/errors';
import { getOpenShift } from '@/server/services/shift-service';
import { posBranchId } from '@/server/services/warehouse-service';
import { sellingEndsAt } from '@/lib/store-access';
import { currentPinFingerprint } from '@/server/services/pin-fingerprint';

/**
 * The catalogue copy a till keeps for offline selling (GET /api/pos/catalog).
 *
 * Only what the till shows and sells with: names, codes, selling prices,
 * units and this branch's stock. Never cost prices, suppliers or other
 * branches' figures. Scoped to the signed-in store and to the branch the
 * cashier sells at (their open shift's, else their operating branch).
 */

export type { CatalogProduct, OfflineCatalog } from '@/lib/offline-catalog';

/** A store with more active products than this gets the first N by name and a warning. */
export const CATALOG_PRODUCT_LIMIT = 20_000;

/** Offline selling is switched off for the store: no catalogue copy is handed out. */
export class OfflineDisabledError extends AppError {
  constructor() {
    super('Offline cash sales are turned off for this store. The owner can turn them on in Settings.', 'OFFLINE_DISABLED', 403);
  }
}

export async function getOfflineCatalog(user: { id: string; name: string; permissions: Iterable<string> }): Promise<OfflineCatalog> {
  const userId = user.id;
  const { db, storeId, access } = await getStoreContext();
  const settings = await getSettings();
  if (!readBoolean(settings, 'pos.offlineMode')) throw new OfflineDisabledError();
  const fetchedAt = new Date();
  const warehouseId = await posBranchId();

  const accessHours = readNumber(settings, 'pos.offlineAccessHours');
  const sellingEnds = sellingEndsAt(access, fetchedAt);
  const byPeriod = new Date(fetchedAt.getTime() + accessHours * 3_600_000);
  const accessUntil = sellingEnds && sellingEnds < byPeriod ? sellingEnds : byPeriod;

  const [company, openShift, categories, products, fingerprint] = await Promise.all([
    getCompanyProfile(),
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
    currentPinFingerprint(userId),
  ]);

  const truncated = products.length > CATALOG_PRODUCT_LIMIT;

  return {
    fetchedAt: fetchedAt.toISOString(),
    store: { id: storeId, name: company.name, currency: company.currency, taxRate: readNumber(settings, 'sales.defaultTaxRate') },
    offlineAccessHours: accessHours,
    accessUntil: accessUntil.toISOString(),
    permissions: [...user.permissions].filter((key) => key.startsWith('pos.') || key.startsWith('sales.')).sort(),
    autoLockMinutes: readNumber(settings, 'security.autoLockMinutes'),
    pinFingerprint: fingerprint,
    branch: { id: warehouseId },
    user: { id: userId, name: user.name },
    receipt: {
      name: company.name,
      address: company.address,
      phone: company.phone,
      receiptFooter: company.receiptFooter,
      logoUrl: company.logoUrl,
    },
    lowStockLevel: readNumber(settings, 'inventory.defaultLowStockLevel'),
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
