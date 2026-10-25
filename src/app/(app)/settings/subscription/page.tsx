import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission, userCan } from '@/lib/session';
import { getStoreContext } from '@/lib/tenant/context';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { auditHistoryStart, usageSummary } from '@/server/services/entitlements';
import { billingBannerKind, billingSnapshot, invoiceDisplayStatus, paymentDisplayStatus, paymentState } from '@/lib/billing';
import { getBillingConfig } from '@/server/platform/billing-service';
import { reportableMethods } from '@/lib/payment-accounts';
import { runBillingRemindersForStore } from '@/server/platform/billing-reminders';
import { countMyActiveTickets } from '@/server/support/support-service';
import { SubscriptionSummary } from '@/features/billing/subscription-summary';
import { UsageOverview } from '@/features/billing/usage-overview';
import { PlanCards } from '@/features/billing/plan-cards';
import { BillingSteps } from '@/features/billing/billing-steps';
import { BillingBanner } from '@/features/billing/billing-banner';
import { InvoicePayment } from '@/features/billing/invoice-payment';
import { InvoicesTable } from '@/features/billing/invoices-table';
import { PaymentsTable } from '@/features/billing/payments-table';
import { ActivityTimeline } from '@/features/billing/activity-timeline';
import type { InvoiceRow, OpenInvoiceInfo, PaymentRow } from '@/features/billing/types';

export const metadata: Metadata = { title: 'Subscription & Billing' };
export const dynamic = 'force-dynamic';

/**
 * Settings → Subscription & Billing: the store's plan, where it stands, what
 * it is using, what (if anything) it owes, and its billing history. Every
 * number is read on the server with the same rules the limits and billing
 * actions are enforced by; the page only presents them.
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
  const [meters, payments, history, invoices, config, storeRow] = await Promise.all([
    usageSummary(ctx),
    ctx.db.subscriptionPayment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, plan: true, amount: true, method: true, reference: true, paidAt: true,
        months: true, periodStart: true, periodEnd: true, voidedAt: true, voidReason: true,
        status: true, rejectReason: true, invoiceId: true, createdAt: true,
        rejectedAt: true, verifiedAt: true, recordedById: true, notes: true,
        invoice: { select: { number: true } },
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
      select: { id: true, entity: true, summary: true, createdAt: true },
    }),
    ctx.db.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true, number: true, plan: true, interval: true, amount: true, periodStart: true, periodEnd: true,
        dueAt: true, status: true, paidAt: true, voidReason: true, createdAt: true, termsVersion: true,
      },
    }),
    getBillingConfig(),
    ctx.db.store.findUnique({ where: { id: store.id }, select: { billingInterval: true } }),
  ]);

  // Who recorded each payment, without naming platform administrators: the
  // store-scoped client only finds this store's own members.
  const recorderIds = [...new Set(payments.map((payment) => payment.recordedById))];
  const members = recorderIds.length
    ? await ctx.db.user.findMany({ where: { id: { in: recorderIds } }, select: { id: true, name: true } })
    : [];
  const memberName = new Map(members.map((member) => [member.id, member.name]));
  const recorderLabel = (id: string) => (id === user.id ? 'You' : (memberName.get(id) ?? 'Platform administrator'));

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
  const canContactSupport = userCan(user, 'support.create');
  const suspended = access.state === 'SUSPENDED';
  const onTrial = store.status === 'TRIAL';
  const selfService = config.prices.some((price) => price.amount > 0) && config.terms !== null;
  const pricesPublished = config.prices.some((price) => price.amount > 0);
  const unpublished =
    !pricesPublished && !config.terms ? 'prices and billing terms' : !pricesPublished ? 'prices' : !config.terms ? 'billing terms' : null;
  const billingInterval = storeRow?.billingInterval ?? null;
  // Only the signed-in user's own tickets, as on the Support page.
  const openBillingTickets = canContactSupport
    ? await countMyActiveTickets(user.id, 'BILLING').catch((error) => {
        console.error('[billing] support ticket count failed', error);
        return 0;
      })
    : 0;

  const lastPaidInvoice = invoices.find((invoice) => invoice.status === 'PAID' && invoice.plan === access.plan.id) ?? null;

  const openInvoiceInfo: OpenInvoiceInfo | null =
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
            ? { method: pendingPayment.method, reference: pendingPayment.reference, submittedAt: pendingPayment.createdAt.toISOString() }
            : null,
          lastRejection:
            lastRejection?.rejectReason && lastRejection.rejectedAt
              ? { reason: lastRejection.rejectReason, at: lastRejection.rejectedAt.toISOString() }
              : null,
        }
      : null;

  const invoiceRows: InvoiceRow[] = invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    plan: invoice.plan,
    interval: invoice.interval,
    amount: Number(invoice.amount),
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    issuedAt: invoice.createdAt.toISOString(),
    dueAt: invoice.dueAt.toISOString(),
    paidAt: invoice.paidAt?.toISOString() ?? null,
    voidReason: invoice.voidReason,
    status: invoiceDisplayStatus(
      invoice,
      payments.some((payment) => payment.invoiceId === invoice.id && payment.status === 'PENDING'),
      now,
    ),
    termsVersion: invoice.termsVersion,
  }));

  const paymentRows: PaymentRow[] = payments.map((payment) => {
    const byStore = payment.recordedById === user.id || memberName.has(payment.recordedById);
    return {
      id: payment.id,
      paidAt: payment.paidAt.toISOString(),
      submittedAt: payment.createdAt.toISOString(),
      amount: Number(payment.amount),
      method: payment.method,
      reference: payment.reference,
      plan: payment.plan,
      months: payment.months,
      periodStart: payment.periodStart.toISOString(),
      periodEnd: payment.periodEnd.toISOString(),
      status: paymentDisplayStatus(payment),
      rejectReason: payment.rejectReason,
      voidReason: payment.voidReason,
      recordedBy: recorderLabel(payment.recordedById),
      verifiedAt: payment.verifiedAt?.toISOString() ?? null,
      invoiceNumber: payment.invoice?.number ?? null,
      // An administrator's notes on a payment they recorded stay with the administrator.
      notes: byStore ? payment.notes : null,
    };
  });

  // The one thing to do next: pay what is owed, otherwise look at the plans.
  const primaryAction = openInvoiceInfo
    ? { href: '#outstanding-invoice', label: canManage && !openInvoiceInfo.pending && !suspended ? 'Pay invoice' : 'View invoice' }
    : selfService && canManage && !suspended
      ? { href: '#plans', label: onTrial || access.state === 'READ_ONLY' ? 'Choose a plan' : 'Manage plan' }
      : { href: '#plans', label: 'View plans' };

  return (
    <div className="no-print">
      <PageHeader
        title="Subscription & Billing"
        description="Manage your plan, payments, invoices, and usage."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Subscription & Billing' }]}
        actions={<span className="hidden text-xs text-muted-foreground md:inline">As of {formatDateTime(now)}</span>}
      />

      <div className="space-y-5">
        {/* An open invoice comes first: what is owed must not sit below the fold. */}
        {openInvoiceInfo && (
          <Panel
            id="outstanding-invoice"
            title="Outstanding invoice"
            description="You chose this plan and agreed to pay. Pay it, then report the payment for verification."
            className="scroll-mt-20"
          >
            <InvoicePayment
              canManage={canManage}
              suspended={suspended}
              paymentInstructions={config.paymentInstructions}
              invoice={openInvoiceInfo}
              methods={reportableMethods(config.paymentAccounts)}
            />
          </Panel>
        )}

        <Card id="plans" className="min-w-0 scroll-mt-20 overflow-hidden rounded-card">
          <PlanCards
            prices={config.prices}
            terms={config.terms ? { version: config.terms.version, body: config.terms.body } : null}
            paymentInstructions={config.paymentInstructions}
            canManage={canManage}
            effectivePlan={access.plan.id}
            paidPlan={onTrial ? null : store.plan}
            onTrial={onTrial}
            billingInterval={billingInterval}
            subscription={{
              status: store.status,
              trialEndsAt: store.trialEndsAt?.toISOString() ?? null,
              currentPeriodEnd: store.currentPeriodEnd?.toISOString() ?? null,
            }}
            openInvoiceNumber={openInvoice?.number ?? null}
            suspended={suspended}
            banner={
              <BillingBanner
                kind={billingBannerKind({ accessState: access.state, billing: billing.billing, selfService })}
                planName={access.plan.name}
                endsAt={access.state === 'GRACE' ? access.graceEndsAt : access.endsAt}
                invoice={openInvoiceInfo ? { number: openInvoiceInfo.number, amount: openInvoiceInfo.amount, dueAt: openInvoice!.dueAt } : null}
                selfService={selfService}
                unpublished={unpublished}
              />
            }
          />
        </Card>

        <SubscriptionSummary
          access={access}
          status={store.status}
          boughtPlan={!onTrial && store.plan !== access.plan.id ? store.plan : null}
          billingInterval={onTrial ? null : billingInterval}
          lastPaid={lastPaidInvoice ? { amount: Number(lastPaidInvoice.amount), interval: lastPaidInvoice.interval } : null}
          amountDue={openInvoiceInfo ? { number: openInvoiceInfo.number, amount: openInvoiceInfo.amount, dueAt: openInvoice!.dueAt } : null}
          payment={paymentState(billing.billing)}
          primaryAction={primaryAction}
          canContactSupport={canContactSupport}
          openBillingTickets={openBillingTickets}
          now={now}
        />


        <BillingSteps paymentInstructions={config.paymentInstructions} />

        <UsageOverview meters={meters} plan={access.plan} canManage={canManage} />

        <Panel
          id="billing-history"
          title="Billing history"
          description="Your invoices, payments, and plan changes."
          className="scroll-mt-20"
        >
          <Tabs defaultValue="invoices">
            <div className="overflow-x-auto scrollbar-none border-b px-4 py-2">
              <TabsList>
                <TabsTrigger value="invoices">Invoices ({invoiceRows.length})</TabsTrigger>
                <TabsTrigger value="payments">Payments ({paymentRows.length})</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="invoices" className="mt-0">
              <InvoicesTable
                invoices={invoiceRows}
                storeName={store.name}
                emptyAction={
                  selfService && canManage && !suspended ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link href="#plans">Compare plans</Link>
                    </Button>
                  ) : undefined
                }
              />
            </TabsContent>
            <TabsContent value="payments" className="mt-0">
              <PaymentsTable payments={paymentRows} />
            </TabsContent>
            <TabsContent value="activity" className="mt-0">
              <ActivityTimeline
                entries={history.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }))}
                historyDays={access.plan.auditHistoryDays}
              />
            </TabsContent>
          </Tabs>
        </Panel>
      </div>
    </div>
  );
}
