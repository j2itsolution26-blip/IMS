import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlarmClock,
  BadgeCheck,
  Bell,
  Clock,
  CreditCard,
  FileWarning,
  Hourglass,
  Search,
  Settings2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { PLANS } from '@/lib/plans';
import { BILLING_LABEL, INTERVAL_LABEL, LIFECYCLE_LABEL } from '@/lib/billing';
import { SUBSCRIPTION_FILTERS, countByFilter, filterRows, type SubscriptionFilter } from '@/lib/subscription-filters';
import { inlineLabel, resolveRangeFromParams, type PeriodKey } from '@/server/analytics/date-range';
import {
  billingMetrics,
  listPendingPayments,
  listPlatformNotifications,
  loadSubscriptionRows,
} from '@/server/platform/billing-queries';
import { getBillingConfig } from '@/server/platform/billing-service';
import { runBillingReminders } from '@/server/platform/billing-reminders';
import { KpiCard } from '@/components/kpi-card';
import { Panel, PanelEmpty } from '@/components/panel';
import { PeriodPicker } from '@/components/period-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BillingQueue } from '@/features/platform/billing-queue';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const COLLECTED_PERIODS: { value: PeriodKey; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];

type Params = { filter?: string; q?: string; page?: string; period?: string; from?: string; to?: string };

/**
 * The administrator's billing overview: who is on trial, who chose a plan,
 * who owes, what awaits verification, and verified money collected. Every
 * figure is read from the database; nothing pending or unpaid is counted as
 * revenue.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission('platform.view');
  const canManage = userCan(user, 'platform.manage');
  const params = await searchParams;
  const now = new Date();

  const filter: SubscriptionFilter = SUBSCRIPTION_FILTERS.some((f) => f.value === params.filter)
    ? (params.filter as SubscriptionFilter)
    : 'all';
  const q = (params.q ?? '').trim().slice(0, 80);
  const offered = params.period === 'custom' || COLLECTED_PERIODS.some((p) => p.value === params.period);
  const { period, range, custom } = resolveRangeFromParams(offered ? params : {}, 'month', now);

  // Raise any reminders owed before reading, in case the daily job did not run. Idempotent.
  await runBillingReminders(now).catch((error) => console.error('[billing] reminder run failed', error));

  const [rows, metrics, pending, notifications, config] = await Promise.all([
    loadSubscriptionRows(now),
    billingMetrics(range, now),
    listPendingPayments(),
    listPlatformNotifications(8),
    getBillingConfig(),
  ]);

  const counts = countByFilter(rows);
  const filtered = filterRows(rows, filter, q);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(Number(params.page) || 1, 1), pageCount);
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const link = (patch: Partial<Params>) => {
    const next = new URLSearchParams();
    const merged: Params = { filter, q, period: params.period, from: params.from, to: params.to, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value && !(key === 'filter' && value === 'all')) next.set(key, String(value));
    const search = next.toString();
    return search ? `/system-admin/billing?${search}` : '/system-admin/billing';
  };

  const missing = [
    config.prices.length === 0 && 'prices',
    !config.terms && 'billing terms',
    !config.paymentInstructions && 'payment instructions',
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-display">Billing</h1>
          <p className="mt-1 text-sm text-muted-foreground">Trials, plan choices, invoices and payments across every store.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodPicker current={period} options={COLLECTED_PERIODS} allowCustom customFrom={custom?.from} customTo={custom?.to} />
          {canManage && (
            <Button asChild variant="outline">
              <Link href="/system-admin/billing/settings">
                <Settings2 /> Billing settings
              </Link>
            </Button>
          )}
        </div>
      </div>

      {missing.length > 0 && (
        <p role="status" className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          Owners cannot choose a plan yet: {missing.join(', ')} {missing.length === 1 ? 'is' : 'are'} not set.{' '}
          {canManage && (
            <Link href="/system-admin/billing/settings" className="font-semibold underline underline-offset-4">
              Set them up
            </Link>
          )}
        </p>
      )}

      <section aria-label="Trials" className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Active trials" value={formatNumber(counts.trial, 0)} icon={Clock} footer={{ label: 'See trials', href: link({ filter: 'trial', page: undefined }) }} />
        <KpiCard
          label="Trials ending soon"
          value={formatNumber(counts['trial-ending'], 0)}
          icon={AlarmClock}
          tone={counts['trial-ending'] > 0 ? 'warning' : 'default'}
          hint="Within 7 days"
          footer={{ label: 'See them', href: link({ filter: 'trial-ending', page: undefined }) }}
        />
        <KpiCard
          label="Expired trials"
          value={formatNumber(counts['trial-expired'], 0)}
          icon={Hourglass}
          hint="No plan bought; nothing owed unless chosen"
          footer={{ label: 'See them', href: link({ filter: 'trial-expired', page: undefined }) }}
        />
        <KpiCard
          label="Paid active"
          value={formatNumber(counts.paid, 0)}
          icon={BadgeCheck}
          tone="success"
          footer={{ label: 'See them', href: link({ filter: 'paid', page: undefined }) }}
        />
      </section>

      <section aria-label="Payments" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Open invoices"
          value={formatNumber(counts['payment-due'] + counts['plan-selected'], 0)}
          icon={CreditCard}
          hint={`${formatNumber(counts['payment-due'], 0)} due within 7 days`}
          footer={{ label: 'See invoices due', href: link({ filter: 'payment-due', page: undefined }) }}
        />
        <KpiCard
          label="To verify"
          value={formatNumber(pending.length, 0)}
          icon={Wallet}
          tone={pending.length > 0 ? 'warning' : 'default'}
          hint="Reported by owners"
        />
        <KpiCard
          label="Past due"
          value={formatNumber(counts['past-due'], 0)}
          icon={FileWarning}
          tone={counts['past-due'] > 0 ? 'destructive' : 'default'}
          footer={{ label: 'See them', href: link({ filter: 'past-due', page: undefined }) }}
        />
        <KpiCard
          label="Collected"
          value={formatCurrency(metrics.collected, 'PHP')}
          icon={TrendingUp}
          hint={`${formatNumber(metrics.collectedCount, 0)} verified payment${metrics.collectedCount === 1 ? '' : 's'} · ${inlineLabel(range)}`}
          inverse
        />
        <KpiCard
          label="Monthly recurring"
          value={formatCurrency(metrics.mrr, 'PHP')}
          icon={TrendingUp}
          hint={`From ${formatNumber(metrics.mrrStores, 0)} store${metrics.mrrStores === 1 ? '' : 's'} with verified payment covering today`}
        />
      </section>

      <div className="mb-5 grid items-start gap-4 xl:grid-cols-3">
        <Panel
          title="Payments to verify"
          description="Check the money arrived before verifying. Oldest first."
          className="xl:col-span-2"
        >
          {pending.length === 0 ? (
            <PanelEmpty icon={Wallet} title="Nothing to verify" description="Payments owners report will wait here for your check." />
          ) : (
            <BillingQueue
              canManage={canManage}
              rows={pending.map((row) => ({
                ...row,
                paidAt: row.paidAt.toISOString(),
                submittedAt: row.submittedAt.toISOString(),
              }))}
            />
          )}
        </Panel>

        <Panel title="Recent billing activity" description="Plan choices and payments reported.">
          {notifications.length === 0 ? (
            <PanelEmpty icon={Bell} title="No activity yet" description="Plan choices and payment reports appear here." />
          ) : (
            <ul className="divide-y">
              {notifications.map((item) => (
                <li key={item.id} className="px-4 py-2.5">
                  {item.href ? (
                    <Link href={item.href} className="text-sm font-medium hover:underline">
                      {item.title}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium">{item.title}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{item.body}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Subscriptions" description="Every store's trial, plan and billing position.">
        <div className="space-y-3 border-b p-4">
          <nav aria-label="Filter subscriptions" className="-mx-1 flex gap-1 overflow-x-auto px-1 scrollbar-none">
            {SUBSCRIPTION_FILTERS.map((option) => (
              <Link
                key={option.value}
                href={link({ filter: option.value, page: undefined })}
                aria-current={filter === option.value ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === option.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
                <span className="tabular opacity-80">{counts[option.value]}</span>
              </Link>
            ))}
          </nav>
          <form action="/system-admin/billing" className="flex max-w-md gap-2">
            {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input name="q" defaultValue={q} placeholder="Store, owner, email or invoice" className="pl-9" aria-label="Search subscriptions" />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </div>

        {shown.length === 0 ? (
          <PanelEmpty
            icon={Search}
            title="No stores match"
            description={q ? 'Try a different search or filter.' : 'No store is in this state right now.'}
          />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <caption className="sr-only">Store subscriptions</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="h-10 px-4 font-semibold">Store &amp; owner</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Status</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Trial ends</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Selected plan</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Next due</th>
                  <th scope="col" className="h-10 px-4 text-right font-semibold">Outstanding</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Last verified</th>
                  <th scope="col" className="h-10 px-4 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.storeId} className="border-b align-top last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.storeName}</p>
                      {row.owner ? (
                        <p className="text-xs text-muted-foreground">
                          {row.owner.name} · @{row.owner.username}
                          <br />
                          {row.owner.email}
                          {row.owner.phone ? ` · ${row.owner.phone}` : ''}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">No owner</p>
                      )}
                    </td>
                    <td className="px-4 py-3">{PLANS[row.plan].name}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge
                          variant={
                            row.lifecycle === 'SUSPENDED'
                              ? 'destructive'
                              : row.lifecycle === 'ACTIVE_PAID'
                                ? 'success'
                                : row.lifecycle === 'TRIAL_EXPIRED' || row.lifecycle === 'PAID_PERIOD_ENDED'
                                  ? 'warning'
                                  : 'secondary'
                          }
                        >
                          {LIFECYCLE_LABEL[row.lifecycle]}
                        </Badge>
                        {row.billing && (
                          <Badge variant={row.billing === 'PAST_DUE' ? 'destructive' : row.billing === 'PAYMENT_DUE' ? 'warning' : 'default'}>
                            {BILLING_LABEL[row.billing]}
                          </Badge>
                        )}
                        {(row.grace || row.readOnly) && (
                          <span className="text-[11px] text-muted-foreground">{row.grace ? 'In grace period' : 'Read-only'}</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{row.trialEndsAt ? formatDate(row.trialEndsAt) : '—'}</td>
                    <td className="px-4 py-3">
                      {row.openInvoice ? (
                        <>
                          {PLANS[row.openInvoice.plan].name}, {INTERVAL_LABEL[row.openInvoice.interval].toLowerCase()}
                          <p className="font-mono text-[11px] text-muted-foreground">{row.openInvoice.number}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{row.openInvoice ? formatDate(row.openInvoice.dueAt) : '—'}</td>
                    <td className="tabular whitespace-nowrap px-4 py-3 text-right">
                      {row.openInvoice ? formatCurrency(row.openInvoice.amount, row.openInvoice.currency) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.lastVerifiedPayment ? (
                        <>
                          {formatDate(row.lastVerifiedPayment.at)}
                          <p className="tabular text-[11px] text-muted-foreground">{formatCurrency(row.lastVerifiedPayment.amount, 'PHP')}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/system-admin/stores/${row.storeId}`}>Open</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>
              Page {page} of {pageCount} · {filtered.length} stores
            </span>
            <div className="flex gap-1">
              {page > 1 ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={link({ page: String(page - 1) })}>Previous</Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>
                  Previous
                </Button>
              )}
              {page < pageCount ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={link({ page: String(page + 1) })}>Next</Link>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>
                  Next
                </Button>
              )}
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}
