import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Activity,
  BadgeCheck,
  Clock,
  CreditCard,
  ShieldCheck,
  Store,
  UserCheck,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { getPlatformStats, listAccountAudit } from '@/features/platform/queries';
import { formatDateTime, formatNumber } from '@/lib/format';
import { PLAN_ORDER, PLANS } from '@/lib/plans';
import { KpiCard } from '@/components/kpi-card';
import { Panel, PanelEmpty, PanelLink } from '@/components/panel';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'System administration' };
export const dynamic = 'force-dynamic';

export default async function SystemAdminPage() {
  const admin = await requirePermission('platform.view');
  const [stats, audit] = await Promise.all([getPlatformStats(), listAccountAudit(8)]);
  const { stores } = stats;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-title sm:text-title-lg">System administration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {admin.name} — stores, owner accounts and subscriptions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/system-admin/owners">
              <Users /> Owner accounts
            </Link>
          </Button>
          <Button asChild>
            <Link href="/system-admin/stores">
              <Store /> Stores
            </Link>
          </Button>
        </div>
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stores</h2>
      <section aria-label="Stores by subscription status" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Total stores" value={formatNumber(stores.total, 0)} icon={Store} href="/system-admin/stores" />
        <KpiCard
          label="Active"
          value={formatNumber(stores.byStatus.ACTIVE, 0)}
          icon={BadgeCheck}
          tone="success"
          hint="Paid and current"
        />
        <KpiCard label="On trial" value={formatNumber(stores.byStatus.TRIAL, 0)} icon={Clock} hint="Free trial running" />
        <KpiCard
          label="Past due"
          value={formatNumber(stores.byStatus.PAST_DUE, 0)}
          icon={CreditCard}
          tone={stores.byStatus.PAST_DUE > 0 ? 'warning' : 'default'}
          hint="In the grace period"
        />
        <KpiCard
          label="Suspended"
          value={formatNumber(stores.byStatus.SUSPENDED, 0)}
          icon={UserX}
          tone={stores.byStatus.SUSPENDED > 0 ? 'destructive' : 'default'}
          hint="No access"
        />
      </section>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accounts</h2>
      <section aria-label="Accounts" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Owner accounts"
          value={formatNumber(stats.owners.total, 0)}
          icon={Users}
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

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Panel title="Stores by plan" description="The plan each store is subscribed to, trials included.">
          {stores.total === 0 ? (
            <PanelEmpty icon={Store} title="No stores yet" description="Stores appear here once they are created." />
          ) : (
            <ul className="space-y-4 p-4">
              {PLAN_ORDER.map((plan) => {
                const count = stores.byPlan[plan];
                const share = count / stores.total;
                return (
                  <li key={plan}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium">{PLANS[plan].name}</span>
                      <span className="tabular text-muted-foreground">
                        <span className="font-semibold text-foreground">{formatNumber(count, 0)}</span> ·{' '}
                        {Math.round(share * 100)}%
                      </span>
                    </div>
                    {/* The figure is written out above; the bar only shows proportion. */}
                    <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent account activity"
          description="Who was given or denied access, and by whom."
          action={<PanelLink href="/system-admin/audit">View all</PanelLink>}
          className="xl:col-span-2"
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
      </div>
    </>
  );
}
