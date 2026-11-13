import 'server-only';
// Reads the platform client by design (eslint.config.mjs): the status check runs// without a session, for cashiers who signed out but may still unlock offline.

import { auth } from '@/lib/auth';
import { platformPrisma } from '@/lib/prisma';
import type { CurrentUser } from '@/lib/session';
import { getStoreContext } from '@/lib/tenant/context';
import { storeAccess } from '@/lib/store-access';
import { AppError, ConflictError, ForbiddenError } from '@/lib/errors';
import { deviceCode } from '@/lib/sync-review';
import { SETTING_DEFAULTS } from '@/lib/settings-definitions';
import { getSettings, readBoolean } from '@/server/services/settings-service';
import { OfflineDisabledError } from '@/server/services/pos-catalog-service';
import { DeviceRevokedError } from '@/server/services/pos-device-service';
import { recordAudit } from '@/server/services/audit-service';
import { pinFingerprint } from '@/server/services/pin-fingerprint';

/**
 * Offline unlock, the server's part (see src/lib/offline-unlock.ts).
 *
 * 1. Enrolment (signed in, online): the cashier proves their lock-screen PIN
 *    once; the device then keeps its own PBKDF2 verifier of it.
 * 2. Status (no session needed): a device asks whether the cashiers it may
 *    unlock offline are still allowed. It can only ever lose access this way:
 *    access is only extended by a signed-in catalogue download.
 *
 * The PIN fingerprint is an HMAC of the stored PIN hash under the server's
 * secret. It changes whenever the PIN does and reveals nothing about it.
 */

export class PinRequiredError extends AppError {
  constructor() {
    super('Set a screen-lock PIN in your profile first. Offline unlock uses that PIN.', 'PIN_REQUIRED', 409);
  }
}

export class PinIncorrectError extends AppError {
  constructor() {
    super('That PIN is incorrect.', 'PIN_INCORRECT', 422);
  }
}

/**
 * Checks the signed-in cashier's PIN for offline unlock on this device and
 * returns what the device keeps beside its own verifier.
 */
export async function enrollOfflineUnlock(user: CurrentUser, input: { deviceId: string; pin: string }) {
  const { db, access } = await getStoreContext();
  if (!access.writable) throw new ForbiddenError('This store is read-only, so it cannot sell offline. Renew the subscription first.');
  if (!readBoolean(await getSettings(), 'pos.offlineMode')) throw new OfflineDisabledError();

  const device = await db.posDevice.findUnique({ where: { id: input.deviceId }, select: { id: true, revokedAt: true } });
  if (!device) throw new ConflictError('Prepare this device for offline sales first.');
  if (device.revokedAt) throw new DeviceRevokedError();

  const row = await platformPrisma.user.findUnique({ where: { id: user.id }, select: { posPinHash: true } });
  if (!row?.posPinHash) throw new PinRequiredError();
  const ctx = await auth.$context;
  if (!(await ctx.password.verify({ hash: row.posPinHash, password: input.pin }))) throw new PinIncorrectError();

  await recordAudit({
    action: 'UPDATE',
    entity: 'PosDevice',
    entityId: device.id,
    summary: `Allowed offline unlock with their PIN on device ${deviceCode(device.id)}`,
    userId: user.id,
  });

  return {
    fingerprint: pinFingerprint(user.id, row.posPinHash) as string,
    user: { id: user.id, username: user.username, name: user.name },
    storeId: user.store?.id as string,
  };
}

export interface StatusEntry {
  storeId: string;
  userId: string;
  fingerprint: string;
  branchId: string;
}

/**
 * Whether each cashier may still unlock this device offline. Answers only
 * yes or no per cashier the device already names, with the device's id and
 * that cashier's PIN fingerprint, both of which only the device holds.
 */
export async function offlineUnlockStatus(deviceId: string, entries: StatusEntry[]): Promise<{ storeId: string; userId: string; valid: boolean }[]> {
  const device = await platformPrisma.posDevice.findUnique({ where: { id: deviceId }, select: { storeId: true, revokedAt: true } });
  const userIds = [...new Set(entries.map((entry) => entry.userId))];
  const users = await platformPrisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      storeId: true,
      isActive: true,
      posPinHash: true,
      mustChangePassword: true,
      warehouseId: true,
      store: { select: { id: true, status: true, plan: true, trialEndsAt: true, currentPeriodEnd: true } },
      role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
    },
  });
  const byId = new Map(users.map((user) => [user.id, user]));

  const offlineOn = new Map<string, boolean>();
  async function offlineModeOn(storeId: string): Promise<boolean> {
    if (!offlineOn.has(storeId)) {
      const setting = await platformPrisma.setting.findFirst({ where: { storeId, key: 'pos.offlineMode' }, select: { value: true } });
      offlineOn.set(storeId, (setting?.value ?? SETTING_DEFAULTS.get('pos.offlineMode')) === 'true');
    }
    return offlineOn.get(storeId) as boolean;
  }

  const results = [];
  for (const entry of entries) {
    const user = byId.get(entry.userId);
    let valid =
      Boolean(device && !device.revokedAt && device.storeId === entry.storeId) &&
      Boolean(user && user.isActive && !user.mustChangePassword && user.storeId === entry.storeId && user.store) &&
      Boolean(user?.role.permissions.some((rp) => rp.permission.key === 'pos.create')) &&
      // Staff moved to another branch lose the copy made for the old one.
      !(user?.warehouseId && user.warehouseId !== entry.branchId) &&
      pinFingerprint(entry.userId, user?.posPinHash ?? null) === entry.fingerprint;
    if (valid && user?.store) {
      const access = storeAccess(user.store);
      valid = access.state !== 'SUSPENDED' && access.writable && (await offlineModeOn(entry.storeId));
    }
    results.push({ storeId: entry.storeId, userId: entry.userId, valid });
  }
  return results;
}
