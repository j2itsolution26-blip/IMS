import * as React from 'react';
import { Check, Minus } from 'lucide-react';
import { Progress } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/lib/format';
import { FEATURE_LABEL, PLANS, PLAN_ORDER, type Feature, type LimitKey, type PlanId } from '@/lib/plans';
import { ACCESS_LABEL, ACCESS_TONE } from '@/lib/subscription';
import type { AccessState } from '@/lib/store-access';
import { cn } from '@/lib/utils';

/**
 * Pieces shared by the owner's Subscription page and the platform's store
 * page. Everything shown comes from the plan configuration and server counts.
 */

export const METER_LABEL: Record<LimitKey, string> = {
  products: 'Products',
  staff: 'Staff accounts',
  branches: 'Branches',
  backgroundRemovalsPerMonth: 'Background removals this month',
};

const METER_HINT: Partial<Record<LimitKey, string>> = {
  products: 'Archived products do not count.',
  staff: 'Active accounts; the owner does not count.',
};

const TONE_VARIANT = { success: 'success', info: 'default', warning: 'warning', danger: 'destructive' } as const;

export function AccessBadge({ state }: { state: AccessState }) {
  return <Badge variant={TONE_VARIANT[ACCESS_TONE[state]]}>{ACCESS_LABEL[state]}</Badge>;
}

export function UsageMeter({ meter, label }: { meter: { key: LimitKey; used: number; limit: number | null }; label?: string }) {
  const name = label ?? METER_LABEL[meter.key];
  const unlimited = meter.limit === null;
  const ratio = unlimited || meter.limit === 0 ? 0 : Math.min(1, meter.used / (meter.limit as number));
  const over = !unlimited && meter.used > (meter.limit as number);
  const full = !unlimited && meter.used >= (meter.limit as number);
  const id = `meter-${meter.key}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id={id} className="font-medium">
          {name}
        </span>
        <span className={cn('tabular-nums', full ? 'font-semibold text-warning-text' : 'text-muted-foreground')}>
          {formatNumber(meter.used, 0)} {unlimited ? '· unlimited' : `of ${formatNumber(meter.limit, 0)}`}
        </span>
      </div>
      {!unlimited && (
        <Progress
          value={ratio * 100}
          aria-labelledby={id}
          aria-valuetext={`${meter.used} of ${meter.limit} used`}
          indicatorClassName={full ? 'bg-warning' : undefined}
        />
      )}
      {over ? (
        <p className="text-xs text-warning-text">
          Over the plan&apos;s limit. Nothing is deleted, but no more can be added until some are removed or the plan is upgraded.
        </p>
      ) : (
        METER_HINT[meter.key] && <p className="text-xs text-muted-foreground">{METER_HINT[meter.key]}</p>
      )}
    </div>
  );
}

const LIMIT_ROWS: { key: LimitKey; label: string }[] = [
  { key: 'branches', label: 'Branches' },
  { key: 'staff', label: 'Staff accounts' },
  { key: 'products', label: 'Products' },
  { key: 'backgroundRemovalsPerMonth', label: 'Background removals / month' },
];
const FEATURE_ROWS: Feature[] = ['reportExports', 'customRoles', 'backgroundRemoval'];

const limitText = (value: number | null) => (value === null ? 'Unlimited' : value === 0 ? '—' : formatNumber(value, 0));

/** Basic / Business / Enterprise side by side, current plan highlighted. */
export function PlanComparison({ current }: { current: PlanId }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="sr-only">Plan comparison</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              <span className="sr-only">Feature</span>
            </th>
            {PLAN_ORDER.map((id) => (
              <th
                key={id}
                scope="col"
                className={cn('px-4 py-2.5 text-left font-semibold', id === current && 'bg-primary/5 text-primary')}
                aria-current={id === current ? 'true' : undefined}
              >
                {PLANS[id].name}
                {id === current && <span className="ml-1.5 text-xs font-medium">(your plan)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LIMIT_ROWS.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-normal text-muted-foreground">
                {row.label}
              </th>
              {PLAN_ORDER.map((id) => (
                <td key={id} className={cn('px-4 py-2.5 tabular-nums', id === current && 'bg-primary/5')}>
                  {limitText(PLANS[id].limits[row.key])}
                </td>
              ))}
            </tr>
          ))}
          {FEATURE_ROWS.map((feature) => (
            <tr key={feature} className="border-b last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-normal text-muted-foreground">
                {FEATURE_LABEL[feature]}
              </th>
              {PLAN_ORDER.map((id) => (
                <td key={id} className={cn('px-4 py-2.5', id === current && 'bg-primary/5')}>
                  {PLANS[id].features[feature] ? (
                    <Check className="h-4 w-4 text-success-text" aria-label="Included" />
                  ) : (
                    <Minus className="h-4 w-4 text-muted-foreground" aria-label="Not included" />
                  )}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" className="px-4 py-2.5 text-left font-normal text-muted-foreground">
              Audit history
            </th>
            {PLAN_ORDER.map((id) => (
              <td key={id} className={cn('px-4 py-2.5', id === current && 'bg-primary/5')}>
                {PLANS[id].auditHistoryDays === null ? 'All' : `${PLANS[id].auditHistoryDays} days`}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
