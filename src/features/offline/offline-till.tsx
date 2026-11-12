'use client';

import * as React from 'react';
import { CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PosTerminal } from '@/features/pos/pos-terminal';
import { SyncAgent } from '@/features/offline/sync-agent';
import { SyncStatusButton } from '@/features/offline/sync-status';
import { OfflineBanner } from '@/features/pwa/offline-banner';
import { useOnlineStatus } from '@/features/pwa/use-online-status';
import { openLocalDb } from '@/features/offline/local-db';
import { deviceSales, lastTill, type TillScope } from '@/features/offline/catalog';
import {
  READINESS_MESSAGE,
  offlineReadiness,
  searchCatalog,
  soldSince,
  type CatalogSnapshot,
  type LocalSellable,
} from '@/lib/offline-catalog';
import { APP_SHORT_NAME } from '@/lib/brand';

/**
 * The till a prepared device opens when the app cannot reach the server
 * (/pos-offline; the service worker sends failed page loads here).
 *
 * It holds no account data of its own: it opens the till last prepared on
 * this device, from that cashier's catalogue copy, under the same rules as an
 * online till that lost its connection: cash only, within the offline access
 * period, at the branch of the shift that was open, and never after that
 * cashier signed out. Everything else in the app waits for the connection.
 */

export type OfflineTillView =
  | { kind: 'loading' }
  | { kind: 'closed'; message: string }
  | { kind: 'ready'; scope: TillScope; snapshot: CatalogSnapshot; products: LocalSellable[]; lowStock: number };

export const NO_TILL_MESSAGE =
  'This device has no till prepared for offline sales. Connect to the internet, sign in and open the till once.';
export const NO_SHIFT_MESSAGE = 'No shift was open when this device last connected. A shift can only be opened with a connection.';

async function readTill(): Promise<OfflineTillView> {
  const db = await openLocalDb();
  const found = await lastTill(db);
  if (!found) return { kind: 'closed', message: NO_TILL_MESSAGE };
  const { scope, snapshot } = found;
  const shift = snapshot.openShift;
  const readiness = offlineReadiness(snapshot, {
    storeId: scope.storeId,
    userId: scope.userId,
    branchId: shift?.warehouseId ?? null,
    // The copy is only kept while the owner has offline sales switched on.
    offlineMode: true,
    now: Date.now(),
  });
  if (!readiness.ready) return { kind: 'closed', message: READINESS_MESSAGE[readiness.reason] };
  if (!shift) return { kind: 'closed', message: NO_SHIFT_MESSAGE };

  const sold = soldSince(snapshot, await deviceSales(db, scope.storeId));
  const lowStockLevel = snapshot.lowStockLevel ?? 0;
  return {
    kind: 'ready',
    scope,
    snapshot,
    products: searchCatalog(snapshot, sold, ''),
    lowStock: lowStockLevel > 0 ? searchCatalog(snapshot, sold, '', { lowStockAtOrBelow: lowStockLevel }, Infinity).length : 0,
  };
}

export function OfflineTill() {
  const online = useOnlineStatus();
  const [view, setView] = React.useState<OfflineTillView>({ kind: 'loading' });

  React.useEffect(() => {
    readTill()
      .then(setView)
      .catch(() => setView({ kind: 'closed', message: 'This browser cannot open the till’s storage, so it cannot sell offline.' }));
  }, []);

  const snapshot = view.kind === 'ready' ? view.snapshot : null;

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{snapshot ? snapshot.receipt?.name || snapshot.store.name : APP_SHORT_NAME}</p>
            <p className="text-xs text-muted-foreground">Offline till{snapshot?.user.name ? ` · ${snapshot.user.name}` : ''}</p>
          </div>
          {view.kind === 'ready' && (
            <SyncStatusButton storeId={view.scope.storeId} userId={view.scope.userId} currency={view.snapshot.store.currency} offlineMode />
          )}
        </div>
      </header>
      <OfflineBanner />

      {online && (
        // Never automatic: with the server down the browser can still report a
        // connection, and the full till would only fail to load again.
        <p role="status" className="border-b border-info/30 bg-info/10 px-4 py-2 text-center text-sm text-info-text">
          The connection is back.{' '}
          {/* A full page load: the till's server data is fetched afresh. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/pos" className="font-semibold underline underline-offset-2">
            Open the full till
          </a>{' '}
          between sales.
        </p>
      )}

      <main className="mx-auto max-w-7xl p-4">
        {view.kind === 'loading' && (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Opening the till…
          </p>
        )}

        {view.kind === 'closed' && (
          <Card className="mx-auto mt-8 max-w-md p-8 text-center">
            <CloudOff className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <h1 className="font-semibold">Offline sales are not available here</h1>
            <p className="mt-2 text-sm text-muted-foreground">{view.message}</p>
            <Button className="mt-5 h-11 w-full" onClick={() => window.location.assign('/pos')}>
              <RefreshCw /> Try the connection again
            </Button>
          </Card>
        )}

        {view.kind === 'ready' && (
          <>
            {/* Sends the saved sales whenever this page sees a connection. */}
            <SyncAgent storeId={view.scope.storeId} userId={view.scope.userId} />
            <PosTerminal
              initialProducts={view.products}
              currency={view.snapshot.store.currency}
              taxRate={view.snapshot.store.taxRate}
              cashierName={view.snapshot.user.name ?? 'Cashier'}
              cashierId={view.scope.userId}
              storeId={view.scope.storeId}
              // The prices on this till are the copy's.
              pricedAt={view.snapshot.fetchedAt}
              company={{
                name: view.snapshot.receipt?.name || view.snapshot.store.name,
                address: view.snapshot.receipt?.address ?? '',
                phone: view.snapshot.receipt?.phone ?? '',
                receiptFooter: view.snapshot.receipt?.receiptFooter ?? '',
                logoUrl: view.snapshot.receipt?.logoUrl || undefined,
              }}
              gcash={{ number: '', accountName: '' }}
              canEditStoreSettings={false}
              canCreateProducts={false}
              canEditProduct={false}
              categoryChips={{
                total: view.snapshot.products.length,
                lowStock: view.lowStock,
                categories: view.snapshot.categories
                  .map((category) => ({ ...category, count: view.snapshot.products.filter((p) => p.categoryId === category.id).length }))
                  .filter((category) => category.count > 0),
              }}
              lowStockLevel={view.snapshot.lowStockLevel ?? 0}
              openShift={view.snapshot.openShift}
              suggestedOpeningCash={0}
              offlineMode
            />
          </>
        )}
      </main>
    </div>
  );
}
