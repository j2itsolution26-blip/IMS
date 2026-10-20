/**
 * POS unlock PIN rules and the lock-screen attempt policy.
 *
 * A PIN only unlocks a session that is already signed in — it never signs
 * anyone in on its own — so a short numeric code is acceptable. What keeps it
 * safe is the attempt limit below, enforced on the server per session.
 *
 * Kept free of server imports so the profile form and unit tests can use it.
 */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

/** Wrong PINs allowed before the lock screen demands the password instead. */
export const MAX_PIN_FAILURES = 5;

/**
 * Wrong PINs and passwords combined before the session is revoked outright and
 * the device has to sign in again from scratch.
 */
export const MAX_UNLOCK_FAILURES = 10;

export const PIN_HINT = `${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits. Avoid repeated or sequential digits like 1111 or 1234.`;

/** Returns the problem with `pin`, or `null` when it is acceptable. */
export function pinProblem(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return 'Use digits only.';
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    return `Use ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`;
  }
  if (/^(\d)\1+$/.test(pin)) return 'Do not repeat the same digit.';

  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, index) => digit - digits[index]);
  if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) {
    return 'Do not use a run of consecutive digits.';
  }
  return null;
}

export type UnlockMethod = 'pin' | 'password';

/** Which unlock methods the lock screen may still accept after `failures` wrong attempts. */
export function allowedUnlockMethods(hasPin: boolean, failures: number): UnlockMethod[] {
  if (failures >= MAX_UNLOCK_FAILURES) return [];
  if (hasPin && failures < MAX_PIN_FAILURES) return ['pin', 'password'];
  return ['password'];
}
