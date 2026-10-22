import { D, money, toNum, type Numeric } from '@/lib/decimal';
import type { VarianceKind } from '@/lib/shift-math';

/**
 * Owner-review rules for closed shifts, kept pure so they read the same in
 * the service, the page and a unit test.
 */

export type ReviewStatus = 'NOT_REQUIRED' | 'PENDING' | 'REVIEWED';

/** What the owner sees for a shift: still open, closed and fine, or needing a look. */
export type ShiftDisplayStatus = 'OPEN' | 'CLOSED' | 'REQUIRES_REVIEW' | 'REVIEWED';

/** A tolerance from settings: never negative, never NaN. */
export function normaliseTolerance(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Whether a closed shift's variance needs the owner. A miss larger than the
 * tolerance does; anything within it, including an exact balance, does not.
 */
export function reviewStatusAtClose(difference: Numeric, tolerance: number): Exclude<ReviewStatus, 'REVIEWED'> {
  return D(difference).abs().greaterThan(D(normaliseTolerance(tolerance))) ? 'PENDING' : 'NOT_REQUIRED';
}

export function displayStatus(status: 'OPEN' | 'CLOSED', review: ReviewStatus): ShiftDisplayStatus {
  if (status === 'OPEN') return 'OPEN';
  if (review === 'PENDING') return 'REQUIRES_REVIEW';
  if (review === 'REVIEWED') return 'REVIEWED';
  return 'CLOSED';
}

/** SH-000123 — the reference staff can read out over the counter. */
export function shiftReference(number: number): string {
  return `SH-${String(number).padStart(6, '0')}`;
}

/** Accepts "SH-000123", "sh123" or "123"; null for anything else. */
export function parseShiftReference(value: string): number | null {
  const match = /^\s*(?:sh-?)?0*(\d{1,9})\s*$/i.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  return number > 0 ? number : null;
}

/**
 * The variance after the owner's corrections. The original variance is never
 * rewritten; adjustments sit beside it and this is the sum of the two.
 */
export function adjustedVariance(difference: Numeric, adjustments: Numeric[]): number {
  return toNum(money(adjustments.reduce<ReturnType<typeof D>>((total, a) => total.plus(D(a)), D(difference))));
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export type ShiftNotificationType = 'SHIFT_OPENED' | 'SHIFT_CLOSED' | 'SHIFT_SHORTAGE' | 'SHIFT_OVERAGE' | 'SHIFT_OVERDUE';

/**
 * One key per event per shift. The notifications table holds the key unique,
 * so the same event raised twice — a retried close, a repeated poll — stores
 * one notice.
 */
export function notificationKey(type: ShiftNotificationType, shiftId: string): string {
  return `${type.toLowerCase()}:${shiftId}`;
}

/** The notices a close raises: always "closed", plus shortage/overage when it needs review. */
export function closeNotificationTypes(kind: VarianceKind, review: ReviewStatus): ShiftNotificationType[] {
  const types: ShiftNotificationType[] = ['SHIFT_CLOSED'];
  if (review === 'PENDING' && kind === 'SHORTAGE') types.push('SHIFT_SHORTAGE');
  if (review === 'PENDING' && kind === 'OVERAGE') types.push('SHIFT_OVERAGE');
  return types;
}

/** True once an open shift has run past the configured limit; 0 hours turns it off. */
export function isOverdue(openedAt: Date, now: Date, overdueHours: number): boolean {
  if (!Number.isFinite(overdueHours) || overdueHours <= 0) return false;
  return now.getTime() - openedAt.getTime() >= overdueHours * 60 * 60 * 1000;
}
