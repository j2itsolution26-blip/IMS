import 'server-only';

import type { Prisma } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import type { NotificationFilter, PlatformNotificationKind } from '@/lib/notifications';

/**
 * Notifications for platform administrators.
 *
 * Every administrator is a recipient of every platform notification; read
 * state is kept per administrator (platform_notification_reads), written only
 * for the signed-in administrator. Store users never reach these: the table is
 * denied to store clients and every reader here is called behind
 * `platform.view`.
 */

type Db = Prisma.TransactionClient | typeof platformPrisma;

export interface NewPlatformNotification {
  kind: PlatformNotificationKind;
  title: string;
  body: string;
  href?: string | null;
  storeId?: string | null;
  dedupeKey: string;
}

/**
 * Raises a notification once per key. The administrator who caused the event
 * (verified the payment, suspended the store) gets it already read, so their
 * own actions do not clutter their bell; other administrators still see it.
 * Safe inside a transaction: duplicates are skipped, never raised as errors.
 * Returns whether it was new.
 */
export async function raisePlatformNotification(
  item: NewPlatformNotification,
  options: { db?: Db; readBy?: string | null } = {},
): Promise<boolean> {
  const db = options.db ?? platformPrisma;
  const created = await db.platformNotification.createManyAndReturn({
    data: [
      {
        kind: item.kind,
        title: item.title.slice(0, 200),
        body: item.body.slice(0, 1000),
        href: item.href ?? null,
        storeId: item.storeId ?? null,
        dedupeKey: item.dedupeKey,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  if (created.length > 0 && options.readBy) {
    await db.platformNotificationRead.createMany({
      data: [{ notificationId: created[0].id, userId: options.readBy }],
      skipDuplicates: true,
    });
  }
  return created.length > 0;
}

export interface PlatformNotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  read: boolean;
}

/** One administrator's view: newest first, optionally unread only, with their unread count. */
export async function listPlatformNotificationsFor(
  userId: string,
  options: { filter?: NotificationFilter; take?: number; skip?: number } = {},
): Promise<{ items: PlatformNotificationView[]; unread: number; total: number }> {
  const unreadWhere: Prisma.PlatformNotificationWhereInput = { reads: { none: { userId } } };
  const where = options.filter === 'unread' ? unreadWhere : {};
  const take = Math.min(100, Math.max(1, options.take ?? 20));
  const [rows, unread, total] = await Promise.all([
    platformPrisma.platformNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip: Math.max(0, options.skip ?? 0),
      select: {
        id: true, kind: true, title: true, body: true, href: true, createdAt: true,
        reads: { where: { userId }, select: { readAt: true } },
      },
    }),
    platformPrisma.platformNotification.count({ where: unreadWhere }),
    platformPrisma.platformNotification.count({ where }),
  ]);
  return {
    unread,
    total,
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      href: row.href,
      createdAt: row.createdAt.toISOString(),
      read: row.reads.length > 0,
    })),
  };
}

/**
 * Marks notifications read for this administrator only — the given ids, or
 * every unread one. Unknown ids are ignored rather than trusted.
 */
export async function markPlatformNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const targets = await platformPrisma.platformNotification.findMany({
    where: { reads: { none: { userId } }, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true },
    take: 1000,
  });
  if (targets.length === 0) return 0;
  const result = await platformPrisma.platformNotificationRead.createMany({
    data: targets.map((target) => ({ notificationId: target.id, userId })),
    skipDuplicates: true,
  });
  return result.count;
}
