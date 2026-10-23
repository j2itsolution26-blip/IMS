import 'server-only';

import { platformPrisma } from '@/lib/prisma';
import { OWNER_ROLE_SLUG, SYSTEM_ADMIN_ROLE_SLUG } from '@/lib/permissions';
import type { StoreSubscription } from '@/lib/store-access';

/**
 * Reads for the platform administrator.
 *
 * Deliberately narrow: account records, not store data. An administrator
 * maintains access to the system, so nothing here touches products, sales or
 * inventory.
 */

export interface PlatformAccount {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  roleName: string;
  roleSlug: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

const ACCOUNT_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  phone: true,
  isActive: true,
  createdAt: true,
  lastLoginAt: true,
  role: { select: { name: true, slug: true } },
} as const;

type AccountRow = {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  role: { name: string; slug: string };
};

const toAccount = (row: AccountRow): PlatformAccount => ({
  id: row.id,
  name: row.name,
  username: row.username,
  email: row.email,
  phone: row.phone,
  isActive: row.isActive,
  roleName: row.role.name,
  roleSlug: row.role.slug,
  createdAt: row.createdAt,
  lastLoginAt: row.lastLoginAt,
});

/** How many stores have no owner yet — each can be given one from the owners screen. */
export async function countStoresAwaitingOwner(): Promise<number> {
  return platformPrisma.store.count({ where: { ownerId: null } });
}

/** Owner accounts, newest first, optionally narrowed by a search term. */
export async function listOwnerAccounts(search?: string): Promise<PlatformAccount[]> {
  const term = search?.trim();

  const rows = await platformPrisma.user.findMany({
    where: {
      role: { slug: OWNER_ROLE_SLUG },
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
              { username: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: ACCOUNT_SELECT,
    orderBy: { createdAt: 'desc' },
  });

  return rows.map(toAccount);
}

export interface PlatformStats {
  owners: { total: number; active: number; inactive: number };
  staff: number;
  admins: number;
  /** Owner accounts created in the last 30 days. */
  recentOwners: number;
  storeName: string;
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
  const owner = { role: { slug: OWNER_ROLE_SLUG } };

  const [total, active, staff, admins, recentOwners, storeNameSetting] = await Promise.all([
    platformPrisma.user.count({ where: owner }),
    platformPrisma.user.count({ where: { ...owner, isActive: true } }),
    platformPrisma.user.count({
      where: { role: { slug: { notIn: [OWNER_ROLE_SLUG, SYSTEM_ADMIN_ROLE_SLUG] } } },
    }),
    platformPrisma.user.count({ where: { role: { slug: SYSTEM_ADMIN_ROLE_SLUG } } }),
    platformPrisma.user.count({ where: { ...owner, createdAt: { gte: thirtyDaysAgo } } }),
    // The store's own name; with several stores the platform lists them all.
    platformPrisma.store.findFirst({ orderBy: { createdAt: 'asc' }, select: { name: true } }),
  ]);

  return {
    owners: { total, active, inactive: total - active },
    staff,
    admins,
    recentOwners,
    storeName: storeNameSetting?.name || 'Unnamed store',
  };
}

export interface AdminAuditEntry {
  id: string;
  action: string;
  summary: string;
  actorName: string | null;
  createdAt: Date;
}

/**
 * Administrative activity on accounts and subscriptions.
 *
 * Scoped to the `User` entity plus the platform's own subscription entries
 * (plan, status, trial and payment changes), so this reads as a record of who
 * was given or denied access, rather than a firehose of every stock movement.
 */
export async function listAccountAudit(limit = 25): Promise<AdminAuditEntry[]> {
  const rows = await platformPrisma.auditLog.findMany({
    where: { OR: [{ entity: 'User' }, { storeId: null, entity: { in: ['Store', 'SubscriptionPayment'] } }] },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      summary: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    summary: row.summary,
    actorName: row.user?.name ?? null,
    createdAt: row.createdAt,
  }));
}

// --- Stores and subscriptions -------------------------------------------------

export interface PlatformStoreRow {
  id: string;
  name: string;
  plan: StoreSubscription['plan'];
  status: StoreSubscription['status'];
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  createdAt: Date;
  ownerName: string | null;
  ownerUsername: string | null;
  products: number;
  staff: number;
  branches: number;
}

/**
 * Every store with its subscription and usage, newest first. Usage uses the
 * same definitions as the plan limits (non-archived products, active staff
 * other than the owner, warehouses).
 */
export async function listStores(search?: string): Promise<PlatformStoreRow[]> {
  const term = search?.trim() ? `%${search.trim()}%` : null;
  return platformPrisma.$queryRaw<PlatformStoreRow[]>`
    SELECT s.id, s.name, s.plan::text AS plan, s.status::text AS status, s."trialEndsAt", s."currentPeriodEnd", s."createdAt",
      o.name AS "ownerName", o.username AS "ownerUsername",
      (SELECT count(*)::int FROM products p WHERE p."storeId" = s.id AND p.status <> 'ARCHIVED') AS products,
      (SELECT count(*)::int FROM users u WHERE u."storeId" = s.id AND u."isActive" AND u.id IS DISTINCT FROM s."ownerId") AS staff,
      (SELECT count(*)::int FROM warehouses w WHERE w."storeId" = s.id) AS branches
    FROM stores s
    LEFT JOIN users o ON o.id = s."ownerId"
    WHERE ${term}::text IS NULL OR s.name ILIKE ${term} OR o.name ILIKE ${term} OR o.username ILIKE ${term} OR o.email ILIKE ${term}
    ORDER BY s."createdAt" DESC
    LIMIT 500`;
}

export interface PlatformPayment {
  id: string;
  plan: StoreSubscription['plan'];
  amount: string;
  currency: string;
  method: 'GCASH' | 'BANK_TRANSFER' | 'OTHER';
  reference: string;
  paidAt: Date;
  months: number;
  periodStart: Date;
  periodEnd: Date;
  notes: string | null;
  recordedBy: string;
  createdAt: Date;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export interface PlatformStoreDetail {
  store: Omit<PlatformStoreRow, 'products' | 'staff' | 'branches'> & { ownerEmail: string | null; ownerPhone: string | null };
  usage: { products: number; staff: number; branches: number; backgroundRemovals: number };
  payments: PlatformPayment[];
  history: AdminAuditEntry[];
}

export async function getStoreDetail(storeId: string, period: string): Promise<PlatformStoreDetail | null> {
  const store = await platformPrisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true, name: true, plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true, createdAt: true, ownerId: true,
      owner: { select: { name: true, username: true, email: true, phone: true } },
    },
  });
  if (!store) return null;

  const [products, staff, branches, removals, payments, history] = await Promise.all([
    platformPrisma.product.count({ where: { storeId, status: { not: 'ARCHIVED' } } }),
    platformPrisma.user.count({ where: { storeId, isActive: true, ...(store.ownerId ? { id: { not: store.ownerId } } : {}) } }),
    platformPrisma.warehouse.count({ where: { storeId } }),
    platformPrisma.storeUsage.findUnique({
      where: { storeId_metric_period: { storeId, metric: 'backgroundRemovals', period } },
      select: { count: true },
    }),
    platformPrisma.subscriptionPayment.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { recordedBy: { select: { name: true } }, voidedBy: { select: { name: true } } },
    }),
    // The platform's copy of this store's subscription entries (it names the administrator).
    platformPrisma.auditLog.findMany({
      where: { storeId: null, entity: { in: ['Store', 'SubscriptionPayment'] }, changes: { path: ['storeId'], equals: storeId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, action: true, summary: true, createdAt: true, user: { select: { name: true } } },
    }),
  ]);

  return {
    store: {
      id: store.id, name: store.name, plan: store.plan, status: store.status, trialEndsAt: store.trialEndsAt,
      currentPeriodEnd: store.currentPeriodEnd, createdAt: store.createdAt,
      ownerName: store.owner?.name ?? null, ownerUsername: store.owner?.username ?? null,
      ownerEmail: store.owner?.email ?? null, ownerPhone: store.owner?.phone ?? null,
    },
    usage: { products, staff, branches, backgroundRemovals: removals?.count ?? 0 },
    payments: payments.map((p) => ({
      id: p.id, plan: p.plan, amount: p.amount.toFixed(2), currency: p.currency, method: p.method, reference: p.reference,
      paidAt: p.paidAt, months: p.months, periodStart: p.periodStart, periodEnd: p.periodEnd, notes: p.notes,
      recordedBy: p.recordedBy.name, createdAt: p.createdAt, voidedAt: p.voidedAt, voidedBy: p.voidedBy?.name ?? null, voidReason: p.voidReason,
    })),
    history: history.map((row) => ({ id: row.id, action: row.action, summary: row.summary, actorName: row.user?.name ?? null, createdAt: row.createdAt })),
  };
}
