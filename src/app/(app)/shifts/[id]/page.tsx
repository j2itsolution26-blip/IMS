import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  ClipboardCheck,
  Inbox,
  LogIn,
  LogOut,
  Scale,
  ShoppingCart,
  Store,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { requireUser, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { formatCurrency, formatDateTime, formatRelative } from '@/lib/format';
import { SALE_STATUS_BADGE, SALE_STATUS_LABEL } from '@/lib/sale-status';
import { CATEGORY_LABEL } from '@/lib/cash-movements';
import { shiftTimeline, varianceKindOf, varianceTone, type TimelineEventType } from '@/lib/shift-detail';
import { cn } from '@/lib/utils';
import { getShiftDetail } from '@/server/services/shift-service';
import { getCompanyProfile } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { KpiCard } from '@/components/kpi-card';
import { Badge } from '@/components/ui/badge';
import { ShiftStatusBadge, VarianceText } from '@/features/shifts/shift-status-badge';
import { AdjustmentButton, OwnerCloseButton, ReviewForm } from '@/features/shifts/shift-owner-actions';
import { AutoRefresh, PrintButton } from '@/features/shifts/auto-refresh';
import { DrawerBreakdownTable } from '@/features/shifts/drawer-breakdown-table';
import { ShiftTransactionsTable, type ShiftTransactionRow } from '@/features/shifts/shift-transactions-table';
import { ShiftPrintReport } from '@/features/shifts/shift-print-report';

export const metadata: Metadata = { title: 'Shift report' };
export const dynamic = 'force-dynamic';

const METHOD: Record<string, string> = { CASH: 'Cash', GCASH: 'GCash', CARD: 'Card', OTHER: 'Other' };

/**
 * One shift's full report. The owner sees every shift in their branches and
 * can close, review and adjust; a cashier may open their own shift's report,
 * read-only. Anyone else gets a 404, so a shift id reveals nothing.
 */
export default async function ShiftReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const isOwner = userCan(user, FINANCIAL_PERMISSION);
  const { id } = await params;

  const shift = await getShiftDetail(id);
  if (!shift || (!isOwner && shift.cashierId !== user.id)) notFound();

  const company = await getCompanyProfile();
  const currency = company.currency;
  const money = (value: number) => formatCurrency(value, currency);
  const signed = (value: number) => `${value < 0 ? '−' : '+'}${money(Math.abs(value))}`;
  const adjustmentsTotal = shift.adjustments.reduce((sum, a) => sum + a.amount, 0);
  const hasAdjustments = shift.adjustments.length > 0;
  // The stored difference is the reconciliation of record; its sign gives over / short.
  const varianceKind = varianceKindOf(shift.difference);
  const tone = varianceTone(varianceKind);
  const now = new Date();

  const varianceHint =
    varianceKind == null
      ? 'Worked out when the drawer is counted at close'
      : varianceKind === 'BALANCED'
        ? 'Counted cash matches the records'
        : varianceKind === 'OVERAGE'
          ? 'Overage — more cash than expected'
          : 'Shortage — less cash than expected';

  const rows: ShiftTransactionRow[] = [
    ...shift.transactions.map(
      (t): ShiftTransactionRow => ({
        id: t.id,
        kind: 'SALE',
        reference: t.invoiceNumber,
        href: `/sales/${t.id}`,
        time: formatDateTime(t.createdAt),
        payment: t.payment,
        statusLabel: SALE_STATUS_LABEL[t.status],
        statusVariant: SALE_STATUS_BADGE[t.status],
        isVoided: t.status === 'VOIDED',
        totalValue: t.total,
        total: money(t.total),
        cashKept: t.cash ? money(t.cash) : null,
        nonCash: t.other ? money(t.other) : null,
      }),
    ),
    ...shift.refundRows.map(
      (r): ShiftTransactionRow => ({
        id: r.id,
        kind: 'REFUND',
        reference: r.returnNumber ?? 'Refund',
        href: r.returnId ? `/returns/${r.returnId}` : null,
        time: formatDateTime(r.createdAt),
        payment: r.method === 'CASH' || r.method === 'GCASH' || r.method === 'CARD' ? r.method : 'OTHER',
        statusLabel: 'Refund',
        statusVariant: 'warning',
        isVoided: false,
        totalValue: -r.amount,
        total: `−${money(r.amount)}`,
        cashKept: r.method === 'CASH' ? `−${money(r.amount)}` : null,
        nonCash: r.method !== 'CASH' ? `−${money(r.amount)}` : null,
      }),
    ),
  ];

  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`Shift ${shift.reference}`}
          description={`Cashier: ${shift.cashierName}${shift.branchName ? ` · Branch: ${shift.branchName}` : ''}`}
          leading={
            <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:flex">
              <Store className="h-6 w-6" aria-hidden="true" />
            </span>
          }
          breadcrumbs={isOwner ? [{ label: 'Shift Management', href: '/shifts' }, { label: shift.reference }] : [{ label: shift.reference }]}
          actions={
            <>
              <ShiftStatusBadge status={shift.displayStatus} />
              {hasAdjustments && (
                <Badge variant="secondary" className="whitespace-nowrap">
                  <Scale className="h-3 w-3" aria-hidden="true" /> Adjustment recorded
                </Badge>
              )}
              {shift.status === 'OPEN' && <AutoRefresh renderedAt={now.toISOString()} />}
              <PrintButton label="Print report" />
              {isOwner && shift.status === 'OPEN' && (
                <OwnerCloseButton shiftId={shift.id} cashierName={shift.cashierName} currency={currency} />
              )}
              {isOwner && shift.status === 'CLOSED' && (
                <AdjustmentButton
                  shiftId={shift.id}
                  currency={currency}
                  shiftReference={shift.reference}
                  expectedCash={shift.expectedCash}
                  actualCash={shift.actualCash}
                  difference={shift.difference}
                  adjustments={shift.adjustments.map((a) => a.amount)}
                />
              )}
            </>
          }
        />

        <dl className="-mt-2 mb-5 flex flex-wrap gap-2 text-xs">
          <Stamp icon={LogIn} label="Opened" value={formatDateTime(shift.openedAt)} />
          <Stamp icon={LogOut} label="Closed" value={shift.closedAt ? formatDateTime(shift.closedAt) : 'Still open'} />
          {shift.status === 'OPEN' && (
            <Stamp icon={CalendarClock} label="Last activity" value={shift.lastActivityAt ? formatRelative(shift.lastActivityAt) : 'No activity yet'} />
          )}
        </dl>

        {shift.liveExpectedCash != null && (
          <p className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-text">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Records changed after this shift closed (for example a sale voided later). Recalculated today the drawer would expect{' '}
            {money(shift.liveExpectedCash)}; the figures below are as reconciled at close.
          </p>
        )}

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Net sales"
            value={money(shift.sales.netSales)}
            icon={ShoppingCart}
            tone="success"
            hint={`${shift.sales.completedCount} completed sale${shift.sales.completedCount === 1 ? '' : 's'}`}
          />
          <KpiCard label="Cash received (kept)" value={money(shift.cashSales)} icon={Banknote} hint="From cash sales, after change" />
          <KpiCard
            label="Expected drawer cash"
            value={money(shift.expectedCash)}
            icon={Inbox}
            hint={shift.status === 'OPEN' ? 'Live, from every cash movement so far' : 'From every cash movement, at close'}
          />
          <KpiCard
            label="Cash variance"
            value={shift.difference == null ? '—' : shift.difference === 0 ? money(0) : signed(shift.difference)}
            icon={tone === 'warning' ? TriangleAlert : Scale}
            tone={tone === 'neutral' ? 'default' : tone}
            hint={hasAdjustments ? `${varianceHint} · after adjustments: ${shift.adjustedDifference === 0 ? 'balanced' : signed(shift.adjustedDifference ?? 0)}` : varianceHint}
          />
        </div>

        {isOwner && shift.displayStatus === 'REQUIRES_REVIEW' && (
          <section aria-labelledby="discrepancy-title" className="mb-4 rounded-card border border-warning/40 bg-warning/5 p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div>
                <h2 id="discrepancy-title" className="flex items-center gap-2 font-semibold">
                  <TriangleAlert className="h-4 w-4 text-warning-text" aria-hidden="true" />
                  This drawer counted{' '}
                  <VarianceText difference={shift.difference} kind={varianceKind} currency={currency} />
                </h2>
                <dl className="mt-3 grid grid-cols-3 divide-x rounded-lg border bg-card text-center text-xs">
                  <Figure label="Expected" value={money(shift.expectedCash)} />
                  <Figure label="Counted" value={shift.actualCash == null ? '—' : money(shift.actualCash)} />
                  <Figure label="Difference" value={shift.difference == null ? '—' : signed(shift.difference)} className="text-warning-text" />
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">
                  A variance is a difference between the count and the records — often a miscount, change given wrongly or a sale not rung
                  up. Check with {shift.cashierName} before drawing conclusions.
                </p>
              </div>
              <ReviewForm shiftId={shift.id} />
            </div>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1.15fr)]">
          {/* Column 1: who and when */}
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Shift information">
              <Facts
                rows={[
                  ['Shift no.', shift.reference],
                  ['Cashier', shift.cashierName],
                  ['Branch', shift.branchName ?? '—'],
                  ['Starting cash', money(shift.openingCash)],
                  ['Opened', formatDateTime(shift.openedAt)],
                  ['Opening notes', shift.openingNotes || '—'],
                  ['Closed', shift.closedAt ? formatDateTime(shift.closedAt) : 'Still open'],
                  ['Closed by', shift.closedByName ?? '—'],
                  ['Closing notes', shift.closingNotes || '—'],
                ]}
              />
            </Panel>

            <Panel title="Review & audit trail" description={reviewDescription(shift.reviewStatus)}>
              <Timeline events={shiftTimeline(shift)} money={signed} />
            </Panel>
          </div>

          {/* Column 2: the drawer */}
          <Panel
            title="Cash drawer reconciliation"
            description={shift.status === 'OPEN' ? 'Every movement, live from the records' : 'Every movement, as reconciled at close'}
            className="lg:row-span-2 xl:row-span-1"
          >
            <DrawerBreakdownTable
              parts={shift.breakdown}
              expectedCash={shift.expectedCash}
              actualCash={shift.actualCash}
              currency={currency}
              showTotals={false}
              className="px-4"
            />
            <div className="grid grid-cols-1 gap-2 border-t p-4 sm:grid-cols-3">
              <SummaryTile label="Expected cash" value={money(shift.expectedCash)} icon={Inbox} />
              <SummaryTile
                label="Actual counted cash"
                value={shift.actualCash == null ? 'Not counted yet' : money(shift.actualCash)}
                icon={Wallet}
                muted={shift.actualCash == null}
              />
              <SummaryTile
                label="Variance"
                value={shift.difference == null ? '—' : shift.difference === 0 ? 'Balanced' : signed(shift.difference)}
                icon={tone === 'warning' ? TriangleAlert : Scale}
                tone={tone}
                tag={varianceKind === 'OVERAGE' ? 'Overage' : varianceKind === 'SHORTAGE' ? 'Shortage' : undefined}
              />
            </div>
            {hasAdjustments && (
              <div className="border-t">
                <p className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owner adjustments</p>
                <ul className="divide-y text-sm">
                  {shift.adjustments.map((a) => (
                    <li key={a.id} className="flex gap-3 px-4 py-2.5">
                      <span className={cn('w-24 shrink-0 text-right font-semibold tabular', a.amount > 0 ? 'text-success-text' : 'text-destructive-text')}>
                        {signed(a.amount)}
                      </span>
                      <span className="min-w-0 break-words">
                        {a.reason}
                        <span className="block text-xs text-muted-foreground">
                          {a.userName}, {formatDateTime(a.createdAt)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <dl className="divide-y border-t text-sm">
                  <Line label="Adjustments total" value={signed(adjustmentsTotal)} />
                  <Line
                    label="Variance after adjustments"
                    value={shift.adjustedDifference === 0 ? <span className="text-success-text">Balanced</span> : signed(shift.adjustedDifference ?? 0)}
                    strong
                  />
                </dl>
                <p className="px-4 pb-3 pt-2 text-xs text-muted-foreground">
                  Adjustments are accounting corrections. The counted cash and the variance at close above are unchanged.
                </p>
              </div>
            )}
          </Panel>

          {/* Column 3: sales and cash movements */}
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 lg:grid lg:grid-cols-2 xl:col-span-1 xl:flex">
            <Panel title="Sales on this shift" description="Voided sales are left out of every figure except their own line.">
              <dl className="divide-y text-sm">
                <Line label="Completed sales" value={String(shift.sales.completedCount)} />
                <Line label="Gross sales (before discounts)" value={money(shift.sales.grossSales)} />
                <Line label="Discounts" value={shift.sales.discounts ? `−${money(shift.sales.discounts)}` : money(0)} />
                {shift.sales.tax > 0 && <Line label="Tax" value={money(shift.sales.tax)} />}
                <Line label="Net sales" value={money(shift.sales.netSales)} strong />
              </dl>
              <p className="border-t bg-muted/20 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                How it was paid
              </p>
              <dl className="divide-y border-t text-sm">
                {shift.received.length === 0 && <Line label="Payments received" value={money(0)} />}
                {shift.received.map((r) => (
                  <Line key={r.method} label={`Received — ${METHOD[r.method] ?? r.method}${r.method === 'CASH' ? ' (tendered)' : ''}`} value={money(r.amount)} />
                ))}
                <Line label="Change given (cash)" value={shift.changeGiven ? `−${money(shift.changeGiven)}` : money(0)} />
                <Line label="Cash received (kept)" value={money(shift.cashSales)} strong />
                <Line
                  label="Voided sales"
                  value={shift.sales.voidedCount ? `${shift.sales.voidedCount} · ${money(shift.sales.voidedTotal)}` : 'None'}
                />
              </dl>
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                Electronic payments count toward sales but never toward drawer cash. Refunds are listed under cash movements.
              </p>
            </Panel>

            <Panel
              title="Refunds & cash movements"
              action={
                shift.movements.length > 0 ? (
                  <Link
                    href={`/cash-movements?shift=${shift.id}`}
                    className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-sm text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Details <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                ) : undefined
              }
            >
              <ul className="divide-y text-sm">
                {shift.refunds.length === 0 ? (
                  <li className="flex justify-between gap-3 px-4 py-2.5">
                    <span className="text-muted-foreground">Refunds paid from this shift</span>
                    <span>None</span>
                  </li>
                ) : (
                  shift.refunds.map((r) => (
                    <MovementItem
                      key={r.method}
                      inflow={false}
                      amount={`−${money(r.amount)}`}
                      title={`Refunds — ${METHOD[r.method] ?? r.method}`}
                      meta={`${r.count} refund${r.count === 1 ? '' : 's'}${r.method === 'CASH' ? ' · paid from the drawer' : ' · not from the drawer'}`}
                    />
                  ))
                )}
                {shift.movements.length === 0 ? (
                  <li className="px-4 py-3 text-muted-foreground">No cash put in or taken out.</li>
                ) : (
                  shift.movements.map((m) => (
                    <MovementItem
                      key={m.id}
                      inflow={m.type === 'CASH_IN'}
                      amount={signed(m.type === 'CASH_IN' ? m.amount : -m.amount)}
                      title={`${m.reference} · ${CATEGORY_LABEL[m.category]}: ${m.reason}`}
                      meta={`${m.userName} · ${formatDateTime(m.createdAt)}${m.notes ? ` · ${m.notes}` : ''}`}
                    />
                  ))
                )}
              </ul>
            </Panel>
          </div>
        </div>

        <Panel
          className="mt-4"
          title={`Transactions (${rows.length})`}
          description={shift.transactionsTruncated ? 'Showing the first 500 sales.' : 'Every sale and refund on this shift. Open one for its receipt.'}
        >
          <ShiftTransactionsTable rows={rows} />
        </Panel>
      </div>

      <ShiftPrintReport shift={shift} currency={currency} storeName={company.name} storeAddress={company.address} printedAt={now} />
    </>
  );
}

function reviewDescription(status: 'NOT_REQUIRED' | 'PENDING' | 'REVIEWED'): string {
  if (status === 'PENDING') return 'Waiting for the owner to review the variance';
  if (status === 'REVIEWED') return 'Variance reviewed by the owner';
  return 'No review needed: within tolerance or still open';
}

function Stamp({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 shadow-2xs">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-2">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={cn('min-w-0 break-words', value === '—' && 'text-muted-foreground')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 px-4 py-2', strong && 'bg-primary/5 font-semibold')}>
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="text-right tabular">{value}</dd>
    </div>
  );
}

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="p-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('tabular mt-0.5 text-sm font-semibold', className)}>{value}</dd>
    </div>
  );
}

const TILE_TONE = {
  neutral: 'border-border bg-muted/30',
  success: 'border-success/30 bg-success/5',
  warning: 'border-warning/40 bg-warning/10',
} as const;

function SummaryTile({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  tag,
  muted,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof TILE_TONE;
  tag?: string;
  muted?: boolean;
}) {
  return (
    <div className={cn('min-w-0 rounded-lg border p-3', TILE_TONE[tone])}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn('h-4 w-4', tone === 'warning' ? 'text-warning-text' : tone === 'success' ? 'text-success-text' : undefined)} aria-hidden="true" />
        {label}
      </p>
      <p
        className={cn(
          'tabular mt-1 text-lg font-bold leading-tight [overflow-wrap:anywhere]',
          muted && 'text-sm font-medium text-muted-foreground',
          tone === 'warning' && 'text-warning-text',
          tone === 'success' && 'text-success-text',
        )}
      >
        {value}
      </p>
      {tag && (
        <Badge variant="warning" className="mt-1.5">
          {tag}
        </Badge>
      )}
    </div>
  );
}

function MovementItem({ inflow, amount, title, meta }: { inflow: boolean; amount: string; title: string; meta: string }) {
  const Icon = inflow ? ArrowDownLeft : ArrowUpRight;
  return (
    <li className="flex gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30">
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          inflow ? 'bg-success/10 text-success-text' : 'bg-destructive/10 text-destructive-text',
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-label={inflow ? 'Into the drawer' : 'Out of the drawer'} />
      </span>
      <span className="min-w-0 flex-1 break-words">
        {title}
        <span className="block text-xs text-muted-foreground">{meta}</span>
      </span>
      <span className={cn('shrink-0 text-right font-semibold tabular', inflow ? 'text-success-text' : 'text-destructive-text')}>{amount}</span>
    </li>
  );
}

const EVENT: Record<TimelineEventType, { label: string; icon: React.ComponentType<{ className?: string }>; noteLabel: string }> = {
  OPENED: { label: 'Shift opened', icon: LogIn, noteLabel: 'Notes' },
  CLOSED: { label: 'Shift closed', icon: LogOut, noteLabel: 'Notes' },
  ADJUSTMENT: { label: 'Adjustment recorded', icon: Scale, noteLabel: 'Reason' },
  REVIEWED: { label: 'Reviewed', icon: ClipboardCheck, noteLabel: 'Resolution' },
};

function Timeline({ events, money }: { events: ReturnType<typeof shiftTimeline>; money: (value: number) => string }) {
  return (
    <ol className="space-y-0 p-4">
      {events.map((event, index) => {
        const meta = EVENT[event.type];
        const Icon = meta.icon;
        const last = index === events.length - 1;
        return (
          <li key={event.key} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && <span className="absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-px bg-border" aria-hidden="true" />}
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                event.type === 'REVIEWED' ? 'bg-success/15 text-success-text' : event.type === 'ADJUSTMENT' ? 'bg-warning/15 text-warning-text' : 'bg-primary/10 text-primary',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <div className={cn('min-w-0 flex-1', event.type === 'REVIEWED' && 'rounded-lg bg-success/5 p-2 -mt-1')}>
              <p className="text-sm font-semibold">
                {meta.label}
                {event.amount != null && <span className="tabular ml-1.5 font-medium">{money(event.amount)}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {event.actor ?? 'Not recorded'} · {formatDateTime(event.at)}
              </p>
              {event.note && (
                <p className="mt-1 break-words text-xs">
                  <span className="text-muted-foreground">{meta.noteLabel}: </span>
                  {event.note}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
