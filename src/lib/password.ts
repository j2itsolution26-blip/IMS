/**
 * Password strength rules, shared by every form that sets a password
 * (owner setup, and account settings) so the rules can never drift between
 * them. Mirrors the server-side check in `src/lib/auth.ts` exactly.
 */
export function validatePassword(password: string) {
  const minLength = password.length >= 10;
  const uppercase = /[A-Z]/.test(password);
  const lowercase = /[a-z]/.test(password);
  const number = /[0-9]/.test(password);
  const specialCharacter = /[^A-Za-z0-9]/.test(password);
  const isValid = minLength && uppercase && lowercase && number && specialCharacter;

  const metCount = [minLength, uppercase, lowercase, number, specialCharacter].filter(Boolean).length;

  return {
    minLength,
    uppercase,
    lowercase,
    number,
    specialCharacter,
    isValid,
    metCount,
  };
}

// Look-alike characters (0/O, 1/l/I) are left out so a password read aloud
// or copied from a screen is typed correctly the first time.
const PASSWORD_SETS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnpqrstuvwxyz',
  '23456789',
  '!@#$%&*?-_+=',
] as const;

/**
 * A random 14-character temporary password that always satisfies
 * `validatePassword`, for the owner to hand to a new staff member.
 *
 * Uses the Web Crypto CSPRNG (available in browsers and Node 19+), never
 * `Math.random`.
 */
export function generatePassword(length = 14): string {
  const all = PASSWORD_SETS.join('');
  const pick = (chars: string) => chars[randomBelow(chars.length)];

  // One from each class guarantees the policy; the rest are drawn from all.
  const characters: string[] = PASSWORD_SETS.map(pick);
  while (characters.length < Math.max(length, 10)) characters.push(pick(all));

  // Fisher–Yates, so the guaranteed characters are not always up front.
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = randomBelow(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }
  return characters.join('');
}

/** Uniform integer in [0, max) for max ≤ 256, by rejection sampling (no modulo bias). */
function randomBelow(max: number): number {
  const limit = 256 - (256 % max);
  const byte = new Uint8Array(1);
  do crypto.getRandomValues(byte);
  while (byte[0] >= limit);
  return byte[0] % max;
}
