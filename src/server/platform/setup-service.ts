import 'server-only';

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { APIError } from 'better-auth/api';
import { platformPrisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { runAsProvisioning } from '@/lib/provisioning-context';
import { getRequestContext } from '@/lib/session';
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/errors';
import { installPermissionCatalogue, installPlatformRole } from '@/server/platform/store-setup';
import { classifySetupError, errorCode, type SetupStatus } from '@/lib/setup-status';

/**
 * First-time setup: creating the installation's initial System Administrator.
 *
 * Setup is open only while the `installation` row is not COMPLETED *and* no
 * account exists — both read from the database on every request, never from
 * anything the browser holds. Once completed the row cannot be reopened (a
 * trigger refuses it), so disabling or deleting an administrator later never
 * brings setup back. The documented recovery path is `npm run admin:create`,
 * which needs database access.
 *
 * Concurrency: the first step is one INSERT that claims the installation row
 * only while no account exists. Of any number of simultaneous requests,
 * exactly one gets the claim; the rest are refused before anything is created.
 * The account-creation hook then re-checks that it is the first account.
 *
 * Optional SETUP_KEY: when set (e.g. in Vercel), the form must supply it, so a
 * stranger who finds a brand-new deployment first cannot claim it. Compared in
 * constant time; never sent to the browser.
 */

/** How long an unfinished claim (a request that died mid-setup) blocks others. */
const STALE_CLAIM_MINUTES = 5;

export async function isSetupRequired(): Promise<boolean> {
  const [installation, users] = await Promise.all([
    platformPrisma.installation.findUnique({ where: { id: 1 }, select: { status: true } }),
    platformPrisma.user.count(),
  ]);
  return installation?.status !== 'COMPLETED' && users === 0;
}

/**
 * Setup's state for the pages, with a database problem told apart from a
 * closed setup: a brand-new database whose migrations have not been applied
 * must say so, not look like an ordinary login. Failures are logged with
 * their error code only — never the message, which can carry connection
 * details.
 */
export async function getSetupStatus(): Promise<SetupStatus> {
  try {
    return (await isSetupRequired()) ? 'required' : 'closed';
  } catch (error) {
    const status = classifySetupError(error);
    console.error(`[setup] status check failed: ${status} (${errorCode(error)})`);
    return status;
  }
}

/** Whether the deployment requires a setup key (the key itself never leaves the server). */
export function isSetupKeyRequired(): boolean {
  return Boolean(process.env.SETUP_KEY?.trim());
}

function setupKeyMatches(given: string | undefined): boolean {
  const expected = process.env.SETUP_KEY?.trim();
  if (!expected) return true;
  // Hashing first gives equal-length buffers, so timingSafeEqual never throws
  // and the comparison time does not depend on how much of the key matched.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given?.trim() ?? ''), digest(expected));
}

export interface SetupInput {
  name: string;
  username: string;
  email: string;
  password: string;
  setupKey?: string;
}

export const SETUP_CLOSED_MESSAGE = 'Setup has already been completed. Please sign in.';

/** Creates the initial System Administrator, or refuses. Returns its username. */
export async function completeSetup(input: SetupInput): Promise<{ userId: string; username: string }> {
  if (!setupKeyMatches(input.setupKey)) {
    throw new ValidationError('The setup key is not correct.', { setupKey: ['Enter the setup key configured for this deployment.'] });
  }

  // 1. Claim the installation, atomically, while it is still empty.
  //    Timestamps are UTC without a zone (Prisma's convention for these
  //    columns), so "now" is taken in UTC rather than the session's zone.
  const token = randomUUID();
  const claimed = await platformPrisma.$queryRaw<{ id: number }[]>`
    INSERT INTO installation (id, status, "claimToken", "claimedAt")
    SELECT 1, 'IN_PROGRESS', ${token}, timezone('UTC', now())
    WHERE NOT EXISTS (SELECT 1 FROM users)
    ON CONFLICT (id) DO UPDATE SET "claimToken" = EXCLUDED."claimToken", "claimedAt" = timezone('UTC', now())
      WHERE installation.status = 'IN_PROGRESS'
        AND installation."claimedAt" < timezone('UTC', now()) - make_interval(mins => ${STALE_CLAIM_MINUTES}::int)
        AND NOT EXISTS (SELECT 1 FROM users)
    RETURNING id`;
  if (claimed.length === 0) {
    if (await isSetupRequired()) {
      throw new ConflictError('Setup is being completed in another window. Wait a moment, then reload.');
    }
    throw new ForbiddenError(SETUP_CLOSED_MESSAGE);
  }

  const release = () =>
    platformPrisma.installation
      .deleteMany({ where: { id: 1, status: 'IN_PROGRESS', claimToken: token } })
      .catch((error) => console.error('[setup] could not release the setup claim', error));

  // 2. The role catalogue and the platform role (a fresh database has neither),
  //    then the account itself, with its role fixed here on the server.
  let userId: string;
  try {
    const ids = await installPermissionCatalogue(platformPrisma);
    const role = await installPlatformRole(platformPrisma, ids);
    const created = await runAsProvisioning({ storeId: null, roleId: role.id, firstAccountOnly: true }, () =>
      auth.api.signUpEmail({
        body: { name: input.name, email: input.email, password: input.password, username: input.username },
      }),
    );
    if (!created?.user?.id) throw new ConflictError('The account could not be created.');
    userId = created.user.id;
  } catch (error) {
    await release();
    if (error instanceof APIError) {
      const message = (error.body as { message?: string } | undefined)?.message ?? error.message;
      if (/username/i.test(message)) throw new ValidationError(message, { username: [message] });
      if (/email|exist/i.test(message)) throw new ValidationError('That email address already has an account.', { email: ['Already registered.'] });
      if (/password/i.test(message)) throw new ValidationError(message, { password: [message] });
      if (/already been completed/i.test(message)) throw new ForbiddenError(SETUP_CLOSED_MESSAGE);
      throw new ValidationError(message || 'The account could not be created.');
    }
    throw error;
  }

  // 3. Close setup for good, and record it.
  const { ipAddress, userAgent } = await getRequestContext().catch(() => ({ ipAddress: null, userAgent: null }));
  await platformPrisma.$transaction(async (tx) => {
    const closed = await tx.installation.updateMany({
      where: { id: 1, status: 'IN_PROGRESS', claimToken: token },
      data: { status: 'COMPLETED', completedAt: new Date(), completedById: userId, claimToken: null },
    });
    if (closed.count !== 1) throw new ConflictError('Setup could not be completed. Reload the page.');
    await tx.auditLog.create({
      data: {
        storeId: null,
        action: 'CREATE',
        entity: 'User',
        entityId: userId,
        summary: `Initial System Administrator @${input.username} created through first-time setup`,
        changes: { role: 'system-admin', via: 'first-time setup' },
        userId,
        ipAddress,
        userAgent,
      },
    });
  });

  return { userId, username: input.username };
}
