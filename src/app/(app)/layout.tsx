import { requireUser, userCan } from '@/lib/session';
import { AppShell } from '@/components/layout/app-shell';
import { UserMenu } from '@/components/layout/user-menu';
import { countActionableStock } from '@/server/analytics/badges';
import { getSettings, readNumber, readString } from '@/server/services/settings-service';
import { storeAccess } from '@/lib/store-access';
import { StoreSuspended, SubscriptionBanner } from '@/features/subscription/subscription-banner';

/**
 * Authenticated shell.
 *
 * Every page under this layout requires a session. The low-stock badge is
 * queried per request, so it is always current after a `router.refresh()`
 * following any mutation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const [lowStockCount, settings] = await Promise.all([
    countActionableStock().catch(() => 0),
    getSettings(),
  ]);

  return (
    <AppShell
      permissions={Array.from(user.permissions)}
      lowStockCount={lowStockCount}
      companyName={readString(settings, 'company.name') || 'Store'}
      user={{
        name: user.name,
        email: user.email,
        image: user.image,
        roleName: user.role.name,
      }}
      screenLock={{
        user: { name: user.name, username: user.username, hasPin: user.hasPin },
        autoLockMinutes: readNumber(settings, 'security.autoLockMinutes'),
      }}
      userSlot={
        <UserMenu
          name={user.name}
          email={user.email}
          image={user.image}
          roleName={user.role.name}
          canManageSettings={userCan(user, 'settings.view')}
          canManageStaff={userCan(user, 'users.view')}
        />
      }
    >
      {user.store?.status === 'SUSPENDED' ? (
        // Every store query refuses a suspended store; say why instead of failing each page.
        <StoreSuspended />
      ) : (
        <>
          {user.store && (
            <SubscriptionBanner access={storeAccess(user.store)} canManageBilling={userCan(user, 'billing.view')} now={new Date()} />
          )}
          {children}
        </>
      )}
    </AppShell>
  );
}
