import Link from 'next/link';
import { ArrowUpRight, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BranchCapacity } from '@/lib/branch-list';

const plural = (n: number) => (n === 1 ? 'location' : 'locations');

/**
 * The plan's location allowance: "2 of 3 locations used", a bar, and what to
 * do when it is full. The limit comes from the store's plan; the server and a
 * database trigger enforce it, this only reports it.
 */
export function BranchCapacityCard({
  id,
  capacity,
  planName,
  canUpgrade,
  isOwner,
}: {
  /** Lets the Add Branch button point at the explanation. */
  id: string;
  capacity: BranchCapacity;
  planName: string;
  canUpgrade: boolean;
  isOwner: boolean;
}) {
  const { used, limit, remaining, percent, full, over } = capacity;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn('rounded-card border bg-card p-4 shadow-card', full && 'border-warning/40')}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', full ? 'bg-warning/15 text-warning-text' : 'bg-primary/10 text-primary')}
          >
            <Gauge className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-sm font-semibold">
              {planName} plan · location capacity
            </h2>
            <p className="text-xs text-muted-foreground">
              {limit === null ? 'No limit on locations' : `Up to ${formatNumber(limit, 0)} ${plural(limit)}`} · a location is a physical store, not a device
            </p>
          </div>
        </div>
        <p className="tabular text-sm">
          <span className="text-lg font-bold">{formatNumber(used, 0)}</span>
          {limit !== null && <span className="text-muted-foreground"> of {formatNumber(limit, 0)}</span>} {plural(limit ?? used)} used
        </p>
      </div>

      {limit !== null && (
        <div
          role="progressbar"
          aria-label="Locations used"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={`${used} of ${limit} ${plural(limit)} used`}
          className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className={cn('h-full rounded-full transition-[width]', full ? 'bg-warning' : 'bg-primary')} style={{ width: `${percent}%` }} />
        </div>
      )}

      <div id={`${id}-note`} className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        {over ? (
          <p className="text-warning-text">
            Your plan allows {limit} active {plural(limit ?? 0)} and {used} are active. Deactivate {used - (limit ?? 0)} to stay within it, choosing which to keep. Until
            then you cannot add or reactivate branches, and the branches marked “Over plan limit” take no new sales, shifts or stock. The main branch always keeps
            working. Nothing is deleted.
          </p>
        ) : full ? (
          <p className="text-warning-text">
            Every location on your plan is in use, so another branch cannot be added. Upgrade for more, or deactivate a branch you no longer use.
          </p>
        ) : (
          <p className="text-muted-foreground">
            {remaining === null ? 'Add as many branches as you need.' : `${formatNumber(remaining, 0)} ${plural(remaining)} left on your plan.`} Deactivated branches keep
            their history and do not count.
          </p>
        )}
        {full &&
          (canUpgrade ? (
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href="/settings/subscription#plans">
                Upgrade plan <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            !isOwner && <span className="text-muted-foreground">Ask the store owner to upgrade.</span>
          ))}
      </div>
    </section>
  );
}
