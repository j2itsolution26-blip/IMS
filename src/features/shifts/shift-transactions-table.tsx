'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Eye, Search } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PAYMENT_KIND_LABEL, matchesTransaction, type SalePaymentKind, type TransactionFilter } from '@/lib/shift-detail';

/** One row, formatted on the server so currency and time zone come from settings. */
export interface ShiftTransactionRow {
  id: string;
  kind: 'SALE' | 'REFUND';
  reference: string;
  /** Receipt (sale) or return page; null when a refund has no return record. */
  href: string | null;
  time: string;
  payment: SalePaymentKind;
  statusLabel: string;
  statusVariant: BadgeProps['variant'];
  isVoided: boolean;
  /** Signed; refunds are negative. Used for searching by amount. */
  totalValue: number;
  total: string;
  cashKept: string | null;
  nonCash: string | null;
  /** Shown under the time: made offline, and whether it arrived after close. */
  offlineNote?: string | null;
}

const FILTERS: { value: TransactionFilter; label: string }[] = [
  { value: 'all', label: 'All payment types' },
  { value: 'CASH', label: 'Cash' },
  { value: 'GCASH', label: 'GCash' },
  { value: 'CARD', label: 'Card' },
  { value: 'SPLIT', label: 'Split payment' },
  { value: 'OTHER', label: 'Other' },
  { value: 'VOIDED', label: 'Voided sales' },
  { value: 'REFUND', label: 'Refunds' },
];

const PAGE_SIZE = 25;

export function ShiftTransactionsTable({ rows }: { rows: ShiftTransactionRow[] }) {
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<TransactionFilter>('all');
  const [page, setPage] = React.useState(0);

  const filtered = React.useMemo(
    () =>
      rows.filter((row) =>
        matchesTransaction(
          { reference: row.reference, total: row.totalValue, payment: row.payment, isVoided: row.isVoided, isRefund: row.kind === 'REFUND' },
          search,
          filter,
        ),
      ),
    [rows, search, filter],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  // Only offer the filters that match something on this shift.
  const filters = FILTERS.filter(
    (f) =>
      f.value === 'all' ||
      rows.some((r) => (f.value === 'VOIDED' ? r.isVoided : f.value === 'REFUND' ? r.kind === 'REFUND' : r.kind === 'SALE' && r.payment === f.value)),
  );

  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">No sales on this shift yet.</p>;

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Search receipt or amount…"
            aria-label="Search transactions by receipt number or amount"
            className="h-10 pl-9"
          />
        </div>
        <select
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as TransactionFilter);
            setPage(0);
          }}
          aria-label="Filter by payment type"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-48"
        >
          {filters.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Sales and refunds on this shift</caption>
          <thead className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th scope="col" className="h-10 px-4 text-left font-semibold">Receipt</th>
              <th scope="col" className="h-10 px-4 text-left font-semibold">Time</th>
              <th scope="col" className="h-10 px-4 text-left font-semibold">Payment</th>
              <th scope="col" className="h-10 px-4 text-left font-semibold">Status</th>
              <th scope="col" className="h-10 px-4 text-right font-semibold">Total</th>
              <th scope="col" className="h-10 px-4 text-right font-semibold">Cash kept</th>
              <th scope="col" className="h-10 px-4 text-right font-semibold">Non-cash</th>
              <th scope="col" className="h-10 px-4 text-right font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No transactions match.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className={cn('transition-colors hover:bg-muted/40', row.isVoided && 'text-muted-foreground')}>
                  <td className="px-4 py-2.5">
                    {row.href ? (
                      <Link href={row.href} className="rounded-sm font-mono text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {row.reference}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs">{row.reference}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {row.time}
                    {row.offlineNote && <p className="text-xs font-medium text-info-text">{row.offlineNote}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">{PAYMENT_KIND_LABEL[row.payment]}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={row.statusVariant}>{row.statusLabel}</Badge>
                  </td>
                  <td className={cn('tabular whitespace-nowrap px-4 py-2.5 text-right font-medium', row.isVoided && 'line-through')}>{row.total}</td>
                  <td className="tabular whitespace-nowrap px-4 py-2.5 text-right">{row.cashKept ?? '—'}</td>
                  <td className="tabular whitespace-nowrap px-4 py-2.5 text-right">{row.nonCash ?? '—'}</td>
                  <td className="px-4 py-1.5 text-right">
                    {row.href && (
                      <Button asChild variant="outline" size="sm" className="h-8">
                        <Link href={row.href} aria-label={`View ${row.reference}`}>
                          <Eye /> View
                        </Link>
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            {current * PAGE_SIZE + 1}–{Math.min((current + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setPage(current + 1)} disabled={current >= pageCount - 1} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
