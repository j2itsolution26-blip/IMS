import { endOfStoreDay, startOfStoreDay } from '@/lib/store-time';

/**
 * The period a cashier's "Cash collected" figure covers.
 *
 * While a shift is open it is that shift — the drawer the cashier will count
 * at close. With no shift open it falls back to the cashier's own takings for
 * the store day, so the card still answers "what have I taken today?".
 */
export type CashierCashWindow =
  | { kind: 'shift'; shiftId: string; since: Date }
  | { kind: 'day'; from: Date; to: Date };

export function cashierCashWindow(
  shift: { id: string; openedAt: Date } | null,
  now: Date = new Date(),
): CashierCashWindow {
  if (shift) return { kind: 'shift', shiftId: shift.id, since: shift.openedAt };
  return { kind: 'day', from: startOfStoreDay(now), to: endOfStoreDay(now) };
}
