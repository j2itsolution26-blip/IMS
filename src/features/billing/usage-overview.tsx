import * as React from 'react';
import Link from 'next/link';
import { Check, Minus } from 'lucide-react';
import { Panel } from '@/components/panel';
import { Progress } from '@/components/ui/misc';
import { METER_HINT, METER_LABEL } from '@/features/subscription/plan-display';
import { usageLevel, type UsageLevel } from '@/lib/billing';
import { FEATURE_LABEL, PLAN_ORDER, type Feature, type LimitKey, type PlanDefinition } from '@/lib/plans';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const FEATURES: Feature[] = ['reportExports', 'customRoles', 'backgroundRemoval'];

/**
 * How much of the plan in force the store is using. The counts come from
 * `usageSummary` — the same counts the limits are enforced by — so a meter
 * never disagrees with what the server will allow.
 */
export function UsageOverview({
  meters,
  plan,
  canManage,
  className,
}: {
  meters: { key: LimitKey; used: number; limit: number | null }[];
  plan: PlanDefinition;
  canManage: boolean;
  className?: string;
}) {
  const topPlan = PLAN_ORDER[PLAN_ORDER.length - 1] === plan.id;
  return (
    <Panel title="Usage" description={`Counted live against your ${plan.name} limits.`} className={className}>
      <ul className="space-y-4 p-4">
        {meters.map((meter) => (
          <UsageRow key={meter.key} meter={meter} level={usageLevel(meter.used, meter.limit)} canManage={canManage} topPlan={topPlan} planName={plan.name} />
        ))}
      </ul>
      <ul className="mt-auto grid gap-1.5 border-t px-4 py-3 text-xs" aria-label="Features on your plan">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex items-center gap-2">
            {plan.features[feature] ? (
              <Check className="h-3.5 w-3.5 text-success-text" aria-hidden="true" />
            ) : (
              <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            <span className={plan.features[feature] ? undefined : 'text-muted-foreground'}>
              {FEATURE_LABEL[feature]}
              <span className="sr-only">{plan.features[feature] ? ': included' : ': not included'}</span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 text-success-text" aria-hidden="true" />
          Audit history: {plan.auditHistoryDays === null ? 'all of it' : `last ${plan.auditHistoryDays} days`}
        </li>
      </ul>
    </Panel>
  );
}

function UsageRow({
  meter,
  level,
  canManage,
  topPlan,
  planName,
}: {
  meter: { key: LimitKey; used: number; limit: number | null };
  level: UsageLevel;
  canManage: boolean;
  topPlan: boolean;
  planName: string;
}) {
  const id = `usage-${meter.key}`;
  const limit = meter.limit ?? 0;
  const ratio = meter.limit ? Math.min(1, meter.used / meter.limit) : 0;
  const attention = level === 'NEAR' || level === 'FULL' || level === 'OVER' || level === 'NOT_INCLUDED';

  const message: string | null =
    level === 'NEAR'
      ? `${formatNumber(limit - meter.used, 0)} left before the limit.`
      : level === 'FULL'
        ? 'Limit reached. Nothing more can be added until some are freed up or the plan is upgraded.'
        : level === 'OVER'
          ? 'Over the limit. Nothing is deleted, but no more can be added until some are removed or the plan is upgraded.'
          : level === 'NOT_INCLUDED'
            ? `Not included on ${planName}.`
            : (METER_HINT[meter.key] ?? null);

  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id={id} className="font-medium">
          {METER_LABEL[meter.key]}
        </span>
        <span
          className={cn(
            'tabular-nums',
            level === 'FULL' || level === 'OVER' ? 'font-semibold text-warning-text' : 'text-muted-foreground',
          )}
        >
          {level === 'UNLIMITED'
            ? `${formatNumber(meter.used, 0)} · unlimited`
            : level === 'NOT_INCLUDED'
              ? '—'
              : `${formatNumber(meter.used, 0)} / ${formatNumber(limit, 0)}`}
        </span>
      </div>
      {level !== 'UNLIMITED' && level !== 'NOT_INCLUDED' && (
        <Progress
          value={ratio * 100}
          aria-labelledby={id}
          aria-valuetext={`${meter.used} of ${limit} used`}
          indicatorClassName={level === 'FULL' || level === 'OVER' ? 'bg-warning' : level === 'NEAR' ? 'bg-warning/70' : undefined}
        />
      )}
      {message && (
        <p className={cn('text-xs', attention && level !== 'NOT_INCLUDED' ? 'text-warning-text' : 'text-muted-foreground')}>
          {message}
          {attention && !topPlan && (
            <>
              {' '}
              {canManage ? (
                <Link href="#plans" className="font-semibold text-primary hover:underline">
                  See plans
                </Link>
              ) : (
                'Ask the store owner about upgrading.'
              )}
            </>
          )}
        </p>
      )}
    </li>
  );
}
