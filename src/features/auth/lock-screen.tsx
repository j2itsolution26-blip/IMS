'use client';

import * as React from 'react';
import { Eye, EyeOff, Lock, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from '@/components/form';
import { Avatar, AvatarFallback } from '@/components/ui/misc';
import { authClient } from '@/lib/auth-client';
import { PIN_MAX_LENGTH, type UnlockMethod } from '@/lib/pos-pin';
import { initials } from '@/lib/utils';
import { unlockSession } from '@/features/auth/lock-actions';

/**
 * The lock screen card: unlock with the PIN (or the password), or sign out so
 * someone else can sign in.
 *
 * Used both as the in-page overlay (so the POS cart underneath survives) and
 * on /locked (when the page was loaded fresh while locked). The server decides
 * which methods are still allowed after each wrong attempt.
 */
export function LockScreen({
  name,
  username,
  initialMethods,
  onUnlocked,
}: {
  name: string;
  username: string;
  initialMethods: UnlockMethod[];
  onUnlocked: () => void;
}) {
  const [methods, setMethods] = React.useState<UnlockMethod[]>(initialMethods);
  const [method, setMethod] = React.useState<UnlockMethod>(initialMethods[0] ?? 'password');
  const [secret, setSecret] = React.useState('');
  const [showSecret, setShowSecret] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, [method]);

  const signOut = async () => {
    setBusy(true);
    await authClient.signOut().catch(() => undefined);
    window.location.href = '/sign-in';
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!secret || busy) return;
    setBusy(true);
    setError(null);

    const result = await unlockSession({ method, secret });
    setBusy(false);
    setSecret('');

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.unlocked) {
      onUnlocked();
      return;
    }

    setError(result.data.message ?? 'That did not work.');
    setMethods(result.data.methods);
    if (result.data.methods.length === 0) {
      // The server revoked the session after too many wrong attempts.
      setTimeout(() => {
        window.location.href = '/sign-in';
      }, 1500);
      return;
    }
    if (!result.data.methods.includes(method)) setMethod(result.data.methods[0]);
    inputRef.current?.focus();
  };

  const isPin = method === 'pin';
  const other = methods.find((candidate) => candidate !== method);

  return (
    <div className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6 shadow-lg sm:p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative">
          <Avatar className="h-16 w-16 text-lg">
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground">
            <Lock className="h-3.5 w-3.5" />
          </span>
        </div>
        <div>
          <h1 className="text-lg font-semibold">Screen locked</h1>
          <p className="text-sm text-muted-foreground">
            {name} · <span className="font-mono">{username}</span>
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={error} />

        <div className="space-y-2">
          <Label htmlFor="unlock-secret">{isPin ? 'PIN' : 'Password'}</Label>
          <div className="relative">
            <Input
              ref={inputRef}
              id="unlock-secret"
              type={showSecret ? 'text' : 'password'}
              inputMode={isPin ? 'numeric' : undefined}
              pattern={isPin ? '[0-9]*' : undefined}
              maxLength={isPin ? PIN_MAX_LENGTH : 128}
              autoComplete={isPin ? 'off' : 'current-password'}
              className={isPin ? 'h-12 pr-12 text-center font-mono text-2xl tracking-[0.5em]' : 'h-12 pr-12'}
              value={secret}
              disabled={busy || methods.length === 0}
              onChange={(e) => setSecret(isPin ? e.target.value.replace(/\D/g, '') : e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowSecret((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={showSecret ? `Hide ${isPin ? 'PIN' : 'password'}` : `Show ${isPin ? 'PIN' : 'password'}`}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!secret || methods.length === 0}>
          Unlock
        </Button>

        <div className="flex items-center justify-between gap-2 text-sm">
          {other ? (
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setMethod(other);
                setSecret('');
                setError(null);
              }}
            >
              Use {other === 'pin' ? 'PIN' : 'password'} instead
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={signOut}
            disabled={busy}
          >
            <LogOut className="h-3.5 w-3.5" /> Switch user
          </button>
        </div>
      </form>
    </div>
  );
}
