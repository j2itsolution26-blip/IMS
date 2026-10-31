import type { PermissionKey } from './permissions';

/**
 * "Download your data": a plain CSV of the store's own products and sales,
 * on every plan. Essential access to a store's own records is not a paid
 * feature; Excel/PDF report exports stay on Business and above.
 *
 * Pure, so the limits and permissions are unit-tested directly; the route
 * (src/app/api/data-export/[dataset]/route.ts) and the service enforce them.
 */

export type DataExportDataset = 'products' | 'sales';

export const DATA_EXPORTS: Record<DataExportDataset, { label: string; description: string; permission: PermissionKey }> = {
  products: {
    label: 'Products',
    description: 'Every product with its SKU, barcode, category, price, stock on hand and status.',
    permission: 'products.export',
  },
  sales: {
    label: 'Sales',
    description: 'Sales from the last 12 months: invoice, date, status, cashier, payment methods and totals.',
    permission: 'sales.export',
  },
};

/** The most rows one download carries. */
export const DATA_EXPORT_ROW_LIMIT = 10_000;

/** How far back the sales download reaches, in calendar months. */
export const SALES_EXPORT_MONTHS = 12;

export function parseDataExport(value: unknown): DataExportDataset | null {
  return typeof value === 'string' && Object.hasOwn(DATA_EXPORTS, value) ? (value as DataExportDataset) : null;
}

/** The start of the sales download window: the same moment `months` calendar months ago (clamped to a shorter month). */
export function salesExportStart(now: Date, months = SALES_EXPORT_MONTHS): Date {
  const start = new Date(now.getTime());
  const day = start.getUTCDate();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(day, lastDay));
  return start;
}

export function dataExportFilename(dataset: DataExportDataset, now: Date): string {
  return `${dataset}-${now.toISOString().slice(0, 10)}.csv`;
}
