import 'server-only';

import type { Prisma, WalletTransactionType } from '@prisma/client';
import { storeDb } from '@/lib/tenant/context';
import { D, money, sum, toNum, type Numeric } from '@/lib/decimal';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { normalizeGcashReference, GCASH_REFERENCE_HINT } from '@/lib/tender';
import { lastFourDigits, walletFigures, walletProblem, walletReference, WALLET_TYPE_LABEL } from '@/lib/wallet';
import { shiftReference } from '@/lib/shift-review';
import { recordAudit } from '@/server/services/audit-service';
import { getSettings, readBoolean } from '@/server/services/settings-service';
import { getOpenShift, lockShiftIfOpen } from '@/server/services/shift-service';

/**
 * GCash cash-in / cash-out services (see src/lib/wallet.ts for the money).
 *
 * Every entry is tied to the cashier's own open shift, so it lands in that
 * drawer's expected cash, and is never a sale: sales, revenue and stock are
 * untouched; only the fee is income. The cashier is always the signed-in
 * user. Entries are append-only; a mistake is reversed once, with a reason,
 * while the shift is open. The database also refuses the same GCash
 * reference twice and a second submit of one attempt.
 */

export async function walletServicesEnabled(): Promise<boolean> {
  return readBoolean(await getSettings(), 'pos.gcashServices');
}

export interface RecordedWallet {
  id: string;
  reference: string;
}

export async function recordWalletTransaction(input: {
  userId: string;
  type: WalletTransactionType;
  amount: number;
  fee: number;
  gcashReference: string;
  customerMobile?: string;
  notes?: string;
  confirmed: boolean;
  clientRequestId?: string;
}): Promise<RecordedWallet> {
  if (!(await walletServicesEnabled())) {
    throw new ConflictError('GCash cash-in / cash-out is turned off. The owner can turn it on in Settings.');
  }
  const problem = walletProblem(input.type, input.amount, input.fee);
  if (problem) throw new ValidationError(problem);
  const gcashReference = normalizeGcashReference(input.gcashReference);
  if (!gcashReference) throw new ValidationError(GCASH_REFERENCE_HINT, { gcashReference: [GCASH_REFERENCE_HINT] });
  if (input.confirmed !== true) {
    throw new ValidationError(
      input.type === 'CASH_IN'
        ? 'Confirm the GCash was sent from the store account before recording.'
        : 'Confirm the GCash arrived in the store account before recording.',
    );
  }

  const db = await storeDb();
  const clientRequestId = input.clientRequestId?.trim() || null;
  if (clientRequestId) {
    const existing = await db.walletTransaction.findFirst({ where: { clientRequestId }, select: { id: true, number: true, userId: true } });
    if (existing) {
      if (existing.userId !== input.userId) throw new ConflictError('This entry was already used. Start again.');
      return { id: existing.id, reference: walletReference(existing.number) };
    }
  }

  const shift = await getOpenShift(input.userId);
  if (!shift) throw new ConflictError('Open a shift first: GCash services go through your drawer.');

  try {
    return await db.$transaction(async (tx) => {
      if (!(await lockShiftIfOpen(tx, shift.id, 'share'))) throw new ConflictError('Your shift was closed. Open a new shift first.');
      const row = await tx.walletTransaction.create({
        data: {
          type: input.type,
          amount: money(input.amount),
          fee: money(input.fee),
          reference: gcashReference,
          customerMobileLast4: lastFourDigits(input.customerMobile),
          notes: input.notes?.trim() ? input.notes.trim().slice(0, 300) : null,
          shiftId: shift.id,
          userId: input.userId,
          clientRequestId,
        },
        select: { id: true, number: true },
      });
      const reference = walletReference(row.number);
      const figures = walletFigures(input.type, input.amount, input.fee);
      await recordAudit(
        {
          action: 'CASH_MOVEMENT',
          entity: 'WalletTransaction',
          entityId: row.id,
          summary: `${reference} ${WALLET_TYPE_LABEL[input.type]} ₱${input.amount.toFixed(2)}, fee ₱${input.fee.toFixed(2)} (GCash ref ${gcashReference}) on ${shiftReference(shift.number)}`,
          changes: { type: input.type, amount: input.amount, fee: input.fee, drawerEffect: figures.drawerEffect, walletEffect: figures.walletEffect },
          userId: input.userId,
        },
        tx,
      );
      return { id: row.id, reference };
    });
  } catch (error) {
    const e = error as { code?: string; meta?: { target?: unknown } };
    if (e?.code === 'P2002') {
      const target = String(e.meta?.target ?? '');
      if (clientRequestId && target.includes('clientRequestId')) {
        const existing = await db.walletTransaction.findFirst({ where: { clientRequestId }, select: { id: true, number: true } });
        if (existing) return { id: existing.id, reference: walletReference(existing.number) };
      }
      throw new ConflictError('That GCash reference is already recorded. Check the history before recording it again.');
    }
    throw error;
  }
}

/**
 * Reverses an entry recorded by mistake, once, while its shift is open — by
 * the cashier who recorded it or by the owner. The cashier must undo the
 * money themselves (return the cash or GCash); this records that it is undone.
 */
export async function reverseWalletTransaction(input: { id: string; actorId: string; isOwner: boolean; reason: string }): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ValidationError('Say why this is being reversed.');
  const db = await storeDb();
  await db.$transaction(async (tx) => {
    const row = await tx.walletTransaction.findUnique({
      where: { id: input.id },
      select: { id: true, number: true, shiftId: true, userId: true, reversedAt: true, type: true, amount: true, fee: true },
    });
    if (!row || (!input.isOwner && row.userId !== input.actorId)) throw new NotFoundError('GCash entry');
    if (row.reversedAt) throw new ConflictError('This entry has already been reversed.');
    if (!(await lockShiftIfOpen(tx, row.shiftId, 'share'))) {
      throw new ConflictError('That shift is closed. The owner can record a shift adjustment instead.');
    }
    await tx.walletTransaction.update({
      where: { id: row.id },
      data: { reversedAt: new Date(), reversedById: input.actorId, reversalReason: reason.slice(0, 200) },
    });
    await recordAudit(
      {
        action: 'CASH_MOVEMENT',
        entity: 'WalletTransaction',
        entityId: row.id,
        summary: `${walletReference(row.number)} reversed: ${reason.slice(0, 120)}`,
        changes: { reversed: true, type: row.type, amount: row.amount.toString(), fee: row.fee.toString() },
        userId: input.actorId,
      },
      tx,
    );
  });
}

export interface WalletRow {
  id: string;
  reference: string;
  type: WalletTransactionType;
  amount: number;
  fee: number;
  gcashReference: string;
  customerMobileLast4: string | null;
  notes: string | null;
  createdAt: Date;
  cashier: { id: string; name: string };
  shift: { id: string; reference: string; open: boolean };
  reversed: { at: Date; by: string | null; reason: string | null } | null;
}

export interface WalletSummary {
  count: number;
  cashIn: number;
  cashOut: number;
  fees: number;
  drawerEffect: number;
  walletEffect: number;
}

export async function listWalletTransactions(query: {
  userId?: string;
  type?: WalletTransactionType;
  shiftId?: string;
  search?: string;
  from: Date;
  to: Date;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: WalletRow[]; total: number; page: number; pageCount: number; summary: WalletSummary }> {
  const db = await storeDb();
  const pageSize = Math.min(100, Math.max(10, query.pageSize ?? 25));
  const search = query.search?.trim();
  const number = search ? /^(gc-?)?0*(\d{1,9})$/i.exec(search)?.[2] : undefined;
  const where: Prisma.WalletTransactionWhereInput = {
    createdAt: { gte: query.from, lte: query.to },
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.shiftId ? { shiftId: query.shiftId } : {}),
    ...(search
      ? {
          OR: [
            ...(number ? [{ number: Number(number) }] : []),
            { reference: { contains: search.replace(/\s+/g, '').toUpperCase() } },
            { notes: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, totals] = await Promise.all([
    db.walletTransaction.count({ where }),
    // Reversed entries are listed but never counted.
    db.walletTransaction.groupBy({ by: ['type'], where: { ...where, reversedAt: null }, _sum: { amount: true, fee: true }, _count: { _all: true } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page ?? 1), pageCount);
  const rows = await db.walletTransaction.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      user: { select: { id: true, name: true } },
      reversedBy: { select: { name: true } },
      shift: { select: { id: true, number: true, status: true } },
    },
  });

  const of = (type: WalletTransactionType) => totals.find((t) => t.type === type);
  const amount = (type: WalletTransactionType): Numeric => of(type)?._sum.amount ?? 0;
  const fees = money(sum([of('CASH_IN')?._sum.fee ?? 0, of('CASH_OUT')?._sum.fee ?? 0]));
  return {
    rows: rows.map((row) => ({
      id: row.id,
      reference: walletReference(row.number),
      type: row.type,
      amount: toNum(row.amount),
      fee: toNum(row.fee),
      gcashReference: row.reference,
      customerMobileLast4: row.customerMobileLast4,
      notes: row.notes,
      createdAt: row.createdAt,
      cashier: row.user,
      shift: { id: row.shift.id, reference: shiftReference(row.shift.number), open: row.shift.status === 'OPEN' },
      reversed: row.reversedAt ? { at: row.reversedAt, by: row.reversedBy?.name ?? null, reason: row.reversalReason } : null,
    })),
    total,
    page,
    pageCount,
    summary: {
      count: (of('CASH_IN')?._count._all ?? 0) + (of('CASH_OUT')?._count._all ?? 0),
      cashIn: toNum(money(amount('CASH_IN'))),
      cashOut: toNum(money(amount('CASH_OUT'))),
      fees: toNum(fees),
      drawerEffect: toNum(money(D(amount('CASH_IN')).minus(D(amount('CASH_OUT'))).plus(fees))),
      walletEffect: toNum(money(D(amount('CASH_OUT')).minus(D(amount('CASH_IN'))))),
    },
  };
}
