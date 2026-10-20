'use client';

import * as React from 'react';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { allowedUnlockMethods } from '@/lib/pos-pin';
import { lockSession } from '@/features/auth/lock-actions';
import { LockScreen } from '@/features/auth/lock-screen';

interface ScreenLockContextValue {
  lock: () => void;
}

const ScreenLockContext = React.createContext<ScreenLockContextValue | null>(null);

/** `null` outside the authenticated shell. */
export function useScreenLock(): ScreenLockContextValue | null {
  return React.useContext(ScreenLockContext);
}

const CHANNEL = 'ims-screen-lock';
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Covers the app with the lock screen without unmounting it, so a POS sale in
 * progress is exactly where the cashier left it after unlocking.
 *
 * The overlay appears immediately; the server is told in the background and
 * from then on refuses every page and action for this session. The page
 * underneath is `inert`, so neither the keyboard nor a barcode scanner can
 * reach it while locked.
 *
 * `autoLockMinutes` comes from Settings › Security and is 0 (off) by default.
 */
export function ScreenLockProvider({
  user,
  autoLockMinutes,
  children,
}: {
  user: { name: string; username: string; hasPin: boolean };
  autoLockMinutes: number;
  children: React.ReactNode;
}) {
  const [locked, setLocked] = React.useState(false);
  const channelRef = React.useRef<BroadcastChannel | null>(null);

  const showLock = React.useCallback(() => {
    setLocked(true);
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, []);

  const lock = React.useCallback(() => {
    showLock();
    channelRef.current?.postMessage('lock');
    void lockSession().then((result) => {
      if (!result.ok) {
        // The overlay stays up either way, and unlocking always checks the
        // PIN or password on the server — so a failed request here only means
        // a refresh will not show the lock screen until the network is back.
        toast.warning('Locked on this screen only — the server could not be reached.');
      }
    });
  }, [showLock]);

  // Keep every open tab of this browser in step.
  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event) => {
      if (event.data === 'lock') showLock();
      if (event.data === 'unlock') setLocked(false);
    };
    channelRef.current = channel;
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [showLock]);

  // Optional idle auto-lock.
  React.useEffect(() => {
    if (!(autoLockMinutes > 0) || locked) return;
    let timer = window.setTimeout(lock, autoLockMinutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, autoLockMinutes * 60_000);
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, reset);
    };
  }, [autoLockMinutes, locked, lock]);

  const onUnlocked = React.useCallback(() => {
    setLocked(false);
    channelRef.current?.postMessage('unlock');
  }, []);

  const value = React.useMemo(() => ({ lock }), [lock]);

  return (
    <ScreenLockContext.Provider value={value}>
      <div inert={locked} aria-hidden={locked || undefined}>
        {children}
      </div>
      {locked && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Screen locked"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-md"
        >
          <LockScreen
            name={user.name}
            username={user.username}
            initialMethods={allowedUnlockMethods(user.hasPin, 0)}
            onUnlocked={onUnlocked}
          />
        </div>
      )}
    </ScreenLockContext.Provider>
  );
}

/** Header button for locking the screen in one tap. */
export function LockScreenButton() {
  const screenLock = useScreenLock();
  if (!screenLock) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-10 w-10 text-muted-foreground hover:text-foreground"
      onClick={screenLock.lock}
      aria-label="Lock screen"
      title="Lock screen"
    >
      <Lock className="h-4.5 w-4.5" />
    </Button>
  );
}
