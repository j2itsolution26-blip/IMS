import 'server-only';

import { RateLimitError } from '@/lib/errors';

/**
 * Fixed-window rate limiter held in process memory.
 *
 * On Vercel each serverless instance keeps its own counter, so this throttles
 * per-instance rather than globally. That is enough to blunt credential
 * stuffing and accidental request storms; swap the store for Redis/Upstash if
 * you need a hard global guarantee.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();
let lastSweep = Date.now();

function sweep(now: number) {
  // Amortised cleanup — the map would otherwise grow without bound.
  if (now - lastSweep < 60_000) return;
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
  lastSweep = now;
}

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const RATE_LIMITS = {
  auth: { limit: 8, windowMs: 60_000 },
  mutation: { limit: 120, windowMs: 60_000 },
  export: { limit: 12, windowMs: 60_000 },
  read: { limit: 300, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitOptions>;

export function checkRateLimit(key: string, options: RateLimitOptions): void {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }

  existing.count += 1;
  if (existing.count > options.limit) {
    throw new RateLimitError(Math.max(1, Math.ceil((existing.resetAt - now) / 1000)));
  }
}
