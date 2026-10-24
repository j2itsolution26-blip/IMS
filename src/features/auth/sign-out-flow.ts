/**
 * The one sign-out sequence, free of React and the auth client so it can be
 * tested directly.
 *
 * Better Auth's client resolves `{ error }` on a failed request instead of
 * throwing, so both shapes of failure are checked. Only a confirmed success
 * navigates away: the server has deleted the session row by then, so the
 * next request is unauthenticated. Navigation is a full page load (not a
 * router push), which drops every cached server component that held the old
 * session's data.
 */

export interface SignOutResult {
  error?: { message?: string | null } | null;
}

export type SignOutOutcome = { ok: true } | { ok: false; message: string };

const FALLBACK_MESSAGE = 'Could not sign out. Check your connection and try again.';

export async function performSignOut(
  signOut: () => Promise<SignOutResult | undefined | null>,
  navigate: (url: string) => void,
): Promise<SignOutOutcome> {
  let result: SignOutResult | undefined | null;
  try {
    result = await signOut();
  } catch {
    return { ok: false, message: FALLBACK_MESSAGE };
  }
  if (result?.error) return { ok: false, message: FALLBACK_MESSAGE };
  navigate('/sign-in');
  return { ok: true };
}
