import Link from 'next/link';
import { ArrowUpRight, Crown, Info, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { upgradePath, type BranchCapacity } from '@/lib/branch-list';

const plural = (n: number) => (n === 1 ? 'location' : 'locations');

/**
 * The plan's location allowance in three parts: the plan, how much of it is
 * used, and what to do next. The limit and price come from the store's plan
 * and the platform price list; the server and a database trigger enforce the
 * limit, this only reports it.
 */
export function BranchCapacityCard({
  id,
  capacity,
  planName,
  planPrice,
  higherPlans,
  canUpgrade,
  isOwner,
}: {
  /** Lets the Add Branch button point at the explanation. */
  id: string;
  capacity: BranchCapacity;
  planName: string;
  planPrice: { amount: number; currency: string } | null;
  higherPlans: { name: string; branches: number | null }[];
  canUpgrade: boolean;
  isOwner: boolean;
}) {
  const { used, limit, remaining, percent, full, over } = capacity;
  const path = upgradePath(higherPlans);

  const upgrade = full && canUpgrade && (
    <Button asChild size="sm" variant="outline" className="mt-2.5 h-8 rounded-lg border-primary/50 bg-card text-primary hover:bg-primary/5 hover:text-primary">
      <Link href="/settings/subscription#plans">
        Upgrade Plan <ArrowUpRight aria-hidden="true" />
      </Link>
    </Button>
  );

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="grid gap-4 rounded-card border bg-card p-4 shadow-card sm:px-5 sm:py-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)_minmax(0,1.3fr)] lg:items-center lg:gap-6"
    >
      {/* The plan */}
      <div className="flex min-w-0 items-center gap-3 lg:border-r lg:pr-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
          <Crown className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`${id}-title`} className="text-lg font-bold leading-tight">
              {planName} Plan
            </h2>
            <Badge variant="info">Current Plan</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {planPrice && (
              <>
                <span className="font-semibold text-foreground">{formatCurrency(planPrice.amount, planPrice.currency).replace(/\.00$/, '')}</span> / month
                <span aria-hidden="true"> • </span>
              </>
            )}
            {limit === null ? 'Unlimited locations' : `${formatNumber(limit, 0)} ${plural(limit)} included`}
          </p>
        </div>
      </div>

      {/* Usage */}
      <div className="min-w-0">
        <p className="font-semibold">Location Capacity</p>
        <div className="mt-1 flex items-baseline justify-between gap-3 text-sm">
          <span>
            {formatNumber(used, 0)}
            {limit !== null && ` of ${formatNumber(limit, 0)}`} {plural(limit ?? used)} used
          </span>
          {limit !== null && <span className="tabular text-muted-foreground">{percent}%</span>}
        </div>
        {limit !== null && (
          <div
            role="progressbar"
            aria-label="Locations used"
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={Math.min(used, limit)}
            aria-valuetext={`${used} of ${limit} ${plural(limit)} used`}
            className="mt-2 h-3 overflow-hidden rounded-full bg-muted"
          >
            <div className={cn('h-full rounded-full transition-[width]', over ? 'bg-warning' : 'bg-primary')} style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>

      {/* What next */}
      <div
        id={`${id}-note`}
        className={cn('rounded-xl border px-4 py-3 text-sm', full ? 'border-warning/30 bg-warning/10' : 'border-primary/15 bg-primary/5')}
      >
        <p className="flex items-center gap-2 font-semibold">
          {full ? <Info className="h-4 w-4 shrink-0 text-warning-text" aria-hidden="true" /> : <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
          {over ? 'Over your plan limit' : full ? 'Location limit reached' : 'Room to grow'}
        </p>
        <p className="mt-1 pl-6 text-[13px] leading-snug text-foreground/80">
          {over ? (
            <>
              Your plan allows {limit} active {plural(limit ?? 0)} and {used} are active. Deactivate {used - (limit ?? 0)}, choosing which to keep. Until then the
              branches marked “Over plan limit” take no new sales, shifts or stock; the main branch always keeps working. Nothing is deleted.
            </>
          ) : full ? (
            <>
              Your {planName} plan includes {limit} {plural(limit ?? 0)}.{' '}
              {path ? `${path} to add more branches.` : 'Deactivate a branch you no longer use to add another.'}
              {path && !canUpgrade && !isOwner && ' Ask the store owner to upgrade.'}
            </>
          ) : (
            <>
              {remaining === null ? 'Add as many branches as you need.' : `${formatNumber(remaining, 0)} more ${plural(remaining)} available on your plan.`} Deactivated
              branches keep their history and do not count.
            </>
          )}
        </p>
        {upgrade && <div className="pl-6">{upgrade}</div>}
      </div>
    </section>
  );
}
