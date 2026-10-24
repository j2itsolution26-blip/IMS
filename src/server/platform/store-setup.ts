import type { Prisma, PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, SYSTEM_ADMIN_ROLE_SLUG, SYSTEM_ROLES, resolveRolePermissions } from '../../lib/permissions';
import { SETTING_DEFINITIONS } from '../../lib/settings-definitions';
import { storedLimits } from '../../lib/store-access';

/**
 * Everything a store needs before anyone can work in it: its own copies of
 * the built-in roles (with their default permissions), the Main Store
 * warehouse, the default settings, and its plan quotas on the store row.
 *
 * Used by `prisma/bootstrap.ts` for every existing store and by the platform
 * administrator's "Create store". Safe to re-run: everything is upserted and a
 * setting an owner has changed is never overwritten.
 *
 * Note: a built-in role's grants are reset to its defaults (that is what
 * bootstrap has always done), so do not run this on an existing store just to
 * pick up one new permission — grant it in a migration instead.
 *
 * Takes the client to use, so the platform can run it inside the transaction
 * that creates the store. Relative imports only: bootstrap runs it outside
 * Next.js.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The permission catalogue, written from src/lib/permissions.ts. Returns
 * permission key -> id. Used by bootstrap and by first-time setup, so a fresh
 * database needs nothing run by hand before /setup works.
 */
export async function installPermissionCatalogue(db: Db): Promise<Map<string, string>> {
  for (const permission of ALL_PERMISSIONS) {
    await db.permission.upsert({
      where: { key: permission.key },
      create: { key: permission.key, resource: permission.resource, action: permission.action, description: permission.description },
      update: { resource: permission.resource, action: permission.action, description: permission.description },
    });
  }
  return permissionIds(db);
}

/** The System Administrator role, which belongs to the platform rather than any store. Returns its id. */
export async function installPlatformRole(db: Db, ids: Map<string, string>): Promise<{ id: string; permissions: number }> {
  const definition = SYSTEM_ROLES.find((role) => role.slug === SYSTEM_ADMIN_ROLE_SLUG);
  if (!definition) throw new Error('The System Administrator role definition is missing.');
  const fields = { name: definition.name, description: definition.description, isSystem: true };
  const existing = await db.role.findFirst({ where: { slug: definition.slug, storeId: null }, select: { id: true } });
  const role = existing
    ? await db.role.update({ where: { id: existing.id }, data: fields, select: { id: true } })
    : await db.role.create({ data: { slug: definition.slug, storeId: null, ...fields }, select: { id: true } });
  const wanted = grantsFor(definition, ids);
  await syncGrants(db, role.id, wanted);
  return { id: role.id, permissions: wanted.length };
}

/** permission key -> id, from the permissions table. */
export async function permissionIds(db: Db): Promise<Map<string, string>> {
  const rows = await db.permission.findMany({ select: { id: true, key: true } });
  return new Map(rows.map((row) => [row.key, row.id]));
}

/** Replaces a role's grants with exactly `wanted`, so a removed permission is actually revoked. */
export async function syncGrants(db: Db, roleId: string, wanted: string[]): Promise<void> {
  await db.rolePermission.deleteMany({ where: { roleId, permissionId: { notIn: wanted } } });
  await db.rolePermission.createMany({
    data: wanted.map((permissionId) => ({ roleId, permissionId })),
    skipDuplicates: true,
  });
}

export function grantsFor(definition: (typeof SYSTEM_ROLES)[number], ids: Map<string, string>): string[] {
  return resolveRolePermissions(definition)
    .map((key) => ids.get(key))
    .filter((id): id is string => Boolean(id));
}

/** Each store's own Owner, Cashier and Inventory Staff roles. */
export async function installStoreRoles(db: Db, storeId: string, ids: Map<string, string>): Promise<void> {
  for (const definition of SYSTEM_ROLES) {
    if (definition.slug === SYSTEM_ADMIN_ROLE_SLUG) continue;
    const role = await db.role.upsert({
      where: { storeId_slug: { storeId, slug: definition.slug } },
      create: { storeId, slug: definition.slug, name: definition.name, description: definition.description, isSystem: true },
      update: { name: definition.name, description: definition.description, isSystem: true },
      select: { id: true },
    });
    await syncGrants(db, role.id, grantsFor(definition, ids));
  }
}

export async function installWarehouse(db: Db, storeId: string): Promise<void> {
  await db.warehouse.upsert({
    where: { storeId_code: { storeId, code: 'MAIN' } },
    create: { storeId, code: 'MAIN', name: 'Main Store', isDefault: true, isActive: true },
    update: { isDefault: true, isActive: true },
  });
}

/** Returns how many settings were created (the rest already existed). */
export async function installSettings(db: Db, storeId: string): Promise<number> {
  let created = 0;
  for (const definition of SETTING_DEFINITIONS) {
    const where = { storeId_key: { storeId, key: definition.key } };
    const existing = await db.setting.findUnique({ where, select: { id: true } });
    if (!existing) {
      await db.setting.create({ data: { ...definition, storeId } });
      created += 1;
      continue;
    }
    // Never overwrite a configured value — only refresh the presentation
    // metadata so relabelled settings pick up the new copy.
    await db.setting.update({
      where,
      data: { type: definition.type, group: definition.group, label: definition.label, description: definition.description },
    });
  }
  return created;
}

/** Copies the plan's quotas onto the store row, where the quota trigger reads them. */
export async function syncLimits(db: Db, storeId: string): Promise<void> {
  const store = await db.store.findUniqueOrThrow({ where: { id: storeId }, select: { plan: true, status: true } });
  await db.store.update({ where: { id: storeId }, data: storedLimits(store) });
}

/** All of the above for one store. Returns the number of settings created. */
export async function setUpStore(db: Db, storeId: string, ids: Map<string, string>): Promise<number> {
  await installStoreRoles(db, storeId, ids);
  await installWarehouse(db, storeId);
  const created = await installSettings(db, storeId);
  await syncLimits(db, storeId);
  return created;
}
