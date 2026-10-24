'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { AlertCircle, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { QUICK_OPENING_AMOUNTS, parseCashAmount } from '@/lib/cash-amount';
import { openShiftAction } from '@/features/pos/shift-actions';

export interface OpenedShift {
  id: string;
  openedAt: string;
  openingCash: number;
  resumed: boolean;
}

/**
 * "Open your shift": the cashier counts the drawer and enters what is
 * actually there. Nothing is pre-filled — a suggested float is shown as a
 * hint only, so it is never mistaken for a count.
 *
 * Safe to submit twice or retry after a dropped connection: the server returns
 * the shift already open instead of creating another.
 */
export function OpenShiftDialog({
  open,
  onOpenChange,
  onOpened,
  suggestedAmount,
  currency = 'PHP',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (shift: OpenedShift) => void;
  /** From Settings; 0 hides the hint. */
  suggestedAmount: number;
  currency?: string;
}) {
  const [amount, setAmount] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const submitting = React.useRef(false);

  React.useEffect(() => {
    if (open) {
      setAmount('');
      setNotes('');
      setTouched(false);
      setServerError(null);
    }
  }, [open]);

  const parsed = parseCashAmount(amount);
  const showError = touched && !parsed.ok;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!parsed.ok || submitting.current) return;

    submitting.current = true;
    setBusy(true);
    setServerError(null);
    try {
      const result = await openShiftAction({ openingCash: amount, openingNotes: notes.trim() || undefined });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      toast.success(
        result.data.resumed
          ? 'Your shift was already open — picking up where you left off.'
          : `Shift opened with ${formatCurrency(result.data.openingCash, currency)} starting cash.`,
      );
      onOpened(result.data);
    } catch {
      // The request may or may not have reached the server. Trying again is
      // safe: an already-open shift is resumed, never duplicated.
      setServerError('Could not reach the server. Check the connection and try again — if your shift did open, it will resume.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-5">
          <DialogHeader>
            <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Wallet className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle className="text-xl">Open your shift</DialogTitle>
            <DialogDescription>Count your starting cash before accepting sales.</DialogDescription>
          </DialogHeader>

          {serverError && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-text">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{serverError}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="starting-cash">Starting cash</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground">
                ₱
              </span>
              <Input
                id="starting-cash"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={showError}
                aria-describedby="starting-cash-help"
                className={cn('h-12 rounded-lg pl-8 text-lg font-semibold tabular', showError && 'border-destructive focus-visible:ring-destructive')}
              />
            </div>
            <p id="starting-cash-help" className={cn('text-xs', showError ? 'text-destructive-text' : 'text-muted-foreground')}>
              {showError && !parsed.ok
                ? parsed.error
                : suggestedAmount > 0
                  ? `Enter the cash you counted. Suggested float: ${formatCurrency(suggestedAmount, currency)} — a guide, not a count.`
                  : 'Enter the cash you counted in the drawer.'}
            </p>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium" id="quick-amounts">
              Quick amounts
            </span>
            <div role="group" aria-labelledby="quick-amounts" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {QUICK_OPENING_AMOUNTS.map((value) => {
                const selected = parsed.ok && parsed.value === value;
                return (
                  <Button
                    key={value}
                    type="button"
                    variant="outline"
                    aria-pressed={selected}
                    onClick={() => {
                      setAmount(String(value));
                      setTouched(true);
                    }}
                    className={cn('h-11 rounded-lg tabular', selected && 'border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
                  >
                    {formatCurrency(value, currency).replace(/\.00$/, '')}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="opening-notes">
              Opening notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="opening-notes"
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="e.g. 2 × ₱500, 5 × ₱100, ₱150 in coins for change"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border bg-muted/40 px-4 py-3" aria-live="polite">
            <span className="text-sm text-muted-foreground">Starting cash</span>
            <span className="tabular text-2xl font-bold">{parsed.ok ? formatCurrency(parsed.value, currency) : '—'}</span>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 sm:min-w-32" loading={busy} disabled={busy || (touched && !parsed.ok)}>
              Open Shift
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
