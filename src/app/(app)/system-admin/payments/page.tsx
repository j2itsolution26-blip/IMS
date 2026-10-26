import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, Clock, Receipt, Search, Settings2, TrendingUp, XCircle } from 'lucide-react';
import type { StorePlan } from '@prisma/client';
import { requirePermission, userCan } from '@/lib/session';
import { formatCurrency, formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { PLANS, PLAN_ORDER } from '@/lib/plans';
import { INTERVAL_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/billing';
import { PAYMENT_METHOD_LABEL } from '@/lib/subscription';
import { inlineLabel, resolveRangeFromParams, type PeriodKey } from '@/server/analytics/date-range';
import {
  REVIEW_STATUS_FILTERS,
  listPaymentRequests,
  paymentReviewMetrics,
  type ReviewStatusFilter,
} from '@/server/platform/payment-review-queries';
import { KpiCard } from '@/components/kpi-card';
import { Panel, PanelEmpty } from '@/components/panel';
import { PeriodPicker } from '@/components/period-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PaymentStatusBadge } from '@/features/billing/status-badges';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Payment verification' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const PERIODS: { value: PeriodKey; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];
const FILTER_LABEL: Record<ReviewStatusFilter, string> = {
  PENDING: PAYMENT_STATUS_LABEL.PENDING,
  VERIFIED: 'Approved',
  REJECTED: PAYMENT_STATUS_LABEL.REJECTED,
  VOID: PAYMENT_STATUS_LABEL.VOID,
  ALL: 'All',
};

type Params = { status?: string; plan?: string; q?: string; page?: string; period?: string; from?: string; to?: string };

/**
 * Owner-submitted subscription payments, to verify against the receiving
 * account. Pending ones come first and oldest first. Nothing here changes a
 * payment: approving and rejecting happen on each payment's own page, behind
 * a confirmation, and only for `platform.manage`.
 */
export default async function PaymentVerificationPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requirePermission('platform.view');
  const canManage = userCan(user, 'platform.manage');
  const params = await searchParams;
  const now = new Date();

  const status: ReviewStatusFilter = REVIEW_STATUS_FILTERS.includes(params.status as ReviewStatusFilter)
    ? (params.status as ReviewStatusFilter)
    : 'PENDING';
  const plan = PLAN_ORDER.includes(params.plan as StorePlan) ? (params.plan as StorePlan) : null;
  const q = (params.q ?? '').trim().slice(0, 80);
  const page = Math.max(Number(params.page) || 1, 1);
  const offered = params.period === 'custom' || PERIODS.some((p) => p.value === params.period);
  const { period, range, custom } = resolveRangeFromParams(offered ? params : {}, 'month', now);

  const [metrics, list] = await Promise.all([
    paymentReviewMetrics(range),
    listPaymentRequests({ status, plan, q, page, pageSize: PAGE_SIZE }),
  ]);
  const pageCount = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  const link = (patch: Partial<Params>) => {
    const next = new URLSearchParams();
    const merged: Params = { status, plan: plan ?? undefined, q, period: params.period, from: params.from, to: params.to, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value && !(key === 'status' && value === 'PENDING')) next.set(key, String(value));
    const search = next.toString();
    return search ? `/system-admin/payments?${search}` : '/system-admin/payments';
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-display">Payment verification</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Owners&rsquo; GCash payments with their receipts. Approve only after finding the money in the receiving account.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodPicker current={period} options={PERIODS} allowCustom customFrom={custom?.from} customTo={custom?.to} />
          {canManage && (
            <Button asChild variant="outline">
              <Link href="/system-admin/billing/settings">
                <Settings2 /> Payment settings
              </Link>
            </Button>
          )}
        </div>
      </div>

      <section aria-label="Payment summary" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Pending verification"
          value={formatNumber(metrics.pending, 0)}
          icon={Clock}
          tone={metrics.pending > 0 ? 'warning' : 'default'}
          hint="Waiting for your check"
          footer={{ label: 'Review them', href: link({ status: 'PENDING', page: undefined }) }}
        />
        <KpiCard
          label="Approved"
          value={formatNumber(metrics.approved, 0)}
          icon={BadgeCheck}
          tone="success"
          hint="All time"
          footer={{ label: 'See them', href: link({ status: 'VERIFIED', page: undefined }) }}
        />
        <KpiCard
          label="Rejected"
          value={formatNumber(metrics.rejected, 0)}
          icon={XCircle}
          tone={metrics.rejected > 0 ? 'destructive' : 'default'}
          hint="All time"
          footer={{ label: 'See them', href: link({ status: 'REJECTED', page: undefined }) }}
        />
        <KpiCard
          label="Verified this period"
          value={formatCurrency(metrics.verifiedInRange.amount, 'PHP')}
          icon={TrendingUp}
          hint={`${formatNumber(metrics.verifiedInRange.count, 0)} payment${metrics.verifiedInRange.count === 1 ? '' : 's'} · ${inlineLabel(range)}`}
          inverse
        />
      </section>

      <Panel title="Payment requests" description={status === 'PENDING' ? 'Oldest first: the order to work through.' : 'Newest first.'}>
        <div className="space-y-3 border-b p-4">
          <nav aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1 scrollbar-none">
            {REVIEW_STATUS_FILTERS.map((value) => (
              <Link
                key={value}
                href={link({ status: value, page: undefined })}
                aria-current={status === value ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  status === value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {FILTER_LABEL[value]}
                {value === 'PENDING' && metrics.pending > 0 && <span className="tabular opacity-80">{metrics.pending}</span>}
              </Link>
            ))}
          </nav>
          <form action="/system-admin/payments" className="flex flex-col gap-2 sm:flex-row">
            {status !== 'PENDING' && <input type="hidden" name="status" value={status} />}
            <div className="relative flex-1 sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input name="q" defaultValue={q} placeholder="Store, owner, invoice or reference" className="pl-9" aria-label="Search payments" />
            </div>
            <label className="sr-only" htmlFor="plan-filter">
              Plan
            </label>
            <select
              id="plan-filter"
              name="plan"
              defaultValue={plan ?? ''}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">All plans</option>
              {PLAN_ORDER.map((id) => (
                <option key={id} value={id}>
                  {PLANS[id].name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </div>

        {list.rows.length === 0 ? (
          <PanelEmpty
            icon={Receipt}
            title={status === 'PENDING' && !q && !plan ? 'Nothing to verify' : 'No payments match'}
            description={status === 'PENDING' && !q && !plan ? 'Payments owners submit wait here for your check.' : 'Try another status, plan or search.'}
          />
        ) : (
          <>
            <ul className="divide-y lg:hidden">
              {list.rows.map((row) => (
                <li key={row.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">{row.storeName}</p>
                    <PaymentStatusBadge status={row.status} />
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span>
                      {PLANS[row.plan].name}
                      {row.interval ? `, ${INTERVAL_LABEL[row.interval].toLowerCase()}` : ''}
                    </span>
                    <span className="tabular font-semibold">{formatCurrency(row.amount, 'PHP')}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {PAYMENT_METHOD_LABEL[row.method]} <span className="font-mono">{row.reference}</span> · submitted {formatDateTime(row.submittedAt)}
                  </p>
                  <Button asChild size="sm" variant="outline" className="mt-1 min-h-10 w-full">
                    <Link href={`/system-admin/payments/${row.id}`}>{row.status === 'PENDING' ? 'Review' : 'Open'}</Link>
                  </Button>
                </li>
              ))}
            </ul>

            <div className="relative hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1180px] text-sm">
                <caption className="sr-only">Payment requests</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="h-10 px-4 font-semibold">Receipt</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Store &amp; owner</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Invoice</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
                    <th scope="col" className="h-10 px-4 text-right font-semibold">Amount</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Reference</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Paid</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Submitted</th>
                    <th scope="col" className="h-10 px-4 font-semibold">Status</th>
                    <th scope="col" className="h-10 px-4 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((row) => (
                    <tr key={row.id} className="border-b align-top last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        {row.receiptId ? (
                          <a
                            href={`/api/billing/receipts/${row.receiptId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block h-14 w-11 overflow-hidden rounded border bg-white"
                            aria-label={`Open the receipt from ${row.storeName}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link */}
                            <img src={`/api/billing/receipts/${row.receiptId}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.storeName}</p>
                        <p className="text-xs text-muted-foreground">{row.ownerName ?? 'No owner'}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{row.invoiceNumber ?? '—'}</td>
                      <td className="px-4 py-3">
                        {PLANS[row.plan].name}
                        {row.interval && <p className="text-xs text-muted-foreground">{INTERVAL_LABEL[row.interval]}</p>}
                      </td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right">{formatCurrency(row.amount, 'PHP')}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs">{row.reference}</span>
                        <p className="text-xs text-muted-foreground">{PAYMENT_METHOD_LABEL[row.method]}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{formatDate(row.paidAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{formatDateTime(row.submittedAt)}</td>
                      <td className="px-4 py-3">
                        <PaymentStatusBadge status={row.status} />
                        {row.reviewerName && row.reviewedAt && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {row.reviewerName}, {formatDate(row.reviewedAt)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant={row.status === 'PENDING' ? 'default' : 'ghost'}>
                          <Link href={`/system-admin/payments/${row.id}`}>{row.status === 'PENDING' ? 'Review' : 'Open'}</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>
              Page {Math.min(page, pageCount)} of {pageCount} · {list.total} payments
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
