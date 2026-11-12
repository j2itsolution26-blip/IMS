import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/session';
import { can, ROLE_LABELS, type Permission } from '@/lib/permissions';
import { Nav, type NavItem } from '@/components/nav';
import { logout } from '../login/actions';

export const dynamic = 'force-dynamic';

const ITEMS: (NavItem & { permission?: Permission })[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/residents', label: 'Residents', permission: 'residents.view' },
  { href: '/households', label: 'Households', permission: 'residents.view' },
  { href: '/certificates', label: 'Certificates', permission: 'certificates.view' },
  { href: '/receipts', label: 'Receipts', permission: 'receipts.view' },
  { href: '/blotter', label: 'Blotter & KP', permission: 'blotter.view' },
  { href: '/reports', label: 'Reports', permission: 'reports.view' },
  { href: '/users', label: 'Accounts', permission: 'users.manage' },
  { href: '/settings', label: 'Settings', permission: 'settings.manage' },
  { href: '/audit', label: 'Audit log', permission: 'audit.view' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const settings = await prisma.barangaySettings.findUnique({ where: { id: 1 } });
  const items = ITEMS.filter((i) => !i.permission || can(user.role, i.permission));

  return (
    <div className="min-h-screen">
      <header className="no-print bg-brand-800 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-brand-100">
              {settings ? `${settings.city}, ${settings.province}` : 'Barangay System'}
            </div>
            <div className="text-lg font-semibold">Barangay {settings?.barangayName ?? ''}</div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <a href="/account" className="text-right hover:underline">
              <div className="font-medium">{user.fullName}</div>
              <div className="text-xs text-brand-100">{ROLE_LABELS[user.role]}</div>
            </a>
            <form action={logout}>
              <button className="rounded-md border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10">Sign out</button>
            </form>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 border-t border-white/10 pt-2">
            <Nav items={items} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
