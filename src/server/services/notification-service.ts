import 'server-only';

import type { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isOverdue, notificationKey, shiftReference } from '@/lib/shift-review';
import { getSettings, readNumber } from '@/server/services/settings-service';

/**
 * The owner's in-app notices.
 *
 * Database-backed and polled — no push service. Every notice carries a unique
 * `dedupeKey`, and writes use `skipDuplicates`, so a retried close or a poll
 * that re-checks overdue shifts never stores the same notice twice. Notices
 * about a shift are written in the same transaction as the shift change, so
 * one never exists without the other.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface NewNotification {
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
  shiftId?: string | null;
}

export async function raiseNotifications(items: NewNotification[], db: Db = prisma): Promise<void> {
  if (items.length === 0) return;
  await db.notification.createMany({
    data: items.map((item) => ({
      type: item.type,
      title: item.title,
      body: item.body,
      href: item.href ?? null,
      shiftId: item.shiftId ?? null,
      dedupeKey: item.shiftId ? notificationKey(item.type, item.shiftId) : `${item.type.toLowerCase()}:${crypto.randomUUID()}`,
    })),
    skipDuplicates: true,
  });
}

/**
 * Raises the "left open" notice for every shift past the configured limit.
 * Cheap and idempotent, so it runs on each poll instead of on a timer.
 */
export async function syncOverdueShiftNotifications(now: Date = new Date()): Promise<void> {
  const hours = readNumber(await getSettings(), 'shifts.overdueHours');
  if (!(hours > 0)) return;

  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const shifts = await prisma.cashierShift.findMany({
    where: { status: 'OPEN', openedAt: { lte: cutoff }, notifications: { none: { type: 'SHIFT_OVERDUE' } } },
    select: { id: true, number: true, openedAt: true, user: { select: { name: true } } },
    take: 50,
  });

  await raiseNotifications(
    shifts
      .filter((shift) => isOverdue(shift.openedAt, now, hours))
      .map((shift) => ({
        type: 'SHIFT_OVERDUE' as const,
        shiftId: shift.id,
        href: `/shifts/${shift.id}`,
        title: `${shift.user.name}'s shift is still open`,
        body: `${shiftReference(shift.number)} has been open for more than ${hours} hour${hours === 1 ? '' : 's'}.`,
      })),
  );
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  read: boolean;
}

export async function listNotifications(limit = 20): Promise<{ items: NotificationView[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(50, Math.max(1, limit)) }),
    prisma.notification.count({ where: { readAt: null } }),
  ]);
  return {
    unread,
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      href: row.href,
      createdAt: row.createdAt.toISOString(),
      read: row.readAt !== null,
    })),
  };
}

/** Marks the given notices read, or every unread one when no ids are passed. */
export async function markNotificationsRead(userId: string, ids?: string[], db: Db = prisma): Promise<void> {
  await db.notification.updateMany({
    where: { readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date(), readById: userId },
  });
}
