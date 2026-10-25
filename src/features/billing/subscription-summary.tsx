import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarDays,
  Clock,
  FileText,
  Headset,
  Info,
  Settings2,
  Store,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccessBadge } from '@/features/subscription/plan-display';
import {
  INTERVAL_LABEL,
  PAYMENT_STATE_LABEL,
  PAYMENT_STATE_TONE,
  type BillingInterval,
  type PaymentState,
} from '@/lib/billing';
import { ACCESS_LABEL, ACCESS_TONE, daysUntil } from '@/lib/subscription';
import { PLANS, type PlanId } from '@/lib/plans';
import type { StoreAccess } from '@/lib/store-access';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

const TONE_BADGE = { success: 'success', info: 'info', warning: 'warning', danger: 'destructive' } as const;
const TONE_DOT = { success: 'bg-success', info: 'bg-info', warning: 'bg-warning', danger: 'bg-destructive' } as const;

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
  amountDue: { number: string; amount: number; dueAt: Date } | null;
  payment: PaymentState;
  /** The page's main next step: pay the open invoice, or go to the plans. */
  primaryAction: { href: string; label: string } | null;
  canContactSupport: boolean;
  /** The signed-in user's billing tickets support is still working on. */
  openBillingTickets: number;
  now: Date;
}

/**
 * The top of the page: which plan applies, where it stands, when that
 * changes, and — only when an invoice is open — what is owed. One status,
 * one payment state: never "trial" and "paid" side by side.
 */
export function SubscriptionSummary({
  access,
  status,
  boughtPlan,
  billingInterval,
  lastPaid,
  amountDue,
  payment,
  primaryAction,
  canContactSupport,
  openBillingTickets,
  now,
}: SubscriptionSummaryProps) {
  const trial = access.state === 'TRIAL' || (status === 'TRIAL' && access.state !== 'SUSPENDED');
  const ended = access.state === 'READ_ONLY' || access.state === 'SUSPENDED';
  const days = ended ? null : daysUntil(access.state === 'GRACE' ? access.graceEndsAt : access.endsAt, now);

  const dateLabel =
    access.state === 'TRIAL'
      ? 'Trial ends'
      : access.state === 'ACTIVE'
        ? 'Next renewal'
        : access.state === 'GRACE'
          ? 'Grace period ends'
          : status === 'TRIAL'
            ? 'Trial ended'
            : 'Period ended';
  const dateValue = access.state === 'GRACE' ? access.graceEndsAt : access.endsAt;
  const tone = ACCESS_TONE[access.state];

  return (
    <section
      aria-labelledby="current-plan-heading"
      className="overflow-hidden rounded-card border border-mint-strong bg-gradient-to-br from-mint via-mint/60 to-card shadow-card"
    >
      <div className="grid gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:items-center xl:gap-8">
        {/* Plan and the three figures that matter most. */}
        <div className="min-w-0 space-y-5">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm sm:h-16 sm:w-16">
              <Store className="h-7 w-7 sm:h-8 sm:w-8" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Your current plan</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h2 id="current-plan-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                  {access.plan.name}
                </h2>
                <AccessBadge state={access.state} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{access.plan.description}</p>
              {boughtPlan && <p className="mt-0.5 text-xs text-muted-foreground">Plan bought: {PLANS[boughtPlan].name}</p>}
            </div>
          </div>

          <dl className="grid gap-3 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-mint-strong">
            <Figure icon={CalendarDays} label={dateLabel} value={dateValue ? formatDate(dateValue) : 'No end date'} />
            <Figure
              icon={Clock}
              label="Remaining"
              value={days === null ? '—' : days === 0 ? 'Ends today' : `${days} day${days === 1 ? '' : 's'}`}
              hint={days === null ? (access.state === 'SUSPENDED' ? 'Suspended' : 'Ended') : undefined}
            />
            {amountDue ? (
              <Figure
                icon={Wallet}
                label="Amount due"
                value={<span className="tabular">{peso(amountDue.amount)}</span>}
                hint={`Invoice ${amountDue.number}, due ${formatDate(amountDue.dueAt)}`}
              />
            ) : (
              <Figure
                icon={Wallet}
                label="Amount due"
                value="Nothing owed"
                hint={trial ? 'You are on a free trial' : 'No open invoice'}
              />
            )}
          </dl>
        </div>

        {/* The state of the subscription, as facts. */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 border-t border-mint-strong pt-4 text-sm xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="flex items-center gap-2 font-semibold">
            <span className={cn('h-2 w-2 rounded-full', TONE_DOT[tone])} aria-hidden="true" />
            {ACCESS_LABEL[access.state]}
          </dd>
          <dt className="text-muted-foreground">Billing cycle</dt>
          <dd className="font-semibold">{trial ? 'Free trial' : billingInterval ? INTERVAL_LABEL[billingInterval] : 'Not set'}</dd>
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-semibold">
            {trial ? (
              'Free'
            ) : lastPaid ? (
              <>
                <span className="tabular">{peso(lastPaid.amount)}</span>
                <span className="font-normal text-muted-foreground"> / {lastPaid.interval === 'MONTHLY' ? 'month' : 'year'}</span>
              </>
            ) : (
              '—'
            )}
          </dd>
          <dt className="text-muted-foreground">Payment</dt>
          <dd>
            <Badge variant={TONE_BADGE[PAYMENT_STATE_TONE[payment]]}>{PAYMENT_STATE_LABEL[payment]}</Badge>
          </dd>
        </dl>

        {/* What to do next. */}
        <div className="flex flex-col gap-2 sm:flex-row xl:w-56 xl:flex-col">
          {primaryAction && (
            <Button asChild className="min-h-11 flex-1 xl:flex-none">
              <Link href={primaryAction.href}>
                {primaryAction.href === '#outstanding-invoice' ? <FileText aria-hidden="true" /> : <Settings2 aria-hidden="true" />}
                {primaryAction.label}
              </Link>
            </Button>
          )}
          {canContactSupport && (
            <Button variant="outline" asChild className="min-h-11 flex-1 bg-card/70 xl:flex-none">
              <Link href="/support/new?category=BILLING">
                <Headset aria-hidden="true" /> Contact support
              </Link>
            </Button>
          )}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-1 text-xs sm:justify-start xl:justify-center">
            <Link href="#plans" className="font-medium text-primary hover:underline">
              Compare plans
            </Link>
            <Link href="#billing-history" className="font-medium text-primary hover:underline">
              Billing history
            </Link>
            {canContactSupport && openBillingTickets > 0 && (
              <Link href="/support" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                Open billing tickets ({openBillingTickets}) <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <StateNotice access={access} trial={trial} hasInvoice={amountDue !== null} />
    </section>
  );
}

function Figure({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 sm:px-4 sm:first:pl-0">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-primary shadow-xs">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="font-semibold">{value}</dd>
        {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
      </div>
    </div>
  );
}

function StateNotice({
  access,
  trial,
  hasInvoice,
}: {
  access: StoreAccess;
  trial: boolean;
  hasInvoice: boolean;
}) {
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
        'flex items-start gap-2 border-t px-4 py-3 text-sm sm:px-6',
        tone === 'info' && 'border-mint-strong bg-card/60',
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
