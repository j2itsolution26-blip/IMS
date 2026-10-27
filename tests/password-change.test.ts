import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHANGE_PASSWORD_PATH,
  isBlockedWhileRestricted,
  passwordChangeProblems,
} from '@/lib/password-change';
import { generatePassword } from '@/lib/password';

// --- The rules for a new password -------------------------------------------

const temporary = generatePassword(16);
const chosen = 'Sari-Sari2026!';

test('a valid change has no problems', () => {
  assert.deepEqual(
    passwordChangeProblems({ currentPassword: temporary, newPassword: chosen, confirmPassword: chosen }),
    {},
  );
});

test('every field is required', () => {
  const problems = passwordChangeProblems({ currentPassword: '', newPassword: '', confirmPassword: '' });
  assert.ok(problems.currentPassword);
  assert.ok(problems.newPassword);
  assert.ok(problems.confirmPassword);
});

test('a weak new password is rejected', () => {
  for (const weak of ['short1!A', 'alllowercase1!', 'ALLUPPERCASE1!', 'NoNumbersHere!', 'NoSymbols12345']) {
    const problems = passwordChangeProblems({ currentPassword: temporary, newPassword: weak, confirmPassword: weak });
    assert.ok(problems.newPassword, weak);
  }
});

test('a mismatched confirmation is rejected', () => {
  const problems = passwordChangeProblems({
    currentPassword: temporary,
    newPassword: chosen,
    confirmPassword: `${chosen}x`,
  });
  assert.equal(problems.confirmPassword, 'The passwords do not match.');
  assert.equal(problems.newPassword, undefined);
});

test('the temporary password cannot be kept', () => {
  const problems = passwordChangeProblems({
    currentPassword: temporary,
    newPassword: temporary,
    confirmPassword: temporary,
  });
  assert.equal(problems.newPassword, 'Choose a password different from the temporary one.');
});

test('an over-long new password is rejected', () => {
  const long = `Aa1!${'x'.repeat(130)}`;
  const problems = passwordChangeProblems({ currentPassword: temporary, newPassword: long, confirmPassword: long });
  assert.ok(problems.newPassword);
});

// --- Better Auth endpoints refused while restricted -------------------------

test('the built-in password, profile and passkey endpoints are refused while restricted', () => {
  for (const path of ['/change-password', '/update-user', '/change-email', '/set-password', '/passkey/add-passkey']) {
    assert.equal(isBlockedWhileRestricted(path), true, path);
  }
});

test('signing in and out stay possible while restricted', () => {
  for (const path of ['/sign-in/username', '/sign-in/email', '/sign-out', '/get-session']) {
    assert.equal(isBlockedWhileRestricted(path), false, path);
  }
});

// --- Every way in is guarded -------------------------------------------------

const SRC = join(process.cwd(), 'src');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('every session guard refuses a pending password change', () => {
  const session = read('lib/session.ts');
  assert.match(session, /if \(user\.mustChangePassword\) redirect\(CHANGE_PASSWORD_PATH\)/, 'requireUser redirects');
  for (const guard of ['authorize', 'authenticate']) {
    const body = session.slice(session.indexOf(`export async function ${guard}(`));
    const end = body.indexOf('\n}\n');
    assert.match(body.slice(0, end), /assertPasswordSettled\(user\)/, `${guard} refuses`);
  }
  assert.match(read('lib/tenant/context.ts'), /assertPasswordSettled\(user\)/, 'the store gateway refuses');
  assert.equal(CHANGE_PASSWORD_PATH, '/change-password');
});

test('nothing reads the signed-in user without handling a pending password change', () => {
  // Files allowed to call getCurrentUser() directly, each for a stated reason.
  // Anything else must go through requireUser / authorize / authenticate, or
  // check `mustChangePassword` itself.
  const allowed = new Set([
    'lib/session.ts', // defines the guards
    'app/change-password/page.tsx', // the restricted page itself
    'app/locked/page.tsx', // reached only via requireUser, which redirects first
    'features/auth/lock-actions.ts', // lock/unlock own screen: no store data, no other account
    'lib/tenant/context.ts', // calls assertPasswordSettled
    'server/services/plan-ui.ts', // reads only the signed-in user's own plan for display
    'server/services/settings-service.ts', // then reads through storeDb, which refuses
  ]);
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const relative = file.slice(SRC.length + 1).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    if (!text.includes('getCurrentUser()') || allowed.has(relative)) continue;
    const guarded = /mustChangePassword|assertPasswordSettled/.test(text);
    if (!guarded) offenders.push(relative);
  }
  assert.deepEqual(offenders, [], 'reads the user without checking for a pending password change');
});

test('the flag is never taken from sign-up input and is set by trusted callers', () => {
  const authConfig = read('lib/auth.ts');
  assert.match(authConfig, /mustChangePassword: \{ type: 'boolean', required: false, defaultValue: false, input: false \}/);
  assert.match(authConfig, /return \{ data: \{ \.\.\.user, roleId, storeId, mustChangePassword, isActive \} \}/);
  assert.match(read('server/platform/subscription-service.ts'), /mustChangePassword: true/, 'Create store');
  assert.match(read('features/platform/actions.ts'), /runAsProvisioning\(\{ storeId: store\.id, roleId: role\.id, mustChangePassword: true \}/, 'Create owner');
  assert.match(read('features/platform/actions.ts'), /data: \{ mustChangePassword: true \}/, 'Reset owner password');
});

test('the change clears the flag only inside the transaction that stores the new hash', () => {
  const action = read('features/auth/password-change-actions.ts');
  const transaction = action.slice(action.indexOf('$transaction'));
  assert.match(transaction, /data: \{ password: hash \}/);
  assert.match(transaction, /data: \{ mustChangePassword: false \}/);
  assert.ok(
    transaction.indexOf('password: hash') < transaction.indexOf('mustChangePassword: false'),
    'hash is written before the flag is cleared',
  );
  assert.doesNotMatch(action, /console\.(log|info|debug)/, 'nothing is logged');
});
