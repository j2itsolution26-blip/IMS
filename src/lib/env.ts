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
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  /** Legacy name for SUPABASE_SECRET_KEY. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  /** Legacy name for NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. */
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
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
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
  return Boolean(getSupabaseUrl() && getSupabaseSecretKey());
}

/** The environment variable names the secret key may arrive under, newest first. */
const SECRET_KEY_VARS = ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

/**
 * The server-side Supabase key.
 *
 * `SUPABASE_SECRET_KEY` is Supabase's current name; `SUPABASE_SERVICE_ROLE_KEY`
 * is the legacy one and is still honoured so an existing deployment keeps
 * working across the rename.
 *
 * This key bypasses row level security and must never reach the browser, so
 * reading it from client code fails loudly rather than silently returning
 * undefined. It is deliberately never given a NEXT_PUBLIC_ name — Next inlines
 * those into the client bundle.
 */
export function getSupabaseSecretKey(): string | undefined {
  if (typeof window !== 'undefined') {
    throw new Error('The Supabase secret key must never be read in the browser.');
  }
  for (const name of SECRET_KEY_VARS) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Which variable supplied the secret key. The name only — never the value. */
export function getSupabaseSecretKeySource(): string | null {
  if (typeof window !== 'undefined') return null;
  return SECRET_KEY_VARS.find((name) => process.env[name]?.trim()) ?? null;
}

/**
 * The browser-safe Supabase key.
 *
 * Accepted under both the current and legacy names. This application talks to
 * Supabase only from the server, so nothing consumes it today; it is recognised
 * so a correctly configured project is reported as such rather than as missing.
 */
export function getSupabasePublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    undefined
  );
}

/**
 * The Supabase project ref carried inside the Postgres connection string.
 *
 * Both connection styles Supabase hands out are recognised:
 *   pooled  postgres.<ref>@aws-0-<region>.pooler.supabase.com
 *   direct  postgres@db.<ref>.supabase.co
 *
 * The ref is not a secret — it is the public subdomain of every image URL.
 */
function projectRefFromDatabase(): string | undefined {
  for (const value of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      const pooled = /^postgres\.([a-z0-9]{16,})$/i.exec(decodeURIComponent(url.username));
      if (pooled) return pooled[1];
      const direct = /^db\.([a-z0-9]{16,})\.supabase\.co$/i.exec(url.hostname);
      if (direct) return direct[1];
    } catch {
      // Not a URL we can read — fall through to the next candidate.
    }
  }
  return undefined;
}

/**
 * The subdomain of a Supabase-hosted URL, whatever it is.
 *
 * Deliberately not restricted to the shape of a real project ref: a
 * placeholder like `your-project.supabase.co`, or a typo, is precisely the
 * value that needs to be recognised as "not this project" and repaired.
 */
function refOfSupabaseHost(url: string): string | undefined {
  try {
    return /^([a-z0-9-]+)\.supabase\.(co|in)$/i.exec(new URL(url).hostname)?.[1];
  } catch {
    return undefined;
  }
}

export interface SupabaseUrlResolution {
  url?: string;
  source: 'configured' | 'derived-from-database' | 'corrected-to-database' | 'none';
  /** Present when an explicitly configured value was overridden or unusable. */
  note?: string;
}

let correctionLogged = false;

/**
 * The Supabase project URL, reconciled against the database.
 *
 * Storage and the database are one Supabase project in this application, so the
 * connection string the app is demonstrably already using is the authority on
 * which project that is. An absent, malformed, or stale `NEXT_PUBLIC_SUPABASE_URL`
 * is therefore repaired from `DATABASE_URL` rather than being allowed to fail
 * later as an unresolvable hostname — the exact failure this replaces.
 *
 * A configured host that is not a Supabase one (custom domain, self-hosted) is
 * always honoured, because there is nothing to reconcile it against.
 */
export function resolveSupabaseUrl(): SupabaseUrlResolution {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const databaseRef = projectRefFromDatabase();
  const derived = databaseRef ? `https://${databaseRef}.supabase.co` : undefined;

  if (!configured) {
    return derived
      ? {
          url: derived,
          source: 'derived-from-database',
          note: 'NEXT_PUBLIC_SUPABASE_URL is not set; using the project from DATABASE_URL.',
        }
      : { source: 'none' };
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(configured);
  } catch {
    parsed = null;
  }

  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    return derived
      ? {
          url: derived,
          source: 'corrected-to-database',
          note: `NEXT_PUBLIC_SUPABASE_URL ("${configured}") is not a valid URL; using the project from DATABASE_URL instead.`,
        }
      : { source: 'none', note: `NEXT_PUBLIC_SUPABASE_URL ("${configured}") is not a valid URL.` };
  }

  const configuredRef = refOfSupabaseHost(configured);

  // A Supabase host naming a different project than the database is the stale
  // value this reconciliation exists for.
  if (configuredRef && databaseRef && configuredRef !== databaseRef && derived) {
    if (!correctionLogged) {
      correctionLogged = true;
      console.warn(
        `[env] NEXT_PUBLIC_SUPABASE_URL points at project "${configuredRef}" but the database is project "${databaseRef}". Using the database's project for storage. Update the variable to ${derived} to silence this.`,
      );
    }
    return {
      url: derived,
      source: 'corrected-to-database',
      note: `NEXT_PUBLIC_SUPABASE_URL points at project "${configuredRef}", but DATABASE_URL uses project "${databaseRef}". Storage is using the database's project. Set NEXT_PUBLIC_SUPABASE_URL to ${derived} and redeploy.`,
    };
  }

  return { url: parsed.origin, source: 'configured' };
}

/**
 * The Supabase project URL. Neither value is secret: it appears in every
 * public image URL.
 */
export function getSupabaseUrl(): string | undefined {
  return resolveSupabaseUrl().url;
}

export function getAppUrl(): string {
  return resolveBaseUrl() ?? 'http://localhost:3000';
}
