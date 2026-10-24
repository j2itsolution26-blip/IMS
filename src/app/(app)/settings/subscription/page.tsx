import type { Metadata } from 'next';
import { CalendarClock, CreditCard, FileText, History, LifeBuoy, Receipt } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getStoreContext } from '@/lib/tenant/context';
import { formatDate, formatDateTime } from '@/lib/format';
import { STATUS_LABEL, PAYMENT_METHOD_LABEL, accessHeadline, daysUntil } from '@/lib/subscription';
import { PLANS } from '@/lib/plans';
import { PageHeader } from '@/components/page-header';
import { Panel, PanelEmpty } from '@/components/panel';
import { AccessBadge, PlanComparison, UsageMeter } from '@/features/subscription/plan-display';
import { auditHistoryStart, usageSummary } from '@/server/services/entitlements';
import { BILLING_LABEL, INTERVAL_LABEL, LIFECYCLE_LABEL, billingSnapshot } from '@/lib/billing';
import { getBillingConfig } from '@/server/platform/billing-service';
import { BillingPanel } from '@/features/billing/billing-panel';
import { runBillingRemindersForStore } from '@/server/platform/billing-reminders';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = { title: 'Subscription & Billing' };
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

  // Raise any reminder this store is owed before reading, so the bell and this
  // page agree even if the daily job did not run. Idempotent.
  await runBillingRemindersForStore(store.id, now).catch((error) => console.error('[billing] reminder check failed', error));

  const historyStart = auditHistoryStart(ctx, now);
  const [meters, payments, history, invoices, config] = await Promise.all([
    usageSummary(ctx),
    ctx.db.subscriptionPayment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, plan: true, amount: true, method: true, reference: true, paidAt: true,
        months: true, periodStart: true, periodEnd: true, voidedAt: true, voidReason: true,
        status: true, rejectReason: true, rejectedAt: true, invoiceId: true, createdAt: true,
      },
    }),
    ctx.db.auditLog.findMany({
      where: {
        entity: { in: ['Store', 'SubscriptionPayment', 'Invoice'] },
        action: { in: ['SUBSCRIPTION', 'PAYMENT', 'CREATE'] },
        ...(historyStart && { createdAt: { gte: historyStart } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, summary: true, createdAt: true },
    }),
    ctx.db.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true, number: true, plan: true, interval: true, amount: true, periodStart: true, periodEnd: true,
        dueAt: true, status: true, paidAt: true, voidReason: true,
      },
    }),
    getBillingConfig(),
  ]);

  const openInvoice = invoices.find((invoice) => invoice.status === 'OPEN') ?? null;
  const invoicePayments = openInvoice ? payments.filter((payment) => payment.invoiceId === openInvoice.id) : [];
  const pendingPayment = invoicePayments.find((payment) => payment.status === 'PENDING') ?? null;
  const lastRejection = invoicePayments.find((payment) => payment.status === 'REJECTED') ?? null;
  const billing = billingSnapshot({
    subscription: store,
    openInvoice: openInvoice ? { id: openInvoice.id, dueAt: openInvoice.dueAt } : null,
    hasPendingPayment: pendingPayment !== null,
    now,
  });
  const canManage = userCan(user, 'billing.manage');

  const endLabel = access.state === 'TRIAL' ? 'Trial ends' : 'Current period ends';
  const daysLeft = daysUntil(access.state === 'GRACE' ? access.graceEndsAt : access.endsAt, now);

  return (
    <>
      <PageHeader
        title="Subscription & Billing"
        description="Your plan, what you owe (if anything), and how much of your plan you are using."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Subscription & Billing' }]}
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
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={billing.lifecycle === 'TRIAL_EXPIRED' || billing.lifecycle === 'PAID_PERIOD_ENDED' ? 'warning' : 'secondary'}
              >
                {LIFECYCLE_LABEL[billing.lifecycle]}
              </Badge>
              {billing.billing ? (
                <Badge variant={billing.billing === 'PAST_DUE' ? 'destructive' : billing.billing === 'PAYMENT_DUE' ? 'warning' : 'default'}>
                  {BILLING_LABEL[billing.billing]}
                </Badge>
              ) : (
                <Badge variant="outline">Nothing owed</Badge>
              )}
            </div>

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

        <Panel title="How billing works">
          <div className="space-y-3 p-4 text-sm">
            <p className="flex items-start gap-2">
              <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Choose a plan to get an invoice, pay by GCash or bank transfer, then report the reference number here.
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

        <Panel
          title="Billing"
          description={
            openInvoice
              ? 'An invoice you agreed to. Pay it, then report the payment.'
              : 'Reminders are informational: you owe nothing until you choose a plan.'
          }
          className="lg:col-span-3"
        >
          <BillingPanel
            canManage={canManage}
            subscription={{
              status: store.status,
              trialEndsAt: store.trialEndsAt?.toISOString() ?? null,
              currentPeriodEnd: store.currentPeriodEnd?.toISOString() ?? null,
            }}
            prices={config.prices}
            terms={config.terms ? { version: config.terms.version, body: config.terms.body } : null}
            paymentInstructions={config.paymentInstructions}
            openInvoice={
              openInvoice && billing.billing
                ? {
                    id: openInvoice.id,
                    number: openInvoice.number,
                    plan: openInvoice.plan,
                    interval: openInvoice.interval,
                    amount: Number(openInvoice.amount),
                    periodStart: openInvoice.periodStart.toISOString(),
                    periodEnd: openInvoice.periodEnd.toISOString(),
                    dueAt: openInvoice.dueAt.toISOString(),
                    flag: billing.billing,
                    pending: pendingPayment
                      ? {
                          method: pendingPayment.method,
                          reference: pendingPayment.reference,
                          submittedAt: pendingPayment.createdAt.toISOString(),
                        }
                      : null,
                    lastRejection:
                      lastRejection?.rejectReason && lastRejection.rejectedAt
                        ? { reason: lastRejection.rejectReason, at: lastRejection.rejectedAt.toISOString() }
                        : null,
                  }
                : null
            }
          />
        </Panel>

        <Panel title="Usage" description="Counted live from your store’s records." className="lg:col-span-3">
          <div className="grid gap-5 p-4 sm:grid-cols-2">
            {meters.map((meter) => (
              <UsageMeter key={meter.key} meter={meter} />
            ))}
          </div>
        </Panel>

        <Panel title="Compare plans" description="What each plan includes. Choose one under Billing." className="lg:col-span-3">
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

        <Panel title="Invoices" description="Plans you chose and agreed to pay for." className="lg:col-span-3">
          {invoices.length === 0 ? (
            <PanelEmpty icon={FileText} title="No invoices" description="Choosing a plan issues an invoice. None has been issued." />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Invoices</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="h-10 px-4 font-semibold">Invoice</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
                    <th scope="col" className="h-10 px-4 text-right font-semibold">Amount</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Covers</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Due</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs">{invoice.number}</td>
                      <td className="px-4 py-2.5">
                        {PLANS[invoice.plan].name}, {INTERVAL_LABEL[invoice.interval].toLowerCase()}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">₱{Number(invoice.amount).toFixed(2)}</td>
                      <td className="px-4 py-2.5">
                        {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                      </td>
                      <td className="px-4 py-2.5">{formatDate(invoice.dueAt)}</td>
                      <td className="px-4 py-2.5">
                        {invoice.status === 'PAID' ? (
                          <Badge variant="success">Paid{invoice.paidAt ? ` ${formatDate(invoice.paidAt)}` : ''}</Badge>
                        ) : invoice.status === 'VOID' ? (
                          <span className="text-xs text-muted-foreground">Void: {invoice.voidReason}</span>
                        ) : (
                          <Badge variant="warning">Open</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Payment history"
          description="Payments you reported and payments the administrator recorded. Only verified payments count."
          className="lg:col-span-3"
        >
          {payments.length === 0 ? (
            <PanelEmpty icon={Receipt} title="No payments yet" description="Payments you report, or the administrator records, will be listed here." />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">Payment history</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="h-10 px-4 font-semibold">Paid</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
                    <th scope="col" className="h-10 px-4 text-right font-semibold">Amount</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Method</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Reference</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Covers</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Status</th>
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
                      <td className="px-4 py-2.5">
                        {payment.status === 'VERIFIED' ? (
                          <Badge variant="success">Verified</Badge>
                        ) : payment.status === 'PENDING' ? (
                          <Badge variant="default">Awaiting verification</Badge>
                        ) : (
                          <span className="text-xs text-destructive-text">Rejected: {payment.rejectReason}</span>
                        )}
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
