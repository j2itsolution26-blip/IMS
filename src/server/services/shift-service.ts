import 'server-only';

import type { CashMovementCategory, CashMovementType, PaymentMethod, Prisma, SaleStatus, ShiftReviewStatus, ShiftStatus } from '@prisma/client';
import { CATEGORY_LABEL, correctionTypeFor, isCategoryAllowed, movementReference } from '@/lib/cash-movements';
import type { DbClient } from '@/lib/prisma';
import { getStoreContext, storeDb, storeDbForShiftClose } from '@/lib/tenant/context';
import { D, money, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { MAX_DRAWER_AMOUNT } from '@/lib/cash-amount';
import { cashVariance, drawerTotals, type DrawerTotals, type VarianceKind } from '@/lib/shift-math';
import {
  adjustedVariance,
  closeNotificationTypes,
  displayStatus,
  parseShiftReference,
  reviewStatusAtClose,
  shiftReference,
  type ShiftDisplayStatus,
} from '@/lib/shift-review';
import { endOfStoreDay, startOfStoreDay } from '@/lib/store-time';
import { formatCurrency } from '@/lib/format';
import { recordAudit } from '@/server/services/audit-service';
import { markNotificationsRead, raiseNotifications, type NewNotification } from '@/server/services/notification-service';
import { getSettings, readNumber } from '@/server/services/settings-service';

/**
 * Cashier shifts and the cash drawer.
 *
 * One OPEN shift per cashier — checked here and enforced by a partial unique
 * index, so two simultaneous "open shift" requests cannot both create one.
 * Every sale, refund and cash movement is tied to the shift whose drawer the
 * money went through (`Sale.shiftId`, `Payment.shiftId`, `CashMovement`).
 *
 * Anything that adds to a shift locks its row `FOR SHARE` and re-checks it is
 * still open; closing locks it `FOR UPDATE`. So a shift is never closed half
 * way through a sale, and nothing lands on it afterwards. Totals are frozen
 * onto the row at close, so a later void or return never rewrites a drawer
 * the cashier already reconciled.
 */

type Db = DbClient;

export interface OpenShiftSummary {
  id: string;
  number: number;
  openedAt: Date;
  openingCash: number;
  openingNotes: string | null;
}

const OPEN_SHIFT_SELECT = { id: true, number: true, openedAt: true, openingCash: true, openingNotes: true } as const;

function toSummary(shift: { id: string; number: number; openedAt: Date; openingCash: Numeric; openingNotes: string | null }): OpenShiftSummary {
  return {
    id: shift.id,
    number: shift.number,
    openedAt: shift.openedAt,
    openingCash: toNum(shift.openingCash),
    openingNotes: shift.openingNotes,
  };
}

const peso = (value: Numeric) => formatCurrency(toNum(value), 'PHP');

export async function getOpenShift(userId: string, db?: Db): Promise<OpenShiftSummary | null> {
  db ??= await storeDb();
  const shift = await db.cashierShift.findFirst({
    where: { userId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
    select: OPEN_SHIFT_SELECT,
  });
  return shift ? toSummary(shift) : null;
}

export async function requireOpenShift(userId: string): Promise<OpenShiftSummary> {
  const shift = await getOpenShift(userId);
  if (!shift) throw new ConflictError('Open a shift before taking a sale.');
  return shift;
}

/**
 * Locks a shift row for the rest of `tx` and reports whether it is still open.
 * `share` for work that adds to the shift; `update` for closing it.
 */
export async function lockShiftIfOpen(tx: Prisma.TransactionClient, shiftId: string, mode: 'share' | 'update'): Promise<boolean> {
  const { storeId } = await getStoreContext();
  const rows =
    mode === 'update'
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cashier_shifts WHERE id = ${shiftId} AND "storeId" = ${storeId} AND status = 'OPEN' FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cashier_shifts WHERE id = ${shiftId} AND "storeId" = ${storeId} AND status = 'OPEN' FOR SHARE`;
  return rows.length > 0;
}

function validDrawerAmount(value: Numeric, label: string, { allowZero }: { allowZero: boolean }) {
  const amount = money(value);
  if (amount.isNaN() || !amount.isFinite()) throw new ValidationError(`${label} must be an amount in pesos.`);
  if (amount.lessThan(0)) throw new ValidationError(`${label} cannot be negative.`);
  if (!allowZero && amount.isZero()) throw new ValidationError(`${label} must be more than ₱0.`);
  if (amount.greaterThan(MAX_DRAWER_AMOUNT)) throw new ValidationError(`${label} cannot be more than ₱${MAX_DRAWER_AMOUNT.toLocaleString('en-PH')}.`);
  return amount;
}

/**
 * Opens a shift, or returns the one already open.
 *
 * Idempotent on purpose: a double-click, a second tab, or a retry after a lost
 * response all get the existing shift back (`resumed: true`) instead of an
 * error or a duplicate. The unique index decides any race.
 */
export async function openShift(input: {
  userId: string;
  openingCash: Numeric;
  openingNotes?: string | null;
}): Promise<{ shift: OpenShiftSummary; resumed: boolean }> {
  const db = await storeDb();
  const existing = await getOpenShift(input.userId);
  if (existing) return { shift: existing, resumed: true };

  const openingCash = validDrawerAmount(input.openingCash, 'Starting cash', { allowZero: true });
  const openingNotes = input.openingNotes?.trim() || null;

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      const shift = await tx.cashierShift.create({
        data: { userId: input.userId, openingCash, openingNotes, status: 'OPEN' },
        select: { ...OPEN_SHIFT_SELECT, user: { select: { name: true } } },
      });
      const reference = shiftReference(shift.number);
      await recordAudit(
        {
          action: 'SHIFT_OPEN',
          entity: 'CashierShift',
          entityId: shift.id,
          summary: `${reference} opened with ₱${toNum(openingCash).toFixed(2)} starting cash${openingNotes ? ` — ${openingNotes.slice(0, 120)}` : ''}`,
          changes: { openingCash: openingCash.toString(), openingNotes },
          userId: input.userId,
        },
        tx,
      );
      await raiseNotifications(
        [
          {
            type: 'SHIFT_OPENED',
            shiftId: shift.id,
            href: `/shifts/${shift.id}`,
            title: `${shift.user.name} opened a shift`,
            body: `${reference} started with ${peso(openingCash)} in the drawer.`,
          },
        ],
        tx,
      );
      return shift;
    });
  } catch (error) {
    // Another request opened one between our check and our insert.
    if ((error as { code?: string }).code === 'P2002') {
      const winner = await getOpenShift(input.userId);
      if (winner) return { shift: winner, resumed: true };
    }
    throw error;
  }

  return { shift: toSummary(created), resumed: false };
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

export interface ShiftCloseSummary extends DrawerTotals {
  /** Completed (not voided) sales on the shift, all payment methods. */
  totalSales: number;
  transactionCount: number;
}

/** The live drawer figures for a shift, from the sales, payments and movements tied to it. */
export async function computeShiftSummary(shiftId: string, openingCash: Numeric, db?: Db): Promise<ShiftCloseSummary> {
  db ??= await storeDb();
  const [tendered, sales, refunds, movements, wallet] = await Promise.all([
    db.payment.aggregate({
      where: { shiftId, method: 'CASH', direction: 'INBOUND', sale: { status: { not: 'VOIDED' } } },
      _sum: { amount: true },
    }),
    db.sale.aggregate({
      where: { shiftId, status: { not: 'VOIDED' } },
      _sum: { total: true, changeAmount: true },
      _count: { _all: true },
    }),
    db.payment.aggregate({
      where: { shiftId, method: 'CASH', direction: 'OUTBOUND' },
      _sum: { amount: true },
    }),
    db.cashMovement.groupBy({ by: ['type'], where: { shiftId }, _sum: { amount: true } }),
    // GCash services still standing (a reversed one no longer counts).
    db.walletTransaction.groupBy({ by: ['type'], where: { shiftId, reversedAt: null }, _sum: { amount: true, fee: true } }),
  ]);

  const movement = (type: CashMovementType) => movements.find((m) => m.type === type)?._sum.amount ?? 0;

  return {
    ...drawerTotals({
      openingCash,
      cashTendered: tendered._sum.amount ?? 0,
      changeGiven: sales._sum.changeAmount ?? 0,
      cashIn: movement('CASH_IN'),
      cashRefunds: refunds._sum.amount ?? 0,
      cashOut: movement('CASH_OUT'),
      walletCash: walletDrawerCash(wallet),
    }),
    totalSales: toNum(money(sales._sum.total ?? 0)),
    transactionCount: sales._count._all,
  };
}

/**
 * Net drawer cash from GCash services: a cash-in adds its amount and fee, a
 * cash-out takes its amount and keeps its fee (see src/lib/wallet.ts).
 */
function walletDrawerCash(rows: { type: 'CASH_IN' | 'CASH_OUT'; _sum: { amount: Numeric | null; fee: Numeric | null } }[]): Prisma.Decimal {
  const of = (type: 'CASH_IN' | 'CASH_OUT') => rows.find((row) => row.type === type)?._sum;
  const cashIn = of('CASH_IN');
  const cashOut = of('CASH_OUT');
  return money(
    D(cashIn?.amount ?? 0)
      .plus(D(cashIn?.fee ?? 0))
      .minus(D(cashOut?.amount ?? 0))
      .plus(D(cashOut?.fee ?? 0)),
  );
}

/** Read-only preview of what closing the cashier's own shift right now would show. */
export async function previewShiftClose(userId: string): Promise<ShiftCloseSummary & { shiftId: string; openedAt: Date }> {
  const shift = await getOpenShift(userId);
  if (!shift) throw new NotFoundError('Open shift');
  return { shiftId: shift.id, openedAt: shift.openedAt, ...(await computeShiftSummary(shift.id, shift.openingCash)) };
}

/* -------------------------------------------------------------------------- */
/* Closing                                                                     */
/* -------------------------------------------------------------------------- */

export interface CloseShiftResult extends ShiftCloseSummary {
  id: string;
  actualCash: number;
  difference: number;
  varianceKind: VarianceKind;
}

async function closeShiftById(input: {
  shiftId: string;
  actorId: string;
  actualCash: Numeric;
  notes?: string | null;
  /** Restricts the close to this cashier's own shift. */
  ownerUserId?: string;
}): Promise<CloseShiftResult> {
  // Writable even when the store is read-only: an open drawer can always be closed.
  const db = await storeDbForShiftClose();
  const actualCash = validDrawerAmount(input.actualCash, 'Counted cash', { allowZero: true });
  const tolerance = readNumber(await getSettings(), 'shifts.varianceTolerance');

  return db.$transaction(async (tx) => {
    // Waits for any sale or movement in flight on this shift, then holds
    // new ones off until the close commits.
    if (!(await lockShiftIfOpen(tx, input.shiftId, 'update'))) {
      throw new ConflictError('This shift is already closed.');
    }
    const shift = await tx.cashierShift.findUniqueOrThrow({
      where: { id: input.shiftId },
      select: { id: true, number: true, userId: true, openingCash: true, user: { select: { name: true } } },
    });
    if (input.ownerUserId && shift.userId !== input.ownerUserId) throw new NotFoundError('Open shift');

    const summary = await computeShiftSummary(shift.id, shift.openingCash, tx);
    const { difference, kind } = cashVariance(actualCash, summary.expectedCash);
    const reviewStatus = reviewStatusAtClose(difference, tolerance);
    const reference = shiftReference(shift.number);
    const outcome = kind === 'BALANCED' ? 'balanced' : `${kind.toLowerCase()} ${peso(Math.abs(difference))}`;

    await tx.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: input.actorId,
        expectedCash: summary.expectedCash,
        actualCash,
        difference,
        totalSales: summary.totalSales,
        transactionCount: summary.transactionCount,
        cashSales: summary.cashSales,
        cashRefunds: summary.cashRefunds,
        cashIn: summary.cashIn,
        cashOut: summary.cashOut,
        walletCash: summary.walletCash,
        notes: input.notes?.trim() || null,
        reviewStatus,
      },
    });

    const byOther = input.actorId !== shift.userId;
    await recordAudit(
      {
        action: 'SHIFT_CLOSE',
        entity: 'CashierShift',
        entityId: shift.id,
        summary:
          `${byOther ? `Closed ${shift.user.name}'s shift ${reference}` : `${reference} closed`} — expected ₱${summary.expectedCash.toFixed(2)}, ` +
          `counted ₱${toNum(actualCash).toFixed(2)}, ${kind === 'BALANCED' ? 'balanced' : `${kind.toLowerCase()} ₱${Math.abs(difference).toFixed(2)}`}`,
        changes: { expectedCash: summary.expectedCash, actualCash: toNum(actualCash), difference, reviewStatus },
        userId: input.actorId,
      },
      tx,
    );
    if (reviewStatus === 'PENDING') {
      await recordAudit(
        {
          action: 'SHIFT_REVIEW',
          entity: 'CashierShift',
          entityId: shift.id,
          summary: `Discrepancy flagged for owner review on ${reference}: ${outcome}`,
          userId: input.actorId,
        },
        tx,
      );
    }

    await raiseNotifications(
      closeNotificationTypes(kind, reviewStatus).map((type): NewNotification => {
        const href = `/shifts/${shift.id}`;
        if (type === 'SHIFT_SHORTAGE' || type === 'SHIFT_OVERAGE') {
          return {
            type,
            shiftId: shift.id,
            href,
            title: `${reference} counted ${type === 'SHIFT_SHORTAGE' ? 'short' : 'over'} by ${peso(Math.abs(difference))}`,
            body: `${shift.user.name}'s drawer: expected ${peso(summary.expectedCash)}, counted ${peso(actualCash)}. Waiting for your review.`,
          };
        }
        return {
          type,
          shiftId: shift.id,
          href,
          title: `${shift.user.name}'s shift closed`,
          body: `${reference} closed ${outcome}${byOther ? ' by the owner' : ''}.`,
        };
      }),
      tx,
    );

    return { id: shift.id, ...summary, actualCash: toNum(actualCash), difference, varianceKind: kind };
  });
}

/** The cashier closes their own open shift. */
export async function closeShift(input: { userId: string; actualCash: Numeric; notes?: string }): Promise<CloseShiftResult> {
  const shift = await getOpenShift(input.userId);
  if (!shift) throw new NotFoundError('Open shift');
  return closeShiftById({ shiftId: shift.id, actorId: input.userId, actualCash: input.actualCash, notes: input.notes, ownerUserId: input.userId });
}

/** The owner closes a shift a cashier left open, with the cash they counted. Authorise before calling. */
export async function closeShiftForCashier(input: { shiftId: string; actorId: string; actualCash: Numeric; notes?: string }): Promise<CloseShiftResult> {
  return closeShiftById(input);
}

/* -------------------------------------------------------------------------- */
/* Cash in / cash out                                                          */
/* -------------------------------------------------------------------------- */

export interface RecordedMovement {
  id: string;
  number: number;
  reference: string;
}

/**
 * Records cash put into or taken from the cashier's own open drawer. The
 * cashier is the signed-in user, never a value from the browser. With a
 * `clientRequestId`, a doubled submit returns the movement already saved.
 */
export async function addCashMovement(input: {
  userId: string;
  type: CashMovementType;
  amount: Numeric;
  reason: string;
  category?: CashMovementCategory;
  notes?: string;
  clientRequestId?: string;
}): Promise<RecordedMovement> {
  const db = await storeDb();
  const amount = validDrawerAmount(input.amount, 'The amount', { allowZero: false });
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ValidationError('Say what the cash is for.', { reason: ['Give a short reason.'] });
  const category = input.category ?? 'OTHER';
  if (!isCategoryAllowed(input.type, category)) {
    throw new ValidationError('Choose a category for this kind of movement.', { category: ['Choose a category.'] });
  }
  const notes = input.notes?.trim() ? input.notes.trim().slice(0, 500) : null;
  const clientRequestId = input.clientRequestId?.trim() || null;

  if (clientRequestId) {
    const existing = await db.cashMovement.findFirst({ where: { clientRequestId }, select: { id: true, number: true, type: true, userId: true } });
    if (existing) {
      if (existing.userId !== input.userId) throw new ConflictError('This entry was already used. Start again.');
      return { id: existing.id, number: existing.number, reference: movementReference(existing.type, existing.number) };
    }
  }

  const shift = await getOpenShift(input.userId);
  if (!shift) throw new ConflictError('Open a shift first.');

  try {
    return await db.$transaction(async (tx) => {
      if (!(await lockShiftIfOpen(tx, shift.id, 'share'))) throw new ConflictError('Your shift was closed. Open a new shift first.');
      const movement = await tx.cashMovement.create({
        data: {
          shiftId: shift.id,
          type: input.type,
          amount,
          reason: reason.slice(0, 200),
          category,
          notes,
          clientRequestId,
          userId: input.userId,
        },
        select: { id: true, number: true },
      });
      const reference = movementReference(input.type, movement.number);
      await recordAudit(
        {
          action: 'CASH_MOVEMENT',
          entity: 'CashierShift',
          entityId: shift.id,
          changes: { movementId: movement.id, reference, type: input.type, category, amount: amount.toString() },
          summary: `${reference} ${input.type === 'CASH_IN' ? 'cash in' : 'cash out'} ₱${toNum(amount).toFixed(2)} (${CATEGORY_LABEL[category]}): ${reason.slice(0, 120)}`,
          userId: input.userId,
        },
        tx,
      );
      return { ...movement, reference };
    });
  } catch (error) {
    if (clientRequestId && isUniqueOn(error, 'clientRequestId')) {
      const existing = await db.cashMovement.findFirst({ where: { clientRequestId }, select: { id: true, number: true, type: true } });
      if (existing) return { id: existing.id, number: existing.number, reference: movementReference(existing.type, existing.number) };
    }
    throw error;
  }
}

function isUniqueOn(error: unknown, field: string): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } };
  return e?.code === 'P2002' && String(e.meta?.target ?? '').includes(field);
}

/**
 * Reverses a cash movement recorded by mistake, with an opposite movement
 * linked to it (never by editing or deleting it). Only on the shift the
 * movement belongs to while that drawer is still open — by its cashier, or by
 * the owner — and only once (unique link). After the shift has closed, the
 * owner records a shift adjustment instead.
 */
export async function correctCashMovement(input: {
  movementId: string;
  actorId: string;
  isOwner: boolean;
  reason: string;
}): Promise<RecordedMovement> {
  const db = await storeDb();
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ValidationError('Say why this is being corrected.', { reason: ['Give a short reason.'] });

  try {
    return await db.$transaction(async (tx) => {
      const original = await tx.cashMovement.findUnique({
        where: { id: input.movementId },
        select: { id: true, number: true, type: true, amount: true, category: true, shiftId: true, userId: true, correctedBy: { select: { id: true } } },
      });
      if (!original) throw new NotFoundError('Cash movement');
      if (!input.isOwner && original.userId !== input.actorId) throw new NotFoundError('Cash movement');
      if (original.category === 'CORRECTION') throw new ConflictError('A correction cannot itself be corrected. Record a new cash in or out instead.');
      if (original.correctedBy) throw new ConflictError('This movement has already been corrected.');
      if (!(await lockShiftIfOpen(tx, original.shiftId, 'share'))) {
        throw new ConflictError('That shift is closed. The owner can record a shift adjustment instead.');
      }

      const type = correctionTypeFor(original.type);
      const originalRef = movementReference(original.type, original.number);
      const movement = await tx.cashMovement.create({
        data: {
          shiftId: original.shiftId,
          type,
          amount: original.amount,
          reason: `Correction of ${originalRef}: ${reason}`.slice(0, 200),
          category: 'CORRECTION',
          correctsId: original.id,
          userId: input.actorId,
        },
        select: { id: true, number: true },
      });
      const reference = movementReference(type, movement.number);
      await recordAudit(
        {
          action: 'CASH_MOVEMENT',
          entity: 'CashierShift',
          entityId: original.shiftId,
          changes: { movementId: movement.id, reference, corrects: originalRef, type, amount: original.amount.toString() },
          summary: `${reference} corrects ${originalRef} (₱${toNum(original.amount).toFixed(2)}): ${reason.slice(0, 120)}`,
          userId: input.actorId,
        },
        tx,
      );
      return { ...movement, reference };
    });
  } catch (error) {
    if (isUniqueOn(error, 'correctsId')) throw new ConflictError('This movement has already been corrected.');
    throw error;
  }
}

/**
 * The drawer a refund paid now comes out of: the payer's own open shift, else
 * the original sale's shift if still open. Null means outside any shift — it
 * is reported separately rather than charged to a drawer that did not pay it.
 * Locks the chosen shift for the caller's transaction.
 */
export async function refundShiftFor(tx: Prisma.TransactionClient, payerId: string, saleShiftId: string | null): Promise<string | null> {
  const own = await tx.cashierShift.findFirst({ where: { userId: payerId, status: 'OPEN' }, select: { id: true } });
  for (const candidate of [own?.id, saleShiftId]) {
    if (candidate && (await lockShiftIfOpen(tx, candidate, 'share'))) return candidate;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Owner monitoring                                                            */
/* -------------------------------------------------------------------------- */

export type ShiftView = 'all' | 'open' | 'closed' | 'review';
export type DiscrepancyFilter = 'any' | 'shortage' | 'overage';
export type ShiftSort = 'opened_desc' | 'opened_asc' | 'closed_desc' | 'variance';

export interface ShiftListQuery {
  userId?: string;
  from: Date;
  to: Date;
  /** `open` and `review` ignore the dates: every open shift, every pending review. */
  view?: ShiftView;
  discrepancy?: DiscrepancyFilter;
  /** A shift reference (SH-000123) or part of a cashier's name. */
  search?: string;
  sort?: ShiftSort;
  page?: number;
  pageSize?: number;
  /** Every matching row (capped) — for exports. */
  all?: boolean;
}

export interface ShiftHistoryRow extends ShiftCloseSummary {
  id: string;
  number: number;
  reference: string;
  status: ShiftStatus;
  displayStatus: ShiftDisplayStatus;
  reviewStatus: ShiftReviewStatus;
  cashierId: string;
  cashierName: string;
  openedAt: Date;
  closedAt: Date | null;
  closedByName: string | null;
  openingNotes: string | null;
  closingNotes: string | null;
  actualCash: number | null;
  difference: number | null;
  varianceKind: VarianceKind | null;
  /** Variance after the owner's adjustments; equals `difference` when there are none. */
  adjustedDifference: number | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  /** Latest payment or cash movement on the drawer; null when nothing has happened yet. */
  lastActivityAt: Date | null;
}

export const EXPORT_ROW_LIMIT = 5000;

function shiftWhere(query: ShiftListQuery): Prisma.CashierShiftWhereInput {
  const and: Prisma.CashierShiftWhereInput[] = [];
  if (query.userId) and.push({ userId: query.userId });

  const inWindow: Prisma.CashierShiftWhereInput = { openedAt: { gte: query.from, lte: query.to } };
  switch (query.view ?? 'all') {
    case 'open':
      and.push({ status: 'OPEN' });
      break;
    case 'review':
      and.push({ reviewStatus: 'PENDING' });
      break;
    case 'closed':
      and.push({ status: 'CLOSED' }, inWindow);
      break;
    default:
      // Every shift that overlapped the window: opened in it, or still open.
      and.push({ OR: [inWindow, { status: 'OPEN' }] });
  }

  if (query.discrepancy === 'shortage') and.push({ difference: { lt: 0 } });
  else if (query.discrepancy === 'overage') and.push({ difference: { gt: 0 } });
  else if (query.discrepancy === 'any') and.push({ difference: { not: 0 } });

  const term = query.search?.trim();
  if (term) {
    const number = parseShiftReference(term);
    and.push({
      OR: [
        { user: { name: { contains: term.slice(0, 100), mode: 'insensitive' } } },
        ...(number ? [{ number }] : []),
      ],
    });
  }
  return { AND: and };
}

function shiftOrder(sort: ShiftSort | undefined): Prisma.CashierShiftOrderByWithRelationInput[] {
  switch (sort) {
    case 'opened_asc':
      return [{ openedAt: 'asc' }];
    case 'closed_desc':
      return [{ closedAt: { sort: 'desc', nulls: 'last' } }, { openedAt: 'desc' }];
    case 'variance':
      // Largest shortage first; open shifts (no count yet) last.
      return [{ difference: { sort: 'asc', nulls: 'last' } }, { openedAt: 'desc' }];
    default:
      return [{ openedAt: 'desc' }];
  }
}

/** The frozen totals of a closed shift, or live ones for an open shift. */
async function totalsFor(row: {
  id: string;
  status: ShiftStatus;
  openingCash: Numeric;
  expectedCash: Numeric | null;
  cashSales: Numeric | null;
  cashRefunds: Numeric | null;
  cashIn: Numeric | null;
  cashOut: Numeric | null;
  walletCash?: Numeric | null;
  totalSales: Numeric | null;
  transactionCount: number | null;
}): Promise<ShiftCloseSummary> {
  if (row.status === 'CLOSED' && row.expectedCash != null) {
    return {
      openingCash: toNum(row.openingCash),
      cashSales: toNum(row.cashSales),
      cashRefunds: toNum(row.cashRefunds),
      cashIn: toNum(row.cashIn),
      cashOut: toNum(row.cashOut),
      walletCash: toNum(row.walletCash ?? 0),
      expectedCash: toNum(row.expectedCash),
      totalSales: toNum(row.totalSales),
      transactionCount: row.transactionCount ?? 0,
    };
  }
  return computeShiftSummary(row.id, row.openingCash);
}

export async function listShifts(query: ShiftListQuery) {
  const db = await storeDb();
  const page = query.all ? 1 : Math.max(1, query.page ?? 1);
  const pageSize = query.all ? EXPORT_ROW_LIMIT : Math.min(50, Math.max(5, query.pageSize ?? 20));
  const where = shiftWhere(query);

  const [rows, total, outsideShift] = await Promise.all([
    db.cashierShift.findMany({
      where,
      orderBy: shiftOrder(query.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { name: true } },
        closedBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
        adjustments: { select: { amount: true } },
      },
    }),
    db.cashierShift.count({ where }),
    // Cash refunds paid while no drawer was open to take them from.
    db.payment.aggregate({
      where: { method: 'CASH', direction: 'OUTBOUND', shiftId: null, createdAt: { gte: query.from, lte: query.to } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const ids = rows.map((row) => row.id);
  const [paymentActivity, movementActivity] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db.payment.groupBy({ by: ['shiftId'], where: { shiftId: { in: ids } }, _max: { createdAt: true } }),
          db.cashMovement.groupBy({ by: ['shiftId'], where: { shiftId: { in: ids } }, _max: { createdAt: true } }),
        ]);
  const lastActivity = new Map<string, Date>();
  for (const entry of [...paymentActivity, ...movementActivity]) {
    const at = entry._max.createdAt;
    if (!entry.shiftId || !at) continue;
    const seen = lastActivity.get(entry.shiftId);
    if (!seen || at > seen) lastActivity.set(entry.shiftId, at);
  }

  const shifts: ShiftHistoryRow[] = await Promise.all(
    rows.map(async (row) => {
      const totals = await totalsFor(row);
      const actual = row.actualCash == null ? null : toNum(row.actualCash);
      const difference = row.difference == null ? null : toNum(row.difference);
      return {
        ...totals,
        id: row.id,
        number: row.number,
        reference: shiftReference(row.number),
        status: row.status,
        displayStatus: displayStatus(row.status, row.reviewStatus),
        reviewStatus: row.reviewStatus,
        cashierId: row.userId,
        cashierName: row.user.name,
        openedAt: row.openedAt,
        closedAt: row.closedAt,
        closedByName: row.closedBy?.name ?? null,
        openingNotes: row.openingNotes,
        closingNotes: row.notes,
        actualCash: actual,
        difference,
        varianceKind: actual == null ? null : cashVariance(actual, totals.expectedCash).kind,
        adjustedDifference: difference == null ? null : adjustedVariance(difference, row.adjustments.map((a) => a.amount)),
        reviewedByName: row.reviewedBy?.name ?? null,
        reviewedAt: row.reviewedAt,
        lastActivityAt: lastActivity.get(row.id) ?? null,
      };
    }),
  );

  return {
    shifts,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    refundsOutsideShift: { amount: toNum(money(D(outsideShift._sum.amount ?? 0))), count: outsideShift._count._all },
  };
}

export interface ShiftKpis {
  activeShifts: number;
  startingCashTotal: number;
  cashSalesToday: number;
  expectedDrawerCash: number;
  closedToday: number;
  pendingReview: number;
}

/** The six headline figures on Shift Management, for the store's current trading day. */
export async function getShiftKpis(now: Date = new Date()): Promise<ShiftKpis> {
  const db = await storeDb();
  const today = { gte: startOfStoreDay(now), lte: endOfStoreDay(now) };
  const [open, tendered, change, closedToday, pendingReview] = await Promise.all([
    db.cashierShift.findMany({ where: { status: 'OPEN' }, select: { id: true, openingCash: true } }),
    // Cash handed over on today's completed sales…
    db.payment.aggregate({
      where: { method: 'CASH', direction: 'INBOUND', sale: { status: { not: 'VOIDED' }, createdAt: today } },
      _sum: { amount: true },
    }),
    // …less the change given back (change only ever comes from cash).
    db.sale.aggregate({ where: { status: { not: 'VOIDED' }, createdAt: today }, _sum: { changeAmount: true } }),
    db.cashierShift.count({ where: { status: 'CLOSED', closedAt: today } }),
    db.cashierShift.count({ where: { reviewStatus: 'PENDING' } }),
  ]);

  const live = await Promise.all(open.map((shift) => computeShiftSummary(shift.id, shift.openingCash)));

  return {
    activeShifts: open.length,
    startingCashTotal: toNum(money(open.reduce((sum, shift) => sum.plus(D(shift.openingCash)), D(0)))),
    cashSalesToday: toNum(money(D(tendered._sum.amount ?? 0).minus(D(change._sum.changeAmount ?? 0)))),
    expectedDrawerCash: toNum(money(live.reduce((sum, s) => sum.plus(D(s.expectedCash)), D(0)))),
    closedToday,
    pendingReview,
  };
}

/* -------------------------------------------------------------------------- */
/* Shift report                                                                */
/* -------------------------------------------------------------------------- */

export interface ShiftDetail extends ShiftHistoryRow {
  reviewNote: string | null;
  /** For a closed shift: what the records give today, when it differs from what was frozen at close. */
  liveExpectedCash: number | null;
  sales: {
    completedCount: number;
    grossSales: number;
    discounts: number;
    tax: number;
    netSales: number;
    voidedCount: number;
    voidedTotal: number;
  };
  /** Money received on this shift's sales, by method. Cash is as tendered; change is shown separately. */
  received: { method: PaymentMethod; amount: number }[];
  changeGiven: number;
  /** Refunds paid out of this drawer, by method. */
  refunds: { method: PaymentMethod; amount: number; count: number }[];
  movements: {
    id: string;
    reference: string;
    type: CashMovementType;
    category: CashMovementCategory;
    amount: number;
    reason: string;
    notes: string | null;
    createdAt: Date;
    userName: string;
  }[];
  adjustments: { id: string; amount: number; reason: string; createdAt: Date; userName: string }[];
  transactions: {
    id: string;
    invoiceNumber: string;
    createdAt: Date;
    status: SaleStatus;
    total: number;
    cash: number;
    other: number;
  }[];
  refundRows: { id: string; returnId: string | null; returnNumber: string | null; method: PaymentMethod; amount: number; createdAt: Date }[];
  transactionsTruncated: boolean;
}

const TRANSACTION_LIMIT = 500;

export async function getShiftDetail(shiftId: string): Promise<ShiftDetail | null> {
  const db = await storeDb();
  const row = await db.cashierShift.findUnique({
    where: { id: shiftId },
    include: {
      user: { select: { name: true } },
      closedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      movements: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } },
      adjustments: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } },
    },
  });
  if (!row) return null;

  const live = await computeShiftSummary(row.id, row.openingCash);
  const totals = await totalsFor(row);
  const notVoided = { shiftId: row.id, status: { not: 'VOIDED' as const } };

  const [completed, voided, received, refunds, transactions, refundRows, lastPayment] = await Promise.all([
    db.sale.aggregate({
      where: notVoided,
      _sum: { subtotal: true, discount: true, taxAmount: true, total: true, changeAmount: true },
      _count: { _all: true },
    }),
    db.sale.aggregate({ where: { shiftId: row.id, status: 'VOIDED' }, _sum: { total: true }, _count: { _all: true } }),
    db.payment.groupBy({
      by: ['method'],
      where: { shiftId: row.id, direction: 'INBOUND', sale: { status: { not: 'VOIDED' } } },
      _sum: { amount: true },
    }),
    db.payment.groupBy({
      by: ['method'],
      where: { shiftId: row.id, direction: 'OUTBOUND' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.sale.findMany({
      where: { shiftId: row.id },
      orderBy: { createdAt: 'asc' },
      take: TRANSACTION_LIMIT + 1,
      select: {
        id: true,
        invoiceNumber: true,
        createdAt: true,
        status: true,
        total: true,
        changeAmount: true,
        payments: { where: { direction: 'INBOUND' }, select: { method: true, amount: true } },
      },
    }),
    db.payment.findMany({
      where: { shiftId: row.id, direction: 'OUTBOUND' },
      orderBy: { createdAt: 'asc' },
      take: TRANSACTION_LIMIT,
      select: { id: true, method: true, amount: true, createdAt: true, return: { select: { id: true, returnNumber: true } } },
    }),
    db.payment.aggregate({ where: { shiftId: row.id }, _max: { createdAt: true } }),
  ]);

  const actual = row.actualCash == null ? null : toNum(row.actualCash);
  const difference = row.difference == null ? null : toNum(row.difference);
  const lastMovement = row.movements.at(-1)?.createdAt ?? null;
  const lastPaymentAt = lastPayment._max.createdAt;
  const lastActivityAt = lastPaymentAt && lastMovement ? (lastPaymentAt > lastMovement ? lastPaymentAt : lastMovement) : (lastPaymentAt ?? lastMovement);

  return {
    ...totals,
    id: row.id,
    number: row.number,
    reference: shiftReference(row.number),
    status: row.status,
    displayStatus: displayStatus(row.status, row.reviewStatus),
    reviewStatus: row.reviewStatus,
    cashierId: row.userId,
    cashierName: row.user.name,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    closedByName: row.closedBy?.name ?? null,
    openingNotes: row.openingNotes,
    closingNotes: row.notes,
    actualCash: actual,
    difference,
    varianceKind: actual == null ? null : cashVariance(actual, totals.expectedCash).kind,
    adjustedDifference: difference == null ? null : adjustedVariance(difference, row.adjustments.map((a) => a.amount)),
    reviewedByName: row.reviewedBy?.name ?? null,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
    lastActivityAt,
    liveExpectedCash: row.status === 'CLOSED' && live.expectedCash !== totals.expectedCash ? live.expectedCash : null,
    sales: {
      completedCount: completed._count._all,
      grossSales: toNum(money(completed._sum.subtotal ?? 0)),
      discounts: toNum(money(completed._sum.discount ?? 0)),
      tax: toNum(money(completed._sum.taxAmount ?? 0)),
      netSales: toNum(money(completed._sum.total ?? 0)),
      voidedCount: voided._count._all,
      voidedTotal: toNum(money(voided._sum.total ?? 0)),
    },
    received: received.map((r) => ({ method: r.method, amount: toNum(money(r._sum.amount ?? 0)) })),
    changeGiven: toNum(money(completed._sum.changeAmount ?? 0)),
    refunds: refunds.map((r) => ({ method: r.method, amount: toNum(money(r._sum.amount ?? 0)), count: r._count._all })),
    movements: row.movements.map((m) => ({
      id: m.id,
      reference: movementReference(m.type, m.number),
      type: m.type,
      category: m.category,
      amount: toNum(m.amount),
      reason: m.reason,
      notes: m.notes,
      createdAt: m.createdAt,
      userName: m.user.name,
    })),
    adjustments: row.adjustments.map((a) => ({
      id: a.id,
      amount: toNum(a.amount),
      reason: a.reason,
      createdAt: a.createdAt,
      userName: a.user.name,
    })),
    transactions: transactions.slice(0, TRANSACTION_LIMIT).map((sale) => {
      const cashTendered = sale.payments.filter((p) => p.method === 'CASH').reduce((sum, p) => sum.plus(D(p.amount)), D(0));
      const other = sale.payments.filter((p) => p.method !== 'CASH').reduce((sum, p) => sum.plus(D(p.amount)), D(0));
      return {
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        createdAt: sale.createdAt,
        status: sale.status,
        total: toNum(money(sale.total)),
        cash: toNum(money(cashTendered.minus(D(sale.changeAmount)))),
        other: toNum(money(other)),
      };
    }),
    refundRows: refundRows.map((p) => ({
      id: p.id,
      returnId: p.return?.id ?? null,
      returnNumber: p.return?.returnNumber ?? null,
      method: p.method,
      amount: toNum(money(p.amount)),
      createdAt: p.createdAt,
    })),
    transactionsTruncated: transactions.length > TRANSACTION_LIMIT,
  };
}

/* -------------------------------------------------------------------------- */
/* Owner review and adjustments                                                */
/* -------------------------------------------------------------------------- */

/**
 * The owner marks a flagged shift reviewed, with what they found. Only the
 * review columns change; the count and variance stay exactly as closed (a
 * database trigger holds them). Authorise before calling.
 */
export async function reviewShift(input: { shiftId: string; actorId: string; note: string }): Promise<void> {
  const db = await storeDb();
  const note = input.note.trim();
  if (note.length < 3) throw new ValidationError('Say what you found.', { note: ['Give a short resolution note.'] });

  await db.$transaction(async (tx) => {
    const updated = await tx.cashierShift.updateMany({
      where: { id: input.shiftId, status: 'CLOSED', reviewStatus: 'PENDING' },
      data: { reviewStatus: 'REVIEWED', reviewedById: input.actorId, reviewedAt: new Date(), reviewNote: note.slice(0, 1000) },
    });
    if (updated.count === 0) {
      const shift = await tx.cashierShift.findUnique({ where: { id: input.shiftId }, select: { status: true, reviewStatus: true } });
      if (!shift) throw new NotFoundError('Shift');
      if (shift.reviewStatus === 'REVIEWED') throw new ConflictError('This shift has already been reviewed.');
      throw new ConflictError(shift.status === 'OPEN' ? 'Close the shift before reviewing it.' : 'This shift does not need a review.');
    }

    const shift = await tx.cashierShift.findUniqueOrThrow({
      where: { id: input.shiftId },
      select: { number: true, difference: true },
    });
    await recordAudit(
      {
        action: 'SHIFT_REVIEW',
        entity: 'CashierShift',
        entityId: input.shiftId,
        summary: `Reviewed ${shiftReference(shift.number)} (variance ₱${toNum(shift.difference).toFixed(2)}): ${note.slice(0, 160)}`,
        changes: { reviewStatus: { from: 'PENDING', to: 'REVIEWED' }, reviewNote: note.slice(0, 1000) },
        userId: input.actorId,
      },
      tx,
    );

    // The shortage/overage notice has been dealt with.
    const notices = await tx.notification.findMany({
      where: { shiftId: input.shiftId, type: { in: ['SHIFT_SHORTAGE', 'SHIFT_OVERAGE'] }, readAt: null },
      select: { id: true },
    });
    if (notices.length > 0) await markNotificationsRead(input.actorId, notices.map((n) => n.id), tx);
  });
}

/**
 * A correction to a closed shift's count, kept as its own record with a
 * reason, beside the original figures. Authorise before calling.
 */
export async function addShiftAdjustment(input: {
  shiftId: string;
  actorId: string;
  amount: Numeric;
  reason: string;
}): Promise<{ id: string }> {
  const db = await storeDb();
  const amount = money(input.amount);
  if (amount.isNaN() || !amount.isFinite() || amount.isZero()) {
    throw new ValidationError('Enter the amount to adjust by.', { amount: ['Enter a non-zero amount.'] });
  }
  if (amount.abs().greaterThan(MAX_DRAWER_AMOUNT)) {
    throw new ValidationError(`An adjustment cannot be more than ₱${MAX_DRAWER_AMOUNT.toLocaleString('en-PH')}.`);
  }
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ValidationError('Say why.', { reason: ['Give a reason for the adjustment.'] });

  return db.$transaction(async (tx) => {
    const shift = await tx.cashierShift.findUnique({ where: { id: input.shiftId }, select: { status: true, number: true } });
    if (!shift) throw new NotFoundError('Shift');
    if (shift.status !== 'CLOSED') throw new ConflictError('Only a closed shift can be adjusted.');

    const adjustment = await tx.shiftAdjustment.create({
      data: { shiftId: input.shiftId, amount, reason: reason.slice(0, 500), userId: input.actorId },
      select: { id: true },
    });
    await recordAudit(
      {
        action: 'SHIFT_ADJUSTMENT',
        entity: 'CashierShift',
        entityId: input.shiftId,
        summary: `Adjusted ${shiftReference(shift.number)} by ${amount.greaterThan(0) ? '+' : '−'}₱${amount.abs().toFixed(2)}: ${reason.slice(0, 160)}`,
        changes: { adjustmentId: adjustment.id, amount: amount.toString() },
        userId: input.actorId,
      },
      tx,
    );
    return adjustment;
  });
}
