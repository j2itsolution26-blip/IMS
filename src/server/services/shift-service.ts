import 'server-only';

import { prisma } from '@/lib/prisma';
import { D, money, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { recordAudit } from '@/server/services/audit-service';

/**
 * Cashier shifts.
 *
 * One OPEN shift per cashier at a time. Every sale taken while a shift is
 * open is tagged with it (`Sale.shiftId`), so closing the shift can compute
 * exactly how much cash it should hold. Totals are snapshotted onto the
 * `CashierShift` row at close time, so a return processed later never
 * silently rewrites a drawer count the cashier already reconciled against.
 */

export interface OpenShiftSummary {
  id: string;
  openedAt: Date;
  openingCash: number;
}

export async function getOpenShift(userId: string): Promise<OpenShiftSummary | null> {
  const shift = await prisma.cashierShift.findFirst({
    where: { userId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
    select: { id: true, openedAt: true, openingCash: true },
  });
  if (!shift) return null;
  return { id: shift.id, openedAt: shift.openedAt, openingCash: toNum(shift.openingCash) };
}

export async function requireOpenShift(userId: string): Promise<OpenShiftSummary> {
  const shift = await getOpenShift(userId);
  if (!shift) throw new ConflictError('Open a shift before taking a sale.');
  return shift;
}

export async function openShift(input: { userId: string; openingCash: Numeric }): Promise<OpenShiftSummary> {
  const existing = await getOpenShift(input.userId);
  if (existing) throw new ConflictError('You already have an open shift.');

  const openingCash = money(input.openingCash);
  if (openingCash.lessThan(0)) {
    throw new ValidationError('Opening cash cannot be negative.');
  }

  const shift = await prisma.cashierShift.create({
    data: { userId: input.userId, openingCash, status: 'OPEN' },
    select: { id: true, openedAt: true, openingCash: true },
  });

  await recordAudit({
    action: 'CREATE',
    entity: 'CashierShift',
    entityId: shift.id,
    summary: `Shift opened with ${toNum(openingCash)} float`,
    userId: input.userId,
  });

  return { id: shift.id, openedAt: shift.openedAt, openingCash: toNum(shift.openingCash) };
}

export interface ShiftCloseSummary {
  openingCash: number;
  expectedCash: number;
  totalSales: number;
  transactionCount: number;
}

/** The cash math shared by the live preview and the actual close. */
async function computeShiftSummary(shiftId: string, openingCash: Numeric): Promise<ShiftCloseSummary> {
  const [cashIn, cashOut, salesAgg] = await Promise.all([
    prisma.payment.aggregate({
      where: { method: 'CASH', direction: 'INBOUND', sale: { shiftId } },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: { method: 'CASH', direction: 'OUTBOUND', return: { sale: { shiftId } } },
      _sum: { amount: true },
    }),
    prisma.sale.aggregate({
      where: { shiftId, status: { not: 'VOIDED' } },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  const cashSales = D(cashIn._sum.amount ?? 0);
  const cashRefunds = D(cashOut._sum.amount ?? 0);
  const expectedCash = money(D(openingCash).plus(cashSales).minus(cashRefunds));

  return {
    openingCash: toNum(openingCash),
    expectedCash: toNum(expectedCash),
    totalSales: toNum(money(salesAgg._sum.total ?? 0)),
    transactionCount: salesAgg._count._all,
  };
}

/** Read-only preview of what closing the shift right now would show. */
export async function previewShiftClose(userId: string): Promise<ShiftCloseSummary> {
  const shift = await prisma.cashierShift.findFirst({
    where: { userId, status: 'OPEN' },
    select: { id: true, openingCash: true },
  });
  if (!shift) throw new NotFoundError('Open shift');
  return computeShiftSummary(shift.id, shift.openingCash);
}

export interface CloseShiftResult extends ShiftCloseSummary {
  id: string;
  actualCash: number;
  difference: number;
}

export async function closeShift(input: {
  userId: string;
  actualCash: Numeric;
  notes?: string;
}): Promise<CloseShiftResult> {
  const shift = await prisma.cashierShift.findFirst({
    where: { userId: input.userId, status: 'OPEN' },
    select: { id: true, openingCash: true },
  });
  if (!shift) throw new NotFoundError('Open shift');

  const summary = await computeShiftSummary(shift.id, shift.openingCash);
  const actualCash = money(input.actualCash);
  if (actualCash.lessThan(0)) throw new ValidationError('Counted cash cannot be negative.');

  const difference = money(actualCash.minus(D(summary.expectedCash)));

  await prisma.cashierShift.update({
    where: { id: shift.id },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
      expectedCash: summary.expectedCash,
      actualCash,
      difference,
      totalSales: summary.totalSales,
      transactionCount: summary.transactionCount,
      notes: input.notes?.trim() || null,
    },
  });

  await recordAudit({
    action: 'UPDATE',
    entity: 'CashierShift',
    entityId: shift.id,
    summary: `Shift closed — expected ${summary.expectedCash}, counted ${toNum(actualCash)}, difference ${toNum(difference)}`,
    userId: input.userId,
  });

  return { id: shift.id, ...summary, actualCash: toNum(actualCash), difference: toNum(difference) };
}
