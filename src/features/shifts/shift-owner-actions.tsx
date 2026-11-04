'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ClipboardCheck, Info, LogOut, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/format';
import { parseCashAmount } from '@/lib/cash-amount';
import { adjustmentPreview } from '@/lib/shift-detail';
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
    <p role="alert" className="text-sm text-destructive-text">
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

/**
 * A signed correction to a closed shift's count, recorded beside the original.
 * It is an accounting record only: the counted cash, the variance at close and
 * the drawer stay as they were. The form shows the variance before and after,
 * then asks for confirmation; the server validates everything again.
 */
export function AdjustmentButton({
  shiftId,
  currency,
  shiftReference,
  expectedCash,
  actualCash,
  difference,
  adjustments,
}: {
  shiftId: string;
  currency: string;
  shiftReference: string;
  expectedCash: number;
  actualCash: number | null;
  difference: number | null;
  /** Signed amounts of the adjustments already recorded. */
  adjustments: number[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<'edit' | 'confirm'>('edit');
  const [direction, setDirection] = React.useState<'ADD' | 'SUBTRACT'>('ADD');
  const [amount, setAmount] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const parsed = parseCashAmount(amount, { allowZero: false });
  const signed = parsed.ok ? (direction === 'ADD' ? parsed.value : -parsed.value) : null;
  const preview = difference == null ? null : adjustmentPreview(difference, adjustments, signed);
  const valid = parsed.ok && reason.trim().length >= 3;
  const money = (value: number) => formatCurrency(value, currency);

  const reset = () => {
    setStep('edit');
    setDirection('ADD');
    setAmount('');
    setReason('');
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !valid) return;
    if (step === 'edit') {
      setStep('confirm');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await addShiftAdjustmentAction({ shiftId, direction, amount, reason: reason.trim() });
      if (!result.ok) {
        setError(result.error);
        setStep('edit');
        return;
      }
      toast.success(`Adjustment of ${signedMoney(signed ?? 0, currency)} recorded on ${shiftReference}.`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError(NETWORK_ERROR);
      setStep('edit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button className="h-10" onClick={() => setOpen(true)}>
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
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>{step === 'edit' ? `Record an adjustment · ${shiftReference}` : 'Confirm the adjustment'}</DialogTitle>
              <DialogDescription>
                For a correction you have confirmed, such as a miscount or a sale rung up wrongly. It is saved under your name next to the
                original count, which does not change. Adjustments cannot be edited or deleted.
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-3 divide-x rounded-lg border bg-muted/30 text-center text-xs">
              <div className="p-2.5">
                <dt className="text-muted-foreground">Expected</dt>
                <dd className="tabular mt-0.5 text-sm font-semibold">{money(expectedCash)}</dd>
              </div>
              <div className="p-2.5">
                <dt className="text-muted-foreground">Counted</dt>
                <dd className="tabular mt-0.5 text-sm font-semibold">{actualCash == null ? '—' : money(actualCash)}</dd>
              </div>
              <div className="p-2.5">
                <dt className="text-muted-foreground">{adjustments.length ? 'Variance now' : 'Variance'}</dt>
                <dd className="tabular mt-0.5 text-sm font-semibold">{preview ? varianceWords(preview.current, currency) : '—'}</dd>
              </div>
            </dl>

            <p className="flex gap-2 rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-info-text">
              <Info className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                This is an accounting correction only. It does not put cash into or take cash out of a drawer, and it does not show that
                any missing cash was found or deposited.
              </span>
            </p>

            <FormError error={error} />

            {step === 'edit' ? (
              <>
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
                  <PesoInput id="adjust-amount" value={amount} onChange={setAmount} autoFocus />
                  {amount !== '' && !parsed.ok && <p className="text-xs text-destructive-text">{parsed.error}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adjust-reason">Reason</Label>
                  <Textarea
                    id="adjust-reason"
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="e.g. Recounted with the cashier — ₱400 was a GCash cash-in rung up as a sale."
                  />
                  <p className="text-xs text-muted-foreground">Required. Kept with the adjustment and in the audit log.</p>
                </div>
                {preview?.after != null && (
                  <p className="flex items-baseline justify-between rounded-lg border px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Variance after this adjustment</span>
                    <span className="tabular font-semibold">{varianceWords(preview.after, currency)}</span>
                  </p>
                )}
              </>
            ) : (
              <dl className="divide-y rounded-lg border text-sm">
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Adjustment</dt>
                  <dd className="tabular font-semibold">{signedMoney(signed ?? 0, currency)}</dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">Variance before → after</dt>
                  <dd className="tabular text-right font-semibold">
                    {preview ? `${varianceWords(preview.current, currency)} → ${varianceWords(preview.after ?? preview.current, currency)}` : '—'}
                  </dd>
                </div>
                <div className="px-3 py-2">
                  <dt className="text-muted-foreground">Reason</dt>
                  <dd className="mt-0.5 break-words">{reason.trim()}</dd>
                </div>
              </dl>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              {step === 'edit' ? (
                <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
              ) : (
                <Button type="button" variant="outline" className="h-11" onClick={() => setStep('edit')} disabled={busy}>
                  Back
                </Button>
              )}
              <Button type="submit" className="h-11" loading={busy} disabled={!valid}>
                {step === 'edit' ? 'Review adjustment' : 'Save adjustment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function signedMoney(value: number, currency: string) {
  return `${value < 0 ? '−' : '+'}${formatCurrency(Math.abs(value), currency)}`;
}

function varianceWords(value: number, currency: string) {
  if (value === 0) return 'Balanced';
  return `${value > 0 ? 'Over' : 'Short'} ${formatCurrency(Math.abs(value), currency)}`;
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
              {counted !== '' && !parsed.ok && <p className="text-xs text-destructive-text">{parsed.error}</p>}
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
