'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronDown, LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { parseCashAmount } from '@/lib/cash-amount';
import { closeShiftForCashierAction } from '@/features/pos/shift-actions';

export interface ShiftRowView {
  id: string;
  status: 'OPEN' | 'CLOSED';
  cashierName: string;
  openedAt: string;
  closedAt: string | null;
  closedByName: string | null;
  openingNotes: string | null;
  closingNotes: string | null;
  openingCash: number;
  cashSales: number;
  cashRefunds: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  actualCash: number | null;
  difference: number | null;
  varianceKind: 'BALANCED' | 'OVERAGE' | 'SHORTAGE' | null;
  totalSales: number;
  transactionCount: number;
  movements: { id: string; type: 'CASH_IN' | 'CASH_OUT'; amount: number; reason: string; createdAt: string; userName: string }[];
}

const VARIANCE = {
  BALANCED: { label: 'Balanced', variant: 'success' },
  OVERAGE: { label: 'Overage', variant: 'warning' },
  SHORTAGE: { label: 'Shortage', variant: 'destructive' },
} as const;

const HEAD = 'h-10 whitespace-nowrap px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const NUM = 'px-3 py-2.5 text-right tabular whitespace-nowrap';

export function ShiftHistoryTable({ shifts, currency }: { shifts: ShiftRowView[]; currency: string }) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [closing, setClosing] = React.useState<ShiftRowView | null>(null);
  const money = (value: number) => formatCurrency(value, currency);

  return (
    // `relative` keeps absolutely positioned descendants (the sr-only header)
    // inside this scroller, so the wide table never widens the page.
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className={HEAD}>Cashier</th>
            <th className={HEAD}>Opened</th>
            <th className={HEAD}>Closed</th>
            <th className={cn(HEAD, 'text-right')}>Starting</th>
            <th className={cn(HEAD, 'text-right')}>Cash sales</th>
            <th className={cn(HEAD, 'text-right')}>Refunds</th>
            <th className={cn(HEAD, 'text-right')}>In / out</th>
            <th className={cn(HEAD, 'text-right')}>Expected</th>
            <th className={cn(HEAD, 'text-right')}>Counted</th>
            <th className={cn(HEAD, 'text-right')}>Variance</th>
            <th className={HEAD}>Status</th>
            <th className={HEAD}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {shifts.map((shift) => {
            const open = expanded === shift.id;
            const variance = shift.varianceKind ? VARIANCE[shift.varianceKind] : null;
            return (
              <React.Fragment key={shift.id}>
                <tr className="align-middle">
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : shift.id)}
                      aria-expanded={open}
                      className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap font-medium hover:text-primary"
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
                      {shift.cashierName}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">{formatDateTime(shift.openedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{shift.closedAt ? formatDateTime(shift.closedAt) : '—'}</td>
                  <td className={NUM}>{money(shift.openingCash)}</td>
                  <td className={NUM}>{money(shift.cashSales)}</td>
                  <td className={NUM}>{shift.cashRefunds ? `−${money(shift.cashRefunds)}` : '—'}</td>
                  <td className={NUM}>
                    {shift.cashIn || shift.cashOut ? `+${money(shift.cashIn)} / −${money(shift.cashOut)}` : '—'}
                  </td>
                  <td className={cn(NUM, 'font-semibold')}>{money(shift.expectedCash)}</td>
                  <td className={NUM}>{shift.actualCash == null ? '—' : money(shift.actualCash)}</td>
                  <td className={NUM}>
                    {variance && shift.difference != null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant={variance.variant}>{variance.label}</Badge>
                        {shift.difference !== 0 && (
                          <span className={shift.difference < 0 ? 'text-destructive' : 'text-warning'}>
                            {shift.difference > 0 ? '+' : ''}
                            {money(shift.difference)}
                          </span>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={shift.status === 'OPEN' ? 'default' : 'secondary'}>{shift.status === 'OPEN' ? 'Open' : 'Closed'}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {shift.status === 'OPEN' && (
                      <Button variant="outline" size="sm" className="h-9" onClick={() => setClosing(shift)}>
                        <LogOut /> Close shift
                      </Button>
                    )}
                  </td>
                </tr>
                {open && (
                  <tr className="bg-muted/20">
                    <td colSpan={12} className="px-6 py-3">
                      <ShiftDetails shift={shift} money={money} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      <OwnerCloseDialog shift={closing} onClose={() => setClosing(null)} currency={currency} />
    </div>
  );
}

function ShiftDetails({ shift, money }: { shift: ShiftRowView; money: (n: number) => string }) {
  return (
    <div className="grid gap-4 text-sm md:grid-cols-3">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sales</p>
        <p>
          {shift.transactionCount} sale{shift.transactionCount === 1 ? '' : 's'} · {money(shift.totalSales)} all payments
        </p>
        {shift.closedByName && <p className="text-muted-foreground">Closed by {shift.closedByName}</p>}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
        <p>
          <span className="text-muted-foreground">Opening:</span> {shift.openingNotes || '—'}
        </p>
        <p>
          <span className="text-muted-foreground">Closing:</span> {shift.closingNotes || '—'}
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cash in / out</p>
        {shift.movements.length === 0 ? (
          <p className="text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-1">
            {shift.movements.map((m) => (
              <li key={m.id}>
                <span className={m.type === 'CASH_IN' ? 'text-success' : 'text-destructive'}>
                  {m.type === 'CASH_IN' ? '+' : '−'}
                  {money(m.amount)}
                </span>{' '}
                {m.reason} <span className="text-xs text-muted-foreground">· {m.userName}, {formatDateTime(m.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The owner closes a shift a cashier left open, after counting that drawer themselves. */
function OwnerCloseDialog({ shift, onClose, currency }: { shift: ShiftRowView | null; onClose: () => void; currency: string }) {
  const router = useRouter();
  const [counted, setCounted] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (shift) {
      setCounted('');
      setNotes('');
      setError(null);
    }
  }, [shift]);

  const parsed = parseCashAmount(counted);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!shift || !parsed.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await closeShiftForCashierAction({ shiftId: shift.id, actualCash: counted, notes: notes.trim() || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const d = result.data.difference;
      toast.success(
        `${shift.cashierName}'s shift closed — ${d === 0 ? 'balanced' : `${d > 0 ? 'overage' : 'shortage'} ${formatCurrency(Math.abs(d), currency)}`}.`,
      );
      onClose();
      router.refresh();
    } catch {
      setError('Could not reach the server. Refresh to see whether the shift closed before trying again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={shift !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Close {shift?.cashierName}&apos;s shift</DialogTitle>
            <DialogDescription>
              Count the drawer, then enter the total. The variance is worked out against the expected cash and recorded under your
              name.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="owner-counted">Cash counted</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-muted-foreground">₱</span>
              <Input
                id="owner-counted"
                inputMode="decimal"
                autoFocus
                value={counted}
                onChange={(event) => setCounted(event.target.value)}
                className="h-11 pl-7 tabular"
                placeholder="0.00"
              />
            </div>
            {counted !== '' && !parsed.ok && <p className="text-xs text-destructive">{parsed.error}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner-notes">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="owner-notes" rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" className="h-11" loading={busy} disabled={!parsed.ok}>
              Close shift
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
