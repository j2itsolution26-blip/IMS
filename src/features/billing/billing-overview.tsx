import * as React from 'react';
import { CalendarDays, CalendarRange, Gem, HelpCircle, Package, ShieldCheck, Users, Wallet, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { OVERVIEW_STATUS_LABEL, OVERVIEW_STATUS_TONE, type OverviewStatus } from '@/lib/billing';
import { GRACE_DAYS, type PlanId } from '@/lib/plans';
import type { StoreAccess } from '@/lib/store-access';
import { daysUntil } from '@/lib/subscription';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const PLAN_ICON: Record<PlanId, LucideIcon> = { BASIC: Package, BUSINESS: Users, ENTERPRISE: Gem };
const TONE_BADGE = { success: 'success', info: 'info', warning: 'warning', danger: 'destructive' } as const;

const STATUS_HINT: Record<OverviewStatus, string> = {
  SUSPENDED: 'Suspended by the platform administrator. Contact support.',
  OVERDUE: 'An invoice is past its due date.',
  UNDER_REVIEW: 'Your reported payment is being verified.',
  AWAITING_PAYMENT: 'An invoice is open and waiting for payment.',
  READ_ONLY: 'Changes are paused until a payment is verified.',
  GRACE: 'Your period ended; the store still works for now.',
  TRIAL: 'Every trial feature, nothing charged.',
  ACTIVE: 'Paid up. Nothing owed.',
};

export interface BillingOverviewProps {
  access: StoreAccess;
  status: OverviewStatus;
  onTrial: boolean;
  /** The open invoice, if any. Nothing is owed without one. */
  invoice: { amount: number; dueAt: Date; overdue: boolean } | null;
  /** The period the newest verified payment covers. */
  paidPeriod: { start: Date; end: Date; months: number } | null;
  now: Date;
}

/**
 * Five figures across the top of the billing page: plan, status, amount due,
 * the next date that matters, and the period in force. Each is read from
 * stored records; a figure with no record says so rather than guessing.
 */
export function BillingOverview({ access, status, onTrial, invoice, paidPeriod, now }: BillingOverviewProps) {
  const PlanIcon = PLAN_ICON[access.plan.id];
  const tone = OVERVIEW_STATUS_TONE[status];
  const nextDate = access.state === 'GRACE' ? access.graceEndsAt : access.endsAt;
  const days = access.state === 'READ_ONLY' || access.state === 'SUSPENDED' ? null : daysUntil(nextDate, now);
  const nextLabel =
    access.state === 'TRIAL'
      ? 'Trial ends'
      : access.state === 'ACTIVE'
        ? 'Next billing date'
        : access.state === 'GRACE'
          ? 'Grace period ends'
          : onTrial
            ? 'Trial ended'
            : 'Period ended';

  return (
    <TooltipProvider delayDuration={150}>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <OverviewCard icon={PlanIcon} label="Current plan">
          <dd className="text-lg font-bold">{access.plan.name}</dd>
          <dd className="text-xs text-muted-foreground">{onTrial ? 'Free trial plan' : 'Paid plan'}</dd>
        </OverviewCard>

        <OverviewCard icon={ShieldCheck} label="Status">
          <dd className="mt-0.5">
            <Badge variant={TONE_BADGE[tone]} className="text-sm">
              {OVERVIEW_STATUS_LABEL[status]}
            </Badge>
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">{STATUS_HINT[status]}</dd>
        </OverviewCard>

        <OverviewCard
          icon={Wallet}
          label="Amount due"
          tone={invoice ? (invoice.overdue ? 'danger' : 'warning') : undefined}
        >
          {invoice ? (
            <>
              <dd className={cn('tabular text-lg font-bold', invoice.overdue ? 'text-destructive-text' : 'text-warning-text')}>
                {formatCurrency(invoice.amount, 'PHP')}
              </dd>
              <dd className="text-xs text-muted-foreground">
                {invoice.overdue ? 'Was due' : 'Due'} {formatDate(invoice.dueAt)}
              </dd>
            </>
          ) : (
            <>
              <dd className="text-lg font-bold">Nothing owed</dd>
              <dd className="text-xs text-muted-foreground">No open invoice</dd>
            </>
          )}
        </OverviewCard>

        <OverviewCard
          icon={CalendarDays}
          label={nextLabel}
          hint={
            access.state === 'GRACE' || access.state === 'ACTIVE'
              ? `When a paid period ends, the store keeps working for a ${GRACE_DAYS}-day grace period, then becomes read-only until a payment is verified.`
              : undefined
          }
        >
          <dd className="text-lg font-bold">{nextDate ? formatDate(nextDate) : '—'}</dd>
          <dd className="text-xs text-muted-foreground">
            {days === null ? (access.state === 'SUSPENDED' ? 'Suspended' : 'Ended') : days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} left`}
          </dd>
        </OverviewCard>

        <OverviewCard
          icon={CalendarRange}
          label="Current period"
          hint="The dates your last verified payment covers. Paying early adds the new period after this one ends."
        >
          {onTrial ? (
            <>
              <dd className="text-lg font-bold">Free trial</dd>
              <dd className="text-xs text-muted-foreground">{access.endsAt ? `Until ${formatDate(access.endsAt)}` : 'No end date'}</dd>
            </>
          ) : paidPeriod ? (
            <>
              <dd className="text-sm font-bold">
                {formatDate(paidPeriod.start)} – {formatDate(paidPeriod.end)}
              </dd>
              <dd className="text-xs text-muted-foreground">
                {paidPeriod.months === 1 ? 'Billed monthly' : paidPeriod.months === 12 ? 'Billed yearly' : `${paidPeriod.months} months`}
              </dd>
            </>
          ) : (
            <>
              <dd className="text-lg font-bold">—</dd>
              <dd className="text-xs text-muted-foreground">Recorded by the administrator</dd>
            </>
          )}
        </OverviewCard>
      </dl>
    </TooltipProvider>
  );
}

function OverviewCard({
  icon: Icon,
  label,
  hint,
  tone,
  children,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  tone?: 'warning' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 gap-3 rounded-card border bg-card p-4 shadow-card',
        tone === 'warning' && 'border-warning/40',
        tone === 'danger' && 'border-destructive/40',
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          tone === 'warning' ? 'bg-warning/15 text-warning-text' : tone === 'danger' ? 'bg-destructive/10 text-destructive-text' : 'bg-mint text-primary',
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {label}
          {hint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`About ${label.toLowerCase()}: ${hint}`}
                >
                  <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 whitespace-normal">{hint}</TooltipContent>
            </Tooltip>
          )}
        </dt>
        {children}
      </div>
    </div>
  );
}
