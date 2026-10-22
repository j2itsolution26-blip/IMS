'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ClipboardCheck, LogOut, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/format';
import { parseCashAmount } from '@/lib/cash-amount';
import { cn } from '@/lib/utils';
import { closeShiftForCashierAction } from '@/features/pos/shift-actions';
import { addShiftAdjustmentAction, reviewShiftAction } from '@/features/shifts/actions';

const NETWORK_ERROR = 'Could not reach the server. Refresh to see whether it went through before trying again.';

function PesoInput({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-muted-foreground">₱</span>
      <Input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 pl-7 tabular"
        placeholder="0.00"
      />
    </div>
  );
}

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

/** The owner marks a flagged shift reviewed. The note is required and kept with the shift. */
export function ReviewForm({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || note.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const result = await reviewShiftAction({ shiftId, note: note.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success('Marked reviewed.');
      router.refresh();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <FormError error={error} />
      <div className="space-y-1.5">
        <Label htmlFor="review-note">What did you find?</Label>
        <Textarea
          id="review-note"
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Counted again with the cashier — ₱20 coin found under the tray. Miscount, no further action."
        />
        <p className="text-xs text-muted-foreground">
          Marking it reviewed keeps the original count and variance unchanged. To correct the figures, record an adjustment.
        </p>
      </div>
      <Button type="submit" className="h-11" loading={busy} disabled={note.trim().length < 3}>
        <ClipboardCheck /> Mark reviewed
      </Button>
    </form>
  );
}

/** A signed correction to a closed shift's count, recorded beside the original. */
export function AdjustmentButton({ shiftId, currency }: { shiftId: string; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [direction, setDirection] = React.useState<'ADD' | 'SUBTRACT'>('ADD');
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const parsed = parseCashAmount(amount, { allowZero: false });

  const reset = () => {
    setDirection('ADD');
    setAmount('');
    setReason('');
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !parsed.ok || reason.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addShiftAdjustmentAction({ shiftId, direction, amount, reason: reason.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Adjustment of ${direction === 'ADD' ? '+' : '−'}${formatCurrency(parsed.value, currency)} recorded.`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="h-10" onClick={() => setOpen(true)}>
        <Scale /> Record adjustment
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>Record an adjustment</DialogTitle>
              <DialogDescription>
                For a correction you have confirmed — cash found later, a miscount. It is saved under your name beside the original
                count, which stays as it was. Adjustments cannot be edited or deleted.
              </DialogDescription>
            </DialogHeader>
            <FormError error={error} />
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Counted cash should be</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['ADD', 'Higher (+)'],
                    ['SUBTRACT', 'Lower (−)'],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className={cn(
                      'flex h-11 cursor-pointer items-center justify-center rounded-md border text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                      direction === value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent',
                    )}
                  >
                    <input
                      type="radio"
                      name="direction"
                      value={value}
                      checked={direction === value}
                      onChange={() => setDirection(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-amount">Amount</Label>
              <PesoInput id="adjust-amount" value={amount} onChange={setAmount} />
              {amount !== '' && !parsed.ok && <p className="text-xs text-destructive">{parsed.error}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adjust-reason">Reason</Label>
              <Textarea id="adjust-reason" rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" className="h-11" loading={busy} disabled={!parsed.ok || reason.trim().length < 3}>
                Save adjustment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The owner closes a shift a cashier left open, after counting that drawer themselves. */
export function OwnerCloseButton({ shiftId, cashierName, currency }: { shiftId: string; cashierName: string; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [counted, setCounted] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const parsed = parseCashAmount(counted);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!parsed.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await closeShiftForCashierAction({ shiftId, actualCash: counted, notes: notes.trim() || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const d = result.data.difference;
      toast.success(
        `${cashierName}'s shift closed — ${d === 0 ? 'balanced' : `${d > 0 ? 'overage' : 'shortage'} ${formatCurrency(Math.abs(d), currency)}`}.`,
      );
      setOpen(false);
      router.refresh();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="h-10" onClick={() => setOpen(true)}>
        <LogOut /> Close this shift
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (next) {
            setCounted('');
            setNotes('');
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={submit} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>Close {cashierName}&apos;s shift</DialogTitle>
              <DialogDescription>
                Count the drawer, then enter the total. The variance is worked out on the server against the expected cash and
                recorded under your name.
              </DialogDescription>
            </DialogHeader>
            <FormError error={error} />
            <div className="space-y-1.5">
              <Label htmlFor="owner-counted">Cash counted</Label>
              <PesoInput id="owner-counted" value={counted} onChange={setCounted} autoFocus />
              {counted !== '' && !parsed.ok && <p className="text-xs text-destructive">{parsed.error}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="owner-notes">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea id="owner-notes" rows={2} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" className="h-11" loading={busy} disabled={!parsed.ok}>
                Close shift
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
