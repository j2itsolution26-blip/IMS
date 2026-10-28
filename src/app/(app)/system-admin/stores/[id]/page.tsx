import { ResetDemoButton } from '@/features/platform/reset-demo-button';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertTriangle, CalendarClock, FileText, History, Mail, Receipt, UserRound } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getStoreDetail } from '@/features/platform/queries';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { PLANS } from '@/lib/plans';
import { storeAccess } from '@/lib/store-access';
import { PAYMENT_METHOD_LABEL, STATUS_LABEL, accessHeadline } from '@/lib/subscription';
import { countdownText, invoiceBadge, paymentBadge, periodCountdown } from '@/lib/store-detail-display';
import { PageHeader } from '@/components/page-header';
import { AccessBadge } from '@/features/subscription/plan-display';
import { StoreControls, VoidPaymentButton } from '@/features/platform/store-subscription-manager';
import { usagePeriod } from '@/server/services/entitlements';
import { VoidInvoiceButton } from '@/features/platform/billing-queue';
import { INTERVAL_LABEL } from '@/lib/billing';
import { getBillingConfig } from '@/server/platform/billing-service';
import {
  HistoryTimeline,
  PlanBadge,
  AdminPlanCards,
  SECTION_ICON,
  SectionCard,
  SectionEmpty,
  ToneBadge,
  UsageTile,
  sectionText,
  sectionTint,
} from '@/features/platform/store-detail-parts';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Store subscription' };
export const dynamic = 'force-dynamic';

const peso = (amount: string) => formatCurrency(Number(amount), 'PHP');

const TONE_TEXT = {
  success: 'text-success-text',
  info: 'text-sec-subscription-text',
  warning: 'text-warning-text',
  danger: 'text-destructive-text',
  neutral: 'text-muted-foreground',
} as const;

export default async function StoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission('platform.view');
  const { id } = await params;
  const [detail, config] = await Promise.all([getStoreDetail(id, usagePeriod()), getBillingConfig()]);
  if (!detail) notFound();

  const { store, usage, payments, invoices, history } = detail;
  const now = new Date();
  const access = storeAccess(store, now);
  const limits = access.plan.limits;
  const canManage = userCan(admin, 'platform.manage');
  const countdown = periodCountdown(access, now);
  const countdownLine = countdownText(countdown.days);
  const openInvoice = invoices.find((invoice) => invoice.status === 'OPEN') ?? null;
  const openBadge = openInvoice ? invoiceBadge(openInvoice, now) : null;
  // The most recent live, verified payment is the only one that can be voided
  // (see voidPayment); pending or rejected reports are not money received.
  const voidable = payments.find(
    (payment) =>
      payment.status === 'VERIFIED' &&
      !payment.voidedAt &&
      store.currentPeriodEnd &&
      payment.periodEnd.getTime() === store.currentPeriodEnd.getTime(),
  );

  return (
    <>
      <PageHeader
        title={store.name}
        description={accessHeadline(access, now).replace(/^Your /, 'The ')}
        breadcrumbs={[{ label: 'Stores', href: '/system-admin/stores' }, { label: store.name }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {store.isDemo && canManage && <ResetDemoButton storeId={store.id} storeName={store.name} />}
            <StoreControls storeId={store.id} storeName={store.name} plan={store.plan} status={store.status} canManage={canManage} />
          </div>
        }
      />

      {store.isDemo && (
        <p role="status" className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-text">
          <span className="font-bold tracking-wider">DEMO</span> — a demonstration store with sample data. It is never billed, is
          left out of platform figures and reminders, and its data can be reset. It cannot become a real store.
        </p>
      )}

      {/* At a glance: plan, access, the clock, the owner. */}
      <div className="mb-5 flex flex-col gap-4 rounded-card border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <PlanBadge plan={access.plan.id} />
          <AccessBadge state={access.state} />
          {store.plan !== access.plan.id && <span className="text-xs text-muted-foreground">Bought: {PLANS[store.plan].name}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <div className="flex items-center gap-2.5">
            <CalendarClock className={cn('h-5 w-5', TONE_TEXT[countdown.tone])} aria-hidden="true" />
            <div>
              <p className="text-xs text-muted-foreground">{countdown.label}</p>
              <p className="font-semibold">
                {countdown.date ? formatDate(countdown.date) : '—'}
                {countdownLine && <span className={cn('ml-1.5 font-medium', TONE_TEXT[countdown.tone])}>· {countdownLine}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <UserRound className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Owner</p>
              <p className="font-semibold">{store.ownerName ?? 'None yet'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <SectionCard section="subscription" icon={SECTION_ICON.subscription} title="Subscription" description="What applies now, and until when.">
          <div className="space-y-4 p-4 sm:p-5">
            <div className={cn('rounded-xl p-4', sectionTint('subscription'))}>
              <p className="text-xs font-medium text-muted-foreground">{countdown.label}</p>
              {countdown.days !== null ? (
                <p className={cn('mt-0.5 text-3xl font-extrabold tabular-nums', sectionText('subscription'), countdown.tone === 'warning' && 'text-warning-text')}>
                  {countdown.days}
                  <span className="ml-1 text-base font-semibold">day{countdown.days === 1 ? '' : 's'} left</span>
                </p>
              ) : (
                <p className={cn('mt-0.5 text-xl font-bold', TONE_TEXT[countdown.tone])}>{access.state === 'SUSPENDED' ? 'Suspended' : 'Ended'}</p>
              )}
              {countdown.date && <p className="text-sm text-muted-foreground">{formatDate(countdown.date)}</p>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Plan in effect</dt>
                <dd className="mt-0.5 font-semibold">{access.plan.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Plan bought</dt>
                <dd className="mt-0.5 font-medium">{PLANS[store.plan].name}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="mt-0.5 font-medium">{STATUS_LABEL[store.status]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Access</dt>
                <dd className="mt-0.5">
                  <AccessBadge state={access.state} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Trial ends</dt>
                <dd className="mt-0.5 font-medium">{store.trialEndsAt ? formatDate(store.trialEndsAt) : '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Paid until</dt>
                <dd className="mt-0.5 font-medium">{store.currentPeriodEnd ? formatDate(store.currentPeriodEnd) : '—'}</dd>
              </div>
              {access.graceEndsAt && (
                <div className="col-span-2 rounded-lg bg-warning/10 px-3 py-2">
                  <dt className="text-xs text-warning-text">Read-only from</dt>
                  <dd className="font-semibold text-warning-text">{formatDate(access.graceEndsAt)}</dd>
                </div>
              )}
              <div className="col-span-2 border-t pt-3">
                <dt className="text-xs text-muted-foreground">Owner</dt>
                <dd className="mt-0.5 font-medium">{store.ownerName ?? 'None yet'}</dd>
                {store.ownerEmail && (
                  <dd className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" aria-hidden="true" /> {store.ownerEmail}
                  </dd>
                )}
              </div>
            </dl>
          </div>
        </SectionCard>

        <SectionCard
          section="usage"
          icon={SECTION_ICON.usage}
          title="Usage"
          description={`Counted against the ${access.plan.name} plan in effect.`}
          className="lg:col-span-2"
        >
          <div className="grid flex-1 gap-3 p-4 sm:grid-cols-2 sm:p-5">
            <UsageTile meter={{ key: 'products', used: usage.products, limit: limits.products }} />
            <UsageTile meter={{ key: 'staff', used: usage.staff, limit: limits.staff }} />
            <UsageTile meter={{ key: 'branches', used: usage.branches, limit: limits.branches }} />
            <UsageTile meter={{ key: 'backgroundRemovalsPerMonth', used: usage.backgroundRemovals, limit: limits.backgroundRemovalsPerMonth }} />
          </div>
        </SectionCard>

        <SectionCard
          section="invoices"
          icon={SECTION_ICON.invoices}
          title="Invoices"
          description="Plans the owner chose, with the terms version they accepted."
          className="lg:col-span-3"
        >
          {openInvoice && openBadge && (
            <div
              role="status"
              className={cn(
                'm-4 flex flex-col gap-3 rounded-xl border p-4 sm:m-5 sm:flex-row sm:items-center sm:justify-between',
                openBadge.tone === 'danger' ? 'border-destructive/40 bg-destructive/5' : 'border-sec-invoices/40 bg-sec-invoices-tint',
              )}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className={cn('mt-0.5 h-5 w-5 shrink-0', openBadge.tone === 'danger' ? 'text-destructive-text' : sectionText('invoices'))}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-semibold">
                    Outstanding invoice <span className="font-mono">{openInvoice.number}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {PLANS[openInvoice.plan].name}, {INTERVAL_LABEL[openInvoice.interval].toLowerCase()} · due {formatDate(openInvoice.dueAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 pl-8 sm:pl-0">
                <span className="tabular text-2xl font-bold">{peso(openInvoice.amount)}</span>
                <ToneBadge tone={openBadge.tone}>{openBadge.label}</ToneBadge>
              </div>
            </div>
          )}
          {invoices.length === 0 ? (
            <SectionEmpty section="invoices" icon={FileText} title="No invoices" description="The owner has not chosen a paid plan." />
          ) : (
            <>
              <ul className="divide-y border-t md:hidden">
                {invoices.map((invoice) => {
                  const badge = invoiceBadge(invoice, now);
                  return (
                    <li key={invoice.id} className="space-y-1 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{invoice.number}</span>
                        <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span>
                          {PLANS[invoice.plan].name}, {INTERVAL_LABEL[invoice.interval].toLowerCase()}
                        </span>
                        <span className="tabular font-semibold">{peso(invoice.amount)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)} · due {formatDate(invoice.dueAt)}
                      </p>
                      {invoice.status === 'VOID' && invoice.voidReason && <p className="text-xs text-muted-foreground">Void: {invoice.voidReason}</p>}
                      {canManage && invoice.status === 'OPEN' && !invoice.hasPendingPayment && (
                        <VoidInvoiceButton invoiceId={invoice.id} storeId={store.id} number={invoice.number} />
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="relative hidden overflow-x-auto border-t md:block">
                <table className="w-full min-w-[820px] text-sm">
                  <caption className="sr-only">Invoices</caption>
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th scope="col" className="h-10 px-5 font-semibold">Invoice</th>
                      <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
                      <th scope="col" className="h-10 px-4 text-right font-semibold">Amount</th>
                      <th scope="col" className="h-10 px-4 font-semibold">Covers</th>
                      <th scope="col" className="h-10 px-4 font-semibold">Due</th>
                      <th scope="col" className="h-10 px-4 font-semibold">Status</th>
                      <th scope="col" className="px-5 py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => {
                      const badge = invoiceBadge(invoice, now);
                      return (
                        <tr key={invoice.id} className="border-b align-top transition-colors last:border-0 hover:bg-muted/30">
                          <td className="px-5 py-3">
                            <span className="font-mono text-xs font-medium">{invoice.number}</span>
                            <span className="block text-xs text-muted-foreground">
                              Terms v{invoice.termsVersion}, accepted {formatDateTime(invoice.acceptedAt)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {PLANS[invoice.plan].name}
                            <span className="block text-xs text-muted-foreground">{INTERVAL_LABEL[invoice.interval]}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums">{peso(invoice.amount)}</td>
                          <td className="px-4 py-3">
                            {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                          </td>
                          <td className="px-4 py-3">{formatDate(invoice.dueAt)}</td>
                          <td className="px-4 py-3">
                            <ToneBadge tone={badge.tone}>
                              {badge.label}
                              {invoice.status === 'PAID' && invoice.paidAt ? ` ${formatDate(invoice.paidAt)}` : ''}
                            </ToneBadge>
                            {invoice.status === 'VOID' && invoice.voidReason && (
                              <span className="mt-1 block text-xs text-muted-foreground">{invoice.voidReason}</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {canManage && invoice.status === 'OPEN' && !invoice.hasPendingPayment && (
                              <VoidInvoiceButton invoiceId={invoice.id} storeId={store.id} number={invoice.number} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard
          section="payments"
          icon={SECTION_ICON.payments}
          title="Payments"
          description="Verified, reported and rejected payments. Permanent; mistakes are voided, not deleted."
          className="lg:col-span-3"
        >
          {payments.length === 0 ? (
            <SectionEmpty section="payments" icon={Receipt} title="No payments recorded" description="Use Record payment once the money has arrived." />
          ) : (
            <>
              <ul className="divide-y md:hidden">
                {payments.map((payment) => {
                  const badge = paymentBadge(payment);
                  return (
                    <li key={payment.id} className="space-y-1 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span>{formatDate(payment.paidAt)}</span>
                        <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span>
                          {PAYMENT_METHOD_LABEL[payment.method]} · <span className="font-mono text-xs">{payment.reference}</span>
                        </span>
                        <span className={cn('tabular font-semibold', payment.voidedAt && 'text-muted-foreground line-through')}>{peso(payment.amount)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {PLANS[payment.plan].name}, {payment.months} mo · by {payment.recordedBy}
                      </p>
                      {payment.status === 'REJECTED' && payment.rejectReason && <p className="text-xs text-destructive-text">{payment.rejectReason}</p>}
                      {canManage && voidable?.id === payment.id && (
                        <VoidPaymentButton paymentId={payment.id} storeId={store.id} reference={payment.reference} />
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="relative hidden overflow-x-auto md:block">
                <table className="w-full min-w-[880px] text-sm">
                  <caption className="sr-only">Payments</caption>
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th scope="col" className="h-10 px-5 font-semibold">Received</th>
                      <th scope="col" className="h-10 px-4 font-semibold">Status</th>
                      <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
                      <th scope="col" className="h-10 px-4 text-right font-semibold">Amount</th>
                      <th scope="col" className="h-10 px-4 font-semibold">Method · reference</th>
                      <th scope="col" className="h-10 px-4 font-semibold">Covers</th>
                      <th scope="col" className="h-10 px-4 font-semibold">Recorded by</th>
                      <th scope="col" className="px-5 py-2"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => {
                      const badge = paymentBadge(payment);
                      return (
                        <tr key={payment.id} className="border-b align-top transition-colors last:border-0 hover:bg-muted/30">
                          <td className="px-5 py-3">{formatDate(payment.paidAt)}</td>
                          <td className="px-4 py-3">
                            <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
                            {payment.status === 'REJECTED' && payment.rejectReason && !payment.voidedAt && (
                              <span className="mt-1 block max-w-[14rem] text-xs text-destructive-text">{payment.rejectReason}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {PLANS[payment.plan].name}
                            <span className="block text-xs text-muted-foreground">{payment.months} mo</span>
                          </td>
                          <td className={cn('px-4 py-3 text-right font-semibold tabular-nums', payment.voidedAt && 'font-normal text-muted-foreground line-through')}>
                            {peso(payment.amount)}
                          </td>
                          <td className="px-4 py-3">
                            {PAYMENT_METHOD_LABEL[payment.method]} · <span className="font-mono text-xs">{payment.reference}</span>
                            {payment.invoiceNumber && <span className="block font-mono text-[11px] text-muted-foreground">{payment.invoiceNumber}</span>}
                            {payment.notes && <span className="block text-xs text-muted-foreground">{payment.notes}</span>}
                          </td>
                          <td className="px-4 py-3">
                            {formatDate(payment.periodStart)} – {formatDate(payment.periodEnd)}
                            {payment.voidedAt && (
                              <span className="block text-xs text-destructive-text">
                                Void {formatDate(payment.voidedAt)} by {payment.voidedBy}: {payment.voidReason}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {payment.recordedBy}
                            <span className="block text-xs text-muted-foreground">{formatDateTime(payment.createdAt)}</span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            {canManage && voidable?.id === payment.id && (
                              <VoidPaymentButton paymentId={payment.id} storeId={store.id} reference={payment.reference} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard
          section="history"
          icon={SECTION_ICON.history}
          title="Subscription history"
          description="Plan, status, trial and payment changes, with who made them."
          className="lg:col-span-3"
        >
          {history.length === 0 ? (
            <SectionEmpty section="history" icon={History} title="No changes yet" description="Changes made here are recorded automatically." />
          ) : (
            <HistoryTimeline entries={history} storeName={store.name} />
          )}
        </SectionCard>

        <SectionCard section="plans" icon={SECTION_ICON.plans} title="Plans" description="What each plan allows. The store's plan in effect is highlighted." className="lg:col-span-3">
          <AdminPlanCards
            prices={config.prices}
            effectivePlan={access.plan.id}
            paidPlan={store.status === 'TRIAL' ? null : store.plan}
            onTrial={store.status === 'TRIAL'}
            canManage={canManage}
          />
        </SectionCard>
      </div>
    </>
  );
}
