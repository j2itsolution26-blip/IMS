import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { History, Receipt } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getStoreDetail } from '@/features/platform/queries';
import { formatDate, formatDateTime } from '@/lib/format';
import { PLANS } from '@/lib/plans';
import { storeAccess } from '@/lib/store-access';
import { PAYMENT_METHOD_LABEL, STATUS_LABEL, accessHeadline } from '@/lib/subscription';
import { PageHeader } from '@/components/page-header';
import { Panel, PanelEmpty } from '@/components/panel';
import { AccessBadge, PlanComparison, UsageMeter } from '@/features/subscription/plan-display';
import { StoreControls, VoidPaymentButton } from '@/features/platform/store-subscription-manager';
import { usagePeriod } from '@/server/services/entitlements';

export const metadata: Metadata = { title: 'Store subscription' };
export const dynamic = 'force-dynamic';

export default async function StoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePermission('platform.view');
  const { id } = await params;
  const detail = await getStoreDetail(id, usagePeriod());
  if (!detail) notFound();

  const { store, usage, payments, history } = detail;
  const now = new Date();
  const access = storeAccess(store, now);
  const limits = access.plan.limits;
  const canManage = userCan(admin, 'platform.manage');
  // The most recent live payment is the only one that can be voided (see voidPayment).
  const voidable = payments.find((payment) => !payment.voidedAt && store.currentPeriodEnd && payment.periodEnd.getTime() === store.currentPeriodEnd.getTime());

  return (
    <>
      <PageHeader
        title={store.name}
        description={accessHeadline(access, now).replace(/^Your /, 'The ')}
        breadcrumbs={[{ label: 'Stores', href: '/system-admin/stores' }, { label: store.name }]}
        actions={<StoreControls storeId={store.id} storeName={store.name} plan={store.plan} status={store.status} canManage={canManage} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Subscription">
          <dl className="space-y-3 p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Access</dt>
              <dd><AccessBadge state={access.state} /></dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Plan in effect</dt>
              <dd className="font-medium">{access.plan.name}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Plan bought</dt>
              <dd>{PLANS[store.plan].name}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{STATUS_LABEL[store.status]}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Trial ends</dt>
              <dd>{store.trialEndsAt ? formatDate(store.trialEndsAt) : '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Paid until</dt>
              <dd>{store.currentPeriodEnd ? formatDate(store.currentPeriodEnd) : '—'}</dd>
            </div>
            {access.graceEndsAt && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Read-only from</dt>
                <dd className="font-medium text-warning-text">{formatDate(access.graceEndsAt)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Owner</dt>
              <dd className="text-right">
                {store.ownerName ?? 'None yet'}
                {store.ownerEmail && <span className="block text-xs text-muted-foreground">{store.ownerEmail}</span>}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Usage" description="Against the plan in effect." className="lg:col-span-2">
          <div className="grid gap-5 p-4 sm:grid-cols-2">
            <UsageMeter meter={{ key: 'products', used: usage.products, limit: limits.products }} />
            <UsageMeter meter={{ key: 'staff', used: usage.staff, limit: limits.staff }} />
            <UsageMeter meter={{ key: 'branches', used: usage.branches, limit: limits.branches }} />
            <UsageMeter meter={{ key: 'backgroundRemovalsPerMonth', used: usage.backgroundRemovals, limit: limits.backgroundRemovalsPerMonth }} />
          </div>
        </Panel>

        <Panel title="Payments" description="Manual payments confirmed on the platform. Permanent; mistakes are voided, not deleted." className="lg:col-span-3">
          {payments.length === 0 ? (
            <PanelEmpty icon={Receipt} title="No payments recorded" description="Use Record payment once the money has arrived." />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <caption className="sr-only">Payments</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="h-10 px-4 font-semibold">Received</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
                    <th scope="col" className="h-10 px-4 text-right font-semibold">Amount</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Method · reference</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Covers</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Recorded by</th>
                    <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b align-top last:border-0">
                      <td className="px-4 py-2.5">{formatDate(payment.paidAt)}</td>
                      <td className="px-4 py-2.5">{PLANS[payment.plan].name}, {payment.months} mo</td>
                      <td className={payment.voidedAt ? 'px-4 py-2.5 text-right tabular-nums text-muted-foreground line-through' : 'px-4 py-2.5 text-right tabular-nums'}>
                        ₱{payment.amount}
                      </td>
                      <td className="px-4 py-2.5">
                        {PAYMENT_METHOD_LABEL[payment.method]} · <span className="font-mono text-xs">{payment.reference}</span>
                        {payment.notes && <span className="block text-xs text-muted-foreground">{payment.notes}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {formatDate(payment.periodStart)} – {formatDate(payment.periodEnd)}
                        {payment.voidedAt && (
                          <span className="block text-xs text-destructive-text">
                            Void {formatDate(payment.voidedAt)} by {payment.voidedBy}: {payment.voidReason}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {payment.recordedBy}
                        <span className="block text-xs text-muted-foreground">{formatDateTime(payment.createdAt)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canManage && voidable?.id === payment.id && (
                          <VoidPaymentButton paymentId={payment.id} storeId={store.id} reference={payment.reference} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Subscription history" description="Plan, status, trial and payment changes, with who made them." className="lg:col-span-3">
          {history.length === 0 ? (
            <PanelEmpty icon={History} title="No changes yet" description="Changes made here are recorded automatically." />
          ) : (
            <ul className="divide-y">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm">{entry.summary.replace(`${store.name}: `, '')}</p>
                    <p className="text-xs text-muted-foreground">{entry.actorName ?? 'System'}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Plans" className="lg:col-span-3">
          <PlanComparison current={access.plan.id} />
        </Panel>
      </div>
    </>
  );
}
