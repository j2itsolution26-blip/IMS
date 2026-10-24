import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { parseNotificationFilter, platformKindTone, safeNotificationHref } from '@/lib/notifications';
import { listPlatformNotificationsFor } from '@/server/platform/platform-notification-service';
import { NOTIFICATIONS_PAGE_SIZE, NotificationsPage } from '@/features/notifications/notifications-page';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

/** Every platform notification, newest first, with this administrator's own read state. */
export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const admin = await requirePermission('platform.view');
  const params = await searchParams;
  const filter = parseNotificationFilter(params.filter);
  const page = Math.max(1, Math.min(10_000, Number(params.page) || 1));
  const result = await listPlatformNotificationsFor(admin.id, {
    filter,
    take: NOTIFICATIONS_PAGE_SIZE,
    skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
  });

  return (
    <NotificationsPage
      title="Notifications"
      description="Stores, trials, billing and security events across the platform."
      basePath="/system-admin/notifications"
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
          tone: platformKindTone(item.kind),
        })),
      }}
    />
  );
}
