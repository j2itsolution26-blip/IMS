'use client';

import * as React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import { UpgradeDialog } from '@/features/subscription/upgrade-dialog';
import type { CapacityInfo } from '@/server/services/plan-ui';

/**
 * Remaining room under a plan quota, shown where the next one is added. Quiet
 * until the store is close (the last fifth, or five or fewer); a warning with
 * the upgrade dialog once it is full. Unlimited quotas show nothing.
 */
export function CapacityNotice({ capacity, noun }: { capacity: CapacityInfo | null; noun: string }) {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  if (!capacity || capacity.limit === null || capacity.remaining === null) return null;

  if (capacity.full) {
    return (
      <div role="status" className="mb-4 flex flex-wrap items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          All {formatNumber(capacity.limit, 0)} {noun} on your plan are in use, so a new one cannot be saved.
        </p>
        <Button ref={buttonRef} type="button" size="sm" variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog">
          How to add more
        </Button>
        <UpgradeDialog open={open} onOpenChange={setOpen} info={capacity.full} returnFocusTo={buttonRef} />
      </div>
    );
  }

  const close = capacity.remaining <= Math.max(5, Math.floor(capacity.limit / 5));
  if (!close) return null;
  return (
    <p role="status" className="mb-4 flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {formatNumber(capacity.used, 0)} of {formatNumber(capacity.limit, 0)} {noun} used — room for{' '}
      {formatNumber(capacity.remaining, 0)} more on your plan.
    </p>
  );
}
