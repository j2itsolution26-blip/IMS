import 'server-only';

import type { AuditAction, Prisma } from '@prisma/client';
import { platformPrisma } from '@/lib/prisma';
import { getRequestContext } from '@/lib/session';

/**
 * Audit entries for support. A store account's entry goes to its own store's
 * trail and an administrator's to the platform's, as with `recordAuditFor` —
 * but written with the platform client, because `recordAudit` goes through
 * the store context, which refuses a suspended store, and support is exactly
 * what a suspended store's owner needs. The database guard still holds the
 * entry's store to the actor's own (migration 20261023090000).
 */
export async function recordSupportAudit(
  actor: { id: string; store: { id: string } | null },
  entry: { action: AuditAction; entityId: string; summary: string; changes?: Prisma.InputJsonValue },
): Promise<void> {
  const { ipAddress, userAgent } = await getRequestContext().catch(() => ({ ipAddress: null, userAgent: null }));
  await platformPrisma.auditLog.create({
    data: {
      storeId: actor.store?.id ?? null,
      userId: actor.id,
      action: entry.action,
      entity: 'SupportTicket',
      entityId: entry.entityId,
      summary: entry.summary,
      changes: entry.changes ?? undefined,
      ipAddress,
      userAgent,
    },
  });
}
