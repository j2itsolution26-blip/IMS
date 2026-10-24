import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePassword, validatePassword } from '@/lib/password';

// The Create Owner modal's Generate button asks for 16 characters.
test('16-character owner passwords always satisfy the password policy', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    const password = generatePassword(16);
    assert.equal(password.length, 16);
    assert.ok(validatePassword(password).isValid, password);
    assert.doesNotMatch(password, /[0O1lI]/, 'look-alike characters are left out');
    seen.add(password);
  }
  assert.equal(seen.size, 500, 'each click should give a new password');
});

test('generation fails rather than falling back when secure randomness is missing', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    assert.throws(() => generatePassword(16));
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  }
  assert.equal(generatePassword(16).length, 16, 'crypto is restored for other tests');
});
