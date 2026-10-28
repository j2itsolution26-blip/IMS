/**
 * GCash cash-in / cash-out services: the store acting as a GCash agent for a
 * customer. Pure, so the POS dialog, the server and the tests share one set
 * of rules. Amounts are worked in whole centavos.
 *
 *   CASH_IN   the customer pays cash: amount + fee. The store sends `amount`
 *             to the customer from its own GCash.
 *             drawer + amount + fee        store GCash - amount
 *   CASH_OUT  the customer sends `amount` to the store's GCash. The store
 *             hands back amount - fee in cash.
 *             drawer - amount + fee        store GCash + amount
 *
 * A wallet movement is not a product sale and never appears in sales
 * figures. Only the fee is the store's income. There is no link to GCash
 * itself: the cashier records what the store's GCash app shows.
 */

export type WalletType = 'CASH_IN' | 'CASH_OUT';

export const WALLET_TYPE_LABEL: Record<WalletType, string> = { CASH_IN: 'GCash cash-in', CASH_OUT: 'GCash cash-out' };

/** Largest single transfer the till accepts. */
export const MAX_WALLET_AMOUNT = 100_000;

const cents = (pesos: number) => Math.round(pesos * 100);
const pesos = (centavos: number) => centavos / 100;

export interface WalletFigures {
  /** Cash the cashier takes from the customer (cash-in) — 0 for cash-out. */
  collectCash: number;
  /** Cash the cashier hands the customer (cash-out) — 0 for cash-in. */
  giveCash: number;
  /** Net effect on the drawer's expected cash (+ adds, − takes). */
  drawerEffect: number;
  /** Net effect on the store's GCash balance. */
  walletEffect: number;
  /** The store's income from this service. */
  revenue: number;
}

export function walletFigures(type: WalletType, amount: number, fee: number): WalletFigures {
  const a = cents(amount);
  const f = cents(fee);
  if (type === 'CASH_IN') {
    return { collectCash: pesos(a + f), giveCash: 0, drawerEffect: pesos(a + f), walletEffect: pesos(-a), revenue: pesos(f) };
  }
  return { collectCash: 0, giveCash: pesos(a - f), drawerEffect: pesos(f - a), walletEffect: pesos(a), revenue: pesos(f) };
}

/** Why an entry cannot be recorded, or null when it can. */
export function walletProblem(type: WalletType, amount: number, fee: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter the GCash amount.';
  if (amount > MAX_WALLET_AMOUNT) return `The amount cannot be more than ₱${MAX_WALLET_AMOUNT.toLocaleString('en-PH')}.`;
  if (!Number.isFinite(fee) || fee < 0) return 'The fee cannot be negative.';
  if (cents(amount) / 100 !== amount || cents(fee) / 100 !== fee) return 'Use at most two decimal places.';
  if (type === 'CASH_OUT' && fee >= amount) return 'For a cash-out the fee must be less than the amount.';
  if (fee > amount) return 'The fee cannot be more than the amount.';
  return null;
}

/** GC-000123. */
export function walletReference(number: number): string {
  return `GC-${String(number).padStart(6, '0')}`;
}

/** Only the last four digits of the customer's number are ever kept. */
export function lastFourDigits(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Plain-language instruction for the cashier, shown before confirming. */
export function walletInstruction(type: WalletType, amount: number, fee: number, format: (n: number) => string): string {
  const f = walletFigures(type, amount, fee);
  return type === 'CASH_IN'
    ? `Collect ${format(f.collectCash)} cash from the customer, then send ${format(amount)} to them from the store GCash.`
    : `Check that ${format(amount)} arrived in the store GCash, then give the customer ${format(f.giveCash)} cash.`;
}
