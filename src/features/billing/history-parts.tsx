'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { HISTORY_RANGE_LABEL, historyRangeStart, type HistoryRange } from '@/lib/billing';

/**
 * Pieces shared by the invoice and payment lists on the billing page. The
 * lists are short (the page loads the latest few dozen rows), so search,
 * filter and paging happen in the browser.
 */

export const PAGE_SIZE = 10;

const selectClass =
  'flex h-9 rounded-full border border-input bg-transparent px-3.5 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function HistoryToolbar({
  idPrefix,
  search,
  onSearch,
  searchPlaceholder,
  status,
  onStatus,
  statuses,
  range,
  onRange,
}: {
  idPrefix: string;
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  /** Leave out for a list with no status filter. */
  status?: string;
  onStatus?: (value: string) => void;
  statuses?: { value: string; label: string }[];
  range: HistoryRange;
  onRange: (value: HistoryRange) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <label htmlFor={`${idPrefix}-search`} className="sr-only">
          {searchPlaceholder}
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id={`${idPrefix}-search`}
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="pl-9"
        />
      </div>
      {statuses && onStatus && (
        <>
          <label htmlFor={`${idPrefix}-status`} className="sr-only">
            Status
          </label>
          <select id={`${idPrefix}-status`} className={selectClass} value={status} onChange={(event) => onStatus(event.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor={`${idPrefix}-range`} className="sr-only">
        Date range
      </label>
      <select
        id={`${idPrefix}-range`}
        className={selectClass}
        value={range}
        onChange={(event) => onRange(event.target.value as HistoryRange)}
      >
        {(Object.keys(HISTORY_RANGE_LABEL) as HistoryRange[]).map((value) => (
          <option key={value} value={value}>
            {HISTORY_RANGE_LABEL[value]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function HistoryPager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      <span>
        Page {page + 1} of {pages} · {total} total
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="icon" onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/**
 * Search, status and date filters and paging over a short list. Resets to
 * page one when a filter changes. `dateOf` is the ISO date the range filters on.
 */
export function useHistoryList<T>(
  rows: T[],
  matches: (row: T, query: string) => boolean,
  statusOf: (row: T) => string,
  dateOf: (row: T) => string,
) {
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [range, setRange] = React.useState<HistoryRange>('all');
  const [page, setPage] = React.useState(0);
  const query = search.trim().toLowerCase();
  const since = historyRangeStart(range, new Date())?.getTime() ?? null;
  const filtered = rows.filter(
    (row) =>
      (!status || statusOf(row) === status) &&
      (since === null || new Date(dateOf(row)).getTime() >= since) &&
      (!query || matches(row, query)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  return {
    search,
    setSearch: (value: string) => {
      setSearch(value);
      setPage(0);
    },
    status,
    setStatus: (value: string) => {
      setStatus(value);
      setPage(0);
    },
    range,
    setRange: (value: HistoryRange) => {
      setRange(value);
      setPage(0);
    },
    page: current,
    setPage,
    pages,
    filtered,
    visible: filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE),
  };
}
