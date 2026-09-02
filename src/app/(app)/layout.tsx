import { requireUser, userCan } from '@/lib/session';
import { AppShell } from '@/components/layout/app-shell';
import { UserMenu } from '@/components/layout/user-menu';
import { countActionableStock } from '@/server/analytics/badges';
import { getSettings, readString } from '@/server/services/settings-service';

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
