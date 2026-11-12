'use client';

import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/features/pwa/use-online-status';
import { useOfflineCatalog } from '@/features/offline/catalog-client';
import { useSyncState } from '@/features/offline/sync-client';

/**
 * Connection notice under the top bar. The live region is always mounted so
 * screen readers announce the change when the connection drops.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const catalog = useOfflineCatalog();
  const sync = useSyncState();
  // Readiness as the till last saw it; the till itself enforces the full rules.
  const canSell = catalog.offlineMode && catalog.snapshot !== null && Date.parse(catalog.snapshot.accessUntil) > Date.now();

  return (
    <div role="status" aria-live="polite" className="no-print">
      {!online && (
        <p className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-sm font-medium text-warning-text">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          {canSell
            ? 'You’re offline. Cash sales are saved on this device and sent when the connection returns.'
            : 'You’re offline. Changes can’t be saved until the connection returns.'}
          {sync.pending > 0 && ` ${sync.pending} sale${sync.pending === 1 ? '' : 's'} waiting to be sent.`}
        </p>
      )}
    </div>
  );
}
