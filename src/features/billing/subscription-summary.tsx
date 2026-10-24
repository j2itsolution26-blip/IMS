import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Ban, Clock, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AccessBadge } from '@/features/subscription/plan-display';
import { BILLING_LABEL, INTERVAL_LABEL, type BillingFlag, type BillingInterval } from '@/lib/billing';
import { accessHeadline, daysUntil } from '@/lib/subscription';
import { PLANS, type PlanId } from '@/lib/plans';
import type { StoreAccess } from '@/lib/store-access';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

const FLAG_VARIANT: Record<BillingFlag, 'default' | 'warning' | 'destructive'> = {
  PLAN_SELECTED: 'default',
  PAYMENT_DUE: 'warning',
  PAYMENT_PENDING: 'default',
  PAST_DUE: 'destructive',
};

export interface SubscriptionSummaryProps {
  access: StoreAccess;
  /** The stored subscription status (TRIAL, ACTIVE, PAST_DUE, SUSPENDED). */
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
  /** The plan the store bought, when it differs from the plan in force. */
  boughtPlan: PlanId | null;
  billingInterval: BillingInterval | null;
  /** The last paid invoice for the plan in force, if there is one. */
  lastPaid: { amount: number; interval: BillingInterval } | null;
  /** Only when an OPEN invoice exists. Nothing is owed otherwise. */
  amountDue: { number: string; amount: number; dueAt: Date; flag: BillingFlag } | null;
  lastChangeAt: Date | null;
  now: Date;
  className?: string;
}

/**
 * The top of the page: which plan applies, where it stands, when that
 * changes, and — only when an invoice is open — what is owed.
 */
export function SubscriptionSummary({
  access,
  status,
  boughtPlan,
  billingInterval,
  lastPaid,
  amountDue,
  lastChangeAt,
  now,
  className,
}: SubscriptionSummaryProps) {
  const trial = access.state === 'TRIAL' || (status === 'TRIAL' && access.state !== 'SUSPENDED');
  const days = daysUntil(access.state === 'GRACE' ? access.graceEndsAt : access.endsAt, now);

  const dateLabel =
    access.state === 'TRIAL'
      ? 'Trial ends'
      : access.state === 'ACTIVE'
        ? 'Paid through'
        : access.state === 'GRACE'
          ? 'Grace period ends'
          : status === 'TRIAL'
            ? 'Trial ended'
            : 'Period ended';
  const dateValue = access.state === 'GRACE' ? access.graceEndsAt : access.endsAt;

  const facts: { label: string; value: React.ReactNode; hint?: string }[] = [
    {
      label: 'Billing',
      value: trial ? 'Free trial' : billingInterval ? INTERVAL_LABEL[billingInterval] : 'Not set',
      hint: !trial && !billingInterval ? 'Recorded by the administrator' : undefined,
    },
    {
      label: 'Price',
      value: trial ? (
        'Free'
      ) : lastPaid ? (
        <>
          <span className="tabular">{peso(lastPaid.amount)}</span>
          <span className="text-muted-foreground"> / {lastPaid.interval === 'MONTHLY' ? 'month' : 'year'}</span>
        </>
      ) : (
        '—'
      ),
      hint: trial ? 'Nothing is charged during a trial' : lastPaid ? 'Last paid invoice' : undefined,
    },
    {
      label: dateLabel,
      value: dateValue ? formatDate(dateValue) : 'No end date',
      hint:
        days === null || access.state === 'READ_ONLY' || access.state === 'SUSPENDED'
          ? undefined
          : days === 0
            ? 'Today'
            : `${days} day${days === 1 ? '' : 's'} left`,
    },
  ];

  return (
    <Card className={cn('flex min-w-0 flex-col rounded-card', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current subscription</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">{access.plan.name}</h2>
            <AccessBadge state={access.state} />
            {status === 'PAST_DUE' && <Badge variant="destructive">Past due</Badge>}
            {trial && <Badge variant="outline">Free trial</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{accessHeadline(access, now)}</p>
          {boughtPlan && <p className="mt-0.5 text-xs text-muted-foreground">Plan bought: {PLANS[boughtPlan].name}</p>}
        </div>
        {lastChangeAt && (
          <p className="text-xs text-muted-foreground">Last change {formatDateTime(lastChangeAt)}</p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="bg-card px-4 py-3 sm:px-5">
            <dt className="text-xs text-muted-foreground">{fact.label}</dt>
            <dd className="mt-0.5 font-semibold">{fact.value}</dd>
            {fact.hint && <dd className="text-xs text-muted-foreground">{fact.hint}</dd>}
          </div>
        ))}
        <div className="bg-card px-4 py-3 sm:px-5">
          <dt className="text-xs text-muted-foreground">Amount due</dt>
          {amountDue ? (
            <>
              <dd className="mt-0.5 font-semibold tabular">{peso(amountDue.amount)}</dd>
              <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Badge variant={FLAG_VARIANT[amountDue.flag]}>{BILLING_LABEL[amountDue.flag]}</Badge>
                Due {formatDate(amountDue.dueAt)}
              </dd>
            </>
          ) : (
            <>
              <dd className="mt-0.5 font-semibold">Nothing owed</dd>
              <dd className="text-xs text-muted-foreground">No open invoice</dd>
            </>
          )}
        </div>
      </dl>

      <StateNotice access={access} trial={trial} hasInvoice={amountDue !== null} />

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 text-sm sm:px-5">
        {amountDue && (
          <Link href="#outstanding-invoice" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            View invoice {amountDue.number} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
        <Link href="#plans" className="font-medium text-primary hover:underline">
          Compare plans
        </Link>
        <Link href="#billing-history" className="font-medium text-primary hover:underline">
          View billing history
        </Link>
      </div>
    </Card>
  );
}

function StateNotice({ access, trial, hasInvoice }: { access: StoreAccess; trial: boolean; hasInvoice: boolean }) {
  let tone: 'info' | 'warning' | 'danger';
  let Icon = Info;
  let body: string;
  switch (access.state) {
    case 'TRIAL':
      tone = 'info';
      body = hasInvoice
        ? 'You chose a plan. Your trial keeps running until your payment is verified, and paying early never shortens it.'
        : `You have every ${access.plan.name} feature during the trial. Nothing is charged; choose a plan before it ends to keep going.`;
      break;
    case 'ACTIVE':
      return null;
    case 'GRACE':
      tone = 'warning';
      Icon = Clock;
      body = `${trial ? 'Your trial has ended.' : 'Your paid period has ended.'} The store works normally until the grace period ends, then becomes read-only. ${hasInvoice ? 'Pay the open invoice to keep full access.' : 'Choose a plan to keep full access.'}`;
      break;
    case 'READ_ONLY':
      tone = 'danger';
      Icon = AlertTriangle;
      body =
        'Sales, stock changes, product edits and staff changes are paused. Sign-in, viewing, the exports your plan includes, and closing an open shift still work. Paying restores everything as soon as the payment is verified — no data was removed.';
      break;
    case 'SUSPENDED':
      tone = 'danger';
      Icon = Ban;
      body = 'The platform administrator suspended this store. Plan changes and payment reports are unavailable. Contact support to resolve it.';
      break;
  }
  return (
    <div
      role="status"
      className={cn(
        'mx-4 my-4 flex items-start gap-2 rounded-md border p-3 text-sm sm:mx-5',
        tone === 'info' && 'border-primary/30 bg-primary/5',
        tone === 'warning' && 'border-warning/40 bg-warning/10',
        tone === 'danger' && 'border-destructive/30 bg-destructive/10',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          tone === 'info' && 'text-primary',
          tone === 'warning' && 'text-warning-text',
          tone === 'danger' && 'text-destructive-text',
        )}
        aria-hidden="true"
      />
      <p className="min-w-0">{body}</p>
    </div>
  );
}
