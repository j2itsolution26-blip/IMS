import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { parseInput } from '@/lib/action';
import { enrollOfflineUnlock } from '@/server/services/offline-unlock-service';
import { errorResponse, json, readJson, sameOriginJson } from '@/server/pos/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  deviceId: z.string().uuid(),
  pin: z.string().regex(/^\d{4,6}$/, 'Enter your 4 to 6 digit PIN.'),
});

/**
 * Allows the signed-in cashier to unlock this prepared device offline with
 * their lock-screen PIN. The PIN is checked here once; the device keeps its
 * own salted verifier of it, never the PIN.
 */
export async function POST(request: NextRequest) {
  const refused = sameOriginJson(request);
  if (refused) return refused;

  try {
    const user = await authorize('pos.create');
    checkRateLimit(`offline-enroll:${user.id}`, RATE_LIMITS.auth);
    const { deviceId, pin } = parseInput(schema, await readJson(request));
    const enrolled = await enrollOfflineUnlock(user, { deviceId, pin });
    return json({ ok: true, ...enrolled });
  } catch (error) {
    return errorResponse(error, 'offline-unlock');
  }
}
