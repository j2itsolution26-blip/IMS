import { requireUser, userCan } from '@/lib/session';
import { AppShell } from '@/components/layout/app-shell';
import { NotificationBell } from '@/components/layout/notification-bell';
import { UserMenu } from '@/components/layout/user-menu';
import { countActionableStock } from '@/server/analytics/badges';
import { getUnreadCount, listNotifications } from '@/server/services/notification-service';
import { getSettings, readString } from '@/server/services/settings-service';

/**
 * Authenticated shell.
 *
 * Every page under this layout requires a session. Badge counts and the
 * notification list are queried per request, so they are always current after
 * a `router.refresh()` following any mutation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const [lowStockCount, unreadCount, notifications, settings] = await Promise.all([
    countActionableStock().catch(() => 0),
    getUnreadCount(user.id).catch(() => 0),
    listNotifications(user.id, 12).catch(() => []),
    getSettings(),
  ]);

  return (
    <AppShell
      permissions={Array.from(user.permissions)}
      lowStockCount={lowStockCount}
      unreadCount={unreadCount}
      companyName={readString(settings, 'company.name') || 'Inventory'}
      user={{
        name: user.name,
        email: user.email,
        image: user.image,
        roleName: user.role.name,
      }}
      notificationSlot={
        <NotificationBell
          unreadCount={unreadCount}
          notifications={notifications.map((n) => ({
            id: n.id,
            type: n.type,
            severity: n.severity,
            title: n.title,
            message: n.message,
            link: n.link,
            readAt: n.readAt,
            createdAt: n.createdAt,
          }))}
        />
      }
      userSlot={
        <UserMenu
          name={user.name}
          email={user.email}
          image={user.image}
          roleName={user.role.name}
          canManageSettings={userCan(user, 'settings.view')}
        />
      }
    >
      {children}
    </AppShell>
  );
}
