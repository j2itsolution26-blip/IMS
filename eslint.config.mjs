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
];

export default config;
