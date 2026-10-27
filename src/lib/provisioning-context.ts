import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Marks a call stack as an authorised account-provisioning operation, and
 * says which store and role the new account gets.
 *
 * Better Auth exposes `/api/auth/sign-up/email` publicly, which in an internal
 * business system would let anyone on the internet create an account. Rather
 * than leaving that open, the `user.create.before` hook rejects every sign-up
 * unless the call originated from server code that wrapped itself in
 * `runAsProvisioning` after its own check: `users.create` for a store's staff,
 * `platform.manage` for a store's owner, the first-time setup's claim for the
 * initial System Administrator, or the `admin:create` recovery script.
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
  /** First-time setup: refuse unless this is the very first account of the installation. */
  firstAccountOnly?: boolean;
  /**
   * The password was chosen by an administrator, so the new account must
   * replace it at first sign-in. Written in the same INSERT as the account.
   */
  mustChangePassword?: boolean;
  /**
   * Whether the account starts active. Written in the same INSERT, so an
   * account created inactive never takes a seat in the plan's staff quota,
   * even for a moment. Defaults to true.
   */
  isActive?: boolean;
}

const storage = new AsyncLocalStorage<ProvisioningTarget>();

export function runAsProvisioning<T>(target: ProvisioningTarget, fn: () => Promise<T>): Promise<T> {
  if (!target.roleId || target.storeId === undefined) throw new Error('runAsProvisioning needs a store (or null) and a role.');
  return storage.run(
    {
      storeId: target.storeId,
      roleId: target.roleId,
      firstAccountOnly: target.firstAccountOnly === true,
      mustChangePassword: target.mustChangePassword === true,
      isActive: target.isActive !== false,
    },
    fn,
  );
}

/** The store and role an authorised provisioning call asked for, or null for a public sign-up. */
export function provisioningTarget(): ProvisioningTarget | null {
  return storage.getStore() ?? null;
}

export function isProvisioning(): boolean {
  return provisioningTarget() !== null;
}
