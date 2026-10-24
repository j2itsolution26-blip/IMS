/**
 * The pure half of the public Help form's abuse rules (the signing lives in
 * src/server/support/support-abuse.ts). Unit-tested.
 */

/** A person needs a few seconds to read the form and type a concern. */
export const FORM_TOKEN_MIN_AGE_MS = 3_000;
/** A form left open longer than this is reloaded. */
export const FORM_TOKEN_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function checkFormToken(issuedAt: number, now: number, minAgeMs: number, maxAgeMs: number): boolean {
  if (!Number.isFinite(issuedAt)) return false;
  const age = now - issuedAt;
  return age >= minAgeMs && age <= maxAgeMs;
}

/** The honeypot is a field people never see; anything in it means a bot. */
export function isHoneypotTripped(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Submissions allowed per window, beyond the in-memory limiter. */
export const PUBLIC_LIMITS = {
  perIpPerHour: 5,
  perEmailPerDay: 5,
} as const;

export const APP_LIMITS = {
  ticketsPerHour: 10,
} as const;
