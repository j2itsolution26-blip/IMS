import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Marks a call stack as an authorised account-provisioning operation.
 *
 * Better Auth exposes `/api/auth/sign-up/email` publicly, which in an internal
 * business system would let anyone on the internet create an account. Rather
 * than leaving that open, the `user.create.before` hook rejects sign-ups unless
 * either:
 *
 *   1. no users exist yet (first-run owner bootstrap), or
 *   2. the call originated from an admin action that wrapped itself in
 *      `runAsProvisioning` after checking the `users.create` permission.
 *
 * AsyncLocalStorage is used because the hook runs deep inside Better Auth and
 * has no access to the caller's arguments. The flag is per-async-context, so
 * concurrent requests cannot see each other's state.
 */

const storage = new AsyncLocalStorage<{ provisioning: true }>();

export function runAsProvisioning<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ provisioning: true }, fn);
}

export function isProvisioning(): boolean {
  return storage.getStore()?.provisioning === true;
}
