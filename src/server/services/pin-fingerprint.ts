import 'server-only';
// Reads the platform client by design: see eslint.config.mjs (offline unlock).

import { createHmac } from 'node:crypto';
import { platformPrisma } from '@/lib/prisma';

/**
 * A fingerprint of a cashier's lock-screen PIN for offline unlock: an HMAC of
 * the stored PIN hash under the server's secret. It changes whenever the PIN
 * changes or is removed, and reveals nothing about the PIN itself. A device
 * whose offline unlock was set up with another fingerprint drops it.
 */
export function pinFingerprint(userId: string, posPinHash: string | null): string | null {
  if (!posPinHash) return null;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set.');
  return createHmac('sha256', secret).update(`offline-pin:v1:${userId}:${posPinHash}`).digest('base64url').slice(0, 32);
}

export async function currentPinFingerprint(userId: string): Promise<string | null> {
  const row = await platformPrisma.user.findUnique({ where: { id: userId }, select: { posPinHash: true } });
  return pinFingerprint(userId, row?.posPinHash ?? null);
}
