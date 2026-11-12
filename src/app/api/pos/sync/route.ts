import { revalidatePath } from 'next/cache';
import type { NextRequest } from 'next/server';
import { authorize } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { parseInput } from '@/lib/action';
import { offlineSyncRequestSchema, type SyncResponse } from '@/lib/offline-sale';
import { recordOfflineSale } from '@/server/services/offline-sale-service';
import { touchDevice } from '@/server/services/pos-device-service';
import { errorResponse, json, readJson, sameOriginJson } from '@/server/pos/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Uploads one sale the till recorded while offline.
 *
 * One sale per request, so a failure only ever concerns that sale and the
 * till can carry on with the rest. Safe to repeat: the same sale id always
 * answers with the one sale recorded for it (`status: 'duplicate'`).
 *
 * Accepted whether or not offline mode is still switched on for the store:
 * turning it off stops new offline sales, never the upload of ones already
 * taken.
 */
export async function POST(request: NextRequest) {
  const refused = sameOriginJson(request);
  if (refused) return refused;

  try {
    const user = await authorize('pos.create');
    checkRateLimit(`pos-sync:${user.id}`, RATE_LIMITS.sync);
    const { deviceId, sale } = parseInput(offlineSyncRequestSchema, await readJson(request));

    const result = await recordOfflineSale({ userId: user.id, deviceId, sale });
    await touchDevice(deviceId, 'lastSyncAt');

    if (result.status === 'recorded') {
      revalidatePath('/pos');
      revalidatePath('/sales');
      revalidatePath('/dashboard');
      revalidatePath('/inventory');
      revalidatePath('/shifts');
    }

    return json({ ok: true, ...result } satisfies SyncResponse);
  } catch (error) {
    return errorResponse(error, 'pos-sync');
  }
}
