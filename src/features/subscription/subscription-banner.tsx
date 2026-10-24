import Link from 'next/link';
import { AlertTriangle, Ban, Clock } from 'lucide-react';
import type { StoreAccess } from '@/lib/store-access';
import { accessHeadline, shouldWarn } from '@/lib/subscription';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * A strip above every page while the store needs attention: the trial's last
 * week, the grace period, or read-only mode. The owner gets the way forward;
 * staff are told who to ask.
 */
export function SubscriptionBanner({ access, canManageBilling, now }: { access: StoreAccess; canManageBilling: boolean; now: Date }) {
  if (!shouldWarn(access, now)) return null;
  const serious = access.state === 'READ_ONLY';
  const Icon = access.state === 'TRIAL' ? Clock : AlertTriangle;
  return (
    <div
      role={serious ? 'alert' : 'status'}
      className={cn(
        'mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm',
        serious ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', serious ? 'text-destructive-text' : 'text-warning-text')} aria-hidden="true" />
      <p className="min-w-0 flex-1">{accessHeadline(access, now)}</p>
      {canManageBilling ? (
        <Link href="/settings/subscription" className="shrink-0 font-semibold text-primary hover:underline">
          {access.state === 'TRIAL' ? 'Choose a plan' : 'Renew'}
        </Link>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">Ask the store owner to renew.</span>
      )}
    </div>
  );
}

/** Shown instead of any page while the store is suspended. Its records are untouched. */
export function StoreSuspended({ canContactSupport = false }: { canContactSupport?: boolean }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div role="alert" className="w-full max-w-md rounded-card border bg-card p-6 text-center shadow-card">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive-text">
          <Ban className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="text-lg font-semibold">This store is suspended</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The platform administrator has suspended this store, so it cannot be used for now. No records have been
          removed. Contact support to restore access.
        </p>
        {canContactSupport && (
          <Button asChild className="mt-4">
            <Link href="/support/new?category=BILLING">Contact support</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
