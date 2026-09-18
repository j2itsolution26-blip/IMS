'use client';

import * as React from 'react';
import Link from 'next/link';
import { Eye, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { getSaleReceiptAction } from '@/features/sales/actions';
import { Receipt, type ReceiptData } from '@/features/pos/receipt';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/misc';
import { formatCurrency, formatDateTime, formatQuantity, humanizeEnum } from '@/lib/format';

/**
 * Opens one past sale in place, so the owner can check what was in it without
 * losing the dashboard behind a page load.
 *
 * The detail is fetched on click rather than shipped with every row, and the
 * printable receipt is the same component the till prints.
 */
export function ViewSaleButton({ saleId }: { saleId: string }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<ReceiptData | null>(null);
  const [loading, setLoading] = React.useState(false);

  const openSale = async () => {
    setOpen(true);
    if (data) return;

    setLoading(true);
    const result = await getSaleReceiptAction(saleId);
    setLoading(false);

    if (!result.ok) {
      toast.error(result.error);
      setOpen(false);
      return;
    }
    if (!result.data) {
      toast.error('That sale could no longer be found.');
      setOpen(false);
      return;
    }
    setData(result.data);
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={openSale} aria-label="View sale">
        <Eye /> View
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader className="no-print">
            <DialogTitle>{data ? data.invoiceNumber : 'Sale'}</DialogTitle>
          </DialogHeader>

          {loading || !data ? (
            <div className="no-print flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading sale…
            </div>
          ) : (
            <SaleDetail data={data} saleId={saleId} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The body of the dialog, separated from the fetching so it can be rendered on its own. */
export function SaleDetail({ data, saleId }: { data: ReceiptData; saleId: string }) {
  const tendered = data.payments.reduce((sum, payment) => sum + payment.amount, 0) || data.paid;

  return (
    <>
      <div className="no-print space-y-3">
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Date</span>
          <span className="text-right font-medium">{formatDateTime(data.issuedAt)}</span>
        </div>
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">Cashier</span>
          <span className="text-right font-medium">{data.cashierName}</span>
        </div>

        <Separator />

        <ul className="space-y-2">
          {data.lines.map((line, index) => (
            <li key={index} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{line.name}</p>
                <p className="tabular text-xs text-muted-foreground">
                  {formatQuantity(line.quantity)} × {formatCurrency(line.unitPrice, data.currency)}
                  {line.discount > 0 && ` · −${formatCurrency(line.discount, data.currency)}`}
                </p>
              </div>
              <span className="tabular whitespace-nowrap font-medium">
                {formatCurrency(line.total, data.currency)}
              </span>
            </li>
          ))}
        </ul>

        <Separator />

        <Row label="Subtotal" value={formatCurrency(data.subtotal, data.currency)} />
        {data.discount > 0 && (
          <Row label="Discount" value={`−${formatCurrency(data.discount, data.currency)}`} />
        )}
        {data.tax > 0 && <Row label="VAT" value={formatCurrency(data.tax, data.currency)} />}

        <div className="flex items-center justify-between">
          <span className="font-semibold">Total</span>
          <span className="tabular text-lg font-bold">{formatCurrency(data.total, data.currency)}</span>
        </div>

        <Separator />

        <Row
          label="Payment method"
          value={
            data.payments.length === 0
              ? '—'
              : data.payments.map((payment) => humanizeEnum(payment.method)).join(', ')
          }
        />
        {/* What the customer actually handed over. `paid` is only the
                    part applied to the sale, so on a ₱9 sale settled with ₱20
                    it reads ₱9 and would not square with ₱11 change. */}
        <Row label="Amount paid" value={formatCurrency(tendered, data.currency)} />
        <Row label="Change" value={formatCurrency(data.change, data.currency)} />
      </div>

      {/* Only this reaches the printer. */}
      <div className="print-only">
        <Receipt data={data} />
      </div>

      <div className="no-print flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={`/sales/${saleId}`}>Open full sale</Link>
        </Button>
        <Button onClick={() => window.print()}>
          <Printer /> Print receipt
        </Button>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular text-right font-medium">{value}</span>
    </div>
  );
}
