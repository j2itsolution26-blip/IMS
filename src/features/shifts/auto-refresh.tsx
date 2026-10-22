'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/format';

/**
 * Re-renders the server page on an interval while the tab is visible, and
 * once when the owner comes back to it. `router.refresh()` keeps the URL,
 * filters and scroll position, so the figures update in place; a hidden tab
 * makes no requests at all.
 */
export function AutoRefresh({ seconds = 30, renderedAt }: { seconds?: number; renderedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, seconds * 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router, seconds]);

  return (
    <div className="no-print flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-live="polite">Updated {formatTime(renderedAt)}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        onClick={() => startTransition(() => router.refresh())}
        aria-label="Refresh now"
        disabled={pending}
      >
        <RefreshCw className={pending ? 'animate-spin' : undefined} />
      </Button>
    </div>
  );
}

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button variant="outline" className="no-print h-10" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
