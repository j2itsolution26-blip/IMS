'use client';

import * as React from 'react';
import { AlertCircle, Fingerprint, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { registerPasskey } from '@/features/auth/passkey-client';

/**
 * Offered once after a password sign-in. The passkey is created on this
 * device's own prompt (Face ID, fingerprint, screen lock); either way the user
 * then continues into the app.
 */
export function PasskeyOffer({ onDone, onNotNow }: { onDone: () => void; onNotNow: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    const outcome = await registerPasskey();
    setBusy(false);
    if (outcome.ok) {
      setCreated(true);
      // Long enough to read the confirmation.
      setTimeout(onDone, 1200);
      return;
    }
    setError(outcome.message);
  };

  return (
    <section aria-labelledby="passkey-offer-title" className="space-y-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Fingerprint className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="space-y-1.5">
        <h2 id="passkey-offer-title" className="text-lg font-semibold tracking-tight">
          Make signing in easier with a passkey
        </h2>
        <p className="text-sm text-muted-foreground">
          Next time, sign in with Face ID, your fingerprint, or this device&apos;s screen lock instead of typing your
          password. Your face and fingerprint never leave this device.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 p-3.5 text-sm text-destructive-text dark:bg-destructive/15"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {created && (
        <p role="status" className="rounded-lg border border-success/30 bg-success/10 p-3.5 text-sm text-success-text">
          Passkey created. You can manage your passkeys from your profile.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" className="h-12 rounded-lg text-sm font-medium" onClick={create} disabled={busy || created}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" aria-hidden="true" />}
          Create a passkey
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 rounded-lg text-sm font-medium"
          disabled={busy || created}
          onClick={onNotNow}
        >
          Not now
        </Button>
      </div>
    </section>
  );
}
