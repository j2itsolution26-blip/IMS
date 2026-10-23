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
import { ALL_PERMISSIONS, SYSTEM_ADMIN_ROLE_SLUG, SYSTEM_ROLES } from '../src/lib/permissions';
import { grantsFor, setUpStore, syncGrants } from '../src/server/platform/store-setup';

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
  await syncGrants(prisma, role.id, wanted);
  console.log(`  platform role ${definition.name} ${wanted.length} permissions`);
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
    const created = await setUpStore(prisma, store.id, permissionIds);
    console.log(`  store "${store.name}": roles, Main Store warehouse, settings (${created} created), plan quotas`);
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
