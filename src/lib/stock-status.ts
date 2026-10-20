/**
 * Stock bands for the inventory dashboard.
 *
 * Three mutually exclusive bands, so every tracked product is counted exactly
 * once and the bands add up to the catalogue:
 *
 *   Out of stock — nothing available (available <= 0)
 *   Low stock    — some available, at or below its low-stock level
 *   In stock     — above its low-stock level, or no level is set
 *
 * The threshold is the product's reorder level, falling back to its minimum
 * stock — the same rule the inventory register and its SQL filters use.
 */

export type StockBand = 'OUT' | 'LOW' | 'IN';

export function stockThreshold(reorderLevel: number, minStock: number): number {
  return reorderLevel > 0 ? reorderLevel : minStock;
}

export function stockBand(available: number, threshold: number): StockBand {
  if (available <= 0) return 'OUT';
  if (threshold > 0 && available <= threshold) return 'LOW';
  return 'IN';
}

/**
 * How many pieces to restock, from what the product is configured with — or
 * null when nothing is configured. No target is ever invented.
 *
 *   1. The reorder quantity, when one is set.
 *   2. Otherwise, enough to fill up to the maximum stock, when one is set.
 */
export function suggestedRestock({
  available,
  reorderQty,
  maxStock,
}: {
  available: number;
  reorderQty: number;
  maxStock: number;
}): number | null {
  if (reorderQty > 0) return Math.ceil(reorderQty);
  if (maxStock > 0) {
    const gap = Math.ceil(maxStock - Math.max(0, available));
    return gap > 0 ? gap : null;
  }
  return null;
}
