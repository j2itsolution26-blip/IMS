import type { NextConfig } from 'next';

/**
 * Storage hosts images may be served from.
 *
 * Both the configured URL and the project named by DATABASE_URL are allowed:
 * when the two disagree, the application serves images from the database's
 * project (see `resolveSupabaseUrl`), so listing only the configured host
 * would block the very images it does load. Duplicating the small ref
 * extraction here rather than importing it keeps `next.config` free of
 * application code, which is loaded in a different context.
 */
const supabaseHosts = (() => {
  const hosts = new Set<string>();

  for (const value of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL]) {
    try {
      if (value) hosts.add(new URL(value).hostname);
    } catch {
      // Ignore an unparseable value; the derived host below still applies.
    }
  }

  for (const value of [process.env.DATABASE_URL, process.env.DIRECT_URL]) {
    try {
      if (!value) continue;
      const url = new URL(value);
      const ref =
        /^postgres\.([a-z0-9]{16,})$/i.exec(decodeURIComponent(url.username))?.[1] ??
        /^db\.([a-z0-9]{16,})\.supabase\.co$/i.exec(url.hostname)?.[1];
      if (ref) hosts.add(`${ref}.supabase.co`);
    } catch {
      // Not a connection string we can read.
    }
  }

  return [...hosts];
})();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Server-only packages that must not be bundled. `recharts` is deliberately
  // absent: it is a client-only charting library used solely from 'use client'
  // components, and Next already lists it internally for transpilation, so
  // naming it here is both wrong and a hard startup error ("the packages
  // specified in 'transpilePackages' conflict with 'serverExternalPackages'").
  serverExternalPackages: ['@prisma/client', 'exceljs', 'better-auth', 'kysely'],
  experimental: {
    serverActions: {
      // Product photos are uploaded through a server action, and the storage
      // service accepts up to 5 MB. Without this the default 1 MB cap rejects
      // mid-size camera photos first, with an error that says nothing about
      // size. The extra megabyte covers multipart encoding overhead.
      bodySizeLimit: '6mb',
    },
  },
  // Lint and type-check are run as their own steps (`npm run verify`) rather
  // than inside `next build`. Both pass in seconds standalone, but Next's
  // combined lint+typecheck worker is killed part-way through on this
  // Windows/Node 24 setup. Splitting them keeps the checks — and makes their
  // output readable — without the build inheriting that instability.
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: supabaseHosts.map((hostname) => ({
      protocol: 'https' as const,
      hostname,
      pathname: '/storage/v1/object/public/**',
    })),
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
