import { normalizeBarcode } from '@/lib/barcode';
import type { ProductUnit } from '@/lib/quantity';

/**
 * The catalogue copy a till keeps for offline selling, and the rules for
 * using it. Shared by the server (GET /api/pos/catalog builds it) and the
 * till (searches it, projects stock from it, decides whether it may sell
 * offline). Pure: no database, no `window`, so it is unit-tested directly.
 */

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
  /** How long the device may sell offline after this copy, in hours. */
  offlineAccessHours: number;
  /**
   * The latest moment the server allows offline selling on this copy: the
   * access period, cut short when the store's subscription and grace period
   * end first. Missing from copies made before it was added.
   */
  accessUntil?: string;
  /** The cashier's permissions when the copy was taken. Offline never grants more. */
  permissions?: string[];
  /** The store's idle auto-lock (minutes, 0 = off), applied to the offline till too. */
  autoLockMinutes?: number;
  /**
   * The server's fingerprint of the cashier's current PIN (null: no PIN). A
   * device whose offline unlock was set up with another PIN drops it.
   */
  pinFingerprint?: string | null;
  branch: { id: string };
  /** `name` is printed on receipts; missing from copies made before it was added. */
  user: { id: string; name?: string };
  /** The receipt header and footer, for a till opened with no connection. */
  receipt?: { name: string; address: string; phone: string; receiptFooter: string; logoUrl: string };
  /** The store's low-stock level, for the till's "Low stock" filter. */
  lowStockLevel?: number;
  openShift: { id: string; number: number; openedAt: string; openingCash: number; warehouseId: string } | null;
  categories: { id: string; name: string }[];
  products: CatalogProduct[];
  truncated: boolean;
}

/** The copy as the device stores it. */
export interface CatalogSnapshot extends Omit<OfflineCatalog, 'accessUntil'> {
  /** `${storeId}:${userId}`: one copy per cashier per store on a device. */
  key: string;
  deviceId: string;
  /** Offline selling ends at this moment unless the device reaches the server again. */
  accessUntil: string;
}

export function catalogKey(storeId: string, userId: string): string {
  return `${storeId}:${userId}`;
}

export function toSnapshot(catalog: OfflineCatalog, deviceId: string): CatalogSnapshot {
  const fetched = Date.parse(catalog.fetchedAt);
  const byPeriod = fetched + catalog.offlineAccessHours * 3_600_000;
  const capped = catalog.accessUntil ? Date.parse(catalog.accessUntil) : NaN;
  return {
    ...catalog,
    key: catalogKey(catalog.store.id, catalog.user.id),
    deviceId,
    accessUntil: new Date(Number.isFinite(capped) ? Math.min(byPeriod, capped) : byPeriod).toISOString(),
  };
}

export type OfflineReadiness =
  | { ready: true; snapshot: CatalogSnapshot }
  | { ready: false; reason: 'disabled' | 'not-prepared' | 'expired' | 'other-branch' };

export const READINESS_MESSAGE: Record<Exclude<OfflineReadiness, { ready: true }>['reason'], string> = {
  disabled: 'Offline cash sales are turned off for this store.',
  'not-prepared': 'This device has not been prepared for offline sales. Connect to the internet and open the till once.',
  expired: 'The offline access period has ended. Connect to the internet to keep selling.',
  'other-branch': 'This device was prepared for another branch. Connect to the internet to refresh it.',
};

/**
 * Whether this till may take a sale without the server, now.
 *
 * Only a copy made for this store and this cashier, for the branch of the
 * open shift, within its offline access period, and only while the owner has
 * offline selling switched on (as last seen online).
 */
export function offlineReadiness(
  snapshot: CatalogSnapshot | null | undefined,
  context: { storeId: string; userId: string; branchId: string | null; offlineMode: boolean; now: number },
): OfflineReadiness {
  if (!context.offlineMode) return { ready: false, reason: 'disabled' };
  if (!snapshot || snapshot.key !== catalogKey(context.storeId, context.userId)) return { ready: false, reason: 'not-prepared' };
  if (Date.parse(snapshot.accessUntil) <= context.now) return { ready: false, reason: 'expired' };
  if (context.branchId && snapshot.branch.id !== context.branchId) return { ready: false, reason: 'other-branch' };
  return { ready: true, snapshot };
}

/** A sale on the device, as far as stock is concerned. */
export interface DeviceSale {
  storeId: string;
  createdAt: string;
  status: string;
  items: { productId: string; quantity: number }[];
}

/**
 * Quantities the device has sold since the copy was taken: the copy's stock
 * did not include them, whether or not they have reached the server since.
 * Sales declined at the counter never happened and are not counted.
 */
export function soldSince(snapshot: Pick<CatalogSnapshot, 'fetchedAt' | 'store'>, sales: DeviceSale[]): Map<string, number> {
  const sold = new Map<string, number>();
  for (const sale of sales) {
    if (sale.storeId !== snapshot.store.id || sale.status === 'declined' || sale.createdAt <= snapshot.fetchedAt) continue;
    for (const item of sale.items) sold.set(item.productId, round3((sold.get(item.productId) ?? 0) + item.quantity));
  }
  return sold;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A product as the till's grid and basket use it (the shape of SellableProduct). */
export interface LocalSellable {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  imageUrl: string | null;
  sellingPrice: number;
  isTrackable: boolean;
  unit: ProductUnit;
  allowsDecimal: boolean;
  quantityPresets: number[];
  categoryName: string;
  available: number;
}

/** Stock is a local estimate: the copy's figure less what this device sold since. */
export function toSellable(product: CatalogProduct, sold: Map<string, number>): LocalSellable {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    imageUrl: product.imageUrl,
    sellingPrice: product.sellingPrice,
    isTrackable: product.isTrackable,
    unit: product.unit,
    allowsDecimal: product.allowsDecimal,
    quantityPresets: product.quantityPresets,
    categoryName: product.categoryName,
    available: product.isTrackable ? round3(product.stock - (sold.get(product.id) ?? 0)) : product.stock,
  };
}

export interface LocalSearchFilters {
  categoryId?: string;
  lowStockAtOrBelow?: number;
  sort?: 'name' | 'priceAsc' | 'priceDesc';
}

/** The till's search, on the device: name or SKU contains, or the exact barcode. */
export function searchCatalog(
  snapshot: Pick<CatalogSnapshot, 'products'>,
  sold: Map<string, number>,
  term: string,
  filters: LocalSearchFilters = {},
  limit = 40,
): LocalSellable[] {
  const needle = term.trim().toLowerCase();
  const rows = snapshot.products
    .filter((product) => !filters.categoryId || product.categoryId === filters.categoryId)
    .filter(
      (product) =>
        !needle ||
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        product.barcode === term.trim(),
    )
    .map((product) => toSellable(product, sold))
    .filter((product) => filters.lowStockAtOrBelow == null || (product.available > 0 && product.available <= filters.lowStockAtOrBelow));

  const sort = filters.sort ?? 'name';
  rows.sort((a, b) =>
    sort === 'priceAsc' ? a.sellingPrice - b.sellingPrice : sort === 'priceDesc' ? b.sellingPrice - a.sellingPrice : a.name.localeCompare(b.name),
  );
  return rows.slice(0, limit);
}

/**
 * A scanned or typed code, on the device: the barcode with pack spacing
 * ignored (as the server compares it), else the exact SKU. The copy holds
 * active products only, so anything else reads as not found.
 */
export function findByCode(snapshot: Pick<CatalogSnapshot, 'products'>, sold: Map<string, number>, code: string): LocalSellable | null {
  const key = normalizeBarcode(code);
  if (!key) return null;
  const product =
    snapshot.products.find((p) => p.barcodeKey === key) ?? snapshot.products.find((p) => normalizeBarcode(p.sku) === key);
  return product ? toSellable(product, sold) : null;
}
