'use client';

import * as React from 'react';
import { CloudOff, KeyRound, Loader2, Lock, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PosTerminal } from '@/features/pos/pos-terminal';
import { SyncAgent } from '@/features/offline/sync-agent';
import { SyncStatusButton } from '@/features/offline/sync-status';
import { OfflineBanner } from '@/features/pwa/offline-banner';
import { useOnlineStatus } from '@/features/pwa/use-online-status';
import { openLocalDb, type PosDb } from '@/features/offline/local-db';
import { deviceSales } from '@/features/offline/catalog';
import { isUnsynced } from '@/features/offline/outbox';
import { listEnrollments, revalidateEnrollments, unlockOffline } from '@/features/offline/offline-unlock';
import { authClient } from '@/lib/auth-client';
import { searchCatalog, soldSince, type CatalogSnapshot, type LocalSellable } from '@/lib/offline-catalog';
import { BAD_CREDENTIALS, SESSION_MESSAGE, offlineSessionCheck, type UnlockEnrollment } from '@/lib/offline-unlock';
import { PIN_MAX_LENGTH } from '@/lib/pos-pin';
import { APP_SHORT_NAME } from '@/lib/brand';

/**
 * The till a prepared device opens when the app cannot reach the server
 * (/pos-offline; the service worker sends failed page loads here).
 *
 * The page holds no account data and shows nothing of any till until a
 * cashier unlocks it with their username and PIN, checked on the device
 * against the offline unlock they allowed while online
 * (src/lib/offline-unlock.ts). The unlocked session lives in this page's
 * memory only: a reload, Lock or idle auto-lock asks for the PIN again.
 *
 * Then the same rules as an online till that lost its connection: cash only,
 * within the offline access period (never extended by unlocking), at the
 * branch of the shift that was open, with the cashier's cached permissions.
 */

type Session = {
  enrollment: UnlockEnrollment;
  snapshot: CatalogSnapshot;
  products: LocalSellable[];
  lowStock: number;
};

export type OfflineTillView =
  | { kind: 'loading' }
  | { kind: 'setup'; message: string }
  | { kind: 'unlock' }
  | { kind: 'refused'; title: string; message: string }
  | { kind: 'ready'; session: Session };

export const SETUP_MESSAGE =
  'This device has not been set up for offline sign-in. An internet connection is needed the first time: sign in, open the till and allow offline unlock with your PIN.';
export const REVALIDATION_MESSAGE =
  'The server no longer allows offline access for this account on this device. Sales already saved here are kept and are sent when the cashier signs in.';

const REFUSED_TITLE: Record<keyof typeof SESSION_MESSAGE, string> = {
  'not-prepared': 'Offline setup required',
  expired: 'Offline authorization expired',
  'not-permitted': 'Device not authorized for this account',
  'no-shift': 'No open shift',
  disabled: 'Offline sales are off',
};

async function openSession(db: PosDb, enrollment: UnlockEnrollment): Promise<Session | { title: string; message: string }> {
  const snapshot = (await db.get('catalog', enrollment.key)) ?? null;
  const check = offlineSessionCheck(snapshot, enrollment, Date.now());
  if (!check.ok || !snapshot) {
    const reason = check.ok ? 'not-prepared' : check.reason;
    return { title: REFUSED_TITLE[reason], message: SESSION_MESSAGE[reason] };
  }
  const sold = soldSince(snapshot, await deviceSales(db, snapshot.store.id));
  const lowStockLevel = snapshot.lowStockLevel ?? 0;
  return {
    enrollment,
    snapshot,
    products: searchCatalog(snapshot, sold, ''),
    lowStock: lowStockLevel > 0 ? searchCatalog(snapshot, sold, '', { lowStockAtOrBelow: lowStockLevel }, Infinity).length : 0,
  };
}

function minutesText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export function OfflineTill() {
  const online = useOnlineStatus();
  const [view, setView] = React.useState<OfflineTillView>({ kind: 'loading' });
  const [pending, setPending] = React.useState(0);
  const [notice, setNotice] = React.useState<string | null>(null);
  const session = view.kind === 'ready' ? view.session : null;

  const refreshPending = React.useCallback(async () => {
    try {
      const db = await openLocalDb();
      setPending((await db.getAll('outbox')).filter(isUnsynced).length);
    } catch {
      setPending(0);
    }
  }, []);

  const toUnlockOrSetup = React.useCallback(async () => {
    try {
      const db = await openLocalDb();
      const enrollments = await listEnrollments(db);
      setView(enrollments.length ? { kind: 'unlock' } : { kind: 'setup', message: SETUP_MESSAGE });
    } catch {
      setView({ kind: 'setup', message: 'This browser cannot open the till’s storage, so it cannot sell offline.' });
    }
    void refreshPending();
  }, [refreshPending]);

  React.useEffect(() => {
    void toUnlockOrSetup();
  }, [toUnlockOrSetup]);

  const lock = React.useCallback(() => {
    setNotice(null);
    void toUnlockOrSetup();
  }, [toUnlockOrSetup]);

  // Idle auto-lock, from the store's setting as of the last download.
  const autoLockMinutes = session?.snapshot.autoLockMinutes ?? 0;
  React.useEffect(() => {
    if (!session || !(autoLockMinutes > 0)) return;
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    let timer = window.setTimeout(lock, autoLockMinutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, autoLockMinutes * 60_000);
    };
    for (const name of events) window.addEventListener(name, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, reset);
    };
  }, [session, autoLockMinutes, lock]);

  // When the connection returns: ask the server whether every cashier this
  // device may unlock is still allowed. Anyone no longer allowed is removed;
  // if that is the cashier at the till, their session ends here (their sales
  // stay on the device).
  const activeKey = session?.enrollment.key ?? null;
  React.useEffect(() => {
    if (!online) return;
    let cancelled = false;
    void (async () => {
      try {
        const removed = await revalidateEnrollments(await openLocalDb());
        if (cancelled || !removed) return;
        if (activeKey && removed.includes(activeKey)) {
          setView({ kind: 'refused', title: 'Account revalidation required', message: REVALIDATION_MESSAGE });
        } else if (!activeKey && removed.length) {
          await toUnlockOrSetup();
        }
      } catch {
        // Storage unavailable: nothing to recheck.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [online, activeKey, toUnlockOrSetup]);

  const snapshot = session?.snapshot ?? null;

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{snapshot ? snapshot.receipt?.name || snapshot.store.name : APP_SHORT_NAME}</p>
            <p className="text-xs text-muted-foreground">Offline till{snapshot?.user.name ? ` · ${snapshot.user.name}` : ''}</p>
          </div>
          {session && (
            <div className="flex items-center gap-2">
              <SyncStatusButton
                storeId={session.enrollment.storeId}
                userId={session.enrollment.userId}
                currency={session.snapshot.store.currency}
                offlineMode
                manageOfflineAccess={false}
              />
              <Button variant="outline" size="sm" className="h-8" onClick={lock}>
                <Lock className="h-3.5 w-3.5" /> Lock
              </Button>
            </div>
          )}
        </div>
      </header>
      {/* Before sign-in the card says what is possible; the banner describes an open till. */}
      {session && <OfflineBanner />}

      {online && view.kind !== 'loading' && <ReconnectNotice userId={session?.enrollment.userId ?? null} />}

      <main className="mx-auto max-w-7xl p-4">
        {view.kind === 'loading' && (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Opening the till…
          </p>
        )}

        {view.kind === 'setup' && (
          <StateCard icon={CloudOff} title="Offline setup required" message={view.message} pending={pending}>
            <Button className="mt-5 h-11 w-full" onClick={() => window.location.assign('/pos')}>
              <RefreshCw /> Try the connection again
            </Button>
          </StateCard>
        )}

        {view.kind === 'refused' && (
          <StateCard icon={ShieldAlert} title={view.title} message={view.message} pending={pending}>
            <div className="mt-5 grid gap-2">
              <Button className="h-11 w-full" onClick={() => window.location.assign('/pos')}>
                <RefreshCw /> Try the connection again
              </Button>
              <Button variant="outline" className="h-11 w-full" onClick={lock}>
                Back to offline sign-in
              </Button>
            </div>
          </StateCard>
        )}

        {view.kind === 'unlock' && (
          <UnlockForm
            pending={pending}
            notice={notice}
            onErased={() => {
              setView({ kind: 'setup', message: 'Too many incorrect attempts, so offline sign-in was turned off on this device. Connect to the internet and sign in to set it up again.' });
            }}
            onUnlocked={async (enrollment) => {
              const opened = await openSession(await openLocalDb(), enrollment);
              if ('enrollment' in opened) setView({ kind: 'ready', session: opened });
              else setView({ kind: 'refused', title: opened.title, message: opened.message });
            }}
          />
        )}

        {session && (
          <>
            {/* Sends the saved sales whenever this page sees a connection. */}
            <SyncAgent storeId={session.enrollment.storeId} userId={session.enrollment.userId} />
            <PosTerminal
              initialProducts={session.products}
              currency={session.snapshot.store.currency}
              taxRate={session.snapshot.store.taxRate}
              cashierName={session.snapshot.user.name ?? session.enrollment.name}
              cashierId={session.enrollment.userId}
              storeId={session.enrollment.storeId}
              // The prices on this till are the copy's.
              pricedAt={session.snapshot.fetchedAt}
              company={{
                name: session.snapshot.receipt?.name || session.snapshot.store.name,
                address: session.snapshot.receipt?.address ?? '',
                phone: session.snapshot.receipt?.phone ?? '',
                receiptFooter: session.snapshot.receipt?.receiptFooter ?? '',
                logoUrl: session.snapshot.receipt?.logoUrl || undefined,
              }}
              gcash={{ number: '', accountName: '' }}
              canEditStoreSettings={false}
              canCreateProducts={false}
              canEditProduct={false}
              categoryChips={{
                total: session.snapshot.products.length,
                lowStock: session.lowStock,
                categories: session.snapshot.categories
                  .map((category) => ({ ...category, count: session.snapshot.products.filter((p) => p.categoryId === category.id).length }))
                  .filter((category) => category.count > 0),
              }}
              lowStockLevel={session.snapshot.lowStockLevel ?? 0}
              openShift={session.snapshot.openShift}
              suggestedOpeningCash={0}
              offlineMode
            />
          </>
        )}
      </main>
    </div>
  );
}

function StateCard({
  icon: Icon,
  title,
  message,
  pending,
  children,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  title: string;
  message: string;
  pending: number;
  children?: React.ReactNode;
}) {
  return (
    <Card className="mx-auto mt-8 max-w-md p-8 text-center">
      <Icon className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
      <h1 className="font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <PendingNote pending={pending} />
      {children}
    </Card>
  );
}

function PendingNote({ pending }: { pending: number }) {
  if (pending <= 0) return null;
  return (
    <p role="status" className="mt-3 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-xs text-info-text">
      {pending === 1 ? '1 sale is' : `${pending} sales are`} saved on this device, waiting to sync. They are kept until the server has them.
    </p>
  );
}

function UnlockForm({
  pending,
  notice,
  onUnlocked,
  onErased,
}: {
  pending: number;
  notice: string | null;
  onUnlocked: (enrollment: UnlockEnrollment) => Promise<void>;
  onErased: () => void;
}) {
  const [username, setUsername] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(notice);
  const [waitUntil, setWaitUntil] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const usernameRef = React.useRef<HTMLInputElement>(null);
  const pinRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!waitUntil) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= waitUntil) setWaitUntil(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [waitUntil]);

  const waiting = waitUntil !== null && waitUntil > now;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || waiting || !username.trim() || !pin) return;
    setBusy(true);
    setError(null);
    try {
      const result = await unlockOffline(await openLocalDb(), username, pin);
      setPin('');
      switch (result.kind) {
        case 'ok':
          await onUnlocked(result.enrollment);
          return;
        case 'wrong':
          setError(result.waitUntil ? `${BAD_CREDENTIALS} Too many attempts: try again in ${minutesText(result.waitUntil - Date.now())}.` : BAD_CREDENTIALS);
          if (result.waitUntil) setWaitUntil(result.waitUntil);
          break;
        case 'wait':
          setError(`Too many attempts. Try again in ${minutesText(result.until - Date.now())}.`);
          setWaitUntil(result.until);
          break;
        case 'clock':
          setError('This device’s clock has been changed. Connect to the internet to continue.');
          break;
        case 'erased':
          onErased();
          return;
      }
      pinRef.current?.focus();
    } catch {
      setError('This browser cannot check the PIN offline.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-8 w-full max-w-sm space-y-5 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="text-lg font-semibold">Offline sign-in</h1>
        <p className="text-sm text-muted-foreground">No connection. Sign in with your username and screen-lock PIN to keep selling for cash.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div aria-live="assertive">
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
              {error}
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="offline-username">Username</Label>
          <Input
            ref={usernameRef}
            id="offline-username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="h-12"
            value={username}
            disabled={busy}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="offline-pin">PIN</Label>
          <Input
            ref={pinRef}
            id="offline-pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={PIN_MAX_LENGTH}
            className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
            value={pin}
            disabled={busy}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={waiting || !username.trim() || !pin}>
          {waiting && waitUntil ? `Try again in ${minutesText(waitUntil - now)}` : 'Unlock till'}
        </Button>
      </form>

      <PendingNote pending={pending} />
      <p className="text-xs text-muted-foreground">
        Only cashiers who allowed offline unlock on this device, while online, can sign in here. Checking the PIN takes a moment.
      </p>
    </div>
  );
}

/**
 * The connection is back. Hands over to the full till only under the same
 * cashier's server session; otherwise the cashier signs in properly first.
 */
function ReconnectNotice({ userId }: { userId: string | null }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const openFullTill = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/pos/session', { credentials: 'same-origin', cache: 'no-store', redirect: 'manual' });
      if (response.status === 200) {
        const body = (await response.json()) as { user?: { id: string; mustChangePassword?: boolean } };
        if (userId && body.user?.id === userId && !body.user.mustChangePassword) {
          window.location.assign('/pos');
          return;
        }
        // Someone else is signed in on this browser: they are signed out first,
        // so the cashier at the counter never carries on as them. (The same
        // cashier with a pending password change keeps their session; the
        // app sends them to change it.)
        if (body.user?.id !== userId) await authClient.signOut().catch(() => undefined);
        window.location.assign('/sign-in?next=%2Fpos');
        return;
      }
      if (response.status === 401 || response.type === 'opaqueredirect') {
        window.location.assign('/sign-in?next=%2Fpos');
        return;
      }
      setError('The server is not answering yet. Keep selling here and try again shortly.');
    } catch {
      setError('The server is not answering yet. Keep selling here and try again shortly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="border-b border-info/30 bg-info/10 px-4 py-2 text-center text-sm text-info-text">
      The connection is back.{' '}
      {/* Never automatic: with the server down the browser can still report a connection. */}
      <button type="button" className="font-semibold underline underline-offset-2 disabled:opacity-60" onClick={openFullTill} disabled={busy}>
        {userId ? 'Open the full till' : 'Sign in online'}
      </button>{' '}
      {userId ? 'between sales.' : ''}
      {error && <span className="block text-xs">{error}</span>}
    </div>
  );
}
