/**
 * Cash put into or taken out of a drawer for anything other than a sale or a
 * refund. Pure, so the dialog, the history and the server share one set of
 * rules and the tests cover them directly.
 *
 * A movement is one authoritative row (cash_movements). The drawer, the
 * cashier's history, the shift record and the owner's reports all read that
 * same row, so nothing is counted twice:
 *
 *   expected drawer = opening + cash sales + cash in − cash refunds − cash out
 *
 * Sales, refunds, voids and discounts are separate records and never appear
 * here. Rows are append-only; a mistake is put right with a CORRECTION, an
 * opposite movement linked to the one it reverses.
 */

export type MovementType = 'CASH_IN' | 'CASH_OUT';

export type MovementCategory =
  | 'CHANGE_FUND'
  | 'OWNER_TOP_UP'
  | 'SUPPLIER_PAYMENT'
  | 'EXPENSE'
  | 'BANK_DEPOSIT'
  | 'OWNER_WITHDRAWAL'
  | 'CORRECTION'
  | 'OTHER';

export const CATEGORY_LABEL: Record<MovementCategory, string> = {
  CHANGE_FUND: 'Change fund',
  OWNER_TOP_UP: 'Owner top-up',
  SUPPLIER_PAYMENT: 'Supplier payment',
  EXPENSE: 'Store expense',
  BANK_DEPOSIT: 'Bank deposit / cash drop',
  OWNER_WITHDRAWAL: 'Owner withdrawal',
  CORRECTION: 'Correction',
  OTHER: 'Other',
};

/** What a cashier may choose for each direction. CORRECTION is only ever made by the correction action. */
export const CATEGORIES_FOR: Record<MovementType, MovementCategory[]> = {
  CASH_IN: ['CHANGE_FUND', 'OWNER_TOP_UP', 'OTHER'],
  CASH_OUT: ['SUPPLIER_PAYMENT', 'EXPENSE', 'BANK_DEPOSIT', 'OWNER_WITHDRAWAL', 'OTHER'],
};

export function isCategoryAllowed(type: MovementType, category: MovementCategory): boolean {
  return CATEGORIES_FOR[type].includes(category);
}

export const TYPE_LABEL: Record<MovementType, string> = { CASH_IN: 'Cash in', CASH_OUT: 'Cash out' };

/** CO-000123 for cash out, CI-000123 for cash in. */
export function movementReference(type: MovementType, number: number): string {
  return `${type === 'CASH_OUT' ? 'CO' : 'CI'}-${String(number).padStart(6, '0')}`;
}

/** Reads "CO-000123", "co123" or "123" back into a number, for search. */
export function parseMovementReference(value: string): number | null {
  const match = /^(?:c[io]-?)?0*(\d{1,9})$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

/** The type that undoes a movement: a correction always runs the other way. */
export function correctionTypeFor(type: MovementType): MovementType {
  return type === 'CASH_OUT' ? 'CASH_IN' : 'CASH_OUT';
}

/** Effect of a movement on the expected drawer cash, in pesos (+ adds, − takes). */
export function drawerEffect(type: MovementType, amount: number): number {
  return type === 'CASH_IN' ? amount : -amount;
}
