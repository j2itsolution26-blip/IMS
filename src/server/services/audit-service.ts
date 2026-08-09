import 'server-only';

import type { AuditAction, Prisma } from '@prisma/client';
import { prisma, type DbClient } from '@/lib/prisma';
import { getRequestContext } from '@/lib/session';

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  summary: string;
  changes?: Prisma.InputJsonValue | null;
  userId?: string | null;
}

/**
 * Computes a field-level diff so the audit trail records what actually changed
 * rather than a full snapshot of every column.
 */
export function diff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
): Prisma.InputJsonValue | null {
  if (!before || !after) return null;

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const from = before[key];
    const to = after[key];
    if (from instanceof Date || to instanceof Date) {
      if (String(from) !== String(to)) changes[key] = { from: String(from), to: String(to) };
      continue;
    }
    // Decimal and other objects stringify to a stable representation.
    const fromValue = from == null ? null : typeof from === 'object' ? from.toString() : from;
    const toValue = to == null ? null : typeof to === 'object' ? to.toString() : to;
    if (fromValue !== toValue) changes[key] = { from: fromValue, to: toValue };
  }

  return Object.keys(changes).length > 0 ? (changes as Prisma.InputJsonValue) : null;
}

/**
 * Writes an audit row. Accepts a transaction client so the log commits or rolls
 * back together with the change it describes.
 */
export async function recordAudit(entry: AuditEntry, db: DbClient = prisma): Promise<void> {
  const { ipAddress, userAgent } = await getRequestContext().catch(() => ({
    ipAddress: null,
    userAgent: null,
  }));

  await db.auditLog.create({
    data: {
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      changes: entry.changes ?? undefined,
      userId: entry.userId ?? null,
      ipAddress,
      userAgent,
    },
  });
}

/**
 * Fire-and-forget variant for paths where an audit failure must not fail the
 * user's action (e.g. logging a data export).
 */
export function recordAuditSafe(entry: AuditEntry): void {
  void recordAudit(entry).catch((error) => {
    console.error('[audit] failed to record entry', entry.action, entry.entity, error);
  });
}
