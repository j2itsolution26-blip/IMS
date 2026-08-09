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

function resolveBaseUrl(): string | undefined {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  // Vercel injects this for every deployment, including previews.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return undefined;
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
export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getAppUrl(): string {
  return resolveBaseUrl() ?? 'http://localhost:3000';
}
