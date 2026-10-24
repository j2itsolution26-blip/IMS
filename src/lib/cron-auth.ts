import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Whether a scheduled-job request carries the configured secret.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. With no secret
 * configured, every request is refused — the job never runs open. Compared
 * in constant time over fixed-length digests so neither the secret nor its
 * length leaks through timing.
 */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !authorization) return false;
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  const received = createHash('sha256').update(authorization).digest();
  return timingSafeEqual(expected, received);
}
