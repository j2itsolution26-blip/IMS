'use client';

import * as React from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatDateTime } from '@/lib/format';
import { PIN_MAX_LENGTH } from '@/lib/pos-pin';
import type { UnlockEnrollment } from '@/lib/offline-unlock';
import { openLocalDb } from '@/features/offline/local-db';
import { enrollDevice, enrollmentFor } from '@/features/offline/offline-unlock';
import { removeOfflineAccessHere, useOfflineCatalog } from '@/features/offline/catalog-client';

/**
 * "Unlock without internet" in the till's device dialog: lets the signed-in
 * cashier allow offline unlock on this device with their lock-screen PIN
 * (checked by the server once), shows whether it is set up, and removes this
 * cashier's offline access from the device.
 */
export function OfflineUnlockSetup({ storeId, userId, online }: { storeId: string; userId: string; online: boolean }) {
  const catalog = useOfflineCatalog();
  const [enrollment, setEnrollment] = React.useState<UnlockEnrollment | null | undefined>(undefined);
  const [pin, setPin] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setEnrollment(await enrollmentFor(await openLocalDb(), storeId, userId));
    } catch {
      setEnrollment(null);
    }
  }, [storeId, userId]);

  // Reload when the copy changes: a refresh drops an unlock made with an old PIN.
  React.useEffect(() => {
    void load();
  }, [load, catalog.snapshot?.fetchedAt]);

  const onEnroll = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !pin) return;
    setBusy(true);
    setError(null);
    try {
      const result = await enrollDevice(await openLocalDb(), { storeId, userId }, pin);
      setPin('');
      if (result.ok) {
        setEnrollment(result.enrollment);
        toast.success('Offline unlock is ready on this device.');
      } else {
        setError(result.message);
      }
    } catch {
      setError('This browser cannot store offline unlock.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await removeOfflineAccessHere(storeId, userId);
      setEnrollment(null);
      setConfirmRemove(false);
      toast.success('Offline access removed from this device. Unsent sales are kept.');
    } catch {
      toast.error('Could not remove offline access from this device.');
    } finally {
      setBusy(false);
    }
  };

  const prepared = Boolean(catalog.snapshot);

  return (
    <section aria-labelledby="offline-unlock-heading" className="space-y-2 rounded-lg border px-3 py-2">
      <h3 id="offline-unlock-heading" className="flex items-center gap-1.5 text-sm font-semibold">
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Unlock without internet
      </h3>

      {enrollment ? (
        <p className="text-xs text-success-text">
          Ready: with no connection, you can open this till with your username and PIN (set up {formatDateTime(new Date(enrollment.enrolledAt))}).
        </p>
      ) : enrollment === null ? (
        prepared ? (
          <form onSubmit={onEnroll} className="space-y-2" noValidate>
            <p className="text-xs text-muted-foreground">
              Allow this device to open the till with your screen-lock PIN when the internet is down. Your PIN is checked by the server now;
              the device keeps only a protected check value, never the PIN.
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="offline-unlock-pin" className="text-xs">
                  Your PIN
                </Label>
                <Input
                  id="offline-unlock-pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  maxLength={PIN_MAX_LENGTH}
                  className="h-9 font-mono tracking-[0.3em]"
                  value={pin}
                  disabled={busy || !online}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <Button type="submit" size="sm" className="h-9" loading={busy} disabled={!online || !pin}>
                Allow
              </Button>
            </div>
            {!online && <p className="text-xs text-warning-text">Needs a connection.</p>}
            {error && (
              <p role="alert" className="text-xs text-destructive-text">
                {error}
              </p>
            )}
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">Prepare this device first, then allow offline unlock with your PIN.</p>
        )
      ) : null}

      {(enrollment || prepared) && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive-text" onClick={() => setConfirmRemove(true)} disabled={busy}>
          <Trash2 className="h-3.5 w-3.5" /> Remove offline access from this device
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        Signing out keeps offline access, protected by your PIN, until it expires. Remove it on a shared or lost-risk device.
      </p>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={(next) => {
          if (!busy) setConfirmRemove(next);
        }}
        title="Remove offline access from this device?"
        description="Your price list and offline unlock leave this device, and it can no longer open your till without internet until you prepare it again. Sales not yet sent are kept and sent when you are online."
        confirmLabel="Remove"
        loadingLabel="Removing…"
        icon={Trash2}
        loading={busy}
        onConfirm={onRemove}
      />
    </section>
  );
}
