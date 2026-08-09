import 'server-only';

import type { NotificationSeverity, NotificationType } from '@prisma/client';
import { prisma, type DbClient } from '@/lib/prisma';

export interface NotificationInput {
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  link?: string | null;
  /** Target a single user; omit to broadcast to everyone. */
  userId?: string | null;
  /**
   * Stable key that identifies this specific alert (e.g.
   * `low-stock:<productId>:<warehouseId>`). Re-raising the same key updates the
   * existing row instead of flooding the bell with duplicates.
   */
  dedupeKey?: string | null;
}

const SEVERITY_BY_TYPE: Record<NotificationType, NotificationSeverity> = {
  LOW_STOCK: 'WARNING',
  OUT_OF_STOCK: 'CRITICAL',
  PURCHASE_RECEIVED: 'SUCCESS',
  LARGE_SALE: 'SUCCESS',
  INVENTORY_ADJUSTMENT: 'INFO',
  RETURN_PROCESSED: 'INFO',
  PRICE_CHANGE: 'INFO',
  SUPPLIER_DELAY: 'WARNING',
  NEW_USER: 'INFO',
  BACKUP_FAILED: 'CRITICAL',
  SYSTEM: 'INFO',
};

export async function notify(input: NotificationInput, db: DbClient = prisma): Promise<void> {
  const severity = input.severity ?? SEVERITY_BY_TYPE[input.type];

  if (!input.dedupeKey) {
    await db.notification.create({
      data: {
        type: input.type,
        severity,
        title: input.title,
        message: input.message,
        link: input.link ?? null,
        userId: input.userId ?? null,
      },
    });
    return;
  }

  // Refresh the message and un-read it so a worsening condition resurfaces.
  await db.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      type: input.type,
      severity,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      userId: input.userId ?? null,
      dedupeKey: input.dedupeKey,
    },
    update: {
      severity,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      readAt: null,
      dismissedAt: null,
      createdAt: new Date(),
    },
  });
}

/** Clears a deduped alert once the underlying condition is resolved. */
export async function resolveNotification(dedupeKey: string, db: DbClient = prisma): Promise<void> {
  await db.notification.deleteMany({ where: { dedupeKey } });
}

export const stockAlertKey = (productId: string, warehouseId: string) =>
  `stock:${productId}:${warehouseId}`;

export const supplierDelayKey = (purchaseOrderId: string) => `supplier-delay:${purchaseOrderId}`;

export async function getUnreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      readAt: null,
      dismissedAt: null,
      OR: [{ userId }, { userId: null }],
    },
  });
}

export async function listNotifications(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { dismissedAt: null, OR: [{ userId }, { userId: null }] },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
