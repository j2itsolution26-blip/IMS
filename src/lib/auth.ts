import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { username } from 'better-auth/plugins';
import { platformPrisma } from '@/lib/prisma';
import { getAppUrl, getTrustedOrigins } from '@/lib/env';
import { provisioningTarget } from '@/lib/provisioning-context';
import { APIError } from 'better-auth/api';
import { APP_NAME } from '@/lib/brand';
import { resolvePasskeyConfig } from '@/lib/passkey-config';
import { passkeyPlugin } from '@/lib/passkey-plugin';
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  isValidUsername,
  normalizeUsername,
} from '@/lib/username';

/**
 * Where passkeys may be used, from PASSKEY_RP_ID / PASSKEY_ORIGIN. Exported so
 * the sign-in page offers the button only where the ceremony will accept it.
 */
export const passkeyConfig = resolvePasskeyConfig(process.env);
if (!passkeyConfig.enabled) console.info(`[auth] Passkeys are off: ${passkeyConfig.reason}`);

/** The one message every failed sign-in shows, whatever the actual reason. */
const INVALID_CREDENTIALS = 'Invalid username/email or password.';

/**
 * Atomically claims the right to create the first Owner account of a store.
 *
 * `count()` followed later by an insert is a classic check-then-act race: two
 * sign-up requests hitting the server at the same instant could both observe
 * zero users and both walk away with the Owner role. Postgres resolves that in
 * a single statement, using the store's own settings row as a mutex.
 * `INSERT ... WHERE NOT EXISTS (owner) ON CONFLICT DO UPDATE ... WHERE <stale>`
 * means only one concurrent caller can ever see a returned row:
 *
 *   - No owner yet, no claim row  -> insert succeeds, this caller wins.
 *   - No owner yet, fresh claim   -> conflict, update's WHERE is false,
 *                                    0 rows returned, this caller loses.
 *   - No owner yet, stale claim   -> conflict, update's WHERE is true (a
 *                                    previous attempt died mid-request),
 *                                    row is re-claimed, this caller wins.
 *   - Owner already exists        -> WHERE NOT EXISTS is false, nothing is
 *                                    ever inserted, 0 rows returned.
 *
 * The row is left in place afterwards as a harmless, permanent marker (it is
 * outside `SETTING_DEFINITIONS`, so it never appears in the Settings UI).
 */
async function claimOwnerSetupSlot(storeId: string): Promise<boolean> {
  const rows = await platformPrisma.$queryRaw<{ id: string }[]>`
    INSERT INTO settings (id, "storeId", key, value, type, "group", label, description, "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, ${storeId}, 'system.ownerSetupClaim', 'claimed', 'STRING', 'system',
           'Owner setup claim',
           'Internal marker that serialises first-owner creation. Safe to delete manually if a crashed request ever leaves it stuck.',
           now(), now()
    WHERE NOT EXISTS (
      SELECT 1 FROM users u JOIN roles r ON r.id = u."roleId"
      WHERE r.slug = 'owner' AND u."storeId" = ${storeId}
    )
    ON CONFLICT ("storeId", key) DO UPDATE
      SET "updatedAt" = now()
      WHERE settings."updatedAt" < now() - interval '2 minutes'
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * The store and role a newly created account gets.
 *
 * An authorised caller (a store's staff screen, the platform's owner screen)
 * names both through `runAsProvisioning`; the role must be one of that
 * store's. Otherwise this is a public sign-up, which is only allowed for the
 * very first account of all: it becomes the owner of the store that has no
 * owner yet. That is how a new installation bootstraps without shipping a
 * seeded admin with a known password.
 */
async function resolveNewAccount(): Promise<{ roleId: string; storeId: string | null }> {
  const target = provisioningTarget();
  if (target) {
    const role = await platformPrisma.role.findFirst({
      where: { id: target.roleId, storeId: target.storeId },
      select: { id: true },
    });
    if (!role) throw new APIError('FORBIDDEN', { message: 'That role does not belong to this store.' });
    return { roleId: target.roleId, storeId: target.storeId };
  }

  // Sign-up is not a public endpoint in a business system.
  if ((await platformPrisma.user.count()) > 0) {
    throw new APIError('FORBIDDEN', {
      message: 'Public sign-up is disabled. Ask an administrator to create your account.',
    });
  }

  const store = await platformPrisma.store.findFirst({
    where: { ownerId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const owner = store
    ? await platformPrisma.role.findUnique({
        where: { storeId_slug: { storeId: store.id, slug: 'owner' } },
        select: { id: true },
      })
    : null;
  if (!store || !owner) {
    throw new Error(
      'No store is ready for its owner. Run `npm run db:bootstrap` to install the roles before signing up.',
    );
  }
  if (!(await claimOwnerSetupSlot(store.id))) {
    // Either an owner was created a moment ago by a concurrent request, or one
    // already existed — either way, this request does not get to create a second.
    throw new APIError('FORBIDDEN', { message: 'Owner account has already been created. Please sign in.' });
  }
  return { roleId: owner.id, storeId: store.id };
}

export const auth = betterAuth({
  appName: APP_NAME,
  baseURL: getAppUrl(),
  // A Vercel deployment is reachable on its production domain, its branch
  // alias, and a unique per-deployment URL simultaneously. Trusting only
  // `baseURL` means sign-in works on one of them and fails on the other two
  // with a CSRF rejection that surfaces as a generic error.
  trustedOrigins: getTrustedOrigins(),
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(platformPrisma, { provider: 'postgresql' }),

  emailAndPassword: {
    enabled: true,
    // Creating an account must never mint a session as a side effect.
    //
    // `signUpEmail` is also called server-side when an administrator creates a
    // staff account. With autoSignIn on, the `nextCookies` plugin wrote the new
    // user's session cookie into that Server Action's response — silently
    // replacing the administrator's own session with one for the account they
    // had just created. The admin became the new user mid-request, and the
    // following re-render of /settings/users then failed their permission
    // check.
    //
    // Sign-in is now always explicit. The first-run sign-up form signs itself
    // in from the browser, which is the only place a session cookie should be
    // established.
    autoSignIn: false,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    requireEmailVerification: false,
  },

  // A store counter must stay ready for the next customer, so sessions are
  // long-lived and sliding: each day the device is used pushes expiry another
  // 30 days out, so a POS in daily use never signs itself out. Sessions still
  // live in the database, so they stay revocable — logout, deactivation and a
  // password reset delete the row, and that takes effect on the next request.
  //
  // "Remember this device" unticked (`rememberMe: false`) gives a cookie that
  // ends when the browser closes, on top of the same server-side expiry.
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    // Off so a revoked session stops working at once. With the cache on, a
    // signed copy of the session in a cookie was trusted for up to 5 minutes
    // after its row was deleted.
    cookieCache: { enabled: false },
  },

  advanced: {
    // Prisma generates the ids so cuid() stays consistent across every table.
    database: { generateId: false },
  },

  user: {
    additionalFields: {
      // `input: false` keeps these out of the public sign-up payload — a user
      // must not be able to grant themselves a role or activate their own account.
      roleId: { type: 'string', required: false, input: false },
      // Which store the account works in; null for platform administrators.
      storeId: { type: 'string', required: false, input: false },
      isActive: { type: 'boolean', required: false, defaultValue: true, input: false },
      phone: { type: 'string', required: false, input: true },
      lastLoginAt: { type: 'date', required: false, input: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const body = (ctx as { body?: { password?: string } } | undefined)?.body;
          if (body?.password) {
            const password = body.password;
            const hasMinLen = password.length >= 10;
            const hasUpper = /[A-Z]/.test(password);
            const hasLower = /[a-z]/.test(password);
            const hasNumber = /[0-9]/.test(password);
            const hasSpecial = /[^A-Za-z0-9]/.test(password);

            if (!hasMinLen || !hasUpper || !hasLower || !hasNumber || !hasSpecial) {
              throw new APIError('BAD_REQUEST', {
                message:
                  'Password must contain at least 10 characters, including uppercase, lowercase, number, and special character.',
              });
            }
          }

          // Every account signs in by username, and the column is NOT NULL.
          // The username plugin has already validated and normalised it and
          // checked it is free; this turns a missing one into a clear message
          // instead of a database constraint error.
          const name = (user as { username?: unknown }).username;
          if (typeof name !== 'string' || !isValidUsername(normalizeUsername(name))) {
            throw new APIError('BAD_REQUEST', { message: 'Choose a valid username.' });
          }

          const { roleId, storeId } = await resolveNewAccount();
          return { data: { ...user, roleId, storeId } };
        },
        // A store's first owner becomes its owner of record.
        after: async (user) => {
          const created = await platformPrisma.user.findUnique({
            where: { id: user.id },
            select: { storeId: true, role: { select: { slug: true } } },
          });
          if (created?.storeId && created.role.slug === 'owner') {
            await platformPrisma.store.updateMany({
              where: { id: created.storeId, ownerId: null },
              data: { ownerId: user.id },
            });
          }
        },
      },
    },
    session: {
      create: {
        // Both sign-in endpoints (email and username) only check the password.
        // A deactivated account must not get a session at all, and the refusal
        // reads exactly like a wrong password so it reveals nothing.
        before: async (session) => {
          const owner = await platformPrisma.user.findUnique({
            where: { id: session.userId },
            select: { isActive: true },
          });
          if (!owner?.isActive) {
            throw new APIError('UNAUTHORIZED', { message: INVALID_CREDENTIALS });
          }
          return { data: session };
        },
        after: async (session) => {
          // Recording the login here (rather than in the UI) means every entry
          // point — form, API, future SSO — is captured.
          await platformPrisma.$transaction(async (tx) => {
            const user = await tx.user.update({
              where: { id: session.userId },
              data: { lastLoginAt: new Date() },
              select: { storeId: true },
            });
            await tx.auditLog.create({
              data: {
                // The store the account works in; a platform admin's own
                // sign-ins stay outside every store.
                storeId: user.storeId,
                action: 'LOGIN',
                entity: 'User',
                entityId: session.userId,
                summary: 'Signed in',
                userId: session.userId,
                ipAddress: session.ipAddress || null,
                userAgent: session.userAgent || null,
              },
            });
          });
        },
      },
    },
  },

  plugins: [
    // Adds `username`/`displayUsername` to the user and the
    // `/sign-in/username` endpoint, on the same accounts, password hashes and
    // sessions as email sign-in — not a second login system.
    username({
      minUsernameLength: USERNAME_MIN_LENGTH,
      maxUsernameLength: USERNAME_MAX_LENGTH,
      usernameNormalization: normalizeUsername,
      // Validate the trimmed, lowercased form, so "Juan.Cruz " is accepted as
      // "juan.cruz" rather than rejected for its capitals or spaces. The
      // validator normalises too because the sign-in endpoint passes it the
      // raw value regardless of `validationOrder`.
      usernameValidator: (value) => isValidUsername(normalizeUsername(value)),
      validationOrder: { username: 'post-normalization' },
    }),
    // WebAuthn sign-in on the same accounts and sessions. Its endpoints refuse
    // to run unless passkeys are configured for the requesting origin.
    passkeyPlugin(passkeyConfig),
    // Must stay last: it writes the cookies set by the plugins above.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
