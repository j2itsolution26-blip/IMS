'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { GCASH_REFERENCE_HINT, normalizeGcashReference } from '@/lib/tender';
import { WALLET_TYPE_LABEL, walletFigures, walletInstruction, walletProblem, type WalletType } from '@/lib/wallet';
import { recordWalletAction } from '@/features/wallet/actions';

/**
 * Records a GCash cash-in or cash-out for a customer, in two steps: enter the
 * details, then read back exactly what to collect or hand over and confirm
 * the GCash transfer in the store's own app before recording. Not a sale.
 */
export function WalletDialog({ open, onOpenChange, currency }: { open: boolean; onOpenChange: (open: boolean) => void; currency: string }) {
  const router = useRouter();
  const [type, setType] = React.useState<WalletType>('CASH_IN');
  const [amount, setAmount] = React.useState('');
  const [fee, setFee] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [mobile, setMobile] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [step, setStep] = React.useState<'enter' | 'confirm'>('enter');
  const [confirmed, setConfirmed] = React.useState(false);
  const [requestId, setRequestId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setType('CASH_IN');
    setAmount('');
    setFee('');
    setReference('');
    setMobile('');
    setNotes('');
    setStep('enter');
    setConfirmed(false);
    setError(null);
    setRequestId(crypto.randomUUID());
  }, [open]);

  const money = (n: number) => formatCurrency(n, currency);
  const amountValue = Number(amount);
  const feeValue = fee.trim() === '' ? 0 : Number(fee);
  const problem = walletProblem(type, amountValue, feeValue);
  const referenceOk = normalizeGcashReference(reference) !== null;
  const figures = problem ? null : walletFigures(type, amountValue, feeValue);

  const next = () => {
    setError(null);
    if (problem) return setError(problem);
    if (!referenceOk) return setError(GCASH_REFERENCE_HINT);
    setConfirmed(false);
    setStep('confirm');
  };

  const submit = async () => {
    if (busy || !confirmed) return;
    setBusy(true);
    setError(null);
    const result = await recordWalletAction({
      type,
      amount: amountValue,
      fee: feeValue,
      gcashReference: reference,
      customerMobile: mobile.trim() || undefined,
      notes: notes.trim() || undefined,
      confirmed,
      clientRequestId: requestId || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`${result.data.reference}: ${WALLET_TYPE_LABEL[type]} of ${money(amountValue)} recorded.`);
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>GCash cash-in / cash-out</DialogTitle>
          <DialogDescription>
            A service for a customer, kept apart from product sales. Only your fee is income. Cash goes through your drawer.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive-text">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}

        {step === 'enter' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Type">
              {(['CASH_IN', 'CASH_OUT'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={type === value}
                  onClick={() => setType(value)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    type === value ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
                  )}
                >
                  {value === 'CASH_IN' ? <ArrowDownToLine className="h-4 w-4" /> : <ArrowUpFromLine className="h-4 w-4" />}
                  {value === 'CASH_IN' ? 'Cash-in' : 'Cash-out'}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {type === 'CASH_IN'
                ? 'The customer pays cash; you send GCash to them from the store account.'
                : 'The customer sends GCash to the store account; you give them cash.'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="wallet-amount">GCash amount</Label>
                <Input id="wallet-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-11 tabular" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wallet-fee">Service fee</Label>
                <Input id="wallet-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" className="h-11 tabular" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wallet-reference">GCash reference number</Label>
              <Input id="wallet-reference" inputMode="numeric" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className="h-11" />
              <p className="text-xs text-muted-foreground">{GCASH_REFERENCE_HINT}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="wallet-mobile">
                  Customer number <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input id="wallet-mobile" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} maxLength={20} className="h-11" />
                <p className="text-xs text-muted-foreground">Only the last 4 digits are kept.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wallet-notes">
                  Notes <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input id="wallet-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className="h-11" />
              </div>
            </div>
          </div>
        ) : (
          figures && (
            <div className="space-y-3">
              <div className="rounded-xl border bg-muted/40 p-3 text-sm">
                <p className="font-medium">{walletInstruction(type, amountValue, feeValue, money)}</p>
              </div>
              <dl className="divide-y rounded-lg border text-sm">
                {[
                  ['Type', WALLET_TYPE_LABEL[type]],
                  ['GCash amount', money(amountValue)],
                  ['Service fee (income)', money(feeValue)],
                  [type === 'CASH_IN' ? 'Collect in cash' : 'Give in cash', money(type === 'CASH_IN' ? figures.collectCash : figures.giveCash)],
                  ['Drawer', `${figures.drawerEffect >= 0 ? '+' : '−'}${money(Math.abs(figures.drawerEffect))}`],
                  ['Store GCash', `${figures.walletEffect >= 0 ? '+' : '−'}${money(Math.abs(figures.walletEffect))}`],
                  ['GCash reference', normalizeGcashReference(reference) ?? ''],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3 px-3 py-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="tabular text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <label htmlFor="wallet-confirmed" className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm">
                <Checkbox id="wallet-confirmed" checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} className="mt-0.5" />
                <span>
                  {type === 'CASH_IN'
                    ? 'I sent this amount from the store GCash and the transfer went through.'
                    : 'I saw this amount arrive in the store GCash (app or SMS), not just the customer’s screen.'}
                </span>
              </label>
            </div>
          )
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step === 'enter' ? (
            <>
              <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" className="h-11" onClick={next}>
                Review
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" className="h-11" onClick={() => setStep('enter')} disabled={busy}>
                Back
              </Button>
              <Button type="button" className="h-11" onClick={submit} loading={busy} disabled={!confirmed}>
                Record
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
