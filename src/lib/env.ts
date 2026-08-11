import { z } from 'zod';

/**
 * Environment contract.
 *
 * Validation is deliberately lazy: `next build` runs module code during static
 * analysis and Vercel builds do not always expose runtime secrets, so throwing
 * at import time would break deploys. Values are validated the first time
 * something actually reads them.
 */

const serverSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid Postgres connection string'),
  DIRECT_URL: z.string().url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('product-images'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

const onVercel = () => Boolean(process.env.VERCEL);
const isLocalhost = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);

/**
 * Resolves the canonical origin the app is served from.
 *
 * Order matters. Vercel exposes three different hostnames per deployment and
 * picking the wrong one breaks authentication, because Better Auth validates
 * the request's Origin header against this value:
 *
 *   VERCEL_PROJECT_PRODUCTION_URL  the stable production domain
 *   VERCEL_BRANCH_URL              the branch alias (…-git-main-…)
 *   VERCEL_URL                     unique per deployment (…-pcctzhaq5-…)
 *
 * `VERCEL_URL` changes on every push, so it is the last resort rather than the
 * first choice. An explicitly configured localhost value is ignored in a Vercel
 * environment — that only ever comes from a `.env` copied into the dashboard by
 * mistake, and honouring it would break sign-in on every deployment.
 */
function resolveBaseUrl(): string | undefined {
  const configured = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured && !(onVercel() && isLocalhost(configured))) return configured;

  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_BRANCH_URL ||
    process.env.VERCEL_URL;

  return host ? `https://${host}` : undefined;
}

/**
 * Every origin the app may legitimately be reached on.
 *
 * A Vercel deployment answers on all three hostnames at once, so all three must
 * be trusted or signing in works on one URL and fails on the others.
 */
export function getTrustedOrigins(): string[] {
  const origins = new Set<string>();

  for (const value of [process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (value && !(onVercel() && isLocalhost(value))) origins.add(value.replace(/\/$/, ''));
  }

  for (const host of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_URL,
  ]) {
    if (host) origins.add(`https://${host}`);
  }

  if (!onVercel()) {
    origins.add('http://localhost:3000');
  }

  return [...origins];
}

export function getEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: resolveBaseUrl(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** True when Supabase Storage is configured; image upload degrades gracefully without it. */
/**
 * Whether product image upload can work.
 *
 * Uploads happen server-side with the service-role key, so only the project URL
 * and that key are required. The anon key was previously demanded here too,
 * which gated upload off for deployments that were in fact perfectly capable of
 * it — the anon key is for browser-side Supabase clients, and this application
 * has none.
 */
export function isStorageConfigured(): boolean {
  return Boolean(getSupabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

/**
 * The Supabase project URL.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` is the established name — `next.config.ts` reads
 * it to allow the storage host in `images.remotePatterns`. A plain
 * `SUPABASE_URL` is accepted as well, because nothing on the server needs the
 * NEXT_PUBLIC_ prefix and it is an easy variable to add under the shorter name.
 * Neither value is secret: it appears in every public image URL.
 */
export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || undefined;
}

export function getAppUrl(): string {
  return resolveBaseUrl() ?? 'http://localhost:3000';
}
