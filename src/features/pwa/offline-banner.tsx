'use client';

import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/features/pwa/use-online-status';

/**
 * Connection notice under the top bar. The live region is always mounted so
 * screen readers announce the change when the connection drops.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();

  return (
    <div role="status" aria-live="polite" className="no-print">
      {!online && (
        <p className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning-text">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          You&apos;re offline. Sales and stock changes can&apos;t be saved until the connection returns.
        </p>
      )}
    </div>
  );
}
