import { createHash, randomBytes } from 'node:crypto';

// No 0/O, 1/I/L: the code is sometimes read aloud or typed from paper.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function sessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** `BC-2026-000042` style sequence numbers. */
export function formatSequence(prefix: string, year: number, n: number, width = 6): string {
  return `${prefix}-${year}-${String(n).padStart(width, '0')}`;
}
