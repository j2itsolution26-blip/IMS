import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { PASSWORD_POLICY_MESSAGE, validatePassword } from '@/lib/password';
import { StoreScopeError, scopeArgs } from '@/lib/tenant/scope';

/**
 * First-time setup's pure parts: routing at the edge, the password policy,
 * the isolation rule for the installation record, and the migration that
 * marks existing systems as set up. The database half (claim, concurrency,
 * closing for good) is tests/integration/setup.integration.ts.
 */

const COOKIE = 'better-auth.session_token';
const visit = (path: string, signedIn = false) => {
  const request = new NextRequest(`http://localhost${path}`, {
    headers: signedIn ? { cookie: `${COOKIE}=abc` } : {},
  });
  return middleware(request);
};
const target = (response: Response) => response.headers.get('location');

test('signed out: /setup and /sign-in are reachable; everything else goes to sign-in', () => {
  assert.equal(target(visit('/setup')), null);
  assert.equal(target(visit('/sign-in')), null);
  assert.match(target(visit('/dashboard')) ?? '', /\/sign-in\?next=%2Fdashboard$/);
  assert.match(target(visit('/system-admin/stores')) ?? '', /\/sign-in/);
  assert.match(target(visit('/api/reports/sales-summary/export')) ?? '', /\/sign-in/);
});

test('signed in: setup, sign-in and the old sign-up address go to the dashboard', () => {
  for (const path of ['/setup', '/sign-in', '/sign-up']) {
    assert.match(target(visit(path, true)) ?? '', /\/dashboard$/, path);
  }
  assert.equal(target(visit('/dashboard', true)), null);
});

test('the setup password policy is the one the account hook enforces', () => {
  for (const weak of ['short1!A', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoNumbers!!!a', 'NoSymbols123a']) {
    assert.equal(validatePassword(weak).isValid, false, weak);
  }
  assert.equal(validatePassword('Str0ng!Passw0rd').isValid, true);
  assert.match(PASSWORD_POLICY_MESSAGE, /10 characters/);
  // The hook in src/lib/auth.ts must use the shared rule, not a copy.
  const auth = readFileSync('src/lib/auth.ts', 'utf8');
  assert.ok(auth.includes('validatePassword(body.password).isValid'));
  assert.ok(!/Public sign-up is only|userCount === 0|claimOwnerSetupSlot/.test(auth), 'the first-account-becomes-owner path is gone');
});

test('a store client can never read or write the installation record', () => {
  for (const op of ['findUnique', 'findMany', 'update', 'create', 'deleteMany']) {
    assert.throws(() => scopeArgs('Installation', op, {}, 'store_a'), StoreScopeError, op);
  }
});

test('the migration marks any installation that already has accounts as set up', () => {
  const sql = readFileSync('prisma/migrations/20261027090000_installation_setup/migration.sql', 'utf8');
  assert.match(sql, /CHECK \("id" = 1\)/);
  assert.match(sql, /INSERT INTO "installation"[\s\S]*'COMPLETED'[\s\S]*WHERE EXISTS \(SELECT 1 FROM "users"\);\s*$/);
  assert.match(sql, /a completed installation cannot be reopened/);
});

test('bootstrap no longer creates a store or any account on an empty database', () => {
  const bootstrap = readFileSync('prisma/bootstrap.ts', 'utf8');
  assert.ok(!/store\.create\(/.test(bootstrap));
  assert.ok(!/user\.create|signUpEmail/.test(bootstrap));
});

test('a database without its tables is told apart from one that cannot be reached', async () => {
  const { classifySetupError, errorCode } = await import('@/lib/setup-status');
  const prismaError = (code: string, message = 'x', meta?: Record<string, unknown>) => Object.assign(new Error(message), { code, meta });

  assert.equal(classifySetupError(prismaError('P2021', 'The table `public.installation` does not exist')), 'needs-migrations');
  assert.equal(classifySetupError(prismaError('P2022')), 'needs-migrations');
  assert.equal(classifySetupError(prismaError('P2010', 'Raw query failed', { code: '42P01' })), 'needs-migrations');
  assert.equal(classifySetupError(new Error('ERROR: relation "installation" does not exist')), 'needs-migrations');

  assert.equal(classifySetupError(prismaError('P1001', "Can't reach database server")), 'unreachable');
  assert.equal(classifySetupError(prismaError('P1017', 'Server has closed the connection.')), 'unreachable');
  assert.equal(classifySetupError(Object.assign(new Error('init'), { name: 'PrismaClientInitializationError' })), 'unreachable');

  assert.equal(classifySetupError(new Error('something else')), 'failed');
  assert.equal(classifySetupError(null), 'failed');

  // Only the code is ever logged, never a message that could hold a connection string.
  const leaky = prismaError('P1001', 'postgresql://user:secret@host/db unreachable');
  assert.equal(errorCode(leaky), 'P1001');
  assert.ok(!errorCode(leaky).includes('secret'));
});
