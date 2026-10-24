import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { parseNotificationFilter, safeNotificationHref, storeTypeTone } from '@/lib/notifications';
import { listNotifications } from '@/server/services/notification-service';
import { NOTIFICATIONS_PAGE_SIZE, NotificationsPage } from '@/features/notifications/notifications-page';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

/** The owner's store notifications: shifts and billing. Read through the store client, so only this store's. */
export default async function StoreNotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  await requirePermission(FINANCIAL_PERMISSION);
  const params = await searchParams;
  const filter = parseNotificationFilter(params.filter);
  const page = Math.max(1, Math.min(10_000, Number(params.page) || 1));
  const result = await listNotifications(NOTIFICATIONS_PAGE_SIZE, {
    unreadOnly: filter === 'unread',
    skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
  });

  return (
    <NotificationsPage
      title="Notifications"
      description="Shift openings and closings, cash differences, and billing reminders for your store."
      basePath="/notifications"
      filter={filter}
      page={page}
      data={{
        unread: result.unread,
        total: result.total,
        items: result.items.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          href: safeNotificationHref(item.href),
          createdAt: item.createdAt,
          read: item.read,
          tone: storeTypeTone(item.type),
        })),
      }}
    />
  );
}
