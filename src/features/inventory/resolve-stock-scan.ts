import { normalizeBarcode } from '@/lib/barcode';
import { lookupInventoryBarcode } from '@/features/inventory/actions';
import type { StockPickerProduct } from '@/features/inventory/queries';
import type { ScanFeedback } from '@/features/scanner/scanner-panel';

/**
 * Turns a scanned code into a stock-holding product for receiving or
 * counting, or into the message explaining why it can't be one.
 *
 * Products already on screen are matched locally (barcode or SKU, separators
 * ignored, leading zeros kept); anything else costs one server lookup, and the
 * answer is remembered in `cache` so scanning the same pack again — as you do
 * when counting units — never repeats the request.
 */
export async function resolveStockScan(
  code: string,
  {
    local = [],
    cache,
    verb,
  }: {
    local?: StockPickerProduct[];
    cache: Map<string, StockPickerProduct>;
    verb: 'received' | 'counted';
  },
): Promise<{ ok: true; product: StockPickerProduct } | { ok: false; feedback: ScanFeedback }> {
  const key = normalizeBarcode(code);
  if (!key) return { ok: false, feedback: { tone: 'error', title: 'That barcode could not be read.' } };

  const cached = cache.get(key);
  if (cached) return { ok: true, product: cached };

  const onScreen =
    local.find((p) => p.barcode && normalizeBarcode(p.barcode) === key) ??
    local.find((p) => normalizeBarcode(p.sku) === key);
  if (onScreen) {
    cache.set(key, onScreen);
    return { ok: true, product: onScreen };
  }

  const result = await lookupInventoryBarcode(code);
  if (!result.ok) return { ok: false, feedback: { tone: 'error', title: result.error } };
  if (result.data.status === 'not-found') {
    return { ok: false, feedback: { tone: 'error', title: 'Product not found' } };
  }

  const { product } = result.data;
  if (product.productStatus !== 'ACTIVE') {
    return {
      ok: false,
      feedback: {
        tone: 'warning',
        title: `${product.name} is ${product.productStatus.toLowerCase()} and can't be ${verb}.`,
      },
    };
  }
  if (!product.isTrackable) {
    return {
      ok: false,
      feedback: { tone: 'warning', title: `${product.name} doesn't keep a stock count.` },
    };
  }

  cache.set(key, product);
  return { ok: true, product };
}
