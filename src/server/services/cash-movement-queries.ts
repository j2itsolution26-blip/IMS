import 'server-only';

import type { CashMovementCategory, CashMovementType, Prisma } from '@prisma/client';
import { storeDb } from '@/lib/tenant/context';
import { D, money, toNum } from '@/lib/decimal';
import { movementReference, parseMovementReference } from '@/lib/cash-movements';
import { parseShiftReference, shiftReference } from '@/lib/shift-review';

/**
 * Cash in / cash out history, read from the one cash_movements table the
 * drawer maths also uses — so the history, the shift record and the owner's
 * figures always agree.
 *
 * `userId` limits the rows to one cashier. The page passes the signed-in
 * cashier's own id unless they hold the financial permission, so a cashier
 * never sees anyone else's movements.
 */

export interface CashMovementQuery {
  userId?: string;
  shiftId?: string;
  type?: CashMovementType;
  category?: CashMovementCategory;
  /** CO-000123, a shift reference SH-000123, or words from the reason. */
  search?: string;
  from: Date;
  to: Date;
  page?: number;
  pageSize?: number;
}

export interface CashMovementRow {
  id: string;
  reference: string;
  type: CashMovementType;
  category: CashMovementCategory;
  amount: number;
  reason: string;
  notes: string | null;
  createdAt: Date;
  cashier: { id: string; name: string; isActive: boolean };
  shift: { id: string; reference: string; open: boolean };
  /** The movement this one reverses. */
  corrects: { id: string; reference: string } | null;
  /** The movement that reversed this one. */
  correctedBy: { id: string; reference: string; createdAt: Date } | null;
}

export interface CashMovementPage {
  rows: CashMovementRow[];
  total: number;
  page: number;
  pageCount: number;
  summary: { cashOut: number; cashOutCount: number; cashIn: number; cashInCount: number; net: number };
}

const SELECT = {
  id: true,
  number: true,
  type: true,
  category: true,
  amount: true,
  reason: true,
  notes: true,
  createdAt: true,
  user: { select: { id: true, name: true, isActive: true } },
  shift: { select: { id: true, number: true, status: true } },
  corrects: { select: { id: true, number: true, type: true } },
  correctedBy: { select: { id: true, number: true, type: true, createdAt: true } },
} as const satisfies Prisma.CashMovementSelect;

type Row = Prisma.CashMovementGetPayload<{ select: typeof SELECT }>;

function toRow(row: Row): CashMovementRow {
  return {
    id: row.id,
    reference: movementReference(row.type, row.number),
    type: row.type,
    category: row.category,
    amount: toNum(row.amount),
    reason: row.reason,
    notes: row.notes,
    createdAt: row.createdAt,
    cashier: row.user,
    shift: { id: row.shift.id, reference: shiftReference(row.shift.number), open: row.shift.status === 'OPEN' },
    corrects: row.corrects ? { id: row.corrects.id, reference: movementReference(row.corrects.type, row.corrects.number) } : null,
    correctedBy: row.correctedBy
      ? { id: row.correctedBy.id, reference: movementReference(row.correctedBy.type, row.correctedBy.number), createdAt: row.correctedBy.createdAt }
      : null,
  };
}

function whereFor(query: CashMovementQuery): Prisma.CashMovementWhereInput {
  const and: Prisma.CashMovementWhereInput[] = [{ createdAt: { gte: query.from, lte: query.to } }];
  if (query.userId) and.push({ userId: query.userId });
  if (query.shiftId) and.push({ shiftId: query.shiftId });
  if (query.type) and.push({ type: query.type });
  if (query.category) and.push({ category: query.category });

  const search = query.search?.trim();
  if (search) {
    const shiftNumber = /^sh/i.test(search) ? parseShiftReference(search) : null;
    const number = shiftNumber === null ? parseMovementReference(search) : null;
    and.push({
      OR: [
        ...(number !== null ? [{ number }] : []),
        ...(shiftNumber !== null ? [{ shift: { number: shiftNumber } }] : []),
        { reason: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  return { AND: and };
}

export async function listCashMovements(query: CashMovementQuery): Promise<CashMovementPage> {
  const db = await storeDb();
  const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 25));
  const where = whereFor(query);

  const [total, totals] = await Promise.all([
    db.cashMovement.count({ where }),
    db.cashMovement.groupBy({ by: ['type'], where, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), pageCount);
  const rows = await db.cashMovement.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: SELECT,
  });

  const of = (type: CashMovementType) => totals.find((t) => t.type === type);
  const cashOut = money(of('CASH_OUT')?._sum.amount ?? 0);
  const cashIn = money(of('CASH_IN')?._sum.amount ?? 0);
  return {
    rows: rows.map(toRow),
    total,
    page,
    pageCount,
    summary: {
      cashOut: toNum(cashOut),
      cashOutCount: of('CASH_OUT')?._count._all ?? 0,
      cashIn: toNum(cashIn),
      cashInCount: of('CASH_IN')?._count._all ?? 0,
      net: toNum(money(D(cashIn).minus(cashOut))),
    },
  };
}

/** The most recent movements of one cashier, for the dashboard. */
export async function recentCashMovements(userId: string, take = 5): Promise<CashMovementRow[]> {
  const db = await storeDb();
  const rows = await db.cashMovement.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
    take,
    select: SELECT,
  });
  return rows.map(toRow);
}

/** Everyone who has recorded a movement, for the owner's cashier filter. */
export async function listMovementCashiers(): Promise<{ id: string; name: string }[]> {
  const db = await storeDb();
  return db.user.findMany({ where: { cashMovements: { some: {} } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}
