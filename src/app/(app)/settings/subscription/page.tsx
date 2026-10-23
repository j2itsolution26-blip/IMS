import type { Metadata } from 'next';
import { CalendarClock, CreditCard, History, LifeBuoy, Receipt } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { getStoreContext } from '@/lib/tenant/context';
import { formatDate, formatDateTime } from '@/lib/format';
import { STATUS_LABEL, PAYMENT_METHOD_LABEL, accessHeadline, daysUntil } from '@/lib/subscription';
import { PLANS } from '@/lib/plans';
import { PageHeader } from '@/components/page-header';
import { Panel, PanelEmpty } from '@/components/panel';
import { AccessBadge, PlanComparison, UsageMeter } from '@/features/subscription/plan-display';
import { auditHistoryStart, usageSummary } from '@/server/services/entitlements';

export const metadata: Metadata = { title: 'Subscription' };
export const dynamic = 'force-dynamic';

/**
 * Settings → Subscription: the store's plan, where it stands, what it is
 * using, and what to do next. Every number is counted on the server with the
 * same rules the limits are enforced by.
 */
export default async function SubscriptionPage() {
  const user = await requirePermission('billing.view');
  const ctx = await getStoreContext();
  const store = user.store!;
  const now = new Date();
  const { access } = ctx;

  const historyStart = auditHistoryStart(ctx, now);
  const [meters, payments, history] = await Promise.all([
    usageSummary(ctx),
    ctx.db.subscriptionPayment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, plan: true, amount: true, method: true, reference: true, paidAt: true,
        months: true, periodStart: true, periodEnd: true, voidedAt: true, voidReason: true,
      },
    }),
    ctx.db.auditLog.findMany({
      where: {
        entity: { in: ['Store', 'SubscriptionPayment'] },
        action: { in: ['SUBSCRIPTION', 'PAYMENT', 'CREATE'] },
        ...(historyStart && { createdAt: { gte: historyStart } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, summary: true, createdAt: true },
    }),
  ]);

  const endLabel = access.state === 'TRIAL' ? 'Trial ends' : 'Current period ends';
  const daysLeft = daysUntil(access.state === 'GRACE' ? access.graceEndsAt : access.endsAt, now);

  return (
    <>
      <PageHeader
        title="Subscription"
        description="Your plan, what it includes, and how much of it you are using."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Subscription' }]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Your plan" className="lg:col-span-2">
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-bold tracking-tight">{access.plan.name}</span>
              <AccessBadge state={access.state} />
              {store.status !== 'TRIAL' && store.plan !== access.plan.id && (
                <span className="text-xs text-muted-foreground">(bought: {PLANS[store.plan].name})</span>
              )}
            </div>
            <p className="text-sm">{accessHeadline(access, now)}</p>

            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="font-medium">{STATUS_LABEL[store.status]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{endLabel}</dt>
                <dd className="font-medium">{access.endsAt ? formatDate(access.endsAt) : 'No end date'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {access.state === 'GRACE' ? 'Read-only from' : 'Time left'}
                </dt>
                <dd className="font-medium">
                  {access.state === 'GRACE' && access.graceEndsAt
                    ? formatDate(access.graceEndsAt)
                    : daysLeft === null
                      ? '—'
                      : access.state === 'READ_ONLY'
                        ? 'Ended'
                        : `${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
                </dd>
              </div>
            </dl>

            {(access.state === 'GRACE' || access.state === 'READ_ONLY') && (
              <div role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                {access.state === 'GRACE'
                  ? 'Your store works normally during the grace period. Renew before it ends to avoid read-only mode.'
                  : 'Sales, stock changes, product edits and staff changes are paused. Sign-in, viewing, exports your plan includes, and closing an open shift still work. Renewing restores everything immediately — no data was removed.'}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Renew or upgrade">
          <div className="space-y-3 p-4 text-sm">
            <p className="flex items-start gap-2">
              <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Pay by GCash or bank transfer, then send the reference number to the platform administrator.
            </p>
            <p className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Your plan starts or extends as soon as the administrator confirms the payment. Paying early never loses days.
            </p>
            <p className="flex items-start gap-2">
              <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Downgrading never deletes data. Anything over a lower plan&apos;s limits stays; you just cannot add more.
            </p>
          </div>
        </Panel>

        <Panel title="Usage" description="Counted live from your store’s records." className="lg:col-span-3">
          <div className="grid gap-5 p-4 sm:grid-cols-2">
            {meters.map((meter) => (
              <UsageMeter key={meter.key} meter={meter} />
            ))}
          </div>
        </Panel>

        <Panel title="Compare plans" description="Contact the platform administrator to change plans." className="lg:col-span-3">
          <PlanComparison current={access.plan.id} />
        </Panel>

        <Panel title="Subscription changes" description="Plan, status, trial and payment changes made for your store." className="lg:col-span-3">
          {history.length === 0 ? (
            <PanelEmpty icon={History} title="No changes yet" description="Changes to your subscription will be listed here." />
          ) : (
            <ul className="divide-y">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <p className="min-w-0 text-sm">{entry.summary}</p>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Payment history" description="Payments confirmed by the platform administrator." className="lg:col-span-3">
          {payments.length === 0 ? (
            <PanelEmpty icon={Receipt} title="No payments yet" description="Confirmed payments will be listed here." />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Payment history</caption>
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-2 font-medium">Paid</th>
                    <th scope="col" className="px-4 py-2 font-medium">Plan</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Amount</th>
                    <th scope="col" className="px-4 py-2 font-medium">Method</th>
                    <th scope="col" className="px-4 py-2 font-medium">Reference</th>
                    <th scope="col" className="px-4 py-2 font-medium">Covers</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className={payment.voidedAt ? 'border-b text-muted-foreground line-through last:border-0' : 'border-b last:border-0'}>
                      <td className="px-4 py-2.5">{formatDateTime(payment.paidAt)}</td>
                      <td className="px-4 py-2.5">{PLANS[payment.plan].name}, {payment.months} mo</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">₱{payment.amount.toFixed(2)}</td>
                      <td className="px-4 py-2.5">{PAYMENT_METHOD_LABEL[payment.method]}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{payment.reference}</td>
                      <td className="px-4 py-2.5">
                        {formatDate(payment.periodStart)} – {formatDate(payment.periodEnd)}
                        {payment.voidedAt && <span className="ml-1 no-underline">(void: {payment.voidReason})</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
