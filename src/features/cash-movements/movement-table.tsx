'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Undo2 } from 'lucide-react';
import type { CashMovementRow } from '@/server/services/cash-movement-queries';
import { CATEGORY_LABEL, TYPE_LABEL } from '@/lib/cash-movements';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { correctCashMovementAction } from '@/features/pos/shift-actions';

const HEAD = 'h-11 whitespace-nowrap px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/** Cash in / out rows; each opens its full detail, with a correction while its shift is open. */
export function CashMovementTable({
  rows,
  currency,
  viewerId,
  isOwner,
  compact = false,
}: {
  rows: CashMovementRow[];
  currency: string;
  viewerId: string;
  isOwner: boolean;
  /** The dashboard's short list: fewer columns. */
  compact?: boolean;
}) {
  const [selected, setSelected] = React.useState<CashMovementRow | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <Table className={compact ? undefined : 'min-w-[860px]'}>
          <TableHeader>
            <TableRow>
              <TableHead className={HEAD}>Reference</TableHead>
              <TableHead className={HEAD}>Date &amp; time</TableHead>
              <TableHead className={HEAD}>Category / reason</TableHead>
              {!compact && <TableHead className={HEAD}>Cashier</TableHead>}
              {!compact && <TableHead className={HEAD}>Shift</TableHead>}
              <TableHead className={cn(HEAD, 'text-right')}>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelected(row)}>
                <TableCell className="px-4 py-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected(row);
                    }}
                  >
                    {row.type === 'CASH_OUT' ? (
                      <ArrowUpFromLine className="h-3.5 w-3.5 text-warning-text" aria-hidden="true" />
                    ) : (
                      <ArrowDownToLine className="h-3.5 w-3.5 text-success-text" aria-hidden="true" />
                    )}
                    <span className="tabular">{row.reference}</span>
                  </button>
                </TableCell>
                <TableCell className="tabular whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">
                  {formatDateTime(row.createdAt)}
                </TableCell>
                <TableCell className="max-w-[280px] px-4 py-3">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {CATEGORY_LABEL[row.category]}
                    {row.correctedBy && <Badge variant="outline">Corrected</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{row.reason}</p>
                </TableCell>
                {!compact && (
                  <TableCell className="whitespace-nowrap px-4 py-3 text-sm">
                    {row.cashier.name}
                    {!row.cashier.isActive && <span className="ml-1 text-xs text-muted-foreground">(inactive)</span>}
                  </TableCell>
                )}
                {!compact && <TableCell className="tabular whitespace-nowrap px-4 py-3 text-sm">{row.shift.reference}</TableCell>}
                <TableCell
                  className={cn(
                    'tabular whitespace-nowrap px-4 py-3 text-right font-semibold',
                    row.type === 'CASH_OUT' ? 'text-warning-text' : 'text-success-text',
                  )}
                >
                  {row.type === 'CASH_OUT' ? '−' : '+'}
                  {formatCurrency(row.amount, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <MovementDetail
        row={selected}
        currency={currency}
        canCorrect={Boolean(
          selected &&
            selected.shift.open &&
            !selected.correctedBy &&
            selected.category !== 'CORRECTION' &&
            (isOwner || selected.cashier.id === viewerId),
        )}
        isOwner={isOwner}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function MovementDetail({
  row,
  currency,
  canCorrect,
  isOwner,
  onClose,
}: {
  row: CashMovementRow | null;
  currency: string;
  canCorrect: boolean;
  isOwner: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [correcting, setCorrecting] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setCorrecting(false);
    setReason('');
    setError(null);
  }, [row?.id]);

  const submit = async () => {
    if (!row || busy || reason.trim().length < 3) return;
    setBusy(true);
    setError(null);
    const result = await correctCashMovementAction({ movementId: row.id, reason: reason.trim() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`${result.data.reference} reverses ${row.reference}.`);
    onClose();
    router.refresh();
  };

  const rows: [string, React.ReactNode][] = row
    ? [
        ['Type', TYPE_LABEL[row.type]],
        ['Amount', <span key="a" className="tabular font-semibold">{formatCurrency(row.amount, currency)}</span>],
        ['Category', CATEGORY_LABEL[row.category]],
        ['Reason', row.reason],
        ['Notes', row.notes ?? '—'],
        ['Date & time', formatDateTime(row.createdAt)],
        ['Recorded by', `${row.cashier.name}${row.cashier.isActive ? '' : ' (inactive)'}`],
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
        ['Drawer effect', `${row.type === 'CASH_IN' ? 'Adds' : 'Takes'} ${formatCurrency(row.amount, currency)} ${row.type === 'CASH_IN' ? 'to' : 'from'} expected cash`],
        ['Approval', 'Recorded directly by the cashier (no approval step)'],
        ...(row.corrects ? ([['Corrects', row.corrects.reference]] as [string, React.ReactNode][]) : []),
        ...(row.correctedBy
          ? ([['Corrected by', `${row.correctedBy.reference} on ${formatDateTime(row.correctedBy.createdAt)}`]] as [string, React.ReactNode][])
          : []),
      ]
    : [];

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="tabular">{row?.reference}</DialogTitle>
          <DialogDescription>
            Kept permanently on the shift record. A mistake is put right with a correction, never by editing or deleting.
          </DialogDescription>
        </DialogHeader>

        <dl className="divide-y rounded-lg border text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[8.5rem_1fr] gap-3 px-3 py-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>

        {correcting && (
          <div className="space-y-1.5">
            {error && (
              <p role="alert" className="flex items-start gap-2 text-sm text-destructive-text">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
              </p>
            )}
            <Label htmlFor="correction-reason">Why is this being corrected?</Label>
            <Input
              id="correction-reason"
              value={reason}
              maxLength={150}
              autoFocus
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Typed the wrong amount"
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              Records an opposite {row?.type === 'CASH_OUT' ? 'cash in' : 'cash out'} of{' '}
              {row ? formatCurrency(row.amount, currency) : ''}, linked to {row?.reference}.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={onClose} disabled={busy}>
            Close
          </Button>
          {canCorrect &&
            (correcting ? (
              <Button type="button" className="h-11" loading={busy} disabled={reason.trim().length < 3} onClick={submit}>
                Record correction
              </Button>
            ) : (
              <Button type="button" variant="secondary" className="h-11" onClick={() => setCorrecting(true)}>
                <Undo2 /> Correct this entry
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
