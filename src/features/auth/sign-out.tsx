'use client';

import * as React from 'react';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { authClient } from '@/lib/auth-client';
import { APP_NAME } from '@/lib/brand';
import { performSignOut } from '@/features/auth/sign-out-flow';

/**
 * Sign out through Better Auth, which deletes the session row on the server.
 * A second call while one is in flight is ignored.
 */
export function useSignOut() {
  const [pending, setPending] = React.useState(false);
  const inFlight = React.useRef(false);

  const signOut = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const outcome = await performSignOut(
      () => authClient.signOut(),
      // `replace` so Back does not return to a page of the signed-out account.
      (url) => window.location.replace(url),
    );
    if (!outcome.ok) {
      toast.error(outcome.message);
      inFlight.current = false;
      setPending(false);
    }
    // On success the page is unloading; leaving `pending` set keeps the
    // button disabled until it does.
  }, []);

  return { signOut, pending };
}

/** "Sign out of …?" confirmation. Cannot be dismissed while signing out. */
export function SignOutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { signOut, pending } = useSignOut();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={`Sign out of ${APP_NAME}?`}
      description="You'll need to sign in again to access your account."
      confirmLabel="Sign out"
      loadingLabel="Signing out…"
      icon={LogOut}
      loading={pending}
      onConfirm={signOut}
    />
  );
}
