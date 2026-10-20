'use client';

import {
  WebAuthnAbortService,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

/**
 * Browser side of the passkey ceremonies in `src/lib/passkey-plugin.ts`.
 *
 * The browser and operating system run the Face ID, fingerprint or screen-lock
 * prompt; this code never sees biometric data, only the signed response,
 * which the server verifies before anything is trusted.
 *
 * Requests use same-origin relative URLs, so they work whichever hostname the
 * app was opened on; the server decides whether that origin may use passkeys.
 */

export type PasskeyOutcome =
  | { ok: true }
  | { ok: false; kind: 'cancelled' | 'unsupported' | 'not-registered' | 'unavailable' | 'failed'; message: string };

const MESSAGES = {
  cancelled: 'Passkey sign-in was cancelled or timed out. Try again, or use your username and password.',
  unsupported: 'This browser or device does not support passkeys. Sign in with your username and password.',
  failed: 'Passkey sign-in failed. Try again, or sign in with your username and password.',
  registerCancelled: 'Passkey setup was cancelled. You can add one later from your profile.',
  registerFailed: 'The passkey could not be created. Try again, or add one later from your profile.',
} as const;

/** Synchronous and SSR-safe: false on the server and on browsers without WebAuthn. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && browserSupportsWebAuthn();
}

/** True when this device has a built-in authenticator (Face ID, Touch ID, Windows Hello, …). */
export async function deviceCanCreatePasskey(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

async function post(path: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(`/api/auth${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, data };
}

function serverMessage(data: Record<string, unknown>, fallback: string): string {
  return typeof data.message === 'string' && data.message ? data.message : fallback;
}

/**
 * WebAuthn reports a cancelled prompt, a timeout and "no passkey on this
 * device" all as NotAllowedError, deliberately, so a site cannot probe which
 * passkeys exist. The message has to cover all three.
 */
function isCancellation(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

export async function signInWithPasskey({ rememberMe }: { rememberMe: boolean }): Promise<PasskeyOutcome> {
  if (!passkeysSupported()) return { ok: false, kind: 'unsupported', message: MESSAGES.unsupported };

  const options = await post('/passkey/authentication-options').catch(() => null);
  if (!options?.ok) {
    const unavailable = options?.data.code === 'PASSKEYS_UNAVAILABLE';
    return {
      ok: false,
      kind: unavailable ? 'unavailable' : 'failed',
      message: serverMessage(options?.data ?? {}, MESSAGES.failed),
    };
  }

  let assertion;
  try {
    // Cancels any earlier prompt still waiting, so a second tap starts afresh.
    WebAuthnAbortService.cancelCeremony();
    assertion = await startAuthentication({ optionsJSON: options.data as never });
  } catch (error) {
    return isCancellation(error)
      ? { ok: false, kind: 'cancelled', message: MESSAGES.cancelled }
      : { ok: false, kind: 'failed', message: MESSAGES.failed };
  }

  const verified = await post('/passkey/verify-authentication', { response: assertion, rememberMe }).catch(() => null);
  if (!verified?.ok) {
    const notRegistered = verified?.data.code === 'PASSKEY_NOT_REGISTERED';
    return {
      ok: false,
      kind: notRegistered ? 'not-registered' : 'failed',
      message: serverMessage(verified?.data ?? {}, MESSAGES.failed),
    };
  }
  return { ok: true };
}

/** Creates a passkey for the signed-in account. The server attaches it to that account only. */
export async function registerPasskey(name?: string): Promise<PasskeyOutcome & { name?: string }> {
  if (!passkeysSupported()) return { ok: false, kind: 'unsupported', message: MESSAGES.unsupported };

  const options = await post('/passkey/registration-options').catch(() => null);
  if (!options?.ok) {
    return {
      ok: false,
      kind: options?.data.code === 'PASSKEYS_UNAVAILABLE' ? 'unavailable' : 'failed',
      message:
        options?.data.code === 'SESSION_NOT_FRESH'
          ? 'For your security, sign out and sign in again with your password, then add the passkey.'
          : serverMessage(options?.data ?? {}, MESSAGES.registerFailed),
    };
  }

  let attestation;
  try {
    WebAuthnAbortService.cancelCeremony();
    attestation = await startRegistration({ optionsJSON: options.data as never });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    // The device already holds a passkey for this account (excludeCredentials).
    if (name === 'InvalidStateError') {
      return { ok: false, kind: 'failed', message: 'This device already has a passkey for your account.' };
    }
    return isCancellation(error)
      ? { ok: false, kind: 'cancelled', message: MESSAGES.registerCancelled }
      : { ok: false, kind: 'failed', message: MESSAGES.registerFailed };
  }

  const saved = await post('/passkey/verify-registration', { response: attestation, name }).catch(() => null);
  if (!saved?.ok) {
    return { ok: false, kind: 'failed', message: serverMessage(saved?.data ?? {}, MESSAGES.registerFailed) };
  }
  return { ok: true, name: typeof saved.data.name === 'string' ? saved.data.name : undefined };
}

/** Passkeys on the signed-in account; null when it could not be checked. */
export async function passkeyCount(): Promise<number | null> {
  try {
    const response = await fetch('/api/auth/passkey/status', { credentials: 'same-origin' });
    if (!response.ok) return null;
    const data = (await response.json()) as { count?: unknown };
    return typeof data.count === 'number' ? data.count : null;
  } catch {
    return null;
  }
}
