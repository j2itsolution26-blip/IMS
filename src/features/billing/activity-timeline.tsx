import * as React from 'react';
import { CalendarClock, FileText, History, Receipt } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import { CompactEmpty } from '@/features/billing/compact-empty';

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
  entries: { id: string; entity: string; summary: string; createdAt: Date }[];
  historyDays: number | null;
}) {
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
      <ol className="space-y-0 px-4 py-3">
        {entries.map((entry, index) => {
          const Icon = ICON[entry.entity] ?? History;
          return (
            <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
              {index < entries.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-px bg-border" aria-hidden="true" />}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-card">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm">{entry.summary}</p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={entry.createdAt.toISOString()}>{formatDateTime(entry.createdAt)}</time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {historyDays !== null && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">Showing the last {historyDays} days your plan keeps.</p>
      )}
    </>
  );
}
