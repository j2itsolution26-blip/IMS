import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    rules: {
      // Unused values are a real smell, but a leading underscore is the
      // conventional way to say "deliberately ignored".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Prisma's generated types and the raw-SQL boundary genuinely need casts
      // in a few places; each one is commented where it appears.
      '@typescript-eslint/no-explicit-any': 'error',
      'react/no-unescaped-entities': 'error',
    },
  },
  {
    // Store isolation: the unscoped client sees every store. Store data goes
    // through `storeDb()` / `getStoreContext()` from `@/lib/tenant/context`,
    // whose client is confined to the signed-in user's store.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/prisma',
              importNames: ['platformPrisma'],
              message: 'Use storeDb() from @/lib/tenant/context for store data. The platform client is only for sign-in, platform administration and the tenant layer.',
            },
          ],
          patterns: [
            {
              group: ['**/lib/prisma'],
              importNames: ['platformPrisma'],
              message: 'Use storeDb() from @/lib/tenant/context for store data.',
            },
          ],
        },
      ],
    },
  },
  {
    // The few places that legitimately work across stores or outside any:
    // authentication and account security (platform administrators have no
    // store), platform administration, the tenant layer itself, and checks of
    // platform-wide unique values (usernames, emails). Adding a file here
    // needs a reason in that file.
    files: [
      'src/lib/prisma.ts',
      'src/lib/tenant/**',
      'src/lib/session.ts',
      'src/lib/auth.ts',
      'src/lib/passkey-plugin.ts',
      'src/features/auth/**',
      'src/features/platform/**',
      'src/features/admin/actions.ts',
      'src/server/services/audit-service.ts',
      'src/server/services/entitlements.ts',
      'src/server/platform/**',
      // Support works for suspended and read-only stores and for the public
      // Help page, so it cannot use the store client; every query there is
      // confined to the session's requester (MODEL_SCOPES denies the tables
      // to store clients).
      'src/server/support/**',
      'src/app/(auth)/**',
      'src/app/locked/**',
      'src/app/api/health/**',
      'src/app/(app)/settings/profile/**',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default config;
