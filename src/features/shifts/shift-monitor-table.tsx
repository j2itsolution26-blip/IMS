import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ShiftHistoryRow } from '@/server/services/shift-service';
import { ShiftStatusBadge, VarianceText } from '@/features/shifts/shift-status-badge';

const HEAD = 'h-10 whitespace-nowrap px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const NUM = 'px-3 py-2.5 text-right tabular whitespace-nowrap';

/**
 * Shift monitoring: one row per shift with the drawer arithmetic laid out
 * left to right — starting cash, plus cash sales, less refunds, in and out,
 * equals expected — then the count and the variance. A table on wide screens,
 * cards on a phone.
 */
export function ShiftMonitorTable({ shifts, currency }: { shifts: ShiftHistoryRow[]; currency: string }) {
  const money = (value: number) => formatCurrency(value, currency);
  const inOut = (s: ShiftHistoryRow) => (s.cashIn || s.cashOut ? `+${money(s.cashIn)} / −${money(s.cashOut)}` : '—');

  return (
    <>
      {/* `relative` keeps the sr-only header inside this scroller. */}
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className={HEAD}>Shift</th>
              <th className={HEAD}>Cashier</th>
              <th className={HEAD}>Opened</th>
              <th className={cn(HEAD, 'text-right')}>Starting</th>
              <th className={cn(HEAD, 'text-right')}>Cash sales</th>
              <th className={cn(HEAD, 'text-right')}>Refunds</th>
              <th className={cn(HEAD, 'text-right')}>In / out</th>
              <th className={cn(HEAD, 'text-right')}>Expected</th>
              <th className={cn(HEAD, 'text-right')}>Counted</th>
              <th className={cn(HEAD, 'text-right')}>Variance</th>
              <th className={HEAD}>Status</th>
              <th className={HEAD}>Last activity</th>
              <th className={HEAD}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shifts.map((shift) => (
              <tr key={shift.id} className={cn('align-middle', shift.displayStatus === 'REQUIRES_REVIEW' && 'bg-warning/5')}>
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{shift.reference}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-medium">{shift.cashierName}</td>
                <td className="whitespace-nowrap px-3 py-2.5">
                  {formatDateTime(shift.openedAt)}
                  {shift.closedAt && <span className="block text-xs text-muted-foreground">Closed {formatDateTime(shift.closedAt)}</span>}
                </td>
                <td className={NUM}>{money(shift.openingCash)}</td>
                <td className={NUM}>{money(shift.cashSales)}</td>
                <td className={NUM}>{shift.cashRefunds ? `−${money(shift.cashRefunds)}` : '—'}</td>
                <td className={NUM}>{inOut(shift)}</td>
                <td className={cn(NUM, 'font-semibold')}>{money(shift.expectedCash)}</td>
                <td className={NUM}>{shift.actualCash == null ? '—' : money(shift.actualCash)}</td>
                <td className={NUM}>
                  <VarianceText difference={shift.difference} kind={shift.varianceKind} currency={currency} />
                </td>
                <td className="px-3 py-2.5">
                  <ShiftStatusBadge status={shift.displayStatus} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                  {shift.lastActivityAt ? (
                    <time dateTime={shift.lastActivityAt.toISOString()} title={formatDateTime(shift.lastActivityAt)}>
                      {formatRelative(shift.lastActivityAt)}
                    </time>
                  ) : (
                    'No activity yet'
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Button asChild variant="outline" size="sm" className="h-9">
                    <Link href={`/shifts/${shift.id}`} aria-label={`View details of ${shift.reference}, ${shift.cashierName}`}>
                      View details
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y md:hidden">
        {shifts.map((shift) => (
          <li key={shift.id}>
            <Link href={`/shifts/${shift.id}`} className="flex items-start gap-3 p-4 hover:bg-accent/40">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{shift.cashierName}</span>
                  <span className="font-mono text-xs text-muted-foreground">{shift.reference}</span>
                  <ShiftStatusBadge status={shift.displayStatus} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Opened {formatDateTime(shift.openedAt)}
                  {shift.closedAt && ` · closed ${formatDateTime(shift.closedAt)}`}
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Starting</dt>
                  <dd className="text-right tabular">{money(shift.openingCash)}</dd>
                  <dt className="text-muted-foreground">Cash sales</dt>
                  <dd className="text-right tabular">{money(shift.cashSales)}</dd>
                  <dt className="font-medium">Expected</dt>
                  <dd className="text-right font-semibold tabular">{money(shift.expectedCash)}</dd>
                  {shift.actualCash != null && (
                    <>
                      <dt className="text-muted-foreground">Counted</dt>
                      <dd className="text-right tabular">
                        {money(shift.actualCash)}{' '}
                        <VarianceText difference={shift.difference} kind={shift.varianceKind} currency={currency} className="block text-xs" />
                      </dd>
                    </>
                  )}
                </dl>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
