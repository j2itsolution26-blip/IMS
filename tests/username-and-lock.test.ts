import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEmailIdentifier,
  isValidUsername,
  normalizeUsername,
  suggestUsername,
  usernameProblem,
} from '@/lib/username';
import {
  MAX_PIN_FAILURES,
  MAX_UNLOCK_FAILURES,
  allowedUnlockMethods,
  pinProblem,
} from '@/lib/pos-pin';
import { isSafeReturnPath } from '@/lib/safe-path';
import { generatePassword, validatePassword } from '@/lib/password';

// --- Usernames ---------------------------------------------------------------

test('usernames are trimmed and lowercased, so capitalisation cannot create a duplicate', () => {
  assert.equal(normalizeUsername('  Juan.Cruz '), 'juan.cruz');
  assert.equal(normalizeUsername('JUAN'), normalizeUsername('juan'));
  assert.equal(normalizeUsername('Juan'), normalizeUsername(' jUaN'));
});

test('username rules: 3–30 of [a-z0-9_.] after normalising', () => {
  for (const ok of ['abc', 'juan.cruz', 'cashier_01', 'a'.repeat(30)]) {
    assert.equal(usernameProblem(ok), null, ok);
    assert.ok(isValidUsername(ok), ok);
  }
  for (const bad of ['', 'ab', 'a'.repeat(31), 'juan cruz', 'juan@store', 'juan-cruz', 'josé']) {
    assert.notEqual(usernameProblem(bad), null, bad);
  }
});

test('the sign-in field routes on "@": emails to email sign-in, everything else to username', () => {
  assert.ok(isEmailIdentifier('owner@store.ph'));
  assert.ok(!isEmailIdentifier('owner'));
  // An @ can never be part of a valid username, so the split is unambiguous.
  assert.notEqual(usernameProblem('a@b'), null);
});

// Mirrors the backfill in migration 20261020090000.
test('backfill derives a valid username from the email local part', () => {
  const taken = new Set<string>();
  assert.equal(suggestUsername('Maria.Santos@gmail.com', taken), 'maria.santos');
  assert.equal(suggestUsername('j+pos@store.ph', taken), 'jpos');
  assert.equal(suggestUsername('ab@store.ph', taken), 'ab0');
  assert.equal(suggestUsername('+++@store.ph', taken), 'user');
  assert.equal(suggestUsername(`${'x'.repeat(40)}@store.ph`, taken), 'x'.repeat(24));
  for (const name of taken) assert.ok(isValidUsername(name), name);
});

test('backfill never gives two accounts the same username', () => {
  const taken = new Set<string>();
  const emails = [
    'juan@a.com',
    'JUAN@b.com',
    'juan@c.com',
    'ju-an@d.com',
    'juan_2@e.com', // would collide with the second juan's suffix
    `${'y'.repeat(30)}@a.com`,
    `${'y'.repeat(30)}@b.com`,
  ];
  const assigned = emails.map((email) => suggestUsername(email, taken));

  assert.equal(new Set(assigned).size, emails.length, assigned.join(', '));
  assert.deepEqual(assigned.slice(0, 4), ['juan', 'juan_2', 'juan_3', 'juan_4']);
  assert.equal(assigned[4], 'juan_2_2');
  for (const name of assigned) assert.ok(isValidUsername(name), name);
});

// --- Screen-lock PIN ---------------------------------------------------------

test('PINs are 4–6 digits and not trivially guessable', () => {
  for (const ok of ['2580', '7391', '904172', '13579']) assert.equal(pinProblem(ok), null, ok);
  for (const bad of ['123', '1234567', '12a4', '', '1111', '000000', '1234', '9876', '456789']) {
    assert.notEqual(pinProblem(bad), null, bad);
  }
});

test('the lock screen falls back from PIN to password, then revokes the session', () => {
  assert.deepEqual(allowedUnlockMethods(true, 0), ['pin', 'password']);
  assert.deepEqual(allowedUnlockMethods(false, 0), ['password']);
  assert.deepEqual(allowedUnlockMethods(true, MAX_PIN_FAILURES - 1), ['pin', 'password']);
  assert.deepEqual(allowedUnlockMethods(true, MAX_PIN_FAILURES), ['password']);
  assert.deepEqual(allowedUnlockMethods(true, MAX_UNLOCK_FAILURES - 1), ['password']);
  assert.deepEqual(allowedUnlockMethods(true, MAX_UNLOCK_FAILURES), []);
  assert.deepEqual(allowedUnlockMethods(false, MAX_UNLOCK_FAILURES), []);
  assert.ok(MAX_PIN_FAILURES < MAX_UNLOCK_FAILURES);
});

// --- Redirect targets --------------------------------------------------------

test('only same-site paths are used as return targets after sign-in or unlock', () => {
  for (const ok of ['/dashboard', '/pos', '/sales/abc?x=1']) assert.ok(isSafeReturnPath(ok), ok);
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'pos', '', null, undefined]) {
    assert.ok(!isSafeReturnPath(bad), String(bad));
  }
});

// --- Temporary passwords -----------------------------------------------------

test('generated temporary passwords always satisfy the password policy', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    const password = generatePassword();
    assert.equal(password.length, 14);
    assert.ok(validatePassword(password).isValid, password);
    seen.add(password);
  }
  assert.equal(seen.size, 500, 'passwords should not repeat');
});
