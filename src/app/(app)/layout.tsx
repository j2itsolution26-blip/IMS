import { requireUser, userCan } from '@/lib/session';
import { AppShell } from '@/components/layout/app-shell';
import { UserMenu } from '@/components/layout/user-menu';
import { countActionableStock } from '@/server/analytics/badges';
import { getSettings, readNumber, readString } from '@/server/services/settings-service';
import { storeAccess } from '@/lib/store-access';
import { StoreSuspended, SubscriptionBanner } from '@/features/subscription/subscription-banner';
import { SuspendedGate } from '@/features/support/suspended-gate';
import { countMyUnreadReplies } from '@/server/support/support-service';
import { countAwaitingAdmin } from '@/server/support/support-admin-service';

/**
 * Authenticated shell.
 *
 * Every page under this layout requires a session. The low-stock badge is
 * queried per request, so it is always current after a `router.refresh()`
 * following any mutation.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const [lowStockCount, settings, supportCount] = await Promise.all([
    countActionableStock().catch(() => 0),
    getSettings(),
    // Administrators: tickets awaiting an answer. Store accounts: replies they have not read.
    userCan(user, 'platform.view')
      ? countAwaitingAdmin().catch(() => 0)
      : userCan(user, 'support.create')
        ? countMyUnreadReplies(user.id).catch(() => 0)
        : 0,
  ]);

  return (
    <AppShell
      permissions={Array.from(user.permissions)}
      lowStockCount={lowStockCount}
      supportCount={supportCount}
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
        // Every store query refuses a suspended store; say why instead of
        // failing each page. Support is the exception (it never uses the
        // store client), decided on the client so it follows navigation.
        <SuspendedGate notice={<StoreSuspended canContactSupport={userCan(user, 'support.create')} />}>
          {children}
        </SuspendedGate>
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
