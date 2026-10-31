import 'server-only';

import type { Prisma } from '@prisma/client';
import { getStoreContext, type StoreContext } from '@/lib/tenant/context';
import { AUDIT_CATEGORIES, type AuditCategory } from '@/lib/audit-log';
import { auditHistoryStart } from '@/server/services/entitlements';

/**
 * Every read of a store's audit trail goes through here, so the plan's history
 * window (Basic 90 days, Business 365, Enterprise all) is applied on the
 * server for every page that shows audit entries, never only in the browser.
 *
 * Reads use the store-scoped client, which only ever returns this store's
 * entries; platform entries (no store) are never visible to a store. Nothing
 * here writes: the table is append-only in the database as well.
 */

/** The createdAt condition the store's plan allows; `{}` for full history. */
export function auditWindowWhere(ctx: Pick<StoreContext, 'access'>, now: Date = new Date()): Prisma.AuditLogWhereInput {
  const start = auditHistoryStart(ctx, now);
  return start ? { createdAt: { gte: start } } : {};
}

export const AUDIT_PAGE_SIZE = 25;

export interface StoreAuditFilters {
  category?: AuditCategory | null;
  userId?: string | null;
  search?: string | null;
  page?: number;
}

export interface StoreAuditRow {
  id: string;
  action: Prisma.AuditLogGetPayload<{ select: { action: true } }>['action'];
  entity: string;
  summary: string;
  createdAt: Date;
  actorName: string | null;
  actorUsername: string | null;
}

export async function listStoreAudit(filters: StoreAuditFilters): Promise<{
  rows: StoreAuditRow[];
  total: number;
  page: number;
  pageCount: number;
  /** Entries older than the plan's window: kept, not shown. */
  hiddenOlder: number;
}> {
  const ctx = await getStoreContext();
  const window = auditWindowWhere(ctx);
  const conditions: Prisma.AuditLogWhereInput[] = [window];

  if (filters.category) {
    const { actions, entities } = AUDIT_CATEGORIES[filters.category];
    conditions.push({ OR: [{ action: { in: actions } }, { entity: { in: entities } }] });
  }
  if (filters.userId) conditions.push({ userId: filters.userId });
  const search = filters.search?.trim().slice(0, 100);
  if (search) conditions.push({ summary: { contains: search, mode: 'insensitive' } });

  const where: Prisma.AuditLogWhereInput = { AND: conditions };
  const total = await ctx.db.auditLog.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1)), pageCount);

  const [rows, hiddenOlder] = await Promise.all([
    ctx.db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
      // IP address and browser details are kept for investigations but not shown here.
      select: { id: true, action: true, entity: true, summary: true, createdAt: true, user: { select: { name: true, username: true } } },
    }),
    'createdAt' in window
      ? ctx.db.auditLog.count({ where: { createdAt: { lt: (window.createdAt as { gte: Date }).gte } } })
      : Promise.resolve(0),
  ]);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      action: row.action,
      entity: row.entity,
      summary: row.summary,
      createdAt: row.createdAt,
      actorName: row.user?.name ?? null,
      actorUsername: row.user?.username ?? null,
    })),
    total,
    page,
    pageCount,
    hiddenOlder,
  };
}

/** The store's accounts, for the "who" filter. */
export async function listAuditActors(): Promise<{ id: string; name: string }[]> {
  const ctx = await getStoreContext();
  return ctx.db.user.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
}
