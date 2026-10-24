import 'server-only';

import type { NotificationType } from '@prisma/client';
import type { DbClient } from '@/lib/prisma';
import { storeDb } from '@/lib/tenant/context';
import { isOverdue, notificationKey, shiftReference, type ShiftNotificationType } from '@/lib/shift-review';
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

type Db = DbClient;

export interface NewNotification {
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
  shiftId?: string | null;
  /** Overrides the default key; billing reminders pass one per event and window. */
  dedupeKey?: string;
}

export async function raiseNotifications(items: NewNotification[], db?: Db): Promise<void> {
  if (items.length === 0) return;
  db ??= await storeDb();
  await db.notification.createMany({
    data: items.map((item) => ({
      type: item.type,
      title: item.title,
      body: item.body,
      href: item.href ?? null,
      shiftId: item.shiftId ?? null,
      dedupeKey:
        item.dedupeKey ??
        (item.shiftId
          ? notificationKey(item.type as ShiftNotificationType, item.shiftId)
          : `${item.type.toLowerCase()}:${crypto.randomUUID()}`),
    })),
    skipDuplicates: true,
  });
}

/**
 * Raises the "left open" notice for every shift past the configured limit.
 * Cheap and idempotent, so it runs on each poll instead of on a timer.
 */
export async function syncOverdueShiftNotifications(now: Date = new Date()): Promise<void> {
  const db = await storeDb();
  const hours = readNumber(await getSettings(), 'shifts.overdueHours');
  if (!(hours > 0)) return;

  const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const shifts = await db.cashierShift.findMany({
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
  const db = await storeDb();
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(50, Math.max(1, limit)) }),
    db.notification.count({ where: { readAt: null } }),
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
export async function markNotificationsRead(userId: string, ids?: string[], db?: Db): Promise<void> {
  db ??= await storeDb();
  await db.notification.updateMany({
    where: { readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date(), readById: userId },
  });
}
