import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { assertDeviceNotRevoked, touchDevice } from '@/server/services/pos-device-service';
import { getOfflineCatalog } from '@/server/services/pos-catalog-service';
import { errorResponse, fail, json } from '@/server/pos/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * The catalogue copy for offline selling. Needs `pos.create`: only someone
 * who may sell gets the price list to sell from. A revoked device is refused,
 * which is how revoking ends its offline access.
 *
 * Never cached anywhere but the till's own IndexedDB: `no-store` here, and
 * the service worker never caches /api.
 */
export async function GET(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get('deviceId');
  if (!deviceId || !z.string().uuid().safeParse(deviceId).success) {
    return fail(422, 'VALIDATION_ERROR', 'Name the device asking for the catalogue.', false);
  }

  try {
    const user = await authorize('pos.create');
    checkRateLimit(`pos-catalog:${user.id}`, RATE_LIMITS.read);
    await assertDeviceNotRevoked(deviceId);
    const catalog = await getOfflineCatalog({ id: user.id, name: user.name, permissions: user.permissions });
    await touchDevice(deviceId, 'lastSeenAt');
    return json({ ok: true, catalog });
  } catch (error) {
    return errorResponse(error, 'pos-catalog');
  }
}
