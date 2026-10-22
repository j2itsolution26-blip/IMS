/**
 * Installs the system reference data the application cannot run without:
 * the permission catalogue and the platform's System Administrator role, and
 * for every store its roles, warehouse and default settings.
 *
 * This is NOT a demo seed. It creates no products, no customers, no suppliers,
 * no sales, and no users — every business record in this system comes from real
 * activity. It is safe to re-run: everything is upserted, and it never
 * downgrades a setting an administrator has already changed.
 *
 *   npm run db:bootstrap
 */

import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, SYSTEM_ADMIN_ROLE_SLUG, SYSTEM_ROLES, resolveRolePermissions } from '../src/lib/permissions';
import { SETTING_DEFINITIONS } from '../src/lib/settings-definitions';

const prisma = new PrismaClient();

async function installPermissions(): Promise<Map<string, string>> {
  await prisma.$transaction(
    ALL_PERMISSIONS.map((permission) =>
      prisma.permission.upsert({
        where: { key: permission.key },
        create: {
          key: permission.key,
          resource: permission.resource,
          action: permission.action,
          description: permission.description,
        },
        update: { resource: permission.resource, action: permission.action, description: permission.description },
      }),
    ),
  );

  const rows = await prisma.permission.findMany({ select: { id: true, key: true } });
  console.log(`  permissions: ${rows.length} installed`);
  return new Map(rows.map((row) => [row.key, row.id]));
}

/** Replaces a role's grants with exactly `wanted`, so a removed permission is actually revoked. */
async function syncGrants(roleId: string, wanted: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId, permissionId: { notIn: wanted } } }),
    prisma.rolePermission.createMany({
      data: wanted.map((permissionId) => ({ roleId, permissionId })),
      skipDuplicates: true,
    }),
  ]);
}

function grantsFor(definition: (typeof SYSTEM_ROLES)[number], permissionIds: Map<string, string>): string[] {
  return resolveRolePermissions(definition)
    .map((key) => permissionIds.get(key))
    .filter((id): id is string => Boolean(id));
}

/** The System Administrator role belongs to the platform, not to any store. */
async function installPlatformRole(permissionIds: Map<string, string>): Promise<void> {
  const definition = SYSTEM_ROLES.find((role) => role.slug === SYSTEM_ADMIN_ROLE_SLUG);
  if (!definition) return;
  const fields = { name: definition.name, description: definition.description, isSystem: true };
  const existing = await prisma.role.findFirst({ where: { slug: definition.slug, storeId: null }, select: { id: true } });
  const role = existing
    ? await prisma.role.update({ where: { id: existing.id }, data: fields, select: { id: true } })
    : await prisma.role.create({ data: { slug: definition.slug, storeId: null, ...fields }, select: { id: true } });
  const wanted = grantsFor(definition, permissionIds);
  await syncGrants(role.id, wanted);
  console.log(`  platform role ${definition.name} ${wanted.length} permissions`);
}

/** Each store's own Owner, Cashier and Inventory Staff roles. */
async function installStoreRoles(storeId: string, permissionIds: Map<string, string>): Promise<void> {
  for (const definition of SYSTEM_ROLES) {
    if (definition.slug === SYSTEM_ADMIN_ROLE_SLUG) continue;
    const role = await prisma.role.upsert({
      where: { storeId_slug: { storeId, slug: definition.slug } },
      create: { storeId, slug: definition.slug, name: definition.name, description: definition.description, isSystem: true },
      update: { name: definition.name, description: definition.description, isSystem: true },
      select: { id: true },
    });
    await syncGrants(role.id, grantsFor(definition, permissionIds));
  }
}

async function installWarehouse(storeId: string): Promise<void> {
  await prisma.warehouse.upsert({
    where: { storeId_code: { storeId, code: 'MAIN' } },
    create: { storeId, code: 'MAIN', name: 'Main Store', isDefault: true, isActive: true },
    update: { isDefault: true, isActive: true },
  });
}

async function installSettings(storeId: string): Promise<number> {
  let created = 0;

  for (const definition of SETTING_DEFINITIONS) {
    const where = { storeId_key: { storeId, key: definition.key } };
    const existing = await prisma.setting.findUnique({ where, select: { id: true } });

    if (!existing) {
      await prisma.setting.create({ data: { ...definition, storeId } });
      created += 1;
      continue;
    }

    // Never overwrite a configured value — only refresh the presentation
    // metadata so relabelled settings pick up the new copy.
    await prisma.setting.update({
      where,
      data: {
        type: definition.type,
        group: definition.group,
        label: definition.label,
        description: definition.description,
      },
    });
  }
  return created;
}

async function main() {
  console.log('Bootstrapping system reference data…\n');

  const permissionIds = await installPermissions();
  await installPlatformRole(permissionIds);

  // A new installation has one store waiting for its owner; an existing one
  // keeps the stores it has, and each is brought up to date.
  let stores = await prisma.store.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
  if (stores.length === 0) {
    stores = [await prisma.store.create({ data: { name: 'My Store', slug: 'my-store' }, select: { id: true, name: true } })];
  }

  for (const store of stores) {
    await installStoreRoles(store.id, permissionIds);
    await installWarehouse(store.id);
    const created = await installSettings(store.id);
    console.log(`  store "${store.name}": roles, Main Store warehouse, settings (${created} created)`);
  }

  const [users, products] = await Promise.all([prisma.user.count(), prisma.product.count()]);

  console.log('\nDone.');
  console.log(`  stores:   ${stores.length}`);
  console.log(`  users:    ${users}`);
  console.log(`  products: ${products}`);

  if (users === 0) {
    console.log('\nNext step: open /sign-up to create the owner account.');
  }
}

main()
  .catch((error) => {
    console.error('\nBootstrap failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
