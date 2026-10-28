'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Lock, LogOut, Smartphone, TriangleAlert, Wallet } from 'lucide-react';
import { WalletDialog } from '@/features/wallet/wallet-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { parseCashAmount } from '@/lib/cash-amount';
import { CATEGORIES_FOR, CATEGORY_LABEL, type MovementCategory } from '@/lib/cash-movements';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addCashMovementAction, closeShiftAction, previewShiftCloseAction } from '@/features/pos/shift-actions';
import { OpenShiftDialog } from '@/features/pos/open-shift-dialog';

/** Shown instead of the till when the cashier has no open shift. */
export function ShiftGate({ suggestedAmount, currency }: { suggestedAmount: number; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(true);

  return (
    <>
      <Card className="mx-auto max-w-sm p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
        <p className="font-medium">Open your shift to start selling</p>
        <p className="mt-1 text-sm text-muted-foreground">Count the cash in the drawer first. Sales need an open shift.</p>
        <div className="mt-5 grid gap-2">
          <Button size="lg" className="h-11" onClick={() => setOpen(true)}>
            <Wallet /> Open shift
          </Button>
          <Button asChild variant="ghost" className="h-10">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </Card>
      <OpenShiftDialog
        open={open}
        onOpenChange={setOpen}
        suggestedAmount={suggestedAmount}
        currency={currency}
        onOpened={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

/** The strip above the till while a shift is open. */
export function ShiftBar({
  openedAt,
  openingCash,
  currency,
  hasUnfinishedOrder,
  walletServices = false,
}: {
  openedAt: string;
  openingCash: number;
  currency: string;
  walletServices?: boolean;
  /** A basket in progress or a held order in this browser. */
  hasUnfinishedOrder: boolean;
}) {
  const [movement, setMovement] = React.useState<'CASH_IN' | 'CASH_OUT' | null>(null);
  const [closing, setClosing] = React.useState(false);
  const [walletOpen, setWalletOpen] = React.useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="min-w-0">
        Shift open since <span className="font-medium text-foreground">{formatTime(openedAt)}</span> · started with{' '}
        <span className="tabular font-medium text-foreground">{formatCurrency(openingCash, currency)}</span>
      </span>
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setMovement('CASH_IN')}>
          <ArrowDownToLine className="h-3.5 w-3.5" /> Cash in
        </Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setMovement('CASH_OUT')}>
          <ArrowUpFromLine className="h-3.5 w-3.5" /> Cash out
        </Button>
        {walletServices && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setWalletOpen(true)}>
            <Smartphone className="h-3.5 w-3.5" /> GCash in / out
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setClosing(true)}>
          <LogOut className="h-3.5 w-3.5" /> Close shift
        </Button>
      </div>

      <CashMovementDialog type={movement} onClose={() => setMovement(null)} currency={currency} />
      {walletServices && <WalletDialog open={walletOpen} onOpenChange={setWalletOpen} currency={currency} />}
      <CloseShiftDialog open={closing} onOpenChange={setClosing} currency={currency} hasUnfinishedOrder={hasUnfinishedOrder} />
    </div>
  );
}

function CashMovementDialog({ type, onClose, currency }: { type: 'CASH_IN' | 'CASH_OUT' | null; onClose: () => void; currency: string }) {
  const router = useRouter();
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [category, setCategory] = React.useState<MovementCategory | ''>('');
  const [notes, setNotes] = React.useState('');
  // One per opening of the dialog: a doubled or retried submit records once.
  const [requestId, setRequestId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (type) {
      setAmount('');
      setReason('');
      setCategory('');
      setNotes('');
      setRequestId(crypto.randomUUID());
      setError(null);
      setTouched(false);
    }
  }, [type]);

  const parsed = parseCashAmount(amount, { allowZero: false });
  const reasonOk = reason.trim().length >= 3;
  const categoryOk = category !== '';
  const isIn = type === 'CASH_IN';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!type || !parsed.ok || !reasonOk || !categoryOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addCashMovementAction({
        type,
        amount,
        reason: reason.trim(),
        category,
        notes: notes.trim() || undefined,
        clientRequestId: requestId || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`${result.data.reference}: ${isIn ? 'cash in' : 'cash out'} of ${formatCurrency(parsed.value, currency)} recorded.`);
      onClose();
      router.refresh();
    } catch {
      setError('Could not reach the server. Check the drawer before trying again so it is not recorded twice.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={type !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{isIn ? 'Cash in' : 'Cash out'}</DialogTitle>
            <DialogDescription>
              {isIn ? 'Cash added to the drawer, such as more change.' : 'Cash taken from the drawer, such as paying a supplier.'} It is
              kept on the shift record.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive-text">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="movement-amount">Amount</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-muted-foreground">₱</span>
              <Input
                id="movement-amount"
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                className="h-11 pl-7 tabular"
                aria-invalid={touched && !parsed.ok}
              />
            </div>
            {touched && !parsed.ok && <p className="text-xs text-destructive-text">{parsed.error}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="movement-category">Category</Label>
            <Select value={category} onValueChange={(value) => setCategory(value as MovementCategory)}>
              <SelectTrigger id="movement-category" className="h-11" aria-invalid={touched && !categoryOk}>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {(type ? CATEGORIES_FOR[type] : []).map((value) => (
                  <SelectItem key={value} value={value}>
                    {CATEGORY_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {touched && !categoryOk && <p className="text-xs text-destructive-text">Choose a category.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="movement-reason">Reason</Label>
            <Input
              id="movement-reason"
              value={reason}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              placeholder={isIn ? 'e.g. Extra coins from the owner' : 'e.g. Paid ice delivery'}
              className="h-11"
              aria-invalid={touched && !reasonOk}
            />
            {touched && !reasonOk && <p className="text-xs text-destructive-text">Give a short reason.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="movement-notes">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="movement-notes"
              value={notes}
              maxLength={500}
              rows={2}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Receipt number, who received the cash, anything the owner should know"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" className="h-11" loading={busy}>
              Record {isIn ? 'cash in' : 'cash out'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Summary {
  openingCash: number;
  cashSales: number;
  cashIn: number;
  cashRefunds: number;
  cashOut: number;
  /** Net drawer cash from GCash services; absent before they existed. */
  walletCash?: number;
  expectedCash: number;
  totalSales: number;
  transactionCount: number;
}

const VARIANCE = {
  BALANCED: { label: 'Balanced', className: 'text-success-text' },
  OVERAGE: { label: 'Overage', className: 'text-warning-text' },
  SHORTAGE: { label: 'Shortage', className: 'text-destructive-text' },
} as const;

function varianceOf(counted: number, expected: number) {
  const difference = Math.round((counted - expected) * 100) / 100;
  return { difference, kind: difference === 0 ? 'BALANCED' : difference > 0 ? 'OVERAGE' : 'SHORTAGE' } as const;
}

/**
 * Close shift as a blind count: the cashier counts the drawer first, then
 * sees the expected figure and the variance and confirms. The figures that are
 * kept are the server's, computed again at the moment of closing.
 */
function CloseShiftDialog({
  open,
  onOpenChange,
  currency,
  hasUnfinishedOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  hasUnfinishedOrder: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState<'count' | 'review' | 'done'>('count');
  const [counted, setCounted] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [preview, setPreview] = React.useState<Summary | null>(null);
  const [result, setResult] = React.useState<(Summary & { actualCash: number; difference: number; varianceKind: keyof typeof VARIANCE }) | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setStep('count');
      setCounted('');
      setNotes('');
      setTouched(false);
      setPreview(null);
      setResult(null);
      setError(null);
    }
  }, [open]);

  const parsed = parseCashAmount(counted);

  const review = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!parsed.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await previewShiftCloseAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res.data);
      setStep('review');
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmClose = async () => {
    if (!parsed.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await closeShiftAction({ actualCash: counted, notes: notes.trim() || undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.data);
      setStep('done');
    } catch {
      setError('Could not reach the server. Reopen the POS to see whether the shift closed before trying again.');
    } finally {
      setBusy(false);
    }
  };

  const shown = step === 'done' ? result : preview;
  const variance = step === 'done' && result ? { difference: result.difference, kind: result.varianceKind } : shown && parsed.ok ? varianceOf(parsed.value, shown.expectedCash) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next && step === 'done') router.refresh();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{step === 'done' ? 'Shift closed' : 'Close shift'}</DialogTitle>
          <DialogDescription>
            {step === 'count'
              ? 'Count every note and coin in the drawer, then enter the total.'
              : step === 'review'
                ? 'Check the figures. Once closed, this shift takes no more sales.'
                : 'These figures are saved on the shift record.'}
          </DialogDescription>
        </DialogHeader>

        {hasUnfinishedOrder && step !== 'done' && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning-text">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            There is an unfinished or held order in this browser. Complete or clear it first if a customer is waiting.
          </p>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-text">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}

        {step === 'count' ? (
          <form id="count-form" onSubmit={review} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="counted-cash">Cash counted in the drawer</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground">₱</span>
                <Input
                  id="counted-cash"
                  inputMode="decimal"
                  autoFocus
                  value={counted}
                  onChange={(event) => setCounted(event.target.value)}
                  placeholder="0.00"
                  aria-invalid={touched && !parsed.ok}
                  className="h-12 pl-8 text-lg font-semibold tabular"
                />
              </div>
              {touched && !parsed.ok && <p className="text-xs text-destructive-text">{parsed.error}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="closing-notes">
                Closing notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea id="closing-notes" rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </form>
        ) : shown ? (
          <div className="space-y-2 text-sm">
            <Line label="Starting cash" value={formatCurrency(shown.openingCash, currency)} />
            <Line label={`Cash sales (${shown.transactionCount} sale${shown.transactionCount === 1 ? '' : 's'})`} value={`+ ${formatCurrency(shown.cashSales, currency)}`} />
            <Line label="Cash in" value={`+ ${formatCurrency(shown.cashIn, currency)}`} />
            <Line label="Cash refunds" value={`− ${formatCurrency(shown.cashRefunds, currency)}`} />
            <Line label="Cash out" value={`− ${formatCurrency(shown.cashOut, currency)}`} />
            {Boolean(shown.walletCash) && (
              <Line
                label="GCash services (cash)"
                value={`${(shown.walletCash ?? 0) >= 0 ? '+' : '−'} ${formatCurrency(Math.abs(shown.walletCash ?? 0), currency)}`}
              />
            )}
            <Separator />
            <Line label="Expected in drawer" value={formatCurrency(shown.expectedCash, currency)} strong />
            <Line label="Counted" value={formatCurrency(step === 'done' && result ? result.actualCash : parsed.ok ? parsed.value : 0, currency)} strong />
            {variance && (
              <div className="flex items-center justify-between rounded-xl border bg-muted/40 px-4 py-3">
                <span className="font-semibold">{VARIANCE[variance.kind].label}</span>
                <span className={cn('tabular text-xl font-bold', VARIANCE[variance.kind].className)}>
                  {variance.difference > 0 ? '+' : ''}
                  {formatCurrency(variance.difference, currency)}
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">All-payment sales this shift: {formatCurrency(shown.totalSales, currency)} (GCash is not in the drawer).</p>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          {step === 'count' && (
            <>
              <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" form="count-form" className="h-11" loading={busy}>
                Review
              </Button>
            </>
          )}
          {step === 'review' && (
            <>
              <Button type="button" variant="outline" className="h-11" onClick={() => setStep('count')} disabled={busy}>
                Recount
              </Button>
              <Button type="button" className="h-11" onClick={confirmClose} loading={busy}>
                Close shift
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button
              type="button"
              className="h-11"
              onClick={() => {
                onOpenChange(false);
                router.refresh();
              }}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
      <span className={cn('tabular', strong && 'font-semibold')}>{value}</span>
    </div>
  );
}
