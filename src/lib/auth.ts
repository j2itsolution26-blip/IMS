import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { username } from 'better-auth/plugins';
import { platformPrisma } from '@/lib/prisma';
import { getAppUrl, getTrustedOrigins } from '@/lib/env';
import { provisioningTarget } from '@/lib/provisioning-context';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { MUST_CHANGE_PASSWORD_MESSAGE, isBlockedWhileRestricted } from '@/lib/password-change';
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
 * The store and role a newly created account gets.
 *
 * Only an authorised caller may create an account, and it names both through
 * `runAsProvisioning`: a store's staff screen, the platform's Create store,
 * the first-time setup (src/server/platform/setup-service.ts), or the
 * `admin:create` recovery script. The role must belong to that store (the
 * System Administrator role has none). There is no public sign-up: a request
 * to Better Auth's sign-up endpoint from a browser is always refused.
 */
async function resolveNewAccount(): Promise<{ roleId: string; storeId: string | null; mustChangePassword: boolean; isActive: boolean }> {
  const target = provisioningTarget();
  if (!target) {
    throw new APIError('FORBIDDEN', {
      message: 'Public sign-up is disabled. Ask an administrator to create your account.',
    });
  }
  const role = await platformPrisma.role.findFirst({
    where: { id: target.roleId, storeId: target.storeId },
    select: { id: true },
  });
  if (!role) throw new APIError('FORBIDDEN', { message: 'That role does not belong to this store.' });
  // A second line behind the setup claim: the initial administrator is only
  // ever the first account.
  if (target.firstAccountOnly && (await platformPrisma.user.count()) > 0) {
    throw new APIError('FORBIDDEN', { message: 'Setup has already been completed. Please sign in.' });
  }
  return {
    roleId: target.roleId,
    storeId: target.storeId,
    mustChangePassword: target.mustChangePassword === true,
    isActive: target.isActive !== false,
  };
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
    // Sign-in is always explicit: even the administrator created by
    // first-time setup signs in on the normal sign-in page afterwards.
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
      // Set only by trusted server code when an administrator chose the
      // password; `input: false` keeps it out of every public payload.
      mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const body = (ctx as { body?: { password?: string } } | undefined)?.body;
          if (body?.password && !validatePassword(body.password).isValid) {
            throw new APIError('BAD_REQUEST', { message: PASSWORD_POLICY_MESSAGE });
          }

          // Every account signs in by username, and the column is NOT NULL.
          // The username plugin has already validated and normalised it and
          // checked it is free; this turns a missing one into a clear message
          // instead of a database constraint error.
          const name = (user as { username?: unknown }).username;
          if (typeof name !== 'string' || !isValidUsername(normalizeUsername(name))) {
            throw new APIError('BAD_REQUEST', { message: 'Choose a valid username.' });
          }

          // The flag comes only from the server-side caller's provisioning
          // target, overriding anything in `user`.
          const { roleId, storeId, mustChangePassword, isActive } = await resolveNewAccount();
          return { data: { ...user, roleId, storeId, mustChangePassword, isActive } };
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

  hooks: {
    // While an administrator-chosen password is still in use, the built-in
    // password, profile and passkey endpoints are refused: the password is
    // changed through our own action, which clears the flag atomically, so
    // these must not become a way around it. Read from the database, never
    // from anything the client sends.
    before: createAuthMiddleware(async (ctx) => {
      if (!isBlockedWhileRestricted(ctx.path)) return;
      const session = await getSessionFromCtx(ctx);
      if (!session?.user?.id) return;
      const user = await platformPrisma.user.findUnique({
        where: { id: session.user.id },
        select: { mustChangePassword: true },
      });
      if (user?.mustChangePassword) {
        throw new APIError('FORBIDDEN', { message: MUST_CHANGE_PASSWORD_MESSAGE });
      }
    }),
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
