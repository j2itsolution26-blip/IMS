import 'server-only';

import { headers } from 'next/headers';

/**
 * The origin the current page was requested on, e.g. https://store.example.com.
 *
 * Behind Vercel's proxy the forwarded headers carry the public host and
 * scheme. Used only to decide what to *offer*; the passkey endpoints check the
 * browser's Origin header against configuration themselves.
 */
export async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host');
  if (!host) return null;
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || (host.startsWith('localhost') ? 'http' : 'https');
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}
