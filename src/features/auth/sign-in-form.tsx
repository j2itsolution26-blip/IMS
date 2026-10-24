'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Eye, EyeOff, Fingerprint, Loader2, Lock, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { isEmailIdentifier, normalizeUsername } from '@/lib/username';
import { isSafeReturnPath } from '@/lib/safe-path';
import {
  deviceCanCreatePasskey,
  passkeyCount,
  passkeysSupported,
  signInWithPasskey,
} from '@/features/auth/passkey-client';
import { PasskeyOffer } from '@/features/auth/passkey-offer';

// Deliberately loose: whether the identifier is a well-formed username or
// email is the server's call, and every way of getting it wrong must end in
// the same generic message.
const schema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email.'),
  password: z.string().min(1, 'Password is required.'),
});

const INVALID_CREDENTIALS = 'Invalid username/email or password.';

type FormValues = z.infer<typeof schema>;

/** "Not now" on the passkey offer, remembered on this device for a month. */
const OFFER_DISMISSED_KEY = 'tpm.passkey-offer.dismissed-at';
const OFFER_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function offerSnoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(OFFER_DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < OFFER_SNOOZE_MS;
  } catch {
    return false;
  }
}

function snoozeOffer() {
  try {
    window.localStorage.setItem(OFFER_DISMISSED_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the offer simply comes back next time.
  }
}

export function SignInForm({
  redirectTo,
  passkeysEnabled = false,
}: {
  redirectTo: string;
  /** Decided on the server: passkeys are configured for the origin this page is served on. */
  passkeysEnabled?: boolean;
}) {
  const [formError, setFormError] = React.useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = React.useState(false);
  // Unknown until mounted, so the server and the first client render agree.
  const [passkeySupport, setPasskeySupport] = React.useState<'unknown' | 'yes' | 'no'>('unknown');
  // Set after a password sign-in on a device that could hold a passkey.
  const [offerPasskey, setOfferPasskey] = React.useState(false);
  const identifierRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (passkeysEnabled) setPasskeySupport(passkeysSupported() ? 'yes' : 'no');
  }, [passkeysEnabled]);

  const destination = isSafeReturnPath(redirectTo) ? redirectTo : '/dashboard';
  // Hard navigation so the new session cookie is picked up by every
  // server component on the destination page.
  const goToApp = React.useCallback(() => {
    window.location.href = destination;
  }, [destination]);
  const [showPassword, setShowPassword] = React.useState(false);
  // On by default: a store counter should stay signed in between customers.
  // Untick on a shared or borrowed device to end the session with the browser.
  const [rememberMe, setRememberMe] = React.useState(true);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    // One account system, two ways to name it. An `@` never appears in a
    // username, so it decides which Better Auth endpoint checks the password.
    const identifier = values.identifier.trim();
    const { error } = isEmailIdentifier(identifier)
      ? await authClient.signIn.email({
          email: identifier.toLowerCase(),
          password: values.password,
          rememberMe,
        })
      : await authClient.signIn.username({
          username: normalizeUsername(identifier),
          password: values.password,
          rememberMe,
        });

    if (error) {
      // Never distinguish "no such user", "malformed username", "deactivated"
      // or "wrong password" — that turns the login form into an account
      // enumeration oracle.
      if (error.status === 400 || error.status === 401 || error.status === 403 || error.status === 422) {
        setFormError(INVALID_CREDENTIALS);
        return;
      }

      // Anything else is a server-side fault, not the user's mistake. Surfacing
      // the status makes a misconfigured deployment diagnosable instead of
      // looking like a rejected password. This leaks nothing about the account.
      const status = error.status ? ` (HTTP ${error.status})` : '';
      setFormError(
        error.message
          ? `${error.message}${status}`
          : `The server could not process the sign-in${status}. This usually means the deployment is misconfigured rather than a problem with your credentials.`,
      );
      return;
    }

    // Signed in. Offer a passkey once, on a device that can hold one, to an
    // account that has none yet — otherwise straight into the app.
    if (passkeysEnabled && !offerSnoozed() && (await deviceCanCreatePasskey()) && (await passkeyCount()) === 0) {
      setOfferPasskey(true);
      return;
    }
    goToApp();
  });

  const onPasskeySignIn = async () => {
    setFormError(null);
    setPasskeyBusy(true);
    const outcome = await signInWithPasskey({ rememberMe });
    if (outcome.ok) {
      goToApp();
      return;
    }
    // A failed passkey never falls through to a password attempt; the user
    // chooses what to do next.
    setPasskeyBusy(false);
    setFormError(outcome.message);
  };

  const { ref: identifierFieldRef, ...identifierField } = register('identifier');
  const busy = isSubmitting || passkeyBusy;

  if (offerPasskey) {
    return (
      <PasskeyOffer
        onDone={goToApp}
        onNotNow={() => {
          snoozeOffer();
          goToApp();
        }}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {/* ── Form-level error ── */}
      {formError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/8 p-3.5 text-sm text-destructive-text dark:bg-destructive/15"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {/* ── Username or email field ── */}
      <div className="space-y-2">
        <Label htmlFor="identifier" className="text-sm font-medium">
          Username or email
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <User className="h-4 w-4" />
          </span>
          <input
            id="identifier"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            placeholder="Enter your username or email"
            aria-invalid={Boolean(errors.identifier)}
            aria-describedby={errors.identifier ? 'identifier-error' : undefined}
            className={cn(
              'flex h-12 w-full rounded-lg border border-input bg-transparent pl-10 pr-4 text-sm shadow-sm transition-colors',
              'placeholder:text-muted-foreground/60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50',
              errors.identifier && 'border-destructive focus-visible:ring-destructive',
            )}
            {...identifierField}
            ref={(element) => {
              identifierFieldRef(element);
              identifierRef.current = element;
            }}
          />
        </div>
        {errors.identifier && (
          <p id="identifier-error" className="text-xs text-destructive-text" role="alert">
            {errors.identifier.message}
          </p>
        )}
      </div>

      {/* ── Password field ── */}
      <div className="space-y-2">
        <Label htmlFor="password" className="text-sm font-medium">
          Password
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Lock className="h-4 w-4" />
          </span>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Enter your password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'password-error' : undefined}
            className={cn(
              'flex h-12 w-full rounded-lg border border-input bg-transparent pl-10 pr-12 text-sm shadow-sm transition-colors',
              'placeholder:text-muted-foreground/60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50',
              errors.password && 'border-destructive focus-visible:ring-destructive',
            )}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password && (
          <p id="password-error" className="text-xs text-destructive-text" role="alert">
            {errors.password.message}
          </p>
        )}
      </div>

      {/* ── Remember me row ── */}
      <div className="flex items-center">
        <button
          id="remember-device"
          type="button"
          role="checkbox"
          aria-checked={rememberMe}
          aria-labelledby="remember-device-label"
          onClick={() => setRememberMe((prev) => !prev)}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            rememberMe
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input',
          )}
        >
          {rememberMe && (
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <span
          id="remember-device-label"
          className="ml-2 cursor-pointer select-none text-sm text-muted-foreground"
          onClick={() => setRememberMe((prev) => !prev)}
        >
          Remember this device
        </span>
      </div>

      {/* ── Submit button ── */}
      <Button
        type="submit"
        className="h-12 w-full rounded-lg text-sm font-medium"
        disabled={busy}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          'Sign In'
        )}
      </Button>

      {/* ── Passkey sign-in ── */}
      {passkeysEnabled && (
        <div className="space-y-3">
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={onPasskeySignIn}
            disabled={busy || passkeySupport === 'no'}
            aria-describedby="passkey-hint"
            className="h-12 w-full rounded-lg border-primary/60 text-sm font-medium text-primary hover:border-primary hover:bg-primary/5 hover:text-primary"
          >
            {passkeyBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for your device…
              </>
            ) : (
              <>
                <Fingerprint className="h-5 w-5" aria-hidden="true" />
                Sign in with a passkey
              </>
            )}
          </Button>

          <p id="passkey-hint" className="text-center text-xs text-muted-foreground">
            {passkeySupport === 'no'
              ? 'This browser does not support passkeys. Use your username and password.'
              : 'Use Face ID, fingerprint, or your device screen lock.'}
          </p>

          {formError && passkeySupport !== 'no' && (
            <p className="text-center text-xs">
              <button
                type="button"
                className="inline-flex min-h-9 items-center font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => {
                  setFormError(null);
                  identifierRef.current?.focus();
                }}
              >
                Use username and password instead
              </button>
            </p>
          )}
        </div>
      )}
    </form>
  );
}
