'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Fingerprint, KeyRound, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { formatDateTime } from '@/lib/format';
import { passkeysSupported, registerPasskey } from '@/features/auth/passkey-client';
import { removePasskey, renamePasskey } from '@/features/auth/passkey-actions';

export interface PasskeyRow {
  id: string;
  name: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The signed-in user's passkeys: add another device, rename one, or remove it.
 * The list itself is read on the server for this user only.
 */
export function PasskeysManager({ passkeys, available }: { passkeys: PasskeyRow[]; available: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [supported, setSupported] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<PasskeyRow | null>(null);
  const [removeBusy, setRemoveBusy] = React.useState(false);

  React.useEffect(() => setSupported(passkeysSupported()), []);

  const add = async () => {
    setAdding(true);
    setError(null);
    const outcome = await registerPasskey();
    setAdding(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    toast.success(`Passkey added${outcome.name ? ` (${outcome.name})` : ''}.`);
    router.refresh();
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    const result = await removePasskey(removing.id);
    setRemoveBusy(false);
    setRemoving(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Passkey removed.');
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {passkeys.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No passkeys yet. Add one to sign in with Face ID, your fingerprint, or this device&apos;s screen lock.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {passkeys.map((passkey) => (
            <PasskeyItem key={passkey.id} passkey={passkey} onRemove={() => setRemoving(passkey)} />
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {available ? (
        <div className="space-y-1.5">
          <Button type="button" variant="outline" onClick={add} disabled={adding || !supported} className="h-10">
            {adding ? <Loader2 className="animate-spin" /> : <Fingerprint />}
            {passkeys.length === 0 ? 'Create a passkey' : 'Add another device'}
          </Button>
          <p className="text-xs text-muted-foreground">
            {supported
              ? 'Passkeys are made for this site only. Synced passkeys (iCloud Keychain, Google Password Manager) also work on your other devices.'
              : 'This browser does not support passkeys.'}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Passkeys can only be added on the store&apos;s main web address. Open the app there to add one.
        </p>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this passkey?"
        description={`"${removing?.name ?? 'Passkey'}" will no longer sign you in. Your password still works, and the passkey may also need removing from the device's own settings.`}
        confirmLabel="Remove passkey"
        destructive
        loading={removeBusy}
        onConfirm={confirmRemove}
      />
    </div>
  );
}

function PasskeyItem({ passkey, onRemove }: { passkey: PasskeyRow; onRemove: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(passkey.name ?? '');
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    const result = await renamePasskey({ id: passkey.id, name });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setEditing(false);
    router.refresh();
  };

  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <KeyRound className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              aria-label="Passkey name"
              className="h-9"
              autoFocus
            />
            <Button type="submit" size="icon" variant="ghost" className="h-9 w-9 shrink-0" disabled={saving} aria-label="Save name">
              {saving ? <Loader2 className="animate-spin" /> : <Check />}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              onClick={() => {
                setEditing(false);
                setName(passkey.name ?? '');
              }}
              aria-label="Cancel renaming"
            >
              <X />
            </Button>
          </form>
        ) : (
          <>
            <p className="truncate text-sm font-medium">{passkey.name ?? 'Passkey'}</p>
            <p className="truncate text-xs text-muted-foreground">
              Added {formatDateTime(passkey.createdAt)}
              {passkey.lastUsedAt ? ` · last used ${formatDateTime(passkey.lastUsedAt)}` : ' · not used yet'}
              {passkey.backedUp ? ' · synced' : ''}
            </p>
          </>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 gap-0.5">
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9" onClick={() => setEditing(true)} aria-label={`Rename ${passkey.name ?? 'passkey'}`}>
            <Pencil />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 text-destructive hover:text-destructive"
            onClick={onRemove}
            aria-label={`Remove ${passkey.name ?? 'passkey'}`}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </li>
  );
}
