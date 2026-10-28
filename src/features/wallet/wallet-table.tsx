'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Printer, Undo2 } from 'lucide-react';
import type { WalletRow } from '@/server/services/wallet-service';
import { WALLET_TYPE_LABEL, walletFigures } from '@/lib/wallet';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { reverseWalletAction } from '@/features/wallet/actions';

const HEAD = 'h-11 whitespace-nowrap px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

export function WalletTable({
  rows,
  currency,
  viewerId,
  isOwner,
  storeName,
}: {
  rows: WalletRow[];
  currency: string;
  viewerId: string;
  isOwner: boolean;
  storeName: string;
}) {
  const [selected, setSelected] = React.useState<WalletRow | null>(null);
  const money = (n: number) => formatCurrency(n, currency);

  return (
    <>
      <div className="overflow-x-auto">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Reference</TableHead>
              <TableHead className={HEAD}>Date &amp; time</TableHead>
              <TableHead className={HEAD}>Type</TableHead>
              <TableHead className={HEAD}>GCash ref.</TableHead>
              <TableHead className={HEAD}>Cashier / shift</TableHead>
              <TableHead className={cn(HEAD, 'text-right')}>Amount</TableHead>
              <TableHead className={cn(HEAD, 'text-right')}>Fee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={cn('cursor-pointer', row.reversed && 'opacity-60')} onClick={() => setSelected(row)}>
                <TableCell className="px-4 py-3">
                  <button
                    type="button"
                    className="tabular rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected(row);
                    }}
                  >
                    {row.reference}
                  </button>
                </TableCell>
                <TableCell className="tabular whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">{formatDateTime(row.createdAt)}</TableCell>
                <TableCell className="whitespace-nowrap px-4 py-3 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    {row.type === 'CASH_IN' ? <ArrowDownToLine className="h-3.5 w-3.5" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
                    {WALLET_TYPE_LABEL[row.type]}
                  </span>
                  {row.reversed && <Badge variant="destructive" className="ml-2">Reversed</Badge>}
                </TableCell>
                <TableCell className="tabular px-4 py-3 text-sm">{row.gcashReference}</TableCell>
                <TableCell className="whitespace-nowrap px-4 py-3 text-sm">
                  {row.cashier.name}
                  <span className="block text-xs text-muted-foreground">{row.shift.reference}</span>
                </TableCell>
                <TableCell className="tabular whitespace-nowrap px-4 py-3 text-right font-semibold">{money(row.amount)}</TableCell>
                <TableCell className="tabular whitespace-nowrap px-4 py-3 text-right text-success-text">{money(row.fee)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <WalletDetail
        row={selected}
        money={money}
        storeName={storeName}
        isOwner={isOwner}
        canReverse={Boolean(selected && !selected.reversed && selected.shift.open && (isOwner || selected.cashier.id === viewerId))}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function WalletDetail({
  row,
  money,
  storeName,
  isOwner,
  canReverse,
  onClose,
}: {
  row: WalletRow | null;
  money: (n: number) => string;
  storeName: string;
  isOwner: boolean;
  canReverse: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reversing, setReversing] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setReversing(false);
    setReason('');
    setError(null);
  }, [row?.id]);

  const figures = row ? walletFigures(row.type, row.amount, row.fee) : null;
  const lines: [string, React.ReactNode][] =
    row && figures
      ? [
          ['Type', WALLET_TYPE_LABEL[row.type]],
          ['GCash amount', money(row.amount)],
          ['Service fee', money(row.fee)],
          [row.type === 'CASH_IN' ? 'Cash collected' : 'Cash given', money(row.type === 'CASH_IN' ? figures.collectCash : figures.giveCash)],
          ['GCash reference', row.gcashReference],
          ['Customer number', row.customerMobileLast4 ? `•••• ${row.customerMobileLast4}` : '—'],
          ['Date & time', formatDateTime(row.createdAt)],
          ['Cashier', row.cashier.name],
          [
            'Shift',
            isOwner ? (
              <Link key="s" href={`/shifts/${row.shift.id}`} className="text-primary underline-offset-4 hover:underline">
                {row.shift.reference}
              </Link>
            ) : (
              row.shift.reference
            ),
          ],
          ['Notes', row.notes ?? '—'],
          ...(row.reversed
            ? ([['Reversed', `${formatDateTime(row.reversed.at)}${row.reversed.by ? ` by ${row.reversed.by}` : ''}${row.reversed.reason ? ` — ${row.reversed.reason}` : ''}`]] as [string, React.ReactNode][])
            : []),
        ]
      : [];

  const reverse = async () => {
    if (!row || busy || reason.trim().length < 3) return;
    setBusy(true);
    setError(null);
    const result = await reverseWalletAction({ id: row.id, reason: reason.trim() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`${row.reference} reversed.`);
    onClose();
    router.refresh();
  };

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="no-print">
          <DialogTitle className="tabular">{row?.reference}</DialogTitle>
          <DialogDescription>A GCash service, not a sale. Kept permanently; a mistake is reversed, never edited.</DialogDescription>
        </DialogHeader>

        <dl className="divide-y rounded-lg border text-sm">
          {lines.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[9rem_1fr] gap-3 px-3 py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>

        {/* The customer copy: only this reaches the printer. */}
        {row && figures && (
          <div className="print-only space-y-1 text-sm text-black">
            <p className="text-base font-bold">{storeName}</p>
            <p>{WALLET_TYPE_LABEL[row.type]} — {row.reference}</p>
            <p>{formatDateTime(row.createdAt)}</p>
            <p>GCash amount: {money(row.amount)}</p>
            <p>Service fee: {money(row.fee)}</p>
            <p>{row.type === 'CASH_IN' ? 'Cash received' : 'Cash given'}: {money(row.type === 'CASH_IN' ? figures.collectCash : figures.giveCash)}</p>
            <p>GCash ref.: {row.gcashReference}</p>
            <p>Cashier: {row.cashier.name}</p>
            {row.reversed && <p>REVERSED</p>}
          </div>
        )}

        {reversing && (
          <div className="no-print space-y-1.5">
            {error && (
              <p role="alert" className="flex items-start gap-2 text-sm text-destructive-text">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
              </p>
            )}
            <Label htmlFor="wallet-reverse-reason">Why is this being reversed?</Label>
            <Input id="wallet-reverse-reason" value={reason} maxLength={200} autoFocus onChange={(e) => setReason(e.target.value)} className="h-11" />
            <p className="text-xs text-muted-foreground">
              Undo the money yourself first ({row?.type === 'CASH_IN' ? 'return the cash, or get the GCash back' : 'get the cash back, or return the GCash'}).
              The entry then stops counting in the drawer and the reports.
            </p>
          </div>
        )}

        <DialogFooter className="no-print gap-2 sm:gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
          {canReverse &&
            (reversing ? (
              <Button type="button" variant="destructive" className="h-11" loading={busy} disabled={reason.trim().length < 3} onClick={reverse}>
                Reverse entry
              </Button>
            ) : (
              <Button type="button" variant="secondary" className="h-11" onClick={() => setReversing(true)}>
                <Undo2 /> Reverse
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
