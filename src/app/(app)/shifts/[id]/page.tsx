import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { requireUser, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { formatCurrency, formatDateTime, formatRelative } from '@/lib/format';
import { SALE_STATUS_BADGE, SALE_STATUS_LABEL } from '@/lib/sale-status';
import { cn } from '@/lib/utils';
import { getShiftDetail } from '@/server/services/shift-service';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { Panel } from '@/components/panel';
import { CATEGORY_LABEL } from '@/lib/cash-movements';
import { Badge } from '@/components/ui/badge';
import { ShiftStatusBadge, VarianceText } from '@/features/shifts/shift-status-badge';
import { AdjustmentButton, OwnerCloseButton, ReviewForm } from '@/features/shifts/shift-owner-actions';
import { AutoRefresh, PrintButton } from '@/features/shifts/auto-refresh';

export const metadata: Metadata = { title: 'Shift report' };
export const dynamic = 'force-dynamic';

const METHOD: Record<string, string> = { CASH: 'Cash', GCASH: 'GCash', CARD: 'Card', OTHER: 'Other' };

/**
 * One shift's full report. The owner sees every shift and can close, review
 * and adjust; a cashier may open their own shift's report, read-only. Anyone
 * else gets a 404, so a shift id reveals nothing.
 */
export default async function ShiftReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const isOwner = userCan(user, FINANCIAL_PERMISSION);
  const { id } = await params;

  const shift = await getShiftDetail(id);
  if (!shift || (!isOwner && shift.cashierId !== user.id)) notFound();

  const currency = await getCurrency();
  const money = (value: number) => formatCurrency(value, currency);
  const adjustmentsTotal = shift.adjustments.reduce((sum, a) => sum + a.amount, 0);

  return (
    <>
      <PageHeader
        title={`${shift.reference} · ${shift.cashierName}`}
        description={shift.status === 'OPEN' ? 'Open shift — figures are live.' : `Closed ${formatDateTime(shift.closedAt)}.`}
        breadcrumbs={isOwner ? [{ label: 'Shift Management', href: '/shifts' }, { label: shift.reference }] : [{ label: shift.reference }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ShiftStatusBadge status={shift.displayStatus} />
            {shift.status === 'OPEN' && <AutoRefresh renderedAt={new Date().toISOString()} />}
            <PrintButton />
            {isOwner && shift.status === 'OPEN' && (
              <span className="no-print">
                <OwnerCloseButton shiftId={shift.id} cashierName={shift.cashierName} currency={currency} />
              </span>
            )}
            {isOwner && shift.status === 'CLOSED' && (
              <span className="no-print">
                <AdjustmentButton shiftId={shift.id} currency={currency} />
              </span>
            )}
          </div>
        }
      />

      {isOwner && shift.displayStatus === 'REQUIRES_REVIEW' && (
        <section className="no-print mb-5 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4 text-warning-text" aria-hidden="true" />
            This drawer counted{' '}
            <VarianceText difference={shift.difference} kind={shift.varianceKind} currency={currency} />
          </h2>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">
            A variance is a difference between the count and the records — often a miscount, change given wrongly or a sale not rung
            up. Check with {shift.cashierName} before drawing conclusions.
          </p>
          <ReviewForm shiftId={shift.id} />
        </section>
      )}

      {shift.liveExpectedCash != null && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning-text">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Records changed after this shift closed (for example a sale voided later). Recalculated today the drawer would expect{' '}
          {money(shift.liveExpectedCash)}; the figures below are as reconciled at close.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Opening">
          <Facts
            rows={[
              ['Cashier', shift.cashierName],
              ['Shift', shift.reference],
              ['Opened', formatDateTime(shift.openedAt)],
              ['Starting cash', money(shift.openingCash)],
              ['Opening notes', shift.openingNotes || '—'],
              ['Last activity', shift.lastActivityAt ? `${formatRelative(shift.lastActivityAt)} (${formatDateTime(shift.lastActivityAt)})` : 'No activity yet'],
            ]}
          />
        </Panel>

        <Panel title="Drawer" description={shift.status === 'OPEN' ? 'Live from the records' : 'As reconciled at close'}>
          <dl className="divide-y text-sm">
            <Line label="Starting cash" value={money(shift.openingCash)} />
            <Line label="+ Cash sales (after change)" value={money(shift.cashSales)} />
            <Line label="+ Cash in" value={money(shift.cashIn)} />
            <Line label="− Cash refunds" value={money(shift.cashRefunds)} />
            <Line label="− Cash out" value={money(shift.cashOut)} />
            <Line label="Expected drawer cash" value={money(shift.expectedCash)} strong />
            <Line label="Counted cash" value={shift.actualCash == null ? 'Not counted yet' : money(shift.actualCash)} />
            <Line
              label="Variance"
              value={<VarianceText difference={shift.difference} kind={shift.varianceKind} currency={currency} className="font-semibold" />}
            />
            {shift.adjustments.length > 0 && (
              <>
                <Line label="Adjustments" value={`${adjustmentsTotal >= 0 ? '+' : '−'}${money(Math.abs(adjustmentsTotal))}`} />
                <Line
                  label="Variance after adjustments"
                  value={
                    shift.adjustedDifference === 0 ? (
                      <span className="text-success-text">Balanced</span>
                    ) : (
                      `${(shift.adjustedDifference ?? 0) > 0 ? '+' : '−'}${money(Math.abs(shift.adjustedDifference ?? 0))}`
                    )
                  }
                  strong
                />
              </>
            )}
          </dl>
        </Panel>

        <Panel title="Closing & review">
          <Facts
            rows={[
              ['Closed', shift.closedAt ? formatDateTime(shift.closedAt) : 'Still open'],
              ['Closed by', shift.closedByName ?? '—'],
              ['Closing notes', shift.closingNotes || '—'],
              [
                'Review',
                shift.reviewStatus === 'REVIEWED'
                  ? `Reviewed by ${shift.reviewedByName ?? 'a former user'}, ${formatDateTime(shift.reviewedAt)}`
                  : shift.reviewStatus === 'PENDING'
                    ? 'Waiting for the owner'
                    : 'Not required',
              ],
              ...(shift.reviewNote ? ([['Resolution', shift.reviewNote]] as [string, string][]) : []),
            ]}
          />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Sales on this shift" description="Voided sales are left out of every figure except their own line.">
          <dl className="divide-y text-sm">
            <Line label="Completed sales" value={String(shift.sales.completedCount)} />
            <Line label="Gross sales (before discounts)" value={money(shift.sales.grossSales)} />
            <Line label="Discounts" value={shift.sales.discounts ? `−${money(shift.sales.discounts)}` : money(0)} />
            {shift.sales.tax > 0 && <Line label="Tax" value={money(shift.sales.tax)} />}
            <Line label="Net sales" value={money(shift.sales.netSales)} strong />
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
        </Panel>

        <Panel
          title="Refunds & cash movements"
          action={
            shift.movements.length > 0 ? (
              <Link href={`/cash-movements?shift=${shift.id}`} className="inline-flex min-h-9 items-center text-xs font-semibold text-primary hover:underline">
                Details
              </Link>
            ) : undefined
          }
        >
          <dl className="divide-y text-sm">
            {shift.refunds.length === 0 ? (
              <Line label="Refunds paid from this drawer" value="None" />
            ) : (
              shift.refunds.map((r) => (
                <Line key={r.method} label={`Refunds — ${METHOD[r.method] ?? r.method} (${r.count})`} value={`−${money(r.amount)}`} />
              ))
            )}
          </dl>
          <List
            empty="No cash put in or taken out."
            items={shift.movements.map((m) => ({
              id: m.id,
              amount: `${m.type === 'CASH_IN' ? '+' : '−'}${money(m.amount)}`,
              tone: m.type === 'CASH_IN' ? 'text-success-text' : 'text-destructive-text',
              text: `${m.reference} · ${CATEGORY_LABEL[m.category]}: ${m.reason}`,
              meta: `${m.userName}, ${formatDateTime(m.createdAt)}${m.notes ? ` · ${m.notes}` : ''}`,
            }))}
          />
          {shift.adjustments.length > 0 && (
            <>
              <p className="border-t px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Owner adjustments</p>
              <List
                empty=""
                items={shift.adjustments.map((a) => ({
                  id: a.id,
                  amount: `${a.amount > 0 ? '+' : '−'}${money(Math.abs(a.amount))}`,
                  tone: a.amount > 0 ? 'text-success-text' : 'text-destructive-text',
                  text: a.reason,
                  meta: `${a.userName}, ${formatDateTime(a.createdAt)}`,
                }))}
              />
            </>
          )}
        </Panel>
      </div>

      <Panel
        className="mt-4"
        title="Transactions"
        description={
          shift.transactionsTruncated ? 'Showing the first 500 sales.' : 'Every sale rung up on this shift. Open one for its receipt.'
        }
      >
        {shift.transactions.length === 0 && shift.refundRows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No sales on this shift yet.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="h-10 px-4 text-left font-semibold">Receipt</th>
                  <th className="h-10 px-4 text-left font-semibold">Time</th>
                  <th className="h-10 px-4 text-left font-semibold">Status</th>
                  <th className="h-10 px-4 text-right font-semibold">Total</th>
                  <th className="h-10 px-4 text-right font-semibold">Cash kept</th>
                  <th className="h-10 px-4 text-right font-semibold">Non-cash</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shift.transactions.map((t) => (
                  <tr key={t.id} className={cn(t.status === 'VOIDED' && 'text-muted-foreground')}>
                    <td className="px-4 py-2">
                      <Link href={`/sales/${t.id}`} className="font-mono text-xs font-medium text-primary hover:underline">
                        {t.invoiceNumber}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{formatDateTime(t.createdAt)}</td>
                    <td className="px-4 py-2">
                      <Badge variant={SALE_STATUS_BADGE[t.status]}>{SALE_STATUS_LABEL[t.status]}</Badge>
                    </td>
                    <td className={cn('px-4 py-2 text-right tabular', t.status === 'VOIDED' && 'line-through')}>{money(t.total)}</td>
                    <td className="px-4 py-2 text-right tabular">{t.cash ? money(t.cash) : '—'}</td>
                    <td className="px-4 py-2 text-right tabular">{t.other ? money(t.other) : '—'}</td>
                  </tr>
                ))}
                {shift.refundRows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      {r.returnId ? (
                        <Link href={`/returns/${r.returnId}`} className="font-mono text-xs font-medium text-primary hover:underline">
                          {r.returnNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">{formatDateTime(r.createdAt)}</td>
                    <td className="px-4 py-2">
                      <Badge variant="warning">Refund</Badge>
                    </td>
                    <td className="px-4 py-2 text-right tabular">−{money(r.amount)}</td>
                    <td className="px-4 py-2 text-right tabular">{r.method === 'CASH' ? `−${money(r.amount)}` : '—'}</td>
                    <td className="px-4 py-2 text-right tabular">{r.method !== 'CASH' ? `−${money(r.amount)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[8.5rem_1fr] gap-3 px-4 py-2.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 px-4 py-2.5', strong && 'bg-muted/30 font-semibold')}>
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="text-right tabular">{value}</dd>
    </div>
  );
}

function List({ items, empty }: { items: { id: string; amount: string; tone: string; text: string; meta: string }[]; empty: string }) {
  if (items.length === 0) return empty ? <p className="border-t px-4 py-3 text-sm text-muted-foreground">{empty}</p> : null;
  return (
    <ul className="divide-y border-t text-sm">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 px-4 py-2.5">
          <span className={cn('w-24 shrink-0 text-right font-medium tabular', item.tone)}>{item.amount}</span>
          <span className="min-w-0">
            {item.text}
            <span className="block text-xs text-muted-foreground">{item.meta}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
