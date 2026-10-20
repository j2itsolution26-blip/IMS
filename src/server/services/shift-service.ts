import 'server-only';

import type { CashMovementType, Prisma, ShiftStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { D, money, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { MAX_DRAWER_AMOUNT } from '@/lib/cash-amount';
import { cashVariance, drawerTotals, type DrawerTotals, type VarianceKind } from '@/lib/shift-math';
import { recordAudit } from '@/server/services/audit-service';

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

type Db = Prisma.TransactionClient | typeof prisma;

export interface OpenShiftSummary {
  id: string;
  openedAt: Date;
  openingCash: number;
  openingNotes: string | null;
}

const OPEN_SHIFT_SELECT = { id: true, openedAt: true, openingCash: true, openingNotes: true } as const;

function toSummary(shift: { id: string; openedAt: Date; openingCash: Numeric; openingNotes: string | null }): OpenShiftSummary {
  return { id: shift.id, openedAt: shift.openedAt, openingCash: toNum(shift.openingCash), openingNotes: shift.openingNotes };
}

export async function getOpenShift(userId: string, db: Db = prisma): Promise<OpenShiftSummary | null> {
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
  const rows =
    mode === 'update'
      ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cashier_shifts WHERE id = ${shiftId} AND status = 'OPEN' FOR UPDATE`
      : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cashier_shifts WHERE id = ${shiftId} AND status = 'OPEN' FOR SHARE`;
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
  const existing = await getOpenShift(input.userId);
  if (existing) return { shift: existing, resumed: true };

  const openingCash = validDrawerAmount(input.openingCash, 'Starting cash', { allowZero: true });
  const openingNotes = input.openingNotes?.trim() || null;

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const shift = await tx.cashierShift.create({
        data: { userId: input.userId, openingCash, openingNotes, status: 'OPEN' },
        select: OPEN_SHIFT_SELECT,
      });
      await recordAudit(
        {
          action: 'CREATE',
          entity: 'CashierShift',
          entityId: shift.id,
          summary: `Shift opened with ₱${toNum(openingCash).toFixed(2)} starting cash`,
          userId: input.userId,
        },
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
export async function computeShiftSummary(shiftId: string, openingCash: Numeric, db: Db = prisma): Promise<ShiftCloseSummary> {
  const [tendered, sales, refunds, movements] = await Promise.all([
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
    }),
    totalSales: toNum(money(sales._sum.total ?? 0)),
    transactionCount: sales._count._all,
  };
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
  const actualCash = validDrawerAmount(input.actualCash, 'Counted cash', { allowZero: true });

  return prisma.$transaction(async (tx) => {
    // Waits for any sale or movement in flight on this shift, then holds
    // new ones off until the close commits.
    if (!(await lockShiftIfOpen(tx, input.shiftId, 'update'))) {
      throw new ConflictError('This shift is already closed.');
    }
    const shift = await tx.cashierShift.findUniqueOrThrow({
      where: { id: input.shiftId },
      select: { id: true, userId: true, openingCash: true, user: { select: { name: true } } },
    });
    if (input.ownerUserId && shift.userId !== input.ownerUserId) throw new NotFoundError('Open shift');

    const summary = await computeShiftSummary(shift.id, shift.openingCash, tx);
    const { difference, kind } = cashVariance(actualCash, summary.expectedCash);

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
        notes: input.notes?.trim() || null,
      },
    });

    const byOther = input.actorId !== shift.userId;
    await recordAudit(
      {
        action: 'UPDATE',
        entity: 'CashierShift',
        entityId: shift.id,
        summary:
          `${byOther ? `Closed ${shift.user.name}'s shift` : 'Shift closed'} — expected ₱${summary.expectedCash.toFixed(2)}, ` +
          `counted ₱${toNum(actualCash).toFixed(2)}, ${kind === 'BALANCED' ? 'balanced' : `${kind.toLowerCase()} ₱${Math.abs(difference).toFixed(2)}`}`,
        userId: input.actorId,
      },
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

export async function addCashMovement(input: {
  userId: string;
  type: CashMovementType;
  amount: Numeric;
  reason: string;
}): Promise<{ id: string }> {
  const amount = validDrawerAmount(input.amount, 'The amount', { allowZero: false });
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ValidationError('Say what the cash is for.', { reason: ['Give a short reason.'] });

  const shift = await getOpenShift(input.userId);
  if (!shift) throw new ConflictError('Open a shift first.');

  return prisma.$transaction(async (tx) => {
    if (!(await lockShiftIfOpen(tx, shift.id, 'share'))) throw new ConflictError('Your shift was closed. Open a new shift first.');
    const movement = await tx.cashMovement.create({
      data: { shiftId: shift.id, type: input.type, amount, reason: reason.slice(0, 200), userId: input.userId },
      select: { id: true },
    });
    await recordAudit(
      {
        action: 'UPDATE',
        entity: 'CashierShift',
        entityId: shift.id,
        summary: `${input.type === 'CASH_IN' ? 'Cash in' : 'Cash out'} ₱${toNum(amount).toFixed(2)}: ${reason.slice(0, 120)}`,
        userId: input.userId,
      },
      tx,
    );
    return movement;
  });
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
/* Owner review                                                                */
/* -------------------------------------------------------------------------- */

export interface ShiftHistoryRow extends ShiftCloseSummary {
  id: string;
  status: ShiftStatus;
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
  movements: { id: string; type: CashMovementType; amount: number; reason: string; createdAt: Date; userName: string }[];
}

export async function listShifts(query: { userId?: string; from: Date; to: Date; page?: number; pageSize?: number }) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, query.pageSize ?? 20));
  // Every shift that overlapped the window: opened in it, or still open.
  const where: Prisma.CashierShiftWhereInput = {
    ...(query.userId ? { userId: query.userId } : {}),
    OR: [{ openedAt: { gte: query.from, lte: query.to } }, { status: 'OPEN' }],
  };

  const [rows, total, outsideShift] = await Promise.all([
    prisma.cashierShift.findMany({
      where,
      orderBy: { openedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { name: true } },
        closedBy: { select: { name: true } },
        movements: { orderBy: { createdAt: 'asc' }, include: { user: { select: { name: true } } } },
      },
    }),
    prisma.cashierShift.count({ where }),
    // Cash refunds paid while no drawer was open to take them from.
    prisma.payment.aggregate({
      where: { method: 'CASH', direction: 'OUTBOUND', shiftId: null, createdAt: { gte: query.from, lte: query.to } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const shifts: ShiftHistoryRow[] = await Promise.all(
    rows.map(async (row) => {
      // A closed shift reports what was frozen at close; an open one, live.
      const totals: ShiftCloseSummary =
        row.status === 'CLOSED' && row.expectedCash != null
          ? {
              openingCash: toNum(row.openingCash),
              cashSales: toNum(row.cashSales),
              cashRefunds: toNum(row.cashRefunds),
              cashIn: toNum(row.cashIn),
              cashOut: toNum(row.cashOut),
              expectedCash: toNum(row.expectedCash),
              totalSales: toNum(row.totalSales),
              transactionCount: row.transactionCount ?? 0,
            }
          : await computeShiftSummary(row.id, row.openingCash);
      const actual = row.actualCash == null ? null : toNum(row.actualCash);
      return {
        ...totals,
        id: row.id,
        status: row.status,
        cashierId: row.userId,
        cashierName: row.user.name,
        openedAt: row.openedAt,
        closedAt: row.closedAt,
        closedByName: row.closedBy?.name ?? null,
        openingNotes: row.openingNotes,
        closingNotes: row.notes,
        actualCash: actual,
        difference: row.difference == null ? null : toNum(row.difference),
        varianceKind: actual == null ? null : cashVariance(actual, totals.expectedCash).kind,
        movements: row.movements.map((m) => ({
          id: m.id,
          type: m.type,
          amount: toNum(m.amount),
          reason: m.reason,
          createdAt: m.createdAt,
          userName: m.user.name,
        })),
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
