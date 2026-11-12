'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, RefreshCw, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { openLocalDb, type OutboxEntry } from '@/features/offline/local-db';
import { entriesForStore, isUnsynced } from '@/features/offline/outbox';
import { getSyncEngine, useSyncState } from '@/features/offline/sync-client';
import { describeEntry, describeSyncStatus, type SyncTone } from '@/features/offline/sync-status-model';
import { useOnlineStatus } from '@/features/pwa/use-online-status';

const TONE: Record<SyncTone, { className: string; Icon: React.ComponentType<{ className?: string }> }> = {
  ok: { className: 'border-success/30 bg-success/10 text-success-text', Icon: CheckCircle2 },
  pending: { className: 'border-info/30 bg-info/10 text-info-text', Icon: UploadCloud },
  busy: { className: 'border-info/30 bg-info/10 text-info-text', Icon: Loader2 },
  offline: { className: 'border-warning/30 bg-warning/10 text-warning-text', Icon: CloudOff },
  error: { className: 'border-destructive/30 bg-destructive/10 text-destructive-text', Icon: AlertTriangle },
};

/**
 * The till's sync indicator: connection, unsent sales and anything that needs
 * attention, at a glance. Opens the list of sales on this device.
 */
export function SyncStatusButton({ storeId, userId, currency }: { storeId: string; userId: string; currency: string }) {
  const state = useSyncState();
  const online = useOnlineStatus();
  const view = describeSyncStatus(state, online);
  const [open, setOpen] = React.useState(false);
  const { className, Icon } = TONE[view.tone];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        aria-label={`${view.label}. ${view.detail} Show sales on this device.`}
      >
        <Icon className={cn('h-3.5 w-3.5 shrink-0', view.tone === 'busy' && 'animate-spin')} aria-hidden="true" />
        <span className="whitespace-nowrap">{view.label}</span>
      </button>
      <PendingSalesDialog open={open} onOpenChange={setOpen} storeId={storeId} userId={userId} currency={currency} />
    </>
  );
}

function PendingSalesDialog({
  open,
  onOpenChange,
  storeId,
  userId,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  userId: string;
  currency: string;
}) {
  const state = useSyncState();
  const online = useOnlineStatus();
  const view = describeSyncStatus(state, online);
  const [entries, setEntries] = React.useState<OutboxEntry[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const db = await openLocalDb();
      setEntries(await entriesForStore(db, storeId));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [storeId]);

  // Reload whenever the engine's counts move while the list is open.
  React.useEffect(() => {
    if (open) void load();
  }, [open, load, state.pending, state.attention, state.othersUnsynced, state.lastSyncAt, state.syncing]);

  const unsynced = (entries ?? []).filter(isUnsynced).reverse();
  const recent = (entries ?? []).filter((entry) => entry.status === 'synced').reverse().slice(0, 10);
  const retry = (ids?: string[]) => void getSyncEngine().run('manual', ids);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sales on this device</DialogTitle>
          <DialogDescription>{view.detail}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
          <dt className="text-muted-foreground">Connection</dt>
          <dd className="text-right font-medium">{!online || state.reachable === false ? 'Offline' : state.reachable ? 'Server reachable' : 'Online'}</dd>
          <dt className="text-muted-foreground">Waiting to send</dt>
          <dd className="tabular text-right font-medium">{state.pending}</dd>
          <dt className="text-muted-foreground">Last successful sync</dt>
          <dd className="text-right font-medium">{state.lastSyncAt ? formatDateTime(new Date(state.lastSyncAt)) : 'Not yet'}</dd>
        </dl>

        {loadError && <p className="text-sm text-destructive-text">The sales saved on this device could not be read.</p>}

        <section aria-labelledby="unsent-heading" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id="unsent-heading" className="text-sm font-semibold">
              Not yet sent {unsynced.length > 0 && <span className="text-muted-foreground">({unsynced.length})</span>}
            </h3>
            <Button size="sm" variant="outline" onClick={() => retry()} disabled={state.syncing || unsynced.length === 0}>
              <RefreshCw className={cn('h-3.5 w-3.5', state.syncing && 'animate-spin')} /> Retry now
            </Button>
          </div>
          {entries !== null && unsynced.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting. Every sale here has reached the server.</p>}
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {unsynced.map((entry) => (
              <li key={entry.id} className="rounded-lg border px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-medium">{entry.localReceiptNumber}</span>
                  <span className="tabular font-medium">{formatCurrency(entry.receipt.total, currency)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(new Date(entry.createdAt))} · {entry.method === 'CASH' ? 'Cash' : 'GCash'}
                  {entry.userId !== userId && ' · another cashier'}
                </p>
                <p className={cn('mt-1 text-xs', entry.status === 'rejected' ? 'text-destructive-text' : 'text-muted-foreground')}>
                  {entry.userId !== userId ? 'Sent when that cashier signs in on this device.' : describeEntry(entry)}
                </p>
                {entry.status === 'rejected' && entry.userId === userId && (
                  <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => retry([entry.id])}>
                    Try again
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {recent.length > 0 && (
          <section aria-labelledby="recent-heading" className="space-y-1">
            <h3 id="recent-heading" className="text-sm font-semibold">
              Recently sent
            </h3>
            <ul className="space-y-0.5 text-xs">
              {recent.map((entry) => (
                <li key={entry.id} className="flex justify-between gap-2">
                  <span className="font-mono">{entry.localReceiptNumber}</span>
                  <span className="text-muted-foreground">→ {entry.result?.invoiceNumber ?? 'sent'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-muted-foreground">
          Sales stay on this device until the server confirms them, even if you sign out. Browser storage is not a backup: keep the
          device signed in and online when you can.
        </p>
      </DialogContent>
    </Dialog>
  );
}
