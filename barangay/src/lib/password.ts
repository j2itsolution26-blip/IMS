import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;
const COST = 16384;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N: COST, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Returns `scrypt$<N>$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${COST}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || Number(cost) !== COST || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** At least 10 characters with a letter and a digit. Returns an error or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters.';
  if (password.length > 200) return 'Password is too long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    return 'Password must contain at least one letter and one number.';
  return null;
}
