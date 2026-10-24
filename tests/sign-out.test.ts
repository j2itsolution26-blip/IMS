import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { performSignOut } from '@/features/auth/sign-out-flow';
import { installActionAvailable } from '@/lib/pwa';

const read = (file: string) => readFileSync(file, 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

test('a successful sign-out navigates to the sign-in page', async () => {
  const visited: string[] = [];
  const outcome = await performSignOut(async () => ({ error: null }), (url) => visited.push(url));
  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(visited, ['/sign-in']);
});

test('an error response is reported and does not navigate', async () => {
  // Better Auth resolves `{ error }` instead of throwing.
  const visited: string[] = [];
  const outcome = await performSignOut(async () => ({ error: { message: 'Server error' } }), (url) => visited.push(url));
  assert.equal(outcome.ok, false);
  assert.deepEqual(visited, []);
});

test('a network failure is reported and does not navigate', async () => {
  const visited: string[] = [];
  const outcome = await performSignOut(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    (url) => visited.push(url),
  );
  assert.equal(outcome.ok, false);
  assert.deepEqual(visited, []);
});

test('every sign-out goes through the shared, confirmed flow', () => {
  // The lock screen's "Switch user" is the one deliberate exception: it runs
  // with the app already covered and always lands on sign-in.
  const allowed = new Set(['src/features/auth/sign-out.tsx', 'src/features/auth/lock-screen.tsx']);
  const offenders = sourceFiles('src')
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => !allowed.has(file) && /\bauthClient\.signOut\(|\bsignOut\(\)/.test(read(file)) && !file.endsWith('sign-out-flow.ts'));
  assert.deepEqual(offenders, []);
});

test('the header avatar and the sidebar card open the same account menu', () => {
  const sidebar = read('src/components/layout/sidebar.tsx');
  assert.match(sidebar, /<AccountMenu\b/);
  assert.doesNotMatch(sidebar, /authClient/);
  const menu = read('src/components/layout/user-menu.tsx');
  assert.match(menu, /<SignOutDialog\b/);
  assert.doesNotMatch(menu, /authClient/);
});

test('"Install app" is offered only where it leads somewhere', () => {
  const ready = { installed: false, canPrompt: false };
  assert.equal(installActionAvailable(null, 'android'), false, 'not before hydration');
  assert.equal(installActionAvailable({ installed: true, canPrompt: true }, 'android'), false, 'not once installed');
  assert.equal(installActionAvailable(ready, 'desktop-firefox'), false, 'desktop Firefox cannot install');
  assert.equal(installActionAvailable({ installed: false, canPrompt: true }, 'desktop-firefox'), true);
  assert.equal(installActionAvailable(ready, 'ios'), true, 'iOS gets the Add to Home Screen steps');
  assert.equal(installActionAvailable(ready, 'desktop-chromium'), true);
  assert.equal(installActionAvailable(ready, null), false);
});
