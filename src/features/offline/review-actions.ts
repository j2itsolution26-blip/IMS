'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { resolveSyncIssue, setDeviceRevoked } from '@/server/services/sync-review-service';

/**
 * Owner actions on offline selling. Each checks the financial permission on
 * the server first; the acting user is always the signed-in owner.
 */

async function owner() {
  const user = await authorize(FINANCIAL_PERMISSION);
  checkRateLimit(`offline-review:${user.id}`, RATE_LIMITS.mutation);
  return user;
}

const resolveSchema = z.object({
  issueId: z.string().min(1).max(64),
  note: z.string().trim().min(3, 'Say what was checked or done.').max(1000),
});

export async function resolveSyncIssueAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await owner();
    const values = parseInput(resolveSchema, input);
    await resolveSyncIssue({ issueId: values.issueId, actorId: user.id, note: values.note });
    revalidatePath('/sales/offline');
    revalidatePath('/dashboard');
  });
}

const deviceSchema = z.object({
  deviceId: z.string().uuid(),
  revoked: z.boolean(),
});

export async function setDeviceRevokedAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await owner();
    const values = parseInput(deviceSchema, input);
    await setDeviceRevoked({ deviceId: values.deviceId, actorId: user.id, revoked: values.revoked });
    revalidatePath('/sales/offline');
  });
}
