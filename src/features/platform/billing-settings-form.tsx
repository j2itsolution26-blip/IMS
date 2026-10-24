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
import { publishTermsAction, setPaymentInstructionsAction, setPlanPriceAction } from '@/features/platform/subscription-actions';

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
        For example the GCash number and account name, and bank, account name and number. Shown to owners with an open invoice.
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
