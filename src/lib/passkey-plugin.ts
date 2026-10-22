import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { APIError, createAuthEndpoint, freshSessionMiddleware, sessionMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { z } from 'zod';
import { platformPrisma } from '@/lib/prisma';
import { APP_NAME } from '@/lib/brand';
import { passkeyLabelFromUserAgent } from '@/lib/passkey-label';
import type { PasskeyConfig } from '@/lib/passkey-config';

/**
 * Passkey (WebAuthn) registration and sign-in, as a Better Auth plugin.
 *
 * It lives in the app rather than as `@better-auth/passkey` because that
 * package pulls a second copy of Better Auth's core into this dependency tree.
 * Everything here comes from `better-auth/api` — the same endpoint, error and
 * session machinery as password sign-in — and SimpleWebAuthn for the
 * cryptography, which is what the official plugin uses too.
 *
 * Security properties, each enforced on the server:
 *
 *   - Challenges are random (SimpleWebAuthn), bound to this browser by a
 *     signed HttpOnly cookie, single-use (consumed atomically from the
 *     verifications table) and expire after five minutes.
 *   - Origins are matched exactly against configuration, never taken from the
 *     request; the RP ID hash is checked by SimpleWebAuthn.
 *   - User verification (Face ID, fingerprint, device PIN) is required, so a
 *     passkey is a full sign-in on its own, not a weaker second path.
 *   - Sign-in creates the session through the same internal adapter as
 *     password sign-in, so the deactivated-account check, last-login stamp
 *     and audit entry in `auth.ts` all apply unchanged.
 *   - Registration needs a fresh, unlocked session on an active account, and
 *     always attaches the passkey to that session's own user.
 *
 * Only the credential's public key and metadata are stored — never a private
 * key, and no biometric data ever reaches the server.
 */

const CHALLENGE_TTL_SECONDS = 300;
const CHALLENGE_COOKIE = 'passkey_challenge';

/** Shown for every failed passkey sign-in, whatever the reason. */
export const PASSKEY_SIGN_IN_FAILED = 'Passkey sign-in failed. Try again, or sign in with your username and password.';

export const PASSKEY_ERROR = {
  UNAVAILABLE: 'PASSKEYS_UNAVAILABLE',
  FAILED: 'PASSKEY_SIGN_IN_FAILED',
  NOT_REGISTERED: 'PASSKEY_NOT_REGISTERED',
  REGISTRATION_FAILED: 'PASSKEY_REGISTRATION_FAILED',
  ALREADY_REGISTERED: 'PASSKEY_ALREADY_REGISTERED',
} as const;

type Ceremony = { type: 'registration'; challenge: string; userId: string } | { type: 'authentication'; challenge: string };

const registrationBody = z.object({
  response: z.custom<RegistrationResponseJSON>((v) => typeof v === 'object' && v !== null),
  name: z.string().trim().max(60).optional(),
});
const authenticationBody = z.object({
  response: z.custom<AuthenticationResponseJSON>((v) => typeof v === 'object' && v !== null),
  rememberMe: z.boolean().optional(),
});

function fail(status: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'CONFLICT', code: string, message: string): never {
  throw new APIError(status, { code, message });
}

function headerOf(request: Request | undefined, headers: Headers | undefined, name: string): string | null {
  return headers?.get(name) ?? request?.headers.get(name) ?? null;
}

export function passkeyPlugin(config: PasskeyConfig): BetterAuthPlugin {
  /** Refuses the ceremony unless passkeys are on and the page is a configured origin. */
  function requireAvailable(origin: string | null) {
    if (!config.enabled || !origin || !config.origins.includes(origin)) {
      fail('FORBIDDEN', PASSKEY_ERROR.UNAVAILABLE, 'Passkeys are not available on this address. Sign in with your password.');
    }
  }

  return {
    id: 'tindahan-passkey',
    endpoints: {
      passkeyRegistrationOptions: createAuthEndpoint(
        '/passkey/registration-options',
        { method: 'POST', use: [freshSessionMiddleware] },
        async (ctx) => {
          requireAvailable(headerOf(ctx.request, ctx.headers, 'origin'));
          const { user, session } = ctx.context.session;

          // A locked POS screen must not let whoever is at the till attach
          // their own authenticator to the signed-in account.
          const [account, sessionRow, existing] = await Promise.all([
            platformPrisma.user.findUnique({ where: { id: user.id }, select: { isActive: true, username: true, name: true } }),
            platformPrisma.session.findUnique({ where: { id: session.id }, select: { lockedAt: true } }),
            platformPrisma.passkey.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } }),
          ]);
          if (!account?.isActive || !sessionRow || sessionRow.lockedAt) {
            fail('FORBIDDEN', PASSKEY_ERROR.REGISTRATION_FAILED, 'Unlock the screen and sign in again to add a passkey.');
          }

          const options = await generateRegistrationOptions({
            rpName: APP_NAME,
            rpID: config.rpID,
            // Stable per account, so re-registering on the same device replaces
            // rather than duplicates; a cuid carries no personal data.
            userID: isoUint8Array.fromUTF8String(user.id),
            userName: account.username,
            userDisplayName: account.name,
            attestationType: 'none',
            excludeCredentials: existing.map((p) => ({
              id: p.credentialId,
              transports: splitTransports(p.transports),
            })),
            authenticatorSelection: {
              // Discoverable, so sign-in needs no username: the device lists
              // the accounts it holds a passkey for.
              residentKey: 'required',
              requireResidentKey: true,
              userVerification: 'required',
            },
            timeout: CHALLENGE_TTL_SECONDS * 1000,
          });

          await storeCeremony(ctx, { type: 'registration', challenge: options.challenge, userId: user.id });
          return ctx.json(options);
        },
      ),

      passkeyVerifyRegistration: createAuthEndpoint(
        '/passkey/verify-registration',
        { method: 'POST', use: [freshSessionMiddleware] },
        async (ctx) => {
          requireAvailable(headerOf(ctx.request, ctx.headers, 'origin'));
          const parsed = registrationBody.safeParse(ctx.body);
          if (!parsed.success) fail('BAD_REQUEST', PASSKEY_ERROR.REGISTRATION_FAILED, 'The passkey could not be saved.');

          const { user, session } = ctx.context.session;
          const ceremony = await consumeCeremony(ctx);
          // The challenge must have been issued to this same signed-in user.
          if (ceremony?.type !== 'registration' || ceremony.userId !== user.id) {
            fail('BAD_REQUEST', PASSKEY_ERROR.REGISTRATION_FAILED, 'That passkey request expired. Try again.');
          }

          const sessionRow = await platformPrisma.session.findUnique({ where: { id: session.id }, select: { lockedAt: true } });
          if (!sessionRow || sessionRow.lockedAt) {
            fail('FORBIDDEN', PASSKEY_ERROR.REGISTRATION_FAILED, 'Unlock the screen and sign in again to add a passkey.');
          }

          let info;
          try {
            const verification = await verifyRegistrationResponse({
              response: parsed.data.response,
              expectedChallenge: ceremony.challenge,
              expectedOrigin: config.origins,
              expectedRPID: config.rpID,
              requireUserVerification: true,
            });
            if (!verification.verified || !verification.registrationInfo) throw new Error('not verified');
            info = verification.registrationInfo;
          } catch (error) {
            ctx.context.logger.warn('Passkey registration rejected', error);
            fail('BAD_REQUEST', PASSKEY_ERROR.REGISTRATION_FAILED, 'The passkey could not be verified. Try again.');
          }

          const userAgent = headerOf(ctx.request, ctx.headers, 'user-agent');
          try {
            const created = await platformPrisma.$transaction(async (tx) => {
              const passkey = await tx.passkey.create({
                data: {
                  userId: user.id,
                  credentialId: info.credential.id,
                  publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
                  counter: info.credential.counter,
                  transports: info.credential.transports?.join(',') || null,
                  deviceType: info.credentialDeviceType,
                  backedUp: info.credentialBackedUp,
                  aaguid: info.aaguid,
                  name: parsed.data.name || passkeyLabelFromUserAgent(userAgent),
                },
                select: { id: true, name: true },
              });
              const owner = await tx.user.findUnique({ where: { id: user.id }, select: { storeId: true } });
              await tx.auditLog.create({
                data: {
                  storeId: owner?.storeId ?? null,
                  action: 'UPDATE',
                  entity: 'User',
                  entityId: user.id,
                  summary: `Added a passkey (${passkey.name})`,
                  userId: user.id,
                  ipAddress: headerOf(ctx.request, ctx.headers, 'x-forwarded-for')?.split(',')[0]?.trim() || null,
                  userAgent,
                },
              });
              return passkey;
            });
            return ctx.json({ id: created.id, name: created.name });
          } catch (error) {
            if ((error as { code?: string }).code === 'P2002') {
              fail('CONFLICT', PASSKEY_ERROR.ALREADY_REGISTERED, 'This passkey is already registered.');
            }
            throw error;
          }
        },
      ),

      passkeyAuthenticationOptions: createAuthEndpoint(
        '/passkey/authentication-options',
        { method: 'POST' },
        async (ctx) => {
          requireAvailable(headerOf(ctx.request, ctx.headers, 'origin'));
          // No allowCredentials: the device offers the passkeys it holds for
          // this site, so the user never types a username first.
          const options = await generateAuthenticationOptions({
            rpID: config.rpID,
            userVerification: 'required',
            timeout: CHALLENGE_TTL_SECONDS * 1000,
          });
          await storeCeremony(ctx, { type: 'authentication', challenge: options.challenge });
          return ctx.json(options);
        },
      ),

      passkeyVerifyAuthentication: createAuthEndpoint(
        '/passkey/verify-authentication',
        { method: 'POST' },
        async (ctx) => {
          requireAvailable(headerOf(ctx.request, ctx.headers, 'origin'));
          const parsed = authenticationBody.safeParse(ctx.body);
          if (!parsed.success) fail('BAD_REQUEST', PASSKEY_ERROR.FAILED, PASSKEY_SIGN_IN_FAILED);
          const response = parsed.data.response;

          // Consumed before anything else, so a replayed or raced challenge
          // fails even when the rest of the request is valid.
          const ceremony = await consumeCeremony(ctx);
          if (ceremony?.type !== 'authentication') fail('UNAUTHORIZED', PASSKEY_ERROR.FAILED, PASSKEY_SIGN_IN_FAILED);

          const passkey = typeof response.id === 'string'
            ? await platformPrisma.passkey.findUnique({ where: { credentialId: response.id } })
            : null;
          if (!passkey) {
            // The device still holds a passkey this server no longer knows —
            // revoked, or registered against another environment.
            fail('UNAUTHORIZED', PASSKEY_ERROR.NOT_REGISTERED, 'This passkey is no longer registered. Sign in with your password, then create a new one.');
          }

          // The authenticator names the account the passkey was made for; it
          // must be the account the credential is stored against.
          const userHandle = response.response?.userHandle;
          if (userHandle && userHandleToUserId(userHandle) !== passkey.userId) {
            fail('UNAUTHORIZED', PASSKEY_ERROR.FAILED, PASSKEY_SIGN_IN_FAILED);
          }

          let newCounter: number;
          try {
            const verification = await verifyAuthenticationResponse({
              response,
              expectedChallenge: ceremony.challenge,
              expectedOrigin: config.origins,
              expectedRPID: config.rpID,
              credential: {
                id: passkey.credentialId,
                publicKey: isoBase64URL.toBuffer(passkey.publicKey),
                counter: passkey.counter,
                transports: splitTransports(passkey.transports),
              },
              requireUserVerification: true,
            });
            if (!verification.verified) throw new Error('not verified');
            newCounter = verification.authenticationInfo.newCounter;
          } catch (error) {
            ctx.context.logger.warn('Passkey sign-in rejected', error);
            fail('UNAUTHORIZED', PASSKEY_ERROR.FAILED, PASSKEY_SIGN_IN_FAILED);
          }

          // The same session creation as password sign-in: its hooks refuse a
          // deactivated account and record the login.
          const dontRememberMe = parsed.data.rememberMe === false;
          let created;
          try {
            created = await ctx.context.internalAdapter.createSession(passkey.userId, dontRememberMe);
          } catch {
            fail('UNAUTHORIZED', PASSKEY_ERROR.FAILED, PASSKEY_SIGN_IN_FAILED);
          }
          const user = created ? await ctx.context.internalAdapter.findUserById(passkey.userId) : null;
          if (!created || !user) fail('UNAUTHORIZED', PASSKEY_ERROR.FAILED, PASSKEY_SIGN_IN_FAILED);

          await platformPrisma.passkey.update({
            where: { id: passkey.id },
            data: { counter: newCounter, lastUsedAt: new Date() },
          });

          await setSessionCookie(ctx, { session: created, user }, dontRememberMe);
          return ctx.json({ ok: true });
        },
      ),

      /** How many passkeys the signed-in user has — drives the post-sign-in prompt. */
      passkeyStatus: createAuthEndpoint('/passkey/status', { method: 'GET', use: [sessionMiddleware] }, async (ctx) => {
        const count = await platformPrisma.passkey.count({ where: { userId: ctx.context.session.user.id } });
        return ctx.json({ count });
      }),
    },

    rateLimit: [
      {
        // Tighter than the default: each of these is a sign-in attempt or
        // creates a challenge row.
        pathMatcher: (path) => path.startsWith('/passkey/') && path !== '/passkey/status',
        window: 60,
        max: 10,
      },
    ],
  } satisfies BetterAuthPlugin;
}

/* -------------------------------------------------------------------------- */

type EndpointCtx = GenericEndpointContext;

async function storeCeremony(ctx: EndpointCtx, ceremony: Ceremony) {
  const token = crypto.randomUUID();
  const cookie = ctx.context.createAuthCookie(CHALLENGE_COOKIE);
  await ctx.setSignedCookie(cookie.name, token, ctx.context.secret, {
    ...cookie.attributes,
    maxAge: CHALLENGE_TTL_SECONDS,
  });
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: `passkey:${token}`,
    value: JSON.stringify(ceremony),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
  });
}

/**
 * Takes this browser's pending challenge, deleting it in the same step.
 * Null when missing, expired, already used, or the cookie was tampered with.
 */
async function consumeCeremony(ctx: EndpointCtx): Promise<Ceremony | null> {
  const cookie = ctx.context.createAuthCookie(CHALLENGE_COOKIE);
  const token = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  // Spent whatever happens next.
  ctx.setCookie(cookie.name, '', { ...cookie.attributes, maxAge: 0 });
  if (!token) return null;

  const row = await ctx.context.internalAdapter.consumeVerificationValue(`passkey:${token}`);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Ceremony;
  } catch {
    return null;
  }
}

function splitTransports(value: string | null): AuthenticatorTransportFuture[] | undefined {
  return value ? (value.split(',') as AuthenticatorTransportFuture[]) : undefined;
}

function userHandleToUserId(userHandle: string): string | null {
  try {
    return isoUint8Array.toUTF8String(isoBase64URL.toBuffer(userHandle));
  } catch {
    return null;
  }
}
