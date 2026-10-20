/**
 * Username rules, shared by every form that sets one, the server actions that
 * save one, and the Better Auth `username` plugin configuration in
 * `src/lib/auth.ts` — so the browser, the actions and the sign-in endpoint can
 * never disagree about what a valid username is.
 *
 * Usernames are stored trimmed and lowercased. Uniqueness is enforced by the
 * database on that stored form (migration 20261020090000), which is what makes
 * `Juan` and `juan` the same account.
 *
 * Kept free of server imports so client components and unit tests can use it.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

const USERNAME_PATTERN = /^[a-z0-9_.]+$/;

export const USERNAME_HINT = `${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters: letters, numbers, underscores (_) and dots (.).`;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Checks an already-normalised username. Returns the problem, or `null` when valid. */
export function usernameProblem(value: string): string | null {
  if (value.length < USERNAME_MIN_LENGTH) return `Use at least ${USERNAME_MIN_LENGTH} characters.`;
  if (value.length > USERNAME_MAX_LENGTH) return `Use at most ${USERNAME_MAX_LENGTH} characters.`;
  if (!USERNAME_PATTERN.test(value)) return 'Use only letters, numbers, underscores (_) and dots (.).';
  return null;
}

export function isValidUsername(value: string): boolean {
  return usernameProblem(value) === null;
}

/**
 * The sign-in form takes one "Username or Email" field. An `@` can never
 * appear in a username, so it decides unambiguously which endpoint to call.
 */
export function isEmailIdentifier(identifier: string): boolean {
  return identifier.includes('@');
}

/**
 * The username an existing account receives when usernames are introduced.
 *
 * Mirrors the backfill in migration 20261020090000 exactly: the email's local
 * part, cleaned to the allowed characters, padded to the minimum length,
 * capped so a suffix still fits, and suffixed `_2`, `_3`… until it is free.
 * `taken` is updated in place so a caller can assign a batch in order.
 */
export function suggestUsername(email: string, taken: Set<string>): string {
  const local = email.split('@')[0] ?? '';
  let stem = local.toLowerCase().replace(/[^a-z0-9_.]/g, '');
  if (stem === '') stem = 'user';
  stem = stem.padEnd(USERNAME_MIN_LENGTH, '0').slice(0, 24);

  let candidate = stem;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${stem}_${n}`;
  taken.add(candidate);
  return candidate;
}
