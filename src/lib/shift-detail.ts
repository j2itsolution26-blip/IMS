import { D, money, toNum, type Numeric } from '@/lib/decimal';
import type { VarianceKind } from '@/lib/shift-math';
import type { ReviewStatus } from '@/lib/shift-review';

/**
 * Pure helpers for the shift report page: how a sale was paid, the shift's
 * history, the transaction filter and the adjustment preview. Kept free of the
 * database so the page, the print layout and a unit test read them the same.
 */

export type PaymentKind = 'CASH' | 'GCASH' | 'CARD' | 'OTHER';
/** How one sale was paid: a single method, several (split), or nothing recorded. */
export type SalePaymentKind = PaymentKind | 'SPLIT' | 'NONE';

export const PAYMENT_KIND_LABEL: Record<SalePaymentKind, string> = {
  CASH: 'Cash',
  GCASH: 'GCash',
  CARD: 'Card',
  OTHER: 'Other',
  SPLIT: 'Split',
  NONE: '—',
};

export function salePaymentKind(methods: readonly string[]): SalePaymentKind {
  const distinct = [...new Set(methods)];
  if (distinct.length === 0) return 'NONE';
  if (distinct.length > 1) return 'SPLIT';
  const only = distinct[0];
  return only === 'CASH' || only === 'GCASH' || only === 'CARD' ? only : 'OTHER';
}

/* -------------------------------------------------------------------------- */
/* History                                                                     */
/* -------------------------------------------------------------------------- */

export type TimelineEventType = 'OPENED' | 'CLOSED' | 'ADJUSTMENT' | 'REVIEWED';

export interface TimelineEvent {
  key: string;
  type: TimelineEventType;
  at: Date;
  actor: string | null;
  /** Free text recorded with the event: notes, a reason or the review resolution. */
  note: string | null;
  /** Signed amount, for adjustments. */
  amount?: number;
}

/**
 * The shift's history from its own records only: opened, closed, each
 * adjustment and the review. An event without a timestamp in the database is
 * left out, never guessed.
 */
export function shiftTimeline(shift: {
  openedAt: Date;
  cashierName: string;
  openingNotes: string | null;
  closedAt: Date | null;
  closedByName: string | null;
  closingNotes: string | null;
  reviewStatus: ReviewStatus;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  adjustments: { id: string; amount: number; reason: string; createdAt: Date; userName: string }[];
}): TimelineEvent[] {
  const events: TimelineEvent[] = [
    { key: 'opened', type: 'OPENED', at: shift.openedAt, actor: shift.cashierName, note: shift.openingNotes || null },
  ];
  if (shift.closedAt) {
    events.push({ key: 'closed', type: 'CLOSED', at: shift.closedAt, actor: shift.closedByName, note: shift.closingNotes || null });
  }
  for (const a of shift.adjustments) {
    events.push({ key: `adj-${a.id}`, type: 'ADJUSTMENT', at: a.createdAt, actor: a.userName, note: a.reason, amount: a.amount });
  }
  if (shift.reviewStatus === 'REVIEWED' && shift.reviewedAt) {
    events.push({ key: 'reviewed', type: 'REVIEWED', at: shift.reviewedAt, actor: shift.reviewedByName, note: shift.reviewNote || null });
  }
  // Opening always comes first; the rest in time order, ties keeping the order above.
  const [opened, ...rest] = events;
  return [
    opened,
    ...rest
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.at.getTime() - b.event.at.getTime() || a.index - b.index)
      .map(({ event }) => event),
  ];
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                                */
/* -------------------------------------------------------------------------- */

export type TransactionFilter = 'all' | SalePaymentKind | 'VOIDED' | 'REFUND';

export interface FilterableTransaction {
  reference: string;
  /** Amount shown in the table; refunds are negative. */
  total: number;
  payment: SalePaymentKind;
  isVoided: boolean;
  isRefund: boolean;
}

/**
 * Matches a receipt or return number, or an amount ("725", "725.25",
 * "₱1,370.25"). A refund matches its amount without the minus sign.
 */
export function matchesTransaction(row: FilterableTransaction, search: string, filter: TransactionFilter): boolean {
  if (filter === 'VOIDED' && !row.isVoided) return false;
  if (filter === 'REFUND' && !row.isRefund) return false;
  if (filter !== 'all' && filter !== 'VOIDED' && filter !== 'REFUND' && (row.isRefund || row.payment !== filter)) return false;

  const term = search.trim().toLowerCase();
  if (!term) return true;
  if (row.reference.toLowerCase().includes(term)) return true;
  const numeric = term.replace(/[₱,\s]/g, '');
  if (/^-?\d+(\.\d{0,2})?$/.test(numeric)) {
    const amount = Math.abs(row.total).toFixed(2);
    const wanted = numeric.replace(/^-/, '');
    return amount === Number(wanted).toFixed(2) || amount.startsWith(wanted);
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Variance and adjustments                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The colour of a variance on the owner's report: green when balanced, amber
 * when it missed (attention), neutral when there is no count yet. Words always
 * accompany the colour.
 */
export type VarianceTone = 'neutral' | 'success' | 'warning';

/** Over / short / balanced from a stored difference (counted − expected); null before the count. */
export function varianceKindOf(difference: number | null): VarianceKind | null {
  if (difference == null) return null;
  return difference === 0 ? 'BALANCED' : difference > 0 ? 'OVERAGE' : 'SHORTAGE';
}

export function varianceTone(kind: VarianceKind | null): VarianceTone {
  if (kind == null) return 'neutral';
  return kind === 'BALANCED' ? 'success' : 'warning';
}

/** The variance today, after existing adjustments, and after a proposed one. */
export function adjustmentPreview(
  difference: Numeric,
  existing: Numeric[],
  proposed: Numeric | null,
): { current: number; after: number | null } {
  const current = existing.reduce<ReturnType<typeof D>>((sum, a) => sum.plus(D(a)), D(difference));
  return {
    current: toNum(money(current)),
    after: proposed == null ? null : toNum(money(current.plus(D(proposed)))),
  };
}

/** How long an identical adjustment is treated as a retry of the first. */
export const DUPLICATE_ADJUSTMENT_WINDOW_MS = 60_000;

/**
 * True when the same owner already recorded the same amount and reason on this
 * shift moments ago — a resubmitted form or a network retry, not a new entry.
 */
export function isDuplicateAdjustment(
  recent: { amount: Numeric; reason: string; userId: string; createdAt: Date }[],
  candidate: { amount: Numeric; reason: string; userId: string },
  now: Date,
  windowMs = DUPLICATE_ADJUSTMENT_WINDOW_MS,
): boolean {
  const reason = candidate.reason.trim();
  return recent.some(
    (a) =>
      a.userId === candidate.userId &&
      a.reason.trim() === reason &&
      money(a.amount).equals(money(candidate.amount)) &&
      now.getTime() - a.createdAt.getTime() < windowMs,
  );
}
