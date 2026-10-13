import 'server-only';

import { prisma } from '@/lib/prisma';
import { OWNER_ROLE_SLUG, SYSTEM_ADMIN_ROLE_SLUG } from '@/lib/permissions';

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
  email: row.email,
  phone: row.phone,
  isActive: row.isActive,
  roleName: row.role.name,
  roleSlug: row.role.slug,
  createdAt: row.createdAt,
  lastLoginAt: row.lastLoginAt,
});

/** Owner accounts, newest first, optionally narrowed by a search term. */
export async function listOwnerAccounts(search?: string): Promise<PlatformAccount[]> {
  const term = search?.trim();

  const rows = await prisma.user.findMany({
    where: {
      role: { slug: OWNER_ROLE_SLUG },
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
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
    prisma.user.count({ where: owner }),
    prisma.user.count({ where: { ...owner, isActive: true } }),
    prisma.user.count({
      where: { role: { slug: { notIn: [OWNER_ROLE_SLUG, SYSTEM_ADMIN_ROLE_SLUG] } } },
    }),
    prisma.user.count({ where: { role: { slug: SYSTEM_ADMIN_ROLE_SLUG } } }),
    prisma.user.count({ where: { ...owner, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.setting.findUnique({ where: { key: 'company.name' }, select: { value: true } }),
  ]);

  return {
    owners: { total, active, inactive: total - active },
    staff,
    admins,
    recentOwners,
    storeName: storeNameSetting?.value || 'Unnamed store',
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
 * Administrative activity on accounts.
 *
 * Scoped to the `User` entity so this reads as a record of who was given or
 * denied access, rather than a firehose of every stock movement.
 */
export async function listAccountAudit(limit = 25): Promise<AdminAuditEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entity: 'User' },
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
