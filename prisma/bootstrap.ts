/**
 * Installs the system reference data the application cannot run without:
 * the permission catalogue, the system roles, and the default settings.
 *
 * This is NOT a demo seed. It creates no products, no customers, no suppliers,
 * no sales, and no users — every business record in this system comes from real
 * activity. It is safe to re-run: everything is upserted, and it never
 * downgrades a setting an administrator has already changed.
 *
 *   npm run db:bootstrap
 */

import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, SYSTEM_ROLES, resolveRolePermissions } from '../src/lib/permissions';
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

async function installRoles(permissionIds: Map<string, string>): Promise<void> {
  for (const definition of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { slug: definition.slug },
      create: {
        slug: definition.slug,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
      update: { name: definition.name, description: definition.description, isSystem: true },
      select: { id: true },
    });

    const keys = resolveRolePermissions(definition);
    const wanted = keys
      .map((key) => permissionIds.get(key))
      .filter((id): id is string => Boolean(id));

    // Replace the grant set so a permission removed from the catalogue is
    // actually revoked, not left dangling on the role.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wanted } },
      }),
      prisma.rolePermission.createMany({
        data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      }),
    ]);

    console.log(`  role ${definition.name.padEnd(16)} ${wanted.length} permissions`);
  }
}

async function installSettings(): Promise<void> {
  let created = 0;

  for (const definition of SETTING_DEFINITIONS) {
    const existing = await prisma.setting.findUnique({ where: { key: definition.key } });

    if (!existing) {
      await prisma.setting.create({ data: definition });
      created += 1;
      continue;
    }

    // Never overwrite a configured value — only refresh the presentation
    // metadata so relabelled settings pick up the new copy.
    await prisma.setting.update({
      where: { key: definition.key },
      data: {
        type: definition.type,
        group: definition.group,
        label: definition.label,
        description: definition.description,
      },
    });
  }

  console.log(`  settings: ${created} created, ${SETTING_DEFINITIONS.length - created} already present`);
}

async function main() {
  console.log('Bootstrapping system reference data…\n');

  const permissionIds = await installPermissions();
  await installRoles(permissionIds);
  await installSettings();

  const [users, products] = await Promise.all([prisma.user.count(), prisma.product.count()]);

  console.log('\nDone.');
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
