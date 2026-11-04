import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DUPLICATE_ADJUSTMENT_WINDOW_MS,
  adjustmentPreview,
  isDuplicateAdjustment,
  matchesTransaction,
  salePaymentKind,
  shiftTimeline,
  varianceKindOf,
  varianceTone,
} from '@/lib/shift-detail';

/* ---------------------------------------------------------- payment kind */

test('a sale paid one way shows that method; several methods show as split', () => {
  assert.equal(salePaymentKind(['CASH']), 'CASH');
  assert.equal(salePaymentKind(['GCASH', 'GCASH']), 'GCASH');
  assert.equal(salePaymentKind(['CASH', 'GCASH']), 'SPLIT');
  assert.equal(salePaymentKind(['BANK_TRANSFER']), 'OTHER');
  assert.equal(salePaymentKind([]), 'NONE');
});

/* -------------------------------------------------------------- timeline */

const base = {
  openedAt: new Date('2026-11-02T13:16:00Z'),
  cashierName: 'Joy Cruz',
  openingNotes: null,
  closedAt: null as Date | null,
  closedByName: null as string | null,
  closingNotes: null,
  reviewStatus: 'NOT_REQUIRED' as const,
  reviewedAt: null as Date | null,
  reviewedByName: null as string | null,
  reviewNote: null as string | null,
  adjustments: [] as { id: string; amount: number; reason: string; createdAt: Date; userName: string }[],
};

test('an open shift has only its opening in the history; nothing is invented', () => {
  const events = shiftTimeline(base);
  assert.deepEqual(events.map((e) => e.type), ['OPENED']);
  assert.equal(events[0].actor, 'Joy Cruz');
});

test('history lists close, adjustments and review in time order from the records', () => {
  const events = shiftTimeline({
    ...base,
    closedAt: new Date('2026-11-02T13:24:00Z'),
    closedByName: 'Joy Cruz',
    reviewStatus: 'REVIEWED' as never,
    reviewedAt: new Date('2026-11-02T14:02:00Z'),
    reviewedByName: 'Maria Sulslan',
    reviewNote: 'Miscount',
    adjustments: [{ id: 'a1', amount: -400, reason: 'GCash cash-in rung as sale', createdAt: new Date('2026-11-02T14:00:00Z'), userName: 'Maria Sulslan' }],
  });
  assert.deepEqual(events.map((e) => e.type), ['OPENED', 'CLOSED', 'ADJUSTMENT', 'REVIEWED']);
  assert.equal(events[2].amount, -400);
  assert.equal(events[3].note, 'Miscount');
});

test('a review is never shown unless the shift is marked reviewed with a timestamp', () => {
  const pending = shiftTimeline({ ...base, closedAt: new Date('2026-11-02T13:24:00Z'), reviewStatus: 'PENDING' as never, reviewNote: 'draft' });
  assert.ok(!pending.some((e) => e.type === 'REVIEWED'));
  const noStamp = shiftTimeline({ ...base, reviewStatus: 'REVIEWED' as never, reviewedAt: null });
  assert.ok(!noStamp.some((e) => e.type === 'REVIEWED'));
});

/* ---------------------------------------------------------- transactions */

const sale = { reference: 'INV-000031', total: 725.25, payment: 'CASH' as const, isVoided: false, isRefund: false };
const gcash = { reference: 'INV-000032', total: 645, payment: 'GCASH' as const, isVoided: false, isRefund: false };
const refund = { reference: 'RET-000004', total: -120, payment: 'CASH' as const, isVoided: false, isRefund: true };
const voided = { reference: 'INV-000033', total: 50, payment: 'CASH' as const, isVoided: true, isRefund: false };

test('transactions match by receipt number or amount', () => {
  assert.ok(matchesTransaction(sale, 'inv-000031', 'all'));
  assert.ok(matchesTransaction(sale, '31', 'all'));
  assert.ok(matchesTransaction(sale, '725.25', 'all'));
  assert.ok(matchesTransaction(sale, '₱725', 'all'));
  assert.ok(!matchesTransaction(gcash, '725', 'all'));
  assert.ok(matchesTransaction(refund, '120', 'all'), 'a refund matches without its minus sign');
  assert.ok(matchesTransaction(sale, '', 'all'));
});

test('the payment filter keeps refunds and voided sales in their own views', () => {
  assert.ok(matchesTransaction(sale, '', 'CASH'));
  assert.ok(!matchesTransaction(gcash, '', 'CASH'));
  assert.ok(!matchesTransaction(refund, '', 'CASH'), 'a cash refund is not a cash sale');
  assert.ok(matchesTransaction(refund, '', 'REFUND'));
  assert.ok(matchesTransaction(voided, '', 'VOIDED'));
  assert.ok(!matchesTransaction(sale, '', 'VOIDED'));
});

/* ----------------------------------------------------- variance & adjust */

test('variance colour: green balanced, amber over or short, neutral before the count', () => {
  assert.equal(varianceTone('BALANCED'), 'success');
  assert.equal(varianceTone('OVERAGE'), 'warning');
  assert.equal(varianceTone('SHORTAGE'), 'warning');
  assert.equal(varianceTone(null), 'neutral');
  assert.equal(varianceKindOf(-20), 'SHORTAGE');
  assert.equal(varianceKindOf(400), 'OVERAGE');
  assert.equal(varianceKindOf(0), 'BALANCED');
  assert.equal(varianceKindOf(null), null);
});

test('the opening always leads the history, even if a later record carries an earlier clock time', () => {
  const events = shiftTimeline({ ...base, closedAt: new Date(base.openedAt.getTime() - 1000) });
  assert.deepEqual(events.map((e) => e.type), ['OPENED', 'CLOSED']);
});

test('the adjustment preview adds to the variance without touching the original', () => {
  assert.deepEqual(adjustmentPreview(400, [], -400), { current: 400, after: 0 });
  assert.deepEqual(adjustmentPreview(-20.1, [10.05], 10.05), { current: -10.05, after: 0 });
  assert.deepEqual(adjustmentPreview(400, [], null), { current: 400, after: null });
});

test('the same adjustment from the same owner within a minute is a retry, not a new entry', () => {
  const now = new Date('2026-11-02T14:00:30Z');
  const recent = [{ amount: '-400.0000', reason: 'Miscount ', userId: 'u1', createdAt: new Date('2026-11-02T14:00:00Z') }];
  assert.ok(isDuplicateAdjustment(recent, { amount: -400, reason: 'Miscount', userId: 'u1' }, now));
  assert.ok(!isDuplicateAdjustment(recent, { amount: -400, reason: 'Miscount', userId: 'u2' }, now), 'another owner');
  assert.ok(!isDuplicateAdjustment(recent, { amount: 400, reason: 'Miscount', userId: 'u1' }, now), 'another amount');
  assert.ok(!isDuplicateAdjustment(recent, { amount: -400, reason: 'Found coin', userId: 'u1' }, now), 'another reason');
  const later = new Date(recent[0].createdAt.getTime() + DUPLICATE_ADJUSTMENT_WINDOW_MS);
  assert.ok(!isDuplicateAdjustment(recent, { amount: -400, reason: 'Miscount', userId: 'u1' }, later), 'after the window');
});
