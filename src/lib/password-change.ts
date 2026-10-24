import { validatePassword } from './password';

/**
 * The mandatory password change that follows an administrator-chosen
 * password. Pure, so the rules are unit-tested directly; the enforcement
 * points live in `src/lib/session.ts`, `src/lib/tenant/context.ts` and the
 * Better Auth hook in `src/lib/auth.ts`.
 */

/** Where a restricted session is sent, and the only page it may open. */
export const CHANGE_PASSWORD_PATH = '/change-password';

/** Returned by every action and API refused while the change is pending. */
export const MUST_CHANGE_PASSWORD_MESSAGE = 'Change your temporary password to continue.';

/**
 * Better Auth endpoints a restricted session may not call. Changing the
 * password goes through our own action — which clears the flag in the same
 * transaction — so the built-in endpoint must not be a way around it, and a
 * profile, email or passkey change waits until the password is the owner's.
 * Sign-in and sign-out are not listed: they never bypass anything, because
 * the flag belongs to the account, not to a session.
 */
export function isBlockedWhileRestricted(authPath: string): boolean {
  return (
    authPath === '/change-password' ||
    authPath === '/update-user' ||
    authPath === '/change-email' ||
    authPath === '/set-password' ||
    authPath.startsWith('/passkey/')
  );
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export type PasswordChangeProblems = Partial<Record<keyof PasswordChangeInput, string>>;

/**
 * Everything wrong with a requested change that can be told without the
 * stored hash. Checking the current password itself happens on the server,
 * against the hash. An empty object means the request may proceed.
 */
export function passwordChangeProblems(input: PasswordChangeInput): PasswordChangeProblems {
  const problems: PasswordChangeProblems = {};

  if (!input.currentPassword) problems.currentPassword = 'Enter your temporary password.';

  if (!input.newPassword) {
    problems.newPassword = 'Enter a new password.';
  } else if (input.newPassword.length > 128) {
    problems.newPassword = 'Use 128 characters or fewer.';
  } else if (!validatePassword(input.newPassword).isValid) {
    problems.newPassword = 'Meet every requirement in the list.';
  } else if (input.newPassword === input.currentPassword) {
    problems.newPassword = 'Choose a password different from the temporary one.';
  }

  if (!input.confirmPassword) {
    problems.confirmPassword = 'Re-enter the new password.';
  } else if (input.confirmPassword !== input.newPassword) {
    problems.confirmPassword = 'The passwords do not match.';
  }

  return problems;
}
