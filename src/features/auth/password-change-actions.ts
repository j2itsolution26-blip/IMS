'use server';

import { auth } from '@/lib/auth';
import { platformPrisma } from '@/lib/prisma';
import { runAction, type ActionResult } from '@/lib/action';
import { ConflictError, ValidationError } from '@/lib/errors';
import { RATE_LIMITS, checkRateLimit } from '@/lib/rate-limit';
import { authenticateForPasswordChange, getRequestContext } from '@/lib/session';
import { passwordChangeProblems } from '@/lib/password-change';

/**
 * Replaces an administrator-chosen password with the account holder's own.
 *
 * The one action a restricted account may call (every other guard refuses
 * it), so it does exactly one thing: for the signed-in user only, check the
 * temporary password against the stored hash, then store the new hash, clear
 * the requirement and end every other session in a single transaction. If
 * any step fails, the requirement stays.
 *
 * Passwords are never logged or written to the audit trail.
 */
export async function changeTemporaryPassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authenticateForPasswordChange();
    if (!user.mustChangePassword) {
      throw new ConflictError('Your password has already been changed. Use Settings to change it again.');
    }
    checkRateLimit(`temporary-password:${user.id}`, RATE_LIMITS.auth);

    const values = {
      currentPassword: typeof input?.currentPassword === 'string' ? input.currentPassword : '',
      newPassword: typeof input?.newPassword === 'string' ? input.newPassword : '',
      confirmPassword: typeof input?.confirmPassword === 'string' ? input.confirmPassword : '',
    };
    const problems = passwordChangeProblems(values);
    if (Object.keys(problems).length > 0) {
      throw new ValidationError(
        'Check the highlighted fields.',
        Object.fromEntries(Object.entries(problems).map(([field, message]) => [field, [message]])),
      );
    }

    const account = await platformPrisma.account.findFirst({
      where: { userId: user.id, providerId: 'credential' },
      select: { id: true, password: true },
    });
    const ctx = await auth.$context;
    const valid = account?.password
      ? await ctx.password.verify({ hash: account.password, password: values.currentPassword })
      : false;

    const { ipAddress, userAgent } = await getRequestContext().catch(() => ({ ipAddress: null, userAgent: null }));
    // Written straight to the table with the account's own store: the usual
    // audit helper reads through the store gateway, which refuses this account
    // until the change is done.
    const audit = { storeId: user.store?.id ?? null, entity: 'User', entityId: user.id, userId: user.id, ipAddress, userAgent };

    if (!account || !valid) {
      await platformPrisma.auditLog.create({
        data: { ...audit, action: 'UPDATE', summary: 'Temporary password change failed: current password incorrect' },
      });
      throw new ValidationError('Your temporary password is incorrect.', {
        currentPassword: ['Incorrect password.'],
      });
    }

    const hash = await ctx.password.hash(values.newPassword);

    await platformPrisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id: account.id }, data: { password: hash } });
      // Conditional, so two submissions racing cannot both "complete".
      const cleared = await tx.user.updateMany({
        where: { id: user.id, mustChangePassword: true },
        data: { mustChangePassword: false },
      });
      if (cleared.count !== 1) throw new ConflictError('Your password has already been changed.');
      // Anything signed in with the temporary password is signed out; this
      // device keeps its session and continues straight to the dashboard.
      await tx.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } });
      await tx.auditLog.create({
        data: { ...audit, action: 'UPDATE', summary: 'Replaced temporary password; other sessions signed out' },
      });
    });
  });
}
