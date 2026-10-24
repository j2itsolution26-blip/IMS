'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, CalendarPlus, CreditCard, Layers, PlayCircle, Plus, ShieldAlert, Undo2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/misc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { USERNAME_HINT } from '@/lib/username';
import { PLANS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { MAX_TRIAL_EXTENSION_DAYS, PAYMENT_METHOD_LABEL, PAYMENT_MONTHS, STATUS_LABEL, TRIAL_DAYS } from '@/lib/subscription';
import type { ActionResult } from '@/lib/action';
import { generatePassword } from '@/lib/password';
import { PasswordChecklist, PasswordInput } from '@/components/password-field';
import {
  changePlanAction,
  createStoreAction,
  extendTrialAction,
  recordPaymentAction,
  setStoreStatusAction,
  voidPaymentAction,
} from '@/features/platform/subscription-actions';

/**
 * Platform controls for a store's subscription. Each dialog calls a server
 * action that re-checks `platform.manage` and validates everything again;
 * this component only collects input and shows the outcome.
 */

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive-text">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type FieldErrors = Record<string, string[] | undefined>;

/** Runs an action and turns its result into a toast, field errors or a refresh. */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<ActionResult<T>>, success: (data: T) => string): Promise<ActionResult<T>> => {
    setBusy(true);
    setErrors({});
    setFormError(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      setFormError(result.error);
      return result;
    }
    toast.success(success(result.data));
    router.refresh();
    return result;
  };
  const reset = () => {
    setErrors({});
    setFormError(null);
  };
  return { busy, errors, formError, run, reset };
}

function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
      {message}
    </p>
  );
}

// --- Create store ---------------------------------------------------------------

const EMPTY_STORE = { storeName: '', name: '', username: '', email: '', password: '', phone: '' };

/** Longer than the 10-character minimum: nobody types a generated password from memory. */
const GENERATED_PASSWORD_LENGTH = 16;

export function CreateStoreButton() {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY_STORE);
  const [similar, setSimilar] = React.useState<string | null>(null);
  const [allowSimilar, setAllowSimilar] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  // Whether the field holds a freshly generated password, or generation failed.
  const [generation, setGeneration] = React.useState<'idle' | 'generated' | 'failed'>('idle');
  const { busy, errors, formError, run, reset } = useAction();

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setForm(EMPTY_STORE);
      setSimilar(null);
      setAllowSimilar(false);
      setShowPassword(false);
      setGeneration('idle');
      reset();
    }
  };

  const onGeneratePassword = () => {
    try {
      // Web Crypto only (see generatePassword). If it is unavailable this
      // throws and the field is left alone, never filled from an insecure source.
      const generated = generatePassword(GENERATED_PASSWORD_LENGTH);
      setForm((current) => ({ ...current, password: generated }));
      setShowPassword(true);
      setGeneration('generated');
    } catch {
      setGeneration('failed');
    }
  };
  const set = (key: keyof typeof EMPTY_STORE) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run(() => createStoreAction({ ...form, allowSimilar }), () => `${form.storeName} created with a ${TRIAL_DAYS}-day trial.`);
    if (!result.ok && result.code === 'SIMILAR_STORE') setSimilar(result.error);
    if (result.ok) close(false);
  };

  const err = (key: string) => errors[key]?.[0];

  return (
    <>
      <Button size="lg" className="h-11" onClick={() => setOpen(true)}>
        <Plus /> Create store
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create store</DialogTitle>
            <DialogDescription>
              Sets up the store with its own roles, warehouse and settings, creates its owner, and starts a {TRIAL_DAYS}-day
              Business trial.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormAlert message={similar ? null : formError} />
            <Field id="store-name" label="Store name" error={err('storeName')}>
              <Input id="store-name" value={form.storeName} onChange={set('storeName')} autoFocus aria-invalid={Boolean(err('storeName'))} />
            </Field>
            <fieldset className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Owner account</legend>
              <Field id="owner-name" label="Full name" error={err('name')}>
                <Input id="owner-name" value={form.name} onChange={set('name')} aria-invalid={Boolean(err('name'))} />
              </Field>
              <Field id="owner-username" label="Username" error={err('username')} hint={USERNAME_HINT}>
                <Input id="owner-username" value={form.username} onChange={set('username')} autoComplete="off" aria-invalid={Boolean(err('username'))} />
              </Field>
              <Field id="owner-email" label="Email" error={err('email')}>
                <Input id="owner-email" type="email" value={form.email} onChange={set('email')} aria-invalid={Boolean(err('email'))} />
              </Field>
              <div className="space-y-1.5">
                <Label htmlFor="owner-password">Temporary password</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <PasswordInput
                    id="owner-password"
                    value={form.password}
                    onChange={(event) => {
                      set('password')(event);
                      setGeneration('idle');
                    }}
                    revealed={showPassword}
                    onRevealedChange={setShowPassword}
                    // Stops the browser filling in the administrator's own saved password.
                    autoComplete="new-password"
                    aria-invalid={Boolean(err('password'))}
                    aria-describedby="owner-password-hint owner-password-rules owner-password-status"
                  />
                  <Button type="button" variant="outline" className="shrink-0" onClick={onGeneratePassword} disabled={busy}>
                    <Wand2 /> Generate
                  </Button>
                </div>
                {err('password') && (
                  <p id="owner-password-error" className="text-xs text-destructive-text">
                    {err('password')}
                  </p>
                )}
                <p id="owner-password-hint" className="text-xs text-muted-foreground">
                  The owner must change this password when signing in for the first time.
                </p>
                <PasswordChecklist id="owner-password-rules" password={form.password} />
                {/* Announces the outcome, never the password itself. */}
                <p id="owner-password-status" role="status" aria-live="polite" className="text-xs font-medium">
                  {generation === 'generated' && (
                    <span className="text-success-text">New password generated. Copy it for the owner before you create the store.</span>
                  )}
                  {generation === 'failed' && (
                    <span className="text-destructive-text">This browser can&apos;t generate a secure password. Type one in instead.</span>
                  )}
                </p>
              </div>
              <Field id="owner-phone" label="Phone (optional)" error={err('phone')} hint="Used to spot a business signing up for a second trial.">
                <Input id="owner-phone" value={form.phone} onChange={set('phone')} />
              </Field>
            </fieldset>
            {similar && (
              <div role="alert" className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <p className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" aria-hidden="true" />
                  {similar}
                </p>
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox checked={allowSimilar} onCheckedChange={(value) => setAllowSimilar(value === true)} />
                  This is a different business — create it anyway
                </label>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy} disabled={Boolean(similar) && !allowSimilar}>
                Create store
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// --- Store controls -------------------------------------------------------------

export interface StoreControlsProps {
  storeId: string;
  storeName: string;
  plan: PlanId;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
  /** Admin's own platform.manage; without it the controls are hidden. */
  canManage: boolean;
}

type Open = 'plan' | 'status' | 'trial' | 'payment' | null;

export function StoreControls({ storeId, storeName, plan, status, canManage }: StoreControlsProps) {
  const [open, setOpen] = React.useState<Open>(null);
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setOpen('payment')} disabled={status === 'SUSPENDED'}>
        <CreditCard /> Record payment
      </Button>
      <Button variant="outline" onClick={() => setOpen('plan')}>
        <Layers /> Change plan
      </Button>
      <Button variant="outline" onClick={() => setOpen('status')}>
        {status === 'SUSPENDED' ? <PlayCircle /> : <Ban />} Change status
      </Button>
      {status === 'TRIAL' && (
        <Button variant="outline" onClick={() => setOpen('trial')}>
          <CalendarPlus /> Extend trial
        </Button>
      )}
      <PaymentDialog open={open === 'payment'} onClose={() => setOpen(null)} storeId={storeId} storeName={storeName} plan={plan} />
      <PlanDialog open={open === 'plan'} onClose={() => setOpen(null)} storeId={storeId} plan={plan} />
      <StatusDialog open={open === 'status'} onClose={() => setOpen(null)} storeId={storeId} status={status} />
      <TrialDialog open={open === 'trial'} onClose={() => setOpen(null)} storeId={storeId} />
    </div>
  );
}

function ReasonField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  return (
    <Field id="change-reason" label="Reason" error={error} hint="Recorded in the audit log.">
      <Input id="change-reason" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} />
    </Field>
  );
}

function PlanDialog({ open, onClose, storeId, plan }: { open: boolean; onClose: () => void; storeId: string; plan: PlanId }) {
  const [target, setTarget] = React.useState<PlanId>(plan);
  const [reason, setReason] = React.useState('');
  const { busy, errors, formError, run, reset } = useAction();
  React.useEffect(() => {
    if (open) {
      setTarget(plan);
      setReason('');
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run(
      () => changePlanAction({ storeId, plan: target, reason }),
      (data) =>
        data.overLimits.length > 0
          ? `Plan changed. Already over the new limits (kept, not deleted): ${data.overLimits.join('; ')}.`
          : 'Plan changed.',
    );
    if (result.ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change plan</DialogTitle>
          <DialogDescription>
            Takes effect immediately. A downgrade never deletes anything; the store just cannot add past the new limits.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormAlert message={formError} />
          <Field id="plan-target" label="Plan" error={errors.plan?.[0]}>
            <select id="plan-target" className={selectClass} value={target} onChange={(event) => setTarget(event.target.value as PlanId)}>
              {PLAN_ORDER.map((id) => (
                <option key={id} value={id}>
                  {PLANS[id].name}
                  {id === plan ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <ReasonField value={reason} onChange={setReason} error={errors.reason?.[0]} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={target === plan}>
              Change plan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_CHOICES = [
  { value: 'ACTIVE', label: 'Active', hint: 'Reinstate the store. Its paid-until date is unchanged.' },
  { value: 'PAST_DUE', label: 'Past due', hint: 'Payment is late: the 7-day grace period applies, then read-only.' },
  { value: 'SUSPENDED', label: 'Suspended', hint: 'Nobody in the store can work in it until it is reactivated. No data is removed.' },
] as const;

function StatusDialog({ open, onClose, storeId, status }: { open: boolean; onClose: () => void; storeId: string; status: StoreControlsProps['status'] }) {
  const choices = STATUS_CHOICES.filter((choice) => choice.value !== status && !(status === 'TRIAL' && choice.value === 'ACTIVE'));
  const [target, setTarget] = React.useState<string>(choices[0]?.value ?? 'SUSPENDED');
  const [reason, setReason] = React.useState('');
  const { busy, errors, formError, run, reset } = useAction();
  React.useEffect(() => {
    if (open) {
      setTarget(choices[0]?.value ?? 'SUSPENDED');
      setReason('');
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run(() => setStoreStatusAction({ storeId, status: target, reason }), () => 'Status changed.');
    if (result.ok) onClose();
  };
  const hint = STATUS_CHOICES.find((choice) => choice.value === target)?.hint;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>
            Currently {STATUS_LABEL[status].toLowerCase()}.
            {status === 'TRIAL' && ' A trial becomes active when you record its first payment.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormAlert message={formError} />
          <Field id="status-target" label="New status" error={errors.status?.[0]} hint={hint}>
            <select id="status-target" className={selectClass} value={target} onChange={(event) => setTarget(event.target.value)}>
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Field>
          <ReasonField value={reason} onChange={setReason} error={errors.reason?.[0]} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} variant={target === 'SUSPENDED' ? 'destructive' : 'default'}>
              {target === 'SUSPENDED' ? 'Suspend store' : 'Change status'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TrialDialog({ open, onClose, storeId }: { open: boolean; onClose: () => void; storeId: string }) {
  const [days, setDays] = React.useState('7');
  const [reason, setReason] = React.useState('');
  const { busy, errors, formError, run, reset } = useAction();
  React.useEffect(() => {
    if (open) {
      setDays('7');
      setReason('');
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run(() => extendTrialAction({ storeId, days, reason }), () => 'Trial extended.');
    if (result.ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Extend trial</DialogTitle>
          <DialogDescription>Adds days to the trial, counted from its end date (or today, if it has already ended).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormAlert message={formError} />
          <Field id="trial-days" label="Days to add" error={errors.days?.[0]} hint={`1 to ${MAX_TRIAL_EXTENSION_DAYS}.`}>
            <Input id="trial-days" type="number" min={1} max={MAX_TRIAL_EXTENSION_DAYS} inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
          </Field>
          <ReasonField value={reason} onChange={setReason} error={errors.reason?.[0]} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Extend trial
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const todayInput = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

function PaymentDialog({ open, onClose, storeId, storeName, plan }: { open: boolean; onClose: () => void; storeId: string; storeName: string; plan: PlanId }) {
  const blank = React.useCallback(
    () => ({ plan, amount: '', method: 'GCASH', reference: '', paidAt: todayInput(), months: '1', notes: '' }),
    [plan],
  );
  const [form, setForm] = React.useState(blank);
  const [confirmed, setConfirmed] = React.useState(false);
  const { busy, errors, formError, run, reset } = useAction();
  React.useEffect(() => {
    if (open) {
      setForm(blank());
      setConfirmed(false);
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, blank]);

  const set = (key: keyof ReturnType<typeof blank>) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const err = (key: string) => errors[key]?.[0];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run(
      // The day the money arrived, as the start of that day in Manila time (never "in the future" for today).
      () => recordPaymentAction({ ...form, storeId, paidAt: `${form.paidAt}T00:00:00+08:00`, confirmed }),
      (data) => `Payment recorded. ${storeName} is paid until ${new Date(data.periodEnd).toLocaleDateString('en-PH', { dateStyle: 'medium' })}.`,
    );
    if (result.ok) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Only record money you have seen arrive in the GCash or bank account. An owner&apos;s screenshot or message is not proof of payment.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormAlert message={formError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pay-plan" label="Plan" error={err('plan')}>
              <select id="pay-plan" className={selectClass} value={form.plan} onChange={set('plan')}>
                {PLAN_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {PLANS[id].name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pay-months" label="Months" error={err('months')} hint="Extends from the later of today or the current end date.">
              <select id="pay-months" className={selectClass} value={form.months} onChange={set('months')}>
                {PAYMENT_MONTHS.map((months) => (
                  <option key={months} value={months}>
                    {months} month{months === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pay-amount" label="Amount received (₱)" error={err('amount')}>
              <Input id="pay-amount" inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="0.00" aria-invalid={Boolean(err('amount'))} />
            </Field>
            <Field id="pay-method" label="Method" error={err('method')}>
              <select id="pay-method" className={selectClass} value={form.method} onChange={set('method')}>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="pay-reference" label="Reference number" error={err('reference')} hint="As shown in the GCash or bank record.">
              <Input id="pay-reference" value={form.reference} onChange={set('reference')} autoComplete="off" aria-invalid={Boolean(err('reference'))} />
            </Field>
            <Field id="pay-date" label="Date received" error={err('paidAt')}>
              <Input id="pay-date" type="date" value={form.paidAt} max={todayInput()} onChange={set('paidAt')} aria-invalid={Boolean(err('paidAt'))} />
            </Field>
          </div>
          <Field id="pay-notes" label="Notes (optional)" error={err('notes')}>
            <Input id="pay-notes" value={form.notes} onChange={set('notes')} />
          </Field>
          <label className={cn('flex items-start gap-2 rounded-md border p-3 text-sm', err('confirmed') && 'border-destructive')}>
            <Checkbox className="mt-0.5" checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} aria-describedby="pay-confirm-error" />
            <span>
              I have checked that this amount was received in our account with this reference.
              {err('confirmed') && (
                <span id="pay-confirm-error" className="mt-1 block text-xs text-destructive-text">
                  {err('confirmed')}
                </span>
              )}
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!confirmed}>
              Confirm payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VoidPaymentButton({ paymentId, storeId, reference }: { paymentId: string; storeId: string; reference: string }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const { busy, errors, formError, run, reset } = useAction();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await run(() => voidPaymentAction({ paymentId, storeId, reason }), () => 'Payment voided.');
    if (result.ok) setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setReason('');
          reset();
          setOpen(true);
        }}
        aria-label={`Void payment ${reference}`}
      >
        <Undo2 /> Void
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Void payment {reference}</DialogTitle>
            <DialogDescription>
              For a payment recorded by mistake. The record stays, marked void, and the store&apos;s paid-until date goes back by the time it
              bought. Only the most recent payment can be voided.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormAlert message={formError} />
            <ReasonField value={reason} onChange={setReason} error={errors.reason?.[0]} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" loading={busy}>
                Void payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
