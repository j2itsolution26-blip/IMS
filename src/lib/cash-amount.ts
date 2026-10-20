/**
 * Cash amounts typed at the till — the starting float, a counted drawer, a
 * cash-in or cash-out. Pure and dependency-free so the dialog and the server
 * apply the same rules; the server's check is the one that counts.
 */

/** Largest amount accepted for any single drawer figure. */
export const MAX_DRAWER_AMOUNT = 1_000_000;

/** One-tap starting amounts on the Open Shift dialog. */
export const QUICK_OPENING_AMOUNTS = [500, 1000, 1500, 2000] as const;

export type CashAmountResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parses a peso amount as typed: digits with up to two decimals, commas and a
 * leading ₱ allowed. `allowZero` is for counts (an empty drawer is a real
 * count); movements must be positive.
 */
export function parseCashAmount(input: unknown, { allowZero = true }: { allowZero?: boolean } = {}): CashAmountResult {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, error: 'Enter an amount in pesos.' };
    input = String(input);
  }
  if (typeof input !== 'string') return { ok: false, error: 'Enter an amount in pesos.' };

  const cleaned = input.trim().replace(/^₱\s*/, '').replace(/,/g, '');
  if (cleaned === '') return { ok: false, error: 'Enter an amount in pesos.' };
  if (cleaned.startsWith('-')) return { ok: false, error: 'The amount cannot be negative.' };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: 'Enter a peso amount with up to two decimal places, like 1000 or 1250.50.' };
  }

  const value = Number(cleaned);
  if (!allowZero && value === 0) return { ok: false, error: 'The amount must be more than ₱0.' };
  if (value > MAX_DRAWER_AMOUNT) {
    return { ok: false, error: `The amount cannot be more than ₱${MAX_DRAWER_AMOUNT.toLocaleString('en-PH')}.` };
  }
  return { ok: true, value };
}
