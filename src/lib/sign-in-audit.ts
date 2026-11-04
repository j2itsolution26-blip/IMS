import { platformPrisma } from '@/lib/prisma';
import { normalizeUsername } from '@/lib/username';
import { FAILED_SIGN_IN_MAX_LOGGED, FAILED_SIGN_IN_WINDOW_MINUTES } from '@/lib/audit-log';

/**
 * Failed sign-ins in the store activity log.
 *
 * Called by the auth after-hook (src/lib/auth.ts) once a password sign-in has
 * been refused, after the response has gone out, so a real username costs the
 * caller no extra time compared with an unknown one.
 *
 *   * Only an existing store account is logged, in its own store. Attempts at
 *     usernames that do not exist, and platform accounts, are not.
 *   * The password is never recorded; the entry names the account and counts
 *     the attempt.
 *   * At most FAILED_SIGN_IN_MAX_LOGGED entries per account per
 *     FAILED_SIGN_IN_WINDOW_MINUTES, so guessing cannot flood the log; the
 *     last one is critical. A per-account lock keeps two simultaneous failures
 *     from taking the same attempt number.
 *   * The actor is left empty: whoever typed the password is unknown, and
 *     filing it under the account would read as if that person did it.
 *
 * It uses the platform client because a refused sign-in has no session and
 * so no store context; the store comes from the account, never the request.
 */

export interface FailedSignIn {
  method: 'username' | 'email';
  identifier: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export function failedSignInSummary(username: string, attempt: number, accountActive: boolean): string {
  if (attempt >= FAILED_SIGN_IN_MAX_LOGGED) {
    return `${attempt} failed sign-ins for @${username} within ${FAILED_SIGN_IN_WINDOW_MINUTES} minutes — further attempts are not logged until it calms down`;
  }
  return `Failed sign-in for @${username}${accountActive ? '' : ' (account deactivated)'}`;
}

export async function recordFailedSignIn(input: FailedSignIn, now: Date = new Date()): Promise<void> {
  const identifier = input.identifier.trim();
  if (!identifier || identifier.length > 254) return;

  const user = await platformPrisma.user.findUnique({
    where: input.method === 'email' ? { email: identifier.toLowerCase() } : { username: normalizeUsername(identifier) },
    select: { id: true, storeId: true, username: true, isActive: true },
  });
  if (!user?.storeId) return;
  const storeId = user.storeId;

  const since = new Date(now.getTime() - FAILED_SIGN_IN_WINDOW_MINUTES * 60_000);
  await platformPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`audit:signin:${user.id}`}))`;
    const logged = await tx.auditLog.count({
      where: { storeId, action: 'LOGIN_FAILED', entityId: user.id, createdAt: { gte: since } },
    });
    if (logged >= FAILED_SIGN_IN_MAX_LOGGED) return;
    const attempt = logged + 1;
    await tx.auditLog.create({
      data: {
        storeId,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        summary: failedSignInSummary(user.username, attempt, user.isActive),
        changes: { attempt, windowMinutes: FAILED_SIGN_IN_WINDOW_MINUTES, method: input.method, accountActive: user.isActive },
        userId: null,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
      },
    });
  });
}
