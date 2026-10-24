'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { platformPrisma } from '@/lib/prisma';
import { authenticate, getCurrentUser } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { UnauthorizedError, ValidationError } from '@/lib/errors';
import { RATE_LIMITS, checkRateLimit } from '@/lib/rate-limit';
import {
  MAX_PIN_FAILURES,
  MAX_UNLOCK_FAILURES,
  allowedUnlockMethods,
  pinProblem,
  type UnlockMethod,
} from '@/lib/pos-pin';
import { recordAuditFor } from '@/server/services/audit-service';
import { raisePlatformNotification } from '@/server/platform/platform-notification-service';
import { platformNotificationKey } from '@/lib/notifications';

/**
 * POS screen lock.
 *
 * Locking marks the current session row, not the browser: while `lockedAt` is
 * set, `requireUser` sends every page to /locked and `authorize` refuses every
 * server action, so the lock holds against a refresh, a new tab or a crafted
 * request. The session itself is untouched — unlocking needs only the PIN (or
 * the password), not a fresh sign-in.
 *
 * Wrong attempts are counted on the session row. After MAX_PIN_FAILURES the
 * PIN stops being accepted; after MAX_UNLOCK_FAILURES the session is revoked.
 */

export async function lockSession(): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new UnauthorizedError();
    if (user.isLocked) return;

    await platformPrisma.session.update({
      where: { id: user.sessionId },
      data: { lockedAt: new Date(), unlockFailures: 0 },
    });
  });
}

export interface UnlockResult {
  unlocked: boolean;
  /** What the lock screen may still offer. Empty once the session is revoked. */
  methods: UnlockMethod[];
  message?: string;
}

const unlockSchema = z.object({
  method: z.enum(['pin', 'password']),
  secret: z.string().min(1, 'Enter your PIN or password.').max(128),
});

export async function unlockSession(input: unknown): Promise<ActionResult<UnlockResult>> {
  return runAction(async () => {
    const user = await getCurrentUser();
    if (!user) throw new UnauthorizedError();
    const { method, secret } = parseInput(unlockSchema, input);

    // Deliberately no shortcut when the row is not locked: the overlay locks
    // instantly on the client, before (or even without, when offline) the
    // server recording it. Clearing it must still prove who is at the counter.
    checkRateLimit(`unlock:${user.sessionId}`, RATE_LIMITS.auth);

    const owner = await platformPrisma.user.findUnique({
      where: { id: user.id },
      select: { posPinHash: true },
    });
    const hasPin = Boolean(owner?.posPinHash);
    if (method === 'pin' && !hasPin) {
      return { unlocked: false, methods: ['password'], message: 'No PIN is set. Unlock with your password.' };
    }

    // Claim the attempt before checking the secret. The conditional update is
    // atomic, so parallel guesses cannot slip past the limit between a read
    // and a write.
    const limit = method === 'pin' ? MAX_PIN_FAILURES : MAX_UNLOCK_FAILURES;
    const claimed = await platformPrisma.session.updateMany({
      where: { id: user.sessionId, unlockFailures: { lt: limit } },
      data: { unlockFailures: { increment: 1 } },
    });

    if (claimed.count === 0) {
      const row = await platformPrisma.session.findUnique({
        where: { id: user.sessionId },
        select: { unlockFailures: true },
      });
      return {
        unlocked: false,
        methods: allowedUnlockMethods(hasPin, row?.unlockFailures ?? MAX_UNLOCK_FAILURES),
        message: 'Unlock with your password.',
      };
    }

    const ctx = await auth.$context;
    let valid = false;
    if (method === 'pin' && owner?.posPinHash) {
      valid = await ctx.password.verify({ hash: owner.posPinHash, password: secret });
    } else if (method === 'password') {
      const account = await platformPrisma.account.findFirst({
        where: { userId: user.id, providerId: 'credential' },
        select: { password: true },
      });
      valid = account?.password ? await ctx.password.verify({ hash: account.password, password: secret }) : false;
    }

    if (valid) {
      await platformPrisma.session.update({
        where: { id: user.sessionId },
        data: { lockedAt: null, unlockFailures: 0 },
      });
      return { unlocked: true, methods: [] };
    }

    const row = await platformPrisma.session.findUnique({
      where: { id: user.sessionId },
      select: { unlockFailures: true },
    });
    const failures = row?.unlockFailures ?? MAX_UNLOCK_FAILURES;
    const methods = allowedUnlockMethods(hasPin, failures);

    if (methods.length === 0) {
      // Someone is guessing. End this session; whoever comes back has to sign
      // in properly with a username or email and password.
      await platformPrisma.session.deleteMany({ where: { id: user.sessionId } });
      await recordAuditFor(user, {
        action: 'LOGOUT',
        entity: 'User',
        entityId: user.id,
        summary: `Session revoked after ${failures} wrong unlock attempts on the lock screen`,
        userId: user.id,
      });
      // Someone may be guessing at a signed-in device: administrators hear of it.
      await raisePlatformNotification({
        kind: 'SESSION_LOCKOUT',
        title: `Lock-screen lockout: @${user.username}`,
        body: `${failures} wrong unlock attempts${user.store ? ` at ${user.store.name}` : ''}. The session was signed out.`,
        href: '/system-admin/audit',
        storeId: user.store?.id ?? null,
        dedupeKey: platformNotificationKey.lockout(user.sessionId),
      }).catch((error) => console.error('[lock] could not notify a lockout', error));
      return { unlocked: false, methods, message: 'Too many wrong attempts. Please sign in again.' };
    }

    return {
      unlocked: false,
      methods,
      message:
        method === 'password'
          ? 'Incorrect password.'
          : methods.includes('pin')
            ? 'Incorrect PIN.'
            : 'Incorrect PIN. Too many wrong PINs — unlock with your password.',
    };
  });
}

// --- PIN management (own account only) --------------------------------------

/** Confirms the signed-in user's own password before a PIN change. */
async function verifyOwnPassword(userId: string, password: string): Promise<void> {
  checkRateLimit(`pin-change:${userId}`, RATE_LIMITS.auth);
  const account = await platformPrisma.account.findFirst({
    where: { userId, providerId: 'credential' },
    select: { password: true },
  });
  const ctx = await auth.$context;
  const valid = account?.password ? await ctx.password.verify({ hash: account.password, password }) : false;
  if (!valid) {
    throw new ValidationError('Your current password is incorrect.', {
      currentPassword: ['Incorrect password.'],
    });
  }
}

const setPinSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(128),
  pin: z.string().superRefine((value, ctx) => {
    const problem = pinProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  }),
});

/**
 * Sets the caller's own unlock PIN. Nobody sets another person's PIN — a staff
 * member who forgets theirs unlocks with their password and sets a new one.
 */
export async function setOwnPosPin(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authenticate();
    const values = parseInput(setPinSchema, input);
    await verifyOwnPassword(user.id, values.currentPassword);

    // The same hasher as passwords, so the PIN is never stored in a readable
    // or quickly reversible form.
    const ctx = await auth.$context;
    await platformPrisma.user.update({
      where: { id: user.id },
      data: { posPinHash: await ctx.password.hash(values.pin) },
    });

    await recordAuditFor(user, {
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      summary: 'Set own screen-lock PIN',
      userId: user.id,
    });
    revalidatePath('/settings/profile');
  });
}

const removePinSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(128),
});

export async function removeOwnPosPin(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authenticate();
    const values = parseInput(removePinSchema, input);
    await verifyOwnPassword(user.id, values.currentPassword);

    await platformPrisma.user.update({ where: { id: user.id }, data: { posPinHash: null } });

    await recordAuditFor(user, {
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      summary: 'Removed own screen-lock PIN',
      userId: user.id,
    });
    revalidatePath('/settings/profile');
  });
}
