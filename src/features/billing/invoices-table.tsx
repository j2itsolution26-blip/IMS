'use client';

import * as React from 'react';
import { FileText, Printer, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PLANS } from '@/lib/plans';
import { INTERVAL_LABEL, INVOICE_STATUS_LABEL, type InvoiceDisplayStatus } from '@/lib/billing';
import { formatCurrency, formatDate } from '@/lib/format';
import { InvoiceStatusBadge } from '@/features/billing/status-badges';
import { HistoryPager, HistoryToolbar, useHistoryList } from '@/features/billing/history-parts';
import { CompactEmpty, DetailRow } from '@/features/billing/compact-empty';
import type { InvoiceRow } from '@/features/billing/types';

const peso = (amount: number) => formatCurrency(amount, 'PHP');
const planLabel = (invoice: InvoiceRow) => `${PLANS[invoice.plan].name}, ${INTERVAL_LABEL[invoice.interval].toLowerCase()}`;

/** The store's invoices: each a snapshot of the plan, amount, period and terms the owner agreed to. */
export function InvoicesTable({
  invoices,
  storeName,
  emptyAction,
}: {
  invoices: InvoiceRow[];
  storeName: string;
  /** Shown under the empty state, e.g. a link to the plans. */
  emptyAction?: React.ReactNode;
}) {
  const list = useHistoryList(
    invoices,
    (invoice, query) => invoice.number.toLowerCase().includes(query) || planLabel(invoice).toLowerCase().includes(query),
    (invoice) => invoice.status,
    (invoice) => invoice.issuedAt,
  );
  const [open, setOpen] = React.useState<InvoiceRow | null>(null);
  const statuses = (Object.keys(INVOICE_STATUS_LABEL) as InvoiceDisplayStatus[])
    .filter((status) => invoices.some((invoice) => invoice.status === status))
    .map((value) => ({ value, label: INVOICE_STATUS_LABEL[value] }));

  if (invoices.length === 0) {
    return (
      <CompactEmpty
        icon={FileText}
        title="No invoices yet"
        description="Choosing a plan issues an invoice for you to pay. Nothing is owed until you do."
        action={emptyAction}
      />
    );
  }

  return (
    <>
      <HistoryToolbar
        idPrefix="invoices"
        search={list.search}
        onSearch={list.setSearch}
        searchPlaceholder="Search invoice number or plan"
        status={list.status}
        onStatus={list.setStatus}
        statuses={statuses}
        range={list.range}
        onRange={list.setRange}
      />

      {list.filtered.length === 0 ? (
        <CompactEmpty icon={SearchX} title="No matching invoices" description="Try another search, status or date range." />
      ) : (
        <>
          {/* Phones: one card per invoice, no sideways scrolling. */}
          <ul className="divide-y sm:hidden">
            {list.visible.map((invoice) => (
              <li key={invoice.id} className="space-y-1 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{invoice.number}</span>
                  <InvoiceStatusBadge status={invoice.status} />
                </div>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{planLabel(invoice)}</span>
                  <span className="tabular font-semibold">{peso(invoice.amount)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)} · due {formatDate(invoice.dueAt)}
                </p>
                <Button variant="outline" size="sm" className="mt-1 min-h-10 w-full" onClick={() => setOpen(invoice)}>
                  View invoice
                </Button>
              </li>
            ))}
          </ul>

          <div className="relative hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[800px] text-sm">
              <caption className="sr-only">Invoices</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="h-10 px-4 font-semibold">Invoice</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Billing period</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Issued</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Due</th>
                  <th scope="col" className="h-10 px-4 text-right font-semibold">Amount</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Status</th>
                  <th scope="col" className="h-10 px-4 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.visible.map((invoice) => (
                  <tr key={invoice.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{invoice.number}</td>
                    <td className="px-4 py-2.5">
                      <span className="block font-medium">{PLANS[invoice.plan].name}</span>
                      <span className="text-xs text-muted-foreground">{INTERVAL_LABEL[invoice.interval]}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                    </td>
                    <td className="px-4 py-2.5">{formatDate(invoice.issuedAt)}</td>
                    <td className="px-4 py-2.5">{formatDate(invoice.dueAt)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{peso(invoice.amount)}</td>
                    <td className="px-4 py-2.5">
                      <InvoiceStatusBadge status={invoice.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpen(invoice)} aria-label={`View invoice ${invoice.number}`}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <HistoryPager page={list.page} pages={list.pages} total={list.filtered.length} onPage={list.setPage} />
        </>
      )}

      {open && <InvoiceDetail invoice={open} storeName={storeName} onClose={() => setOpen(null)} />}
    </>
  );
}

function InvoiceDetail({ invoice, storeName, onClose }: { invoice: InvoiceRow; storeName: string; onClose: () => void }) {
  const rows = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <DetailRow label="Store">{storeName}</DetailRow>
      <DetailRow label="Plan">{planLabel(invoice)}</DetailRow>
      <DetailRow label="Billing period">
        {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
      </DetailRow>
      <DetailRow label="Issued">{formatDate(invoice.issuedAt)}</DetailRow>
      <DetailRow label="Due">{formatDate(invoice.dueAt)}</DetailRow>
      <DetailRow label="Amount">
        <span className="tabular">{peso(invoice.amount)}</span>
      </DetailRow>
      <DetailRow label="Status">
        {INVOICE_STATUS_LABEL[invoice.status]}
        {invoice.status === 'PAID' && invoice.paidAt && ` on ${formatDate(invoice.paidAt)}`}
        {invoice.status === 'VOID' && invoice.voidReason && ` — ${invoice.voidReason}`}
      </DetailRow>
      <DetailRow label="Billing terms">Version {invoice.termsVersion}, accepted when the plan was chosen</DetailRow>
    </dl>
  );

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-md print:static print:max-h-none print:w-full print:max-w-none print:overflow-visible print:translate-x-0 print:translate-y-0 print:border-0 print:p-0 print:shadow-none">
        <DialogHeader className="no-print">
          <DialogTitle className="font-mono text-base">{invoice.number}</DialogTitle>
          <DialogDescription>A copy of what was agreed. The amount and period cannot change after issue.</DialogDescription>
        </DialogHeader>
        <div className="no-print flex items-center gap-2">
          <InvoiceStatusBadge status={invoice.status} />
        </div>
        <div className="no-print">{rows}</div>

        {/* Only this reaches the printer. */}
        <div className="print-only space-y-4 text-black">
          <div>
            <p className="text-xl font-bold">Invoice {invoice.number}</p>
            <p className="text-sm">TindahanProMax POS subscription</p>
          </div>
          {rows}
        </div>

        <DialogFooter className="no-print">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <Printer aria-hidden="true" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
