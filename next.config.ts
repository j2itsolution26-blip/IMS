import type { NextConfig } from 'next';

const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null;
  } catch {
    return null;
  }
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
  // Lint and type-check are run as their own steps (`npm run verify`) rather
  // than inside `next build`. Both pass in seconds standalone, but Next's
  // combined lint+typecheck worker is killed part-way through on this
  // Windows/Node 24 setup. Splitting them keeps the checks — and makes their
  // output readable — without the build inheriting that instability.
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }]
      : [],
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
