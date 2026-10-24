import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { checkFormToken, FORM_TOKEN_MIN_AGE_MS, FORM_TOKEN_MAX_AGE_MS } from '@/lib/support-abuse-rules';

/**
 * Abuse protection for the public Help form, which anyone can reach.
 *
 *   - A form token signed on the server when the page renders. A submission
 *     needs one that is genuine, at least a few seconds old (a person reads
 *     and types; a script posts at once) and not stale.
 *   - A honeypot field people never see; a bot that fills it is told "sent"
 *     and nothing is stored.
 *   - Limits per hashed IP and per reply address (see support-service), on top
 *     of the per-instance in-memory limiter.
 *
 * The IP is never stored: only a keyed hash, which cannot be reversed without
 * the server secret and is used for nothing but these limits.
 */

function key(purpose: string): Buffer {
  return createHmac('sha256', getEnv().BETTER_AUTH_SECRET).update(`support:${purpose}`).digest();
}

function sign(value: string): string {
  return createHmac('sha256', key('form-token')).update(value).digest('base64url');
}

/** A token for a freshly rendered form. */
export function issueFormToken(now: number = Date.now()): string {
  const issued = String(now);
  return `${issued}.${sign(issued)}`;
}

/** Whether the token is genuine and of a believable age. */
export function verifyFormToken(token: unknown, now: number = Date.now()): boolean {
  if (typeof token !== 'string') return false;
  const [issued, signature] = token.split('.');
  if (!issued || !signature) return false;
  const expected = Buffer.from(sign(issued));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return checkFormToken(Number(issued), now, FORM_TOKEN_MIN_AGE_MS, FORM_TOKEN_MAX_AGE_MS);
}

/** Keyed hash of the client IP, for rate limits only. Null when the IP is unknown. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHmac('sha256', key('ip')).update(ip.trim().toLowerCase()).digest('hex');
}
