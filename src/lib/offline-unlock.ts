import type { CatalogSnapshot } from '@/lib/offline-catalog';

/**
 * Offline unlock: opening a prepared till with the cashier's PIN when the
 * server cannot be reached.
 *
 * The PIN is the cashier's own lock-screen PIN. The server checks it once,
 * online, when the cashier allows offline unlock on a device ("enrolment").
 * The device then keeps only a PBKDF2-SHA-256 verifier of it, made with the
 * browser's WebCrypto, with a random salt. Never the PIN, the account
 * password or any server hash.
 *
 * This is a counter-side gate, not hardware security. Anyone who copies the
 * browser's storage can try every 4-6 digit PIN against the verifier on their
 * own computer, and anyone with developer tools on an unlocked device can
 * step around checks that run in the browser. See docs/offline-pos.md.
 *
 * Pure apart from WebCrypto (`globalThis.crypto.subtle`, present in browsers
 * and in Node), so it is unit-tested directly.
 */

/** OWASP's figure for PBKDF2-HMAC-SHA256. Stored with each verifier, so it can be raised later. */
export const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const VERIFIER_BITS = 256;

/** Wrong PINs in a row, across every cashier on the device, before unlock pauses. */
export const LOCKOUT_FREE_ATTEMPTS = 5;
export const LOCKOUT_FIRST_WAIT_MS = 60_000;
export const LOCKOUT_MAX_WAIT_MS = 30 * 60_000;
/** Wrong PINs in a row after which every offline unlock on the device is erased. */
export const ERASE_AFTER_FAILURES = 15;
/** How far the device clock may step back before unlock is refused. */
export const CLOCK_TOLERANCE_MS = 5 * 60_000;

/** One cashier allowed to unlock this device offline. */
export interface UnlockEnrollment {
  /** `${storeId}:${userId}`, the same key as the cashier's catalogue copy. */
  key: string;
  storeId: string;
  userId: string;
  /** Normalised (lowercase) sign-in name, what the cashier types offline. */
  username: string;
  name: string;
  deviceId: string;
  /** Base64. */
  salt: string;
  iterations: number;
  /** Base64 PBKDF2 output. */
  verifier: string;
  /** The server's fingerprint of the PIN when it was checked; a change means the PIN changed. */
  fingerprint: string;
  enrolledAt: string;
}

/**
 * Device-wide unlock state, kept in `meta`. Counted for the whole device and
 * not per cashier, so the lockout says nothing about which usernames exist.
 */
export interface UnlockGuard {
  failures: number;
  /** Epoch ms; 0 = not waiting. */
  lockedUntil: number;
  /** The latest time this device has seen, to notice a clock moved backwards. */
  clockHighWater: number;
}

export const EMPTY_GUARD: UnlockGuard = { failures: 0, lockedUntil: 0, clockHighWater: 0 };

/** How long unlock pauses after `failures` wrong PINs in a row. */
export function lockoutDelayMs(failures: number): number {
  if (failures < LOCKOUT_FREE_ATTEMPTS) return 0;
  const doublings = failures - LOCKOUT_FREE_ATTEMPTS;
  return Math.min(LOCKOUT_MAX_WAIT_MS, LOCKOUT_FIRST_WAIT_MS * 2 ** Math.min(doublings, 20));
}

export type GuardVerdict =
  | { ok: true; guard: UnlockGuard }
  | { ok: false; reason: 'wait'; until: number; guard: UnlockGuard }
  | { ok: false; reason: 'clock'; guard: UnlockGuard };

/** Whether an attempt may be made now. Moves the clock high-water mark forward. */
export function checkGuard(guard: UnlockGuard, now: number): GuardVerdict {
  if (guard.clockHighWater && now < guard.clockHighWater - CLOCK_TOLERANCE_MS) return { ok: false, reason: 'clock', guard };
  const next = { ...guard, clockHighWater: Math.max(guard.clockHighWater, now) };
  if (next.lockedUntil > now) return { ok: false, reason: 'wait', until: next.lockedUntil, guard: next };
  return { ok: true, guard: next };
}

/** Counts an attempt before the PIN is checked, so closing the page mid-check still counts. */
export function claimAttempt(guard: UnlockGuard, now: number): UnlockGuard {
  const failures = guard.failures + 1;
  const delay = lockoutDelayMs(failures);
  return { ...guard, failures, lockedUntil: delay ? now + delay : 0, clockHighWater: Math.max(guard.clockHighWater, now) };
}

export function clearFailures(guard: UnlockGuard): UnlockGuard {
  return { ...guard, failures: 0, lockedUntil: 0 };
}

// --- Key derivation ---------------------------------------------------------

function subtle(): SubtleCrypto {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error('This browser has no WebCrypto, so it cannot unlock offline.');
  return value;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function newSalt(): string {
  return toBase64(globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

export async function deriveVerifier(pin: string, salt: string, iterations: number): Promise<string> {
  const key = await subtle().importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt) as BufferSource, iterations },
    key,
    VERIFIER_BITS,
  );
  return toBase64(new Uint8Array(bits));
}

/** Compares without stopping at the first difference. */
export function sameBytes(a: string, b: string): boolean {
  const x = fromBase64(a);
  const y = fromBase64(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** A fixed salt for checking a username that has no enrolment, so it takes as long as a real one. */
export const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA==';

// --- Opening a till ---------------------------------------------------------

export type OfflineSessionCheck =
  | { ok: true }
  | { ok: false; reason: 'not-prepared' | 'expired' | 'not-permitted' | 'no-shift' | 'disabled' };

/**
 * Whether an unlocked cashier may open their till from the device copy now.
 * Checked at every unlock. Never extends the access period: only a fresh
 * download from the server does that.
 */
export function offlineSessionCheck(snapshot: CatalogSnapshot | null | undefined, enrollment: UnlockEnrollment, now: number): OfflineSessionCheck {
  if (!snapshot || snapshot.key !== enrollment.key) return { ok: false, reason: 'not-prepared' };
  if (Date.parse(snapshot.accessUntil) <= now) return { ok: false, reason: 'expired' };
  // Copies from before permissions were listed were only handed out with pos.create.
  if (snapshot.permissions && !snapshot.permissions.includes('pos.create')) return { ok: false, reason: 'not-permitted' };
  if (!snapshot.openShift) return { ok: false, reason: 'no-shift' };
  if (snapshot.openShift.warehouseId !== snapshot.branch.id) return { ok: false, reason: 'not-prepared' };
  return { ok: true };
}

export const SESSION_MESSAGE: Record<Exclude<OfflineSessionCheck, { ok: true }>['reason'], string> = {
  'not-prepared': 'This till is not prepared for offline sales. Connect to the internet, sign in and open the till.',
  expired: 'Offline access for this account has ended. Connect to the internet and sign in to continue.',
  'not-permitted': 'This account may not sell offline. Connect to the internet and sign in.',
  'no-shift': 'No shift was open when this device last connected. A shift can only be opened with a connection.',
  disabled: 'Offline cash sales are turned off for this store.',
};

/** The one message for a wrong PIN or an unknown username. */
export const BAD_CREDENTIALS = 'Username or PIN is incorrect.';
