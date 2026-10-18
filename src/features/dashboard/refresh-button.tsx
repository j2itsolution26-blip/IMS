'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Re-runs the page's server queries without losing the selected filters.
 *
 * `router.refresh()` re-renders the route on the server with the same URL, so
 * the figures are re-read from the database while the period stays put.
 */
export function RefreshButton({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">
        {pending ? 'Refreshing…' : `Updated ${formatTime(generatedAt)}`}
      </span>
      <Button
        type="button"
        variant="outline"
        className="h-9"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
      >
        <RefreshCw className={cn('h-4 w-4', pending && 'animate-spin')} aria-hidden="true" />
        Refresh
      </Button>
    </div>
  );
}
