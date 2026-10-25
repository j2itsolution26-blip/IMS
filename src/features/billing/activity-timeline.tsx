'use client';

import * as React from 'react';
import { CalendarClock, FileText, History, Receipt, SearchX } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { CompactEmpty } from '@/features/billing/compact-empty';
import { HistoryPager, HistoryToolbar, useHistoryList } from '@/features/billing/history-parts';

const ICON: Record<string, typeof FileText> = {
  Invoice: FileText,
  SubscriptionPayment: Receipt,
  Store: CalendarClock,
};

/**
 * Subscription events from the store's audit log — plan choices, invoices,
 * payments, trial and status changes. Read only; nothing is recorded here.
 */
export function ActivityTimeline({
  entries,
  historyDays,
}: {
  entries: { id: string; entity: string; summary: string; createdAt: string }[];
  historyDays: number | null;
}) {
  const list = useHistoryList(
    entries,
    (entry, query) => entry.summary.toLowerCase().includes(query),
    () => '',
    (entry) => entry.createdAt,
  );

  if (entries.length === 0) {
    return (
      <CompactEmpty
        icon={History}
        title="No subscription activity yet"
        description="Trial, plan, invoice and payment changes for your store are listed here."
      />
    );
  }
  return (
    <>
      <HistoryToolbar
        idPrefix="activity"
        search={list.search}
        onSearch={list.setSearch}
        searchPlaceholder="Search activity"
        range={list.range}
        onRange={list.setRange}
      />
      {list.filtered.length === 0 ? (
        <CompactEmpty icon={SearchX} title="No matching activity" description="Try another search or date range." />
      ) : (
        <ol className="space-y-0 px-4 py-3">
          {list.visible.map((entry, index) => {
            const Icon = ICON[entry.entity] ?? History;
            return (
              <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
                {index < list.visible.length - 1 && (
                  <span className="absolute left-[15px] top-8 h-[calc(100%-1.75rem)] w-px bg-border" aria-hidden="true" />
                )}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-mint text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 pt-1">
                  <p className="text-sm">{entry.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <HistoryPager page={list.page} pages={list.pages} total={list.filtered.length} onPage={list.setPage} />
      {historyDays !== null && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">Showing the last {historyDays} days your plan keeps.</p>
      )}
    </>
  );
}
