import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAppUrl, getTrustedOrigins, isStorageConfigured } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Deployment health check.
 *
 * Exists because a misconfigured deployment otherwise surfaces as a generic
 * "sign in failed" with no way to tell a missing environment variable from an
 * unreachable database.
 *
 * Deliberately reports only *presence* of secrets, never their values. The
 * resolved origins are included because they are public URLs and getting them
 * wrong is the most common cause of authentication failing in production.
 */
export async function GET() {
  const required = ['DATABASE_URL', 'DIRECT_URL', 'BETTER_AUTH_SECRET'] as const;

  const env = Object.fromEntries(
    required.map((key) => [key, Boolean(process.env[key]?.trim())]),
  ) as Record<(typeof required)[number], boolean>;

  // A secret that is present but too short fails silently inside Better Auth,
  // so length is checked separately from presence.
  const secretLooksValid = (process.env.BETTER_AUTH_SECRET?.length ?? 0) >= 32;

  let database: { reachable: boolean; error?: string; users?: number; roles?: number } = {
    reachable: false,
  };

  try {
    const [users, roles] = await Promise.all([prisma.user.count(), prisma.role.count()]);
    database = { reachable: true, users, roles };
  } catch (error) {
    database = {
      reachable: false,
      // The message can contain the host but never the password — Prisma masks it.
      error: error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'unknown error',
    };
  }

  // Product image upload is optional, so it is reported separately and does
  // not affect `healthy`. Presence only — never the value, and never a prefix
  // or length that would narrow a guess at the secret.
  const storage = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    bucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'product-images',
    uploadEnabled: isStorageConfigured(),
  };

  const missing = required.filter((key) => !env[key]);
  const healthy = missing.length === 0 && secretLooksValid && database.reachable && (database.roles ?? 0) > 0;

  return NextResponse.json(
    {
      healthy,
      environment: {
        onVercel: Boolean(process.env.VERCEL),
        nodeEnv: process.env.NODE_ENV,
        variablesPresent: env,
        betterAuthSecretLength: secretLooksValid ? 'ok (>=32)' : 'MISSING OR TOO SHORT',
      },
      auth: {
        resolvedBaseUrl: getAppUrl(),
        trustedOrigins: getTrustedOrigins(),
      },
      database,
      storage,
      // Actionable next step rather than a bare boolean.
      diagnosis: healthy
        ? 'All checks passed.'
        : missing.length > 0
          ? `Missing environment variable(s): ${missing.join(', ')}. Set them in the Vercel project settings and redeploy.`
          : !secretLooksValid
            ? 'BETTER_AUTH_SECRET is missing or shorter than 32 characters.'
            : !database.reachable
              ? 'Database unreachable — check DATABASE_URL and that the Supabase project is running.'
              : 'Database reachable but no roles installed — run npm run db:bootstrap.',
    },
    { status: healthy ? 200 : 503 },
  );
}
