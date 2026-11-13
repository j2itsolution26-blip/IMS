import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getRequestContext } from '@/lib/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseInput } from '@/lib/action';
import { offlineUnlockStatus } from '@/server/services/offline-unlock-service';
import { errorResponse, json, readJson, sameOriginJson } from '@/server/pos/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  deviceId: z.string().uuid(),
  entries: z
    .array(
      z.object({
        storeId: z.string().min(1).max(64),
        userId: z.string().min(1).max(64),
        fingerprint: z.string().min(1).max(64),
        branchId: z.string().min(1).max(64),
      }),
    )
    .max(20),
});

/**
 * Whether the cashiers a device may unlock offline are still allowed:
 * account active, PIN unchanged, still at that branch with `pos.create`,
 * device not removed, store neither suspended nor read-only, offline sales
 * on. Needs no session, because a cashier may have signed out online: the
 * device names each cashier with its own id and that cashier's PIN
 * fingerprint, and the answer can only take access away.
 */
export async function POST(request: NextRequest) {
  const refused = sameOriginJson(request);
  if (refused) return refused;

  try {
    const { ipAddress } = await getRequestContext();
    checkRateLimit(`offline-status:${ipAddress ?? 'unknown'}`, { limit: 30, windowMs: 60_000 });
    const { deviceId, entries } = parseInput(schema, await readJson(request));
    return json({ ok: true, results: await offlineUnlockStatus(deviceId, entries) });
  } catch (error) {
    return errorResponse(error, 'offline-unlock-status');
  }
}
