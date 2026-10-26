'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PLANS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { INTERVAL_LABEL, type BillingInterval } from '@/lib/billing';
import { formatDateTime } from '@/lib/format';
import { AlertTriangle, Plus, QrCode, Trash2, Upload } from 'lucide-react';
import { Switch } from '@/components/ui/misc';
import {
  MAX_PAYMENT_ACCOUNTS,
  PAYMENT_ACCOUNT_KIND_LABEL,
  checkoutProblems,
  formatGcashNumber,
  validatePaymentAccounts,
  type PaymentAccount,
  type PaymentAccountKind,
} from '@/lib/payment-accounts';
import { BILLING_IMAGE_ACCEPT, QR_MAX_BYTES, formatMegabytes } from '@/lib/billing-files';
import {
  publishTermsAction,
  setPaymentAccountQrAction,
  setPaymentAccountsAction,
  setPaymentInstructionsAction,
  setPlanPriceAction,
} from '@/features/platform/subscription-actions';

const INTERVALS: BillingInterval[] = ['MONTHLY', 'ANNUAL'];

/** Prices per plan and interval. A blank price is not offered; nothing is assumed. */
export function PriceGrid({ prices }: { prices: { plan: PlanId; interval: BillingInterval; amount: number }[] }) {
  const initial = (plan: PlanId, interval: BillingInterval) =>
    prices.find((price) => price.plan === plan && price.interval === interval)?.amount.toFixed(2) ?? '';
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(PLAN_ORDER.flatMap((plan) => INTERVALS.map((interval) => [`${plan}:${interval}`, initial(plan, interval)]))),
  );
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const router = useRouter();

  const save = async (plan: PlanId, interval: BillingInterval) => {
    const key = `${plan}:${interval}`;
    setBusyKey(key);
    setErrors((current) => ({ ...current, [key]: '' }));
    const result = await setPlanPriceAction({ plan, interval, amount: values[key] });
    setBusyKey(null);
    if (!result.ok) {
      setErrors((current) => ({ ...current, [key]: result.fieldErrors?.amount?.[0] ?? result.error }));
      return;
    }
    toast.success(values[key] ? `${PLANS[plan].name} ${INTERVAL_LABEL[interval].toLowerCase()} price saved.` : 'Price removed.');
    router.refresh();
  };

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">Plan prices</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="h-10 px-4 font-semibold">Plan</th>
            {INTERVALS.map((interval) => (
              <th key={interval} scope="col" className="h-10 px-4 font-semibold">
                {INTERVAL_LABEL[interval]} (₱)
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PLAN_ORDER.map((plan) => (
            <tr key={plan} className="border-b last:border-0">
              <th scope="row" className="px-4 py-3 text-left font-medium">
                {PLANS[plan].name}
              </th>
              {INTERVALS.map((interval) => {
                const key = `${plan}:${interval}`;
                const changed = values[key] !== initial(plan, interval);
                return (
                  <td key={interval} className="px-4 py-3">
                    <div className="flex gap-2">
                      <Input
                        aria-label={`${PLANS[plan].name} ${INTERVAL_LABEL[interval].toLowerCase()} price in pesos`}
                        inputMode="decimal"
                        placeholder="Not offered"
                        value={values[key]}
                        onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                        aria-invalid={Boolean(errors[key])}
                        className="max-w-[9rem]"
                      />
                      <Button size="sm" variant="outline" className="h-9" disabled={!changed} loading={busyKey === key} onClick={() => save(plan, interval)}>
                        Save
                      </Button>
                    </div>
                    {errors[key] && <p className="mt-1 text-xs text-destructive-text">{errors[key]}</p>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Publishes a new version; earlier versions stay with the invoices that quote them. */
export function TermsForm({ current }: { current: { version: number; body: string; createdAt: string } | null }) {
  const router = useRouter();
  const [body, setBody] = React.useState(current?.body ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const publish = async () => {
    setBusy(true);
    setError(null);
    const result = await publishTermsAction({ body });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.body?.[0] ?? result.error);
      return;
    }
    toast.success(`Billing terms version ${result.data.version} published.`);
    router.refresh();
  };

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        {current
          ? `Version ${current.version}, published ${formatDateTime(current.createdAt)}. Owners must accept the current version when choosing a plan; publishing a change asks for acceptance again on the next choice.`
          : 'No terms are published, so owners cannot choose a plan. Write the terms owners will agree to: price changes, renewal, refunds, what happens if a payment is late.'}
      </p>
      <Label htmlFor="terms-body" className="sr-only">
        Billing terms
      </Label>
      <Textarea id="terms-body" value={body} onChange={(event) => setBody(event.target.value)} className="min-h-[220px] text-sm" maxLength={20_000} />
      {error && <p className="text-sm text-destructive-text">{error}</p>}
      <Button onClick={publish} loading={busy} disabled={body.trim().length < 20 || body.trim() === current?.body}>
        Publish {current ? `version ${current.version + 1}` : 'version 1'}
      </Button>
    </div>
  );
}

// The QR code is not part of the list form: it is uploaded on its own, and the server keeps the stored one when the list is saved.
type AccountDraft = Omit<PaymentAccount, 'bankName' | 'note' | 'qrPath'> & { bankName: string; note: string };

const toDraft = ({ qrPath: _qrPath, ...account }: PaymentAccount): AccountDraft => ({
  ...account,
  bankName: account.bankName ?? '',
  note: account.note ?? '',
  accountNumber: account.kind === 'GCASH' ? formatGcashNumber(account.accountNumber) : account.accountNumber,
});

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `acct-${Date.now().toString(36)}`);

/**
 * The GCash and bank accounts owners pay into, shown to them as cards with
 * copy buttons. Saved as one list; the server validates every field again.
 */
export function PaymentAccountsForm({ current }: { current: PaymentAccount[] }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<AccountDraft[]>(() => current.map(toDraft));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const saved = React.useMemo(() => JSON.stringify(current.map(toDraft)), [current]);
  const changed = JSON.stringify(rows) !== saved;
  const savedIds = React.useMemo(() => new Set(current.map((account) => account.id)), [current]);
  const problems = React.useMemo(() => checkoutProblems(current), [current]);

  const update = (index: number, patch: Partial<AccountDraft>) => {
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setErrors((existing) => Object.fromEntries(Object.entries(existing).filter(([key]) => !key.startsWith(`${index}.`) && key !== 'list')));
  };
  const add = (kind: PaymentAccountKind) =>
    setRows((list) => [...list, { id: newId(), kind, bankName: '', accountName: '', accountNumber: '', note: '', enabled: true }]);
  const remove = (index: number) => {
    setRows((list) => list.filter((_, i) => i !== index));
    setErrors({});
  };

  const save = async () => {
    const payload = rows.map((row) => ({ ...row, bankName: row.kind === 'BANK_TRANSFER' ? row.bankName : null, note: row.note || null }));
    const local = validatePaymentAccounts(payload);
    if (!local.ok) {
      setErrors(local.errors);
      return;
    }
    setBusy(true);
    const result = await setPaymentAccountsAction({ accounts: payload });
    setBusy(false);
    if (!result.ok) {
      const fromServer = Object.fromEntries(
        Object.entries(result.fieldErrors ?? {}).map(([key, messages]) => [key.replace(/^accounts\./, ''), messages[0]]),
      );
      setErrors({ list: result.error, ...fromServer });
      return;
    }
    toast.success('Payment accounts saved.');
    router.refresh();
  };

  const errorFor = (index: number, name: string) => errors[`${index}.${name}`];
  const inputProps = (index: number, name: 'bankName' | 'accountName' | 'accountNumber' | 'note') => ({
    id: `acct-${index}-${name}`,
    value: rows[index][name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => update(index, { [name]: event.target.value }),
    'aria-invalid': Boolean(errorFor(index, name)),
    'aria-describedby': errorFor(index, name) ? `acct-${index}-${name}-error` : undefined,
  });
  const field = (index: number, name: string, label: string, input: React.ReactNode) => (
    <div className="space-y-1">
      <Label htmlFor={`acct-${index}-${name}`}>{label}</Label>
      {input}
      {errorFor(index, name) && (
        <p id={`acct-${index}-${name}-error`} className="text-xs text-destructive-text">
          {errorFor(index, name)}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        Owners see each account marked &ldquo;Show to owners&rdquo; at checkout, and can report a payment only with those methods. A
        GCash account is shown once its QR code is uploaded. Until an account is ready, owners cannot submit payments. Check every
        number carefully: owners send money to it.
      </p>

      {problems.length > 0 && (
        <div role="status" className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          {problems.map((problem) => (
            <p key={problem} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" aria-hidden="true" />
              <span>{problem}</span>
            </p>
          ))}
        </div>
      )}

      {rows.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No accounts yet.</p>}

      <ul className="space-y-3">
        {rows.map((row, index) => (
          <li key={row.id} className="rounded-xl border p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{PAYMENT_ACCOUNT_KIND_LABEL[row.kind]}</p>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={row.enabled} onCheckedChange={(value) => update(index, { enabled: value })} />
                  Show to owners
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  aria-label={`Remove ${PAYMENT_ACCOUNT_KIND_LABEL[row.kind]} account ${index + 1}`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {row.kind === 'BANK_TRANSFER' &&
                field(index, 'bankName', 'Bank', <Input {...inputProps(index, 'bankName')} maxLength={60} placeholder="e.g. BDO, BPI" />)}
              {field(index, 'accountName', 'Account name', <Input {...inputProps(index, 'accountName')} maxLength={80} autoComplete="off" />)}
              {field(
                index,
                'accountNumber',
                row.kind === 'GCASH' ? 'GCash number' : 'Account number',
                <Input
                  {...inputProps(index, 'accountNumber')}
                  maxLength={row.kind === 'GCASH' ? 17 : 30}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={row.kind === 'GCASH' ? '0917 123 4567' : undefined}
                  className="font-mono"
                />,
              )}
              {field(index, 'note', 'Note for owners (optional)', <Input {...inputProps(index, 'note')} maxLength={120} placeholder="e.g. Savings account" />)}
            </div>
            {row.kind === 'GCASH' &&
              (savedIds.has(row.id) ? (
                <GcashQrField accountId={row.id} qrPath={current.find((account) => account.id === row.id)?.qrPath ?? null} />
              ) : (
                <p className="mt-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Save the accounts first, then upload this account&rsquo;s QR code.
                </p>
              ))}
          </li>
        ))}
      </ul>

      {errors.list && <p className="text-sm text-destructive-text">{errors.list}</p>}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => add('GCASH')} disabled={rows.length >= MAX_PAYMENT_ACCOUNTS}>
          <Plus aria-hidden="true" /> Add GCash
        </Button>
        <Button variant="outline" size="sm" onClick={() => add('BANK_TRANSFER')} disabled={rows.length >= MAX_PAYMENT_ACCOUNTS}>
          <Plus aria-hidden="true" /> Add bank account
        </Button>
        <Button size="sm" className="ml-auto" onClick={save} loading={busy} disabled={!changed}>
          Save accounts
        </Button>
      </div>
    </div>
  );
}

/**
 * The QR code owners scan to pay one GCash account. Checked on the server by
 * its real bytes (JPG, PNG or WEBP, up to 2 MB) and kept in the private
 * billing bucket; owners see it at checkout through an access-checked link.
 */
function GcashQrField({ accountId, qrPath }: { accountId: string; qrPath: string | null }) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState<'upload' | 'remove' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const send = async (form: FormData, kind: 'upload' | 'remove') => {
    setBusy(kind);
    setError(null);
    const result = await setPaymentAccountQrAction(form);
    setBusy(null);
    if (input.current) input.current.value = '';
    if (!result.ok) {
      setError(result.fieldErrors?.qr?.[0] ?? result.error);
      return;
    }
    toast.success(kind === 'upload' ? 'QR code saved.' : 'QR code removed.');
    router.refresh();
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    if (file.size > QR_MAX_BYTES) {
      setError(`The QR code must be ${formatMegabytes(QR_MAX_BYTES)} or smaller.`);
      return;
    }
    const form = new FormData();
    form.set('accountId', accountId);
    form.set('qr', file);
    void send(form, 'upload');
  };

  const remove = () => {
    const form = new FormData();
    form.set('accountId', accountId);
    form.set('remove', '1');
    void send(form, 'remove');
  };

  // The file name changes with every upload, so the preview never shows a stale image.
  const version = qrPath?.split('/').pop() ?? '';

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center">
      <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white">
        {qrPath ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link; next/image cannot optimise it
          <img src={`/api/billing/qr/${accountId}?v=${version}`} alt="GCash QR code" className="h-full w-full object-contain p-1" />
        ) : (
          <QrCode className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">{qrPath ? 'QR code uploaded' : 'No QR code yet'}</p>
        <p className="text-xs text-muted-foreground">
          {qrPath
            ? 'Owners scan this at checkout. Replace it if the GCash account changes.'
            : 'Owners do not see this account until its QR code is uploaded. Use the QR from GCash → Receive → Download QR.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept={BILLING_IMAGE_ACCEPT}
            className="sr-only"
            id={`qr-${accountId}`}
            onChange={(event) => upload(event.target.files?.[0])}
          />
          <Button size="sm" variant="outline" onClick={() => input.current?.click()} loading={busy === 'upload'} disabled={busy !== null}>
            <Upload aria-hidden="true" /> {qrPath ? 'Replace QR code' : 'Upload QR code'}
          </Button>
          {qrPath && (
            <Button size="sm" variant="ghost" onClick={remove} loading={busy === 'remove'} disabled={busy !== null}>
              Remove
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive-text">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** What owners see under "How to pay" on an open invoice. */
export function InstructionsForm({ current }: { current: string | null }) {
  const router = useRouter();
  const [value, setValue] = React.useState(current ?? '');
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    const result = await setPaymentInstructionsAction({ value });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Payment instructions saved.');
    router.refresh();
  };

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        Extra notes owners see with the payment accounts, e.g. cut-off times or what to put in the transfer message. Until payment
        accounts are added above, write the GCash and bank details here.
      </p>
      <Label htmlFor="pay-instructions" className="sr-only">
        Payment instructions
      </Label>
      <Textarea id="pay-instructions" value={value} onChange={(event) => setValue(event.target.value)} className="min-h-[140px] text-sm" maxLength={4_000} />
      <Button onClick={save} loading={busy} disabled={value.trim() === (current ?? '').trim()}>
        Save instructions
      </Button>
    </div>
  );
}
