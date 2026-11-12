import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authorize, getRequestContext } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { parseInput } from '@/lib/action';
import { registerDevice } from '@/server/services/pos-device-service';
import { errorResponse, json, readJson, sameOriginJson } from '@/server/pos/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  deviceId: z.string().uuid(),
  label: z.string().max(80).optional(),
});

/** Registers this browser for offline selling (step one of preparing a device). */
export async function POST(request: NextRequest) {
  const refused = sameOriginJson(request);
  if (refused) return refused;

  try {
    const user = await authorize('pos.create');
    checkRateLimit(`pos-device:${user.id}`, RATE_LIMITS.mutation);
    const { deviceId, label } = parseInput(schema, await readJson(request));
    const { userAgent } = await getRequestContext();
    const device = await registerDevice({ deviceId, userId: user.id, label, userAgent });
    return json({ ok: true, device });
  } catch (error) {
    return errorResponse(error, 'pos-device');
  }
}
