import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, ShieldCheck, Store, UserCheck, UserPlus, UserX, Users } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { getPlatformStats, listAccountAudit } from '@/features/platform/queries';
import { formatDateTime, formatNumber } from '@/lib/format';
import { KpiCard } from '@/features/dashboard/kpi-card';
import { Panel, PanelEmpty } from '@/components/panel';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'System administration' };
export const dynamic = 'force-dynamic';

export default async function SystemAdminPage() {
  const admin = await requirePermission('platform.view');
  const [stats, audit] = await Promise.all([getPlatformStats(), listAccountAudit(8)]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">System administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {admin.name} — platform maintenance for {stats.storeName}.
          </p>
        </div>
        <Button asChild size="lg" className="h-11 rounded-xl">
          <Link href="/system-admin/owners">
            <Users /> Owner accounts
          </Link>
        </Button>
      </div>

      <section aria-label="Platform summary" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Owner accounts"
          value={formatNumber(stats.owners.total, 0)}
          icon={Store}
          href="/system-admin/owners"
        />
        <KpiCard
          label="Active owners"
          value={formatNumber(stats.owners.active, 0)}
          icon={UserCheck}
          tone="success"
          href="/system-admin/owners"
        />
        <KpiCard
          label="Deactivated"
          value={formatNumber(stats.owners.inactive, 0)}
          icon={UserX}
          tone={stats.owners.inactive > 0 ? 'warning' : 'default'}
          href="/system-admin/owners"
        />
        <KpiCard label="New in 30 days" value={formatNumber(stats.recentOwners, 0)} icon={UserPlus} />
        <KpiCard
          label="Administrators"
          value={formatNumber(stats.admins, 0)}
          icon={ShieldCheck}
          hint={`${formatNumber(stats.staff, 0)} staff account${stats.staff === 1 ? '' : 's'}`}
        />
      </section>

      <Panel
        title="Recent account activity"
        description="Who was given or denied access, and by whom."
        action={
          <Link
            href="/system-admin/audit"
            className="text-xs font-semibold text-primary hover:underline"
          >
            View all
          </Link>
        }
      >
        {audit.length === 0 ? (
          <PanelEmpty
            icon={Activity}
            title="No account activity yet"
            description="Creating, resetting or deactivating an account will be recorded here."
          />
        ) : (
          <ul className="divide-y">
            {audit.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{entry.summary}</p>
                  <p className="text-xs text-muted-foreground">{entry.actorName ?? 'System'}</p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
