import 'server-only';

import type { AuditAction, Prisma } from '@prisma/client';
import { getStoreContext, type StoreContext } from '@/lib/tenant/context';
import {
  actionsMatchingSearch,
  categoriesMatchingSearch,
  categoryWhere,
  changeRows,
  classifyAudit,
  relatedLink,
  severityWhere,
  type AuditCategory,
  type AuditSeverity,
  type ChangeRow,
} from '@/lib/audit-log';
import { auditHistoryStart } from '@/server/services/entitlements';
import { visibleBranchIds } from '@/server/analytics/branch-filter';
import { ForbiddenError } from '@/lib/errors';
import { startOfStoreDay } from '@/lib/store-time';

/**
 * Every read of a store's audit trail goes through here, so the plan's history
 * window (Basic 90 days, Business 365, Enterprise all) is applied on the
 * server for every page that shows audit entries, never only in the browser.
 *
 * Reads use the store-scoped client, which only ever returns this store's
 * entries; platform entries (no store) are never visible to a store. Nothing
 * here writes: the table is append-only in the database as well.
 *
 * Only accounts that see every branch may read the log: most entries (staff,
 * settings, products) belong to no branch, so a branch-limited account could
 * not be shown "its" part of the log without leaking the rest.
 */

/** The createdAt condition the store's plan allows; `{}` for full history. */
export function auditWindowWhere(ctx: Pick<StoreContext, 'access'>, now: Date = new Date()): Prisma.AuditLogWhereInput {
  const start = auditHistoryStart(ctx, now);
  return start ? { createdAt: { gte: start } } : {};
}

export const STORE_WIDE_ONLY_MESSAGE = 'The activity log covers every branch, so it is open only to accounts that see all branches.';

/** Whether the signed-in account sees every branch, and so may read the log. */
export async function isStoreWideAuditViewer(): Promise<boolean> {
  return (await visibleBranchIds()) === null;
}

/** Refuses an account limited to some branches. */
export async function assertStoreWideAuditViewer(): Promise<void> {
  if (!(await isStoreWideAuditViewer())) throw new ForbiddenError(STORE_WIDE_ONLY_MESSAGE);
}

export const AUDIT_PAGE_SIZE = 25;

export interface StoreAuditFilters {
  category?: AuditCategory | null;
  severity?: AuditSeverity | null;
  userId?: string | null;
  search?: string | null;
  /** The chosen window; clipped to the plan's history. */
  from?: Date | null;
  to?: Date | null;
  page?: number;
}

export interface StoreAuditRow {
  id: string;
  action: AuditAction;
  entity: string;
  summary: string;
  createdAt: Date;
  category: AuditCategory;
  severity: AuditSeverity;
  actorName: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  branchName: string | null;
  related: { label: string; href: string } | null;
}

function rangeWhere(window: Prisma.AuditLogWhereInput, from?: Date | null, to?: Date | null): Prisma.AuditLogWhereInput[] {
  const conditions: Prisma.AuditLogWhereInput[] = [window];
  if (from) conditions.push({ createdAt: { gte: from } });
  if (to) conditions.push({ createdAt: { lte: to } });
  return conditions;
}

function searchWhere(raw: string | null | undefined): Prisma.AuditLogWhereInput | null {
  const search = raw?.trim().slice(0, 100);
  if (!search) return null;
  const or: Prisma.AuditLogWhereInput[] = [
    { summary: { contains: search, mode: 'insensitive' } },
    { user: { name: { contains: search, mode: 'insensitive' } } },
    { user: { username: { contains: search.replace(/^@/, ''), mode: 'insensitive' } } },
    { entityId: search },
  ];
  const actions = actionsMatchingSearch(search);
  if (actions.length > 0) or.push({ action: { in: actions } });
  for (const category of categoriesMatchingSearch(search)) or.push(categoryWhere(category));
  return { OR: or };
}

/** Branch names for entries about a sale, a refund or a shift, looked up in three queries at most. */
async function branchNames(db: StoreContext['db'], rows: { entity: string; entityId: string | null }[]): Promise<Map<string, string>> {
  const ids = (entity: string) => [...new Set(rows.filter((r) => r.entity === entity && r.entityId).map((r) => r.entityId!))];
  const [sales, returns, shifts] = await Promise.all([
    ids('Sale').length ? db.sale.findMany({ where: { id: { in: ids('Sale') } }, select: { id: true, warehouse: { select: { name: true } } } }) : [],
    ids('Return').length
      ? db.return.findMany({ where: { id: { in: ids('Return') } }, select: { id: true, sale: { select: { warehouse: { select: { name: true } } } } } })
      : [],
    ids('CashierShift').length
      ? db.cashierShift.findMany({ where: { id: { in: ids('CashierShift') } }, select: { id: true, warehouse: { select: { name: true } } } })
      : [],
  ]);
  const names = new Map<string, string>();
  for (const sale of sales) names.set(`Sale:${sale.id}`, sale.warehouse.name);
  for (const ret of returns) if (ret.sale) names.set(`Return:${ret.id}`, ret.sale.warehouse.name);
  for (const shift of shifts) names.set(`CashierShift:${shift.id}`, shift.warehouse.name);
  return names;
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
  const conditions = rangeWhere(window, filters.from, filters.to);

  if (filters.category) conditions.push(categoryWhere(filters.category));
  if (filters.severity) conditions.push(severityWhere(filters.severity));
  if (filters.userId) conditions.push({ userId: filters.userId });
  const search = searchWhere(filters.search);
  if (search) conditions.push(search);

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
      // IP address and browser details are kept for investigations and shown
      // only when a sign-in entry is opened (getStoreAuditEntry).
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        summary: true,
        changes: true,
        createdAt: true,
        user: { select: { name: true, username: true, role: { select: { name: true } } } },
      },
    }),
    'createdAt' in window
      ? ctx.db.auditLog.count({ where: { createdAt: { lt: (window.createdAt as { gte: Date }).gte } } })
      : Promise.resolve(0),
  ]);

  const branches = await branchNames(ctx.db, rows);

  return {
    rows: rows.map((row) => {
      const { category, severity } = classifyAudit(row);
      return {
        id: row.id,
        action: row.action,
        entity: row.entity,
        summary: row.summary,
        createdAt: row.createdAt,
        category,
        severity,
        actorName: row.user?.name ?? null,
        actorUsername: row.user?.username ?? null,
        actorRole: row.user?.role?.name ?? null,
        branchName: branches.get(`${row.entity}:${row.entityId}`) ?? null,
        related: relatedLink(row),
      };
    }),
    total,
    page,
    pageCount,
    hiddenOlder,
  };
}

export interface StoreAuditSummary {
  /** Entries in the chosen window. */
  total: number;
  /** Entries since the start of today, store time. */
  today: number;
  /** Sign-in and security entries in the chosen window. */
  security: number;
  /** Of those, the ones flagged attention or critical. */
  securityFlagged: number;
  /** Closed shifts short or over, still waiting for the owner. */
  shiftsAwaitingReview: number;
}

/** The headline counts, each a count of real rows under the stated rule. */
export async function getStoreAuditSummary(range: { from?: Date | null; to?: Date | null }, now: Date = new Date()): Promise<StoreAuditSummary> {
  const ctx = await getStoreContext();
  const window = auditWindowWhere(ctx, now);
  const inRange = rangeWhere(window, range.from, range.to);
  const security = categoryWhere('security');

  const [total, today, securityCount, securityFlagged, shiftsAwaitingReview] = await Promise.all([
    ctx.db.auditLog.count({ where: { AND: inRange } }),
    ctx.db.auditLog.count({ where: { AND: [window, { createdAt: { gte: startOfStoreDay(now) } }] } }),
    ctx.db.auditLog.count({ where: { AND: [...inRange, security] } }),
    ctx.db.auditLog.count({ where: { AND: [...inRange, security, { NOT: severityWhere('normal') }] } }),
    ctx.db.cashierShift.count({ where: { reviewStatus: 'PENDING' } }),
  ]);
  return { total, today, security: securityCount, securityFlagged, shiftsAwaitingReview };
}

export interface StoreAuditEntry extends StoreAuditRow {
  entityId: string | null;
  /** Recorded details, secrets masked; empty when the entry recorded none. */
  details: ChangeRow[];
  /** Only for sign-in and security entries. */
  ipAddress: string | null;
  device: string | null;
}

/** One entry, within the store and the plan's window, or null. */
export async function getStoreAuditEntry(id: string): Promise<StoreAuditEntry | null> {
  const ctx = await getStoreContext();
  const row = await ctx.db.auditLog.findFirst({
    where: { AND: [auditWindowWhere(ctx), { id }] },
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      summary: true,
      changes: true,
      createdAt: true,
      ipAddress: true,
      userAgent: true,
      user: { select: { name: true, username: true, role: { select: { name: true } } } },
    },
  });
  if (!row) return null;

  const { category, severity } = classifyAudit(row);
  const branches = await branchNames(ctx.db, [row]);
  const security = category === 'security';
  return {
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    summary: row.summary,
    createdAt: row.createdAt,
    category,
    severity,
    actorName: row.user?.name ?? null,
    actorUsername: row.user?.username ?? null,
    actorRole: row.user?.role?.name ?? null,
    branchName: branches.get(`${row.entity}:${row.entityId}`) ?? null,
    related: relatedLink(row),
    details: changeRows(row.changes),
    ipAddress: security ? row.ipAddress : null,
    device: security ? describeDevice(row.userAgent) : null,
  };
}

/** "Chrome on Android" from a user-agent string; the raw string is not shown. */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : null;
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (!browser && !os) return 'Unknown device';
  return [browser, os].filter(Boolean).join(' on ');
}

/** The store's accounts, for the "who" filter. */
export async function listAuditActors(): Promise<{ id: string; name: string }[]> {
  const ctx = await getStoreContext();
  return ctx.db.user.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
}
