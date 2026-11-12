import 'server-only';
import { headers } from 'next/headers';

/** Base URL printed into QR codes: APP_URL if set, else the request's own host. */
export async function appUrl(): Promise<string> {
  const configured = process.env.APP_URL?.replace(/\/+$/, '');
  if (configured) return configured;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3100';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
