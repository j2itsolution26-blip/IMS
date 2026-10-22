import 'server-only';

import type { AuditAction, Prisma } from '@prisma/client';
import { platformPrisma, type DbClient } from '@/lib/prisma';
import { storeDb } from '@/lib/tenant/context';
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
 *
 * Without one, the entry goes to the signed-in user's store. Platform events
 * (system administrators) pass `platformPrisma`, which leaves the entry
 * outside every store.
 */
export async function recordAudit(entry: AuditEntry, db?: DbClient): Promise<void> {
  db ??= await storeDb();
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
/**
 * An entry for something a platform administrator did. It belongs to no
 * store — platform administrators have none — so it is written with the
 * platform client and stays out of every store's audit trail. The database
 * guard still requires the actor to be a platform user.
 */
export async function recordPlatformAudit(entry: AuditEntry): Promise<void> {
  const { ipAddress, userAgent } = await getRequestContext().catch(() => ({
    ipAddress: null,
    userAgent: null,
  }));

  await platformPrisma.auditLog.create({
    data: {
      storeId: null,
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
 * For actions any signed-in account can take on itself (its lock screen, its
 * passkeys): a store account's entry goes to its store's trail, a platform
 * administrator's to the platform's.
 */
export async function recordAuditFor(actor: { store: { id: string } | null }, entry: AuditEntry): Promise<void> {
  return actor.store ? recordAudit(entry) : recordPlatformAudit(entry);
}

export function recordAuditSafe(entry: AuditEntry): void {
  void recordAudit(entry).catch((error) => {
    console.error('[audit] failed to record entry', entry.action, entry.entity, error);
  });
}
