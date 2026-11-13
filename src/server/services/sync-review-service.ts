import 'server-only';

import type { Prisma, SyncIssueStatus } from '@prisma/client';
import { storeDb } from '@/lib/tenant/context';
import { toNum } from '@/lib/decimal';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { visibleBranchIds, whereBranch } from '@/server/analytics/branch-filter';
import { recordAudit } from '@/server/services/audit-service';
import { deviceCode, deviceKind, deviceState, syncIssueLabel, type DeviceState } from '@/lib/sync-review';

/**
 * The owner's view of offline selling: sales that need a look (sync issues),
 * the devices prepared for offline sales, and the totals that came in
 * offline. Owner-only (the actions check FINANCIAL_PERMISSION), and limited
 * to the branches the account may see.
 *
 * Resolving an issue only records that the owner looked and what was done:
 * the sale, stock and drawer figures are never changed here. A stock
 * correction is a stock adjustment; a drawer correction is a shift
 * adjustment, each with its own record.
 */

export const ISSUE_PAGE_SIZE = 25;

export interface SyncOverview {
  openIssues: number;
  offlineSales30d: { count: number; total: number };
  devices: { active: number; revoked: number };
}

export async function getSyncOverview(now = new Date()): Promise<SyncOverview> {
  const db = await storeDb();
  const branches = whereBranch(await visibleBranchIds());
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [openIssues, offline, devices, revoked] = await Promise.all([
    db.syncIssue.count({ where: { status: 'OPEN', ...branches } }),
    db.sale.aggregate({
      where: { origin: 'OFFLINE', status: { not: 'VOIDED' }, createdAt: { gte: since }, ...branches },
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.posDevice.count({ where: { revokedAt: null, ...branches } }),
    db.posDevice.count({ where: { revokedAt: { not: null }, ...branches } }),
  ]);
  return {
    openIssues,
    offlineSales30d: { count: offline._count._all, total: toNum(offline._sum.total ?? 0) },
    devices: { active: devices, revoked },
  };
}

/** Open sync issues the owner can see, for the dashboard notice. */
export async function countOpenSyncIssues(): Promise<number> {
  const db = await storeDb();
  return db.syncIssue.count({ where: { status: 'OPEN', ...whereBranch(await visibleBranchIds()) } });
}

export interface SyncIssueRow {
  id: string;
  kind: string;
  label: string;
  status: SyncIssueStatus;
  message: string;
  createdAt: Date;
  sale: {
    id: string;
    invoiceNumber: string;
    localReceiptNumber: string | null;
    total: number;
    soldAt: Date;
    receivedAt: Date;
    cashierName: string;
  };
  branchName: string;
  productName: string | null;
  shift: { id: string; number: number } | null;
  deviceLabel: string | null;
  resolved: { at: Date; by: string | null; note: string | null } | null;
}

export async function listSyncIssues(input: { status: SyncIssueStatus; page: number }): Promise<{ rows: SyncIssueRow[]; total: number; page: number; pageCount: number }> {
  const db = await storeDb();
  const where: Prisma.SyncIssueWhereInput = { status: input.status, ...whereBranch(await visibleBranchIds()) };
  const total = await db.syncIssue.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / ISSUE_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(input.page) || 1), pageCount);

  const rows = await db.syncIssue.findMany({
    where,
    // Open: oldest first, so nothing waits forever. Resolved: latest first.
    orderBy: input.status === 'OPEN' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ resolvedAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * ISSUE_PAGE_SIZE,
    take: ISSUE_PAGE_SIZE,
    select: {
      id: true,
      kind: true,
      status: true,
      message: true,
      createdAt: true,
      resolvedAt: true,
      resolutionNote: true,
      resolvedBy: { select: { name: true } },
      warehouse: { select: { name: true } },
      product: { select: { name: true } },
      shift: { select: { id: true, number: true } },
      device: { select: { id: true, label: true, userAgent: true } },
      sale: {
        select: {
          id: true,
          invoiceNumber: true,
          localReceiptNumber: true,
          total: true,
          createdAt: true,
          receivedAt: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  return {
    total,
    page,
    pageCount,
    rows: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: syncIssueLabel(row.kind),
      status: row.status,
      message: row.message,
      createdAt: row.createdAt,
      sale: {
        id: row.sale.id,
        invoiceNumber: row.sale.invoiceNumber,
        localReceiptNumber: row.sale.localReceiptNumber,
        total: toNum(row.sale.total),
        soldAt: row.sale.createdAt,
        receivedAt: row.sale.receivedAt,
        cashierName: row.sale.user.name,
      },
      branchName: row.warehouse.name,
      productName: row.product?.name ?? null,
      shift: row.shift,
      deviceLabel: row.device ? `${row.device.label} ${deviceCode(row.device.id)} · ${deviceKind(row.device.userAgent)}` : null,
      resolved: row.resolvedAt ? { at: row.resolvedAt, by: row.resolvedBy?.name ?? null, note: row.resolutionNote } : null,
    })),
  };
}

/** The issues raised on one sale, for its detail page. */
export async function syncIssuesForSale(saleId: string): Promise<{ id: string; label: string; message: string; status: SyncIssueStatus }[]> {
  const db = await storeDb();
  const rows = await db.syncIssue.findMany({
    where: { saleId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, message: true, status: true },
  });
  return rows.map((row) => ({ id: row.id, label: syncIssueLabel(row.kind), message: row.message, status: row.status }));
}

/**
 * Marks an issue as looked at, with what was done. Nothing else changes. A
 * second resolve of the same issue (double click, two tabs) is refused
 * rather than overwriting the first note.
 */
export async function resolveSyncIssue(input: { issueId: string; actorId: string; note: string }): Promise<void> {
  const db = await storeDb();
  const issue = await db.syncIssue.findFirst({
    where: { id: input.issueId, ...whereBranch(await visibleBranchIds()) },
    select: { id: true, kind: true, status: true, sale: { select: { invoiceNumber: true } } },
  });
  if (!issue) throw new NotFoundError('Issue');
  if (issue.status !== 'OPEN') throw new ConflictError('This issue was already resolved.');

  await db.$transaction(async (tx) => {
    const updated = await tx.syncIssue.updateMany({
      where: { id: issue.id, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: input.actorId, resolutionNote: input.note },
    });
    if (updated.count === 0) throw new ConflictError('This issue was already resolved.');
    await recordAudit(
      {
        action: 'UPDATE',
        entity: 'SyncIssue',
        entityId: issue.id,
        summary: `Resolved "${syncIssueLabel(issue.kind)}" on offline sale ${issue.sale.invoiceNumber}`,
        changes: { status: { from: 'OPEN', to: 'RESOLVED' }, note: input.note },
      },
      tx,
    );
  });
}

export interface DeviceRow {
  id: string;
  label: string;
  /** Printed on its offline receipts: OFF-<code>-000012. */
  code: string;
  kind: string;
  branchName: string;
  registeredBy: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  lastSyncAt: Date | null;
  state: DeviceState;
  revoked: { at: Date; by: string | null } | null;
  offlineSales: number;
  openIssues: number;
}

export async function listDevices(now = new Date()): Promise<DeviceRow[]> {
  const db = await storeDb();
  const devices = await db.posDevice.findMany({
    where: whereBranch(await visibleBranchIds()),
    orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { lastSeenAt: { sort: 'desc', nulls: 'last' } }],
    take: 200,
    select: {
      id: true,
      label: true,
      userAgent: true,
      createdAt: true,
      lastSeenAt: true,
      lastSyncAt: true,
      revokedAt: true,
      warehouse: { select: { name: true } },
      registeredBy: { select: { name: true } },
      revokedBy: { select: { name: true } },
      _count: { select: { sales: true, syncIssues: { where: { status: 'OPEN' } } } },
    },
  });
  return devices.map((device) => ({
    id: device.id,
    label: device.label,
    code: deviceCode(device.id),
    kind: deviceKind(device.userAgent),
    branchName: device.warehouse.name,
    registeredBy: device.registeredBy.name,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    lastSyncAt: device.lastSyncAt,
    state: deviceState(device, now),
    revoked: device.revokedAt ? { at: device.revokedAt, by: device.revokedBy?.name ?? null } : null,
    offlineSales: device._count.sales,
    openIssues: device._count.syncIssues,
  }));
}

/**
 * Removes a device from offline selling: it can no longer download the
 * catalogue, so its offline access ends at its next contact (and at the
 * latest when its offline access period runs out). Sales it already took
 * still upload, flagged DEVICE_REVOKED, so no money taken goes unrecorded.
 * `allow` puts a removed device back.
 */
export async function setDeviceRevoked(input: { deviceId: string; actorId: string; revoked: boolean }): Promise<void> {
  const db = await storeDb();
  const device = await db.posDevice.findFirst({
    where: { id: input.deviceId, ...whereBranch(await visibleBranchIds()) },
    select: { id: true, label: true, revokedAt: true },
  });
  if (!device) throw new NotFoundError('Device');
  if ((device.revokedAt !== null) === input.revoked) return;

  await db.$transaction(async (tx) => {
    await tx.posDevice.update({
      where: { id: device.id },
      data: input.revoked ? { revokedAt: new Date(), revokedById: input.actorId } : { revokedAt: null, revokedById: null },
    });
    await recordAudit(
      {
        action: 'UPDATE',
        entity: 'PosDevice',
        entityId: device.id,
        summary: input.revoked ? `Removed device "${device.label}" from offline sales` : `Allowed device "${device.label}" to sell offline again`,
        changes: { revoked: { from: !input.revoked, to: input.revoked } },
      },
      tx,
    );
  });
}
