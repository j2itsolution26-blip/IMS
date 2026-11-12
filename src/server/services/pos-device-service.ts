import 'server-only';

import { Prisma } from '@prisma/client';
import { storeDb } from '@/lib/tenant/context';
import { AppError, ConflictError } from '@/lib/errors';
import { posBranchId } from '@/server/services/warehouse-service';

/**
 * Devices prepared for offline selling.
 *
 * A device id is a UUID made in the browser and kept in its IndexedDB. The
 * server only ever learns of it from a signed-in account of this store, and
 * files it under that store; an id another store already uses is refused, so
 * one store's device can never upload into another's.
 *
 * Revoking a device (owner, Phase 5) stops it downloading the catalogue, which
 * ends its offline access once its cached copy expires. Sales it already took
 * still upload, flagged, so no money taken goes unrecorded.
 */

export class DeviceRevokedError extends AppError {
  constructor() {
    super('This device has been removed by the store owner and can no longer sell offline. Sales it already recorded will still upload.', 'DEVICE_REVOKED', 403);
  }
}

export interface DeviceSummary {
  id: string;
  label: string;
  warehouseId: string;
  revoked: boolean;
}

const LABEL_MAX = 80;

function cleanLabel(label: string | undefined, fallback: string): string {
  const trimmed = (label ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  return trimmed || fallback;
}

function isIdTaken(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Registers this browser for offline selling at the cashier's branch (their
 * open shift's, else their operating branch), or refreshes an existing
 * registration. Refused for a revoked device.
 */
export async function registerDevice(input: {
  deviceId: string;
  userId: string;
  label?: string;
  userAgent?: string | null;
}): Promise<DeviceSummary> {
  const db = await storeDb();
  const warehouseId = await posBranchId();
  const userAgent = input.userAgent?.slice(0, 300) ?? null;
  const now = new Date();

  const existing = await db.posDevice.findUnique({ where: { id: input.deviceId }, select: { id: true, revokedAt: true } });
  if (existing?.revokedAt) throw new DeviceRevokedError();

  if (existing) {
    const device = await db.posDevice.update({
      where: { id: input.deviceId },
      data: { warehouseId, lastSeenAt: now, userAgent, ...(input.label ? { label: cleanLabel(input.label, 'POS device') } : {}) },
      select: { id: true, label: true, warehouseId: true, revokedAt: true },
    });
    return { id: device.id, label: device.label, warehouseId: device.warehouseId, revoked: device.revokedAt !== null };
  }

  try {
    const device = await db.posDevice.create({
      data: { id: input.deviceId, warehouseId, label: cleanLabel(input.label, 'POS device'), userAgent, registeredById: input.userId, lastSeenAt: now },
      select: { id: true, label: true, warehouseId: true },
    });
    return { ...device, revoked: false };
  } catch (error) {
    // The id exists, but not in this store (the scoped lookup above missed it).
    if (isIdTaken(error)) throw new ConflictError('This device id is already in use. Reset offline mode on this device and prepare it again.');
    throw error;
  }
}

/**
 * The device an upload names, registering it on first sight. Returns whether
 * it has been revoked; the sale is recorded either way.
 */
export async function deviceForUpload(input: { deviceId: string; userId: string; warehouseId: string }): Promise<{ revoked: boolean }> {
  const db = await storeDb();
  const existing = await db.posDevice.findUnique({ where: { id: input.deviceId }, select: { revokedAt: true } });
  if (existing) return { revoked: existing.revokedAt !== null };
  try {
    await db.posDevice.create({
      data: { id: input.deviceId, warehouseId: input.warehouseId, label: 'POS device', registeredById: input.userId, lastSeenAt: new Date() },
    });
    return { revoked: false };
  } catch (error) {
    if (!isIdTaken(error)) throw error;
    // Two uploads from a new device raced: the other one registered it.
    const raced = await db.posDevice.findUnique({ where: { id: input.deviceId }, select: { revokedAt: true } });
    if (raced) return { revoked: raced.revokedAt !== null };
    throw new ConflictError('This device id belongs to another store. Reset offline mode on this device and prepare it again.');
  }
}

/** Notes a successful upload or catalogue download. Never fails the request. */
export async function touchDevice(deviceId: string, field: 'lastSeenAt' | 'lastSyncAt'): Promise<void> {
  try {
    const db = await storeDb();
    const now = new Date();
    await db.posDevice.updateMany({ where: { id: deviceId }, data: field === 'lastSyncAt' ? { lastSyncAt: now, lastSeenAt: now } : { lastSeenAt: now } });
  } catch (error) {
    console.warn('[pos-device] could not record device activity', error);
  }
}

/** Throws if the device is known to this store and revoked; unknown devices pass. */
export async function assertDeviceNotRevoked(deviceId: string): Promise<void> {
  const db = await storeDb();
  const device = await db.posDevice.findUnique({ where: { id: deviceId }, select: { revokedAt: true } });
  if (device?.revokedAt) throw new DeviceRevokedError();
}
