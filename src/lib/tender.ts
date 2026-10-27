/**
 * Tendering at the till: the quick-cash buttons, change, and the GCash
 * reference. Pure and dependency-free so the payment dialog and its tests use
 * the same arithmetic. The server re-checks everything in exact decimals
 * (src/server/services/sale-service.ts); this only drives what the cashier sees.
 *
 * Amounts are worked in whole centavos, so ₱0.10 + ₱0.20 is exactly ₱0.30 and
 * ₱1,000.00 − ₱350.00 is exactly ₱650.00.
 */

/** Notes a customer typically hands over. ₱1,000 is a choice, never assumed. */
export const QUICK_CASH_NOTES = [20, 50, 100, 200, 500, 1000] as const;

/** Pesos to whole centavos. Non-numbers and negatives count as zero. */
export function toCentavos(value: number | string): number {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
}

export const fromCentavos = (centavos: number): number => centavos / 100;

/** The quick-cash notes that cover the total: tapping one must never leave the sale short. */
export function quickCashOptions(total: number): number[] {
  const due = toCentavos(total);
  return QUICK_CASH_NOTES.filter((note) => note * 100 >= due);
}

export interface TenderSummary {
  /** What the customer handed over (cash) or sent (GCash), in pesos. */
  received: number;
  /** Change to hand back; only cash gives change. */
  change: number;
  /** What is still unpaid. */
  outstanding: number;
  /** GCash sent for more than the total, which the till refuses. */
  overpaidNonCash: boolean;
  canComplete: boolean;
}

/**
 * Change and balance for one tender. Cash may exceed the total (the excess is
 * change); GCash must be for the exact total, since there is nothing to hand back.
 */
export function tenderSummary(input: { total: number; method: 'CASH' | 'GCASH'; received: number | string }): TenderSummary {
  const due = toCentavos(input.total);
  const received = toCentavos(input.received);
  const change = input.method === 'CASH' ? Math.max(0, received - due) : 0;
  const outstanding = Math.max(0, due - received);
  const overpaidNonCash = input.method !== 'CASH' && received > due;
  return {
    received: fromCentavos(received),
    change: fromCentavos(change),
    outstanding: fromCentavos(outstanding),
    overpaidNonCash,
    canComplete: due > 0 && outstanding === 0 && !overpaidNonCash,
  };
}

/**
 * A GCash reference as stored: spaces removed, uppercase. GCash shows a
 * 13-digit number; other wallets and banks use letters too, so 6–40 letters,
 * digits or dashes are accepted. Null when it cannot be a reference.
 */
export function normalizeGcashReference(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9-]{6,40}$/.test(cleaned) ? cleaned : null;
}

export const GCASH_REFERENCE_HINT = 'Enter the reference number shown on the GCash receipt (at least 6 letters or digits).';
