import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/page-header';
import { NotificationList } from '@/features/notifications/notification-list';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await requirePermission('notifications.view');

  // Dismissed items are kept out; the bell and this page show the same set.
  const notifications = await prisma.notification.findMany({
    where: { dismissedAt: null, OR: [{ userId: user.id }, { userId: null }] },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const unread = notifications.filter((item) => !item.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          unread > 0
            ? `${unread} unread. Alerts are raised automatically by stock levels, deliveries, and trading activity.`
            : 'Alerts raised automatically by stock levels, deliveries, and trading activity.'
        }
      />

      <NotificationList
        notifications={notifications.map((item) => ({
          id: item.id,
          type: item.type,
          severity: item.severity,
          title: item.title,
          message: item.message,
          link: item.link,
          readAt: item.readAt,
          createdAt: item.createdAt,
        }))}
        canManage={userCan(user, 'notifications.manage')}
      />
    </>
  );
}
