import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Marks a call stack as an authorised account-provisioning operation, and
 * says which store and role the new account gets.
 *
 * Better Auth exposes `/api/auth/sign-up/email` publicly, which in an internal
 * business system would let anyone on the internet create an account. Rather
 * than leaving that open, the `user.create.before` hook rejects sign-ups unless
 * either:
 *
 *   1. no users exist yet (first-run owner bootstrap), or
 *   2. the call originated from an action that wrapped itself in
 *      `runAsProvisioning` after checking its own permission (`users.create`
 *      for a store's staff, `platform.manage` for a store's owner).
 *
 * The target store and role come from that server-side caller, never from the
 * request; the hook still checks the role belongs to the store.
 *
 * AsyncLocalStorage is used because the hook runs deep inside Better Auth and
 * has no access to the caller's arguments. The value is per-async-context, so
 * concurrent requests cannot see each other's state.
 */

export interface ProvisioningTarget {
  /** The store the new account belongs to; null only for a platform role. */
  storeId: string | null;
  /** Its role, which must be one of that store's roles. */
  roleId: string;
}

const storage = new AsyncLocalStorage<ProvisioningTarget>();

export function runAsProvisioning<T>(target: ProvisioningTarget, fn: () => Promise<T>): Promise<T> {
  if (!target.roleId || target.storeId === undefined) throw new Error('runAsProvisioning needs a store (or null) and a role.');
  return storage.run({ storeId: target.storeId, roleId: target.roleId }, fn);
}

/** The store and role an authorised provisioning call asked for, or null for a public sign-up. */
export function provisioningTarget(): ProvisioningTarget | null {
  return storage.getStore() ?? null;
}

export function isProvisioning(): boolean {
  return provisioningTarget() !== null;
}
