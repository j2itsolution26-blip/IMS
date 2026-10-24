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
import { installPermissionCatalogue, installPlatformRole, setUpStore } from '../src/server/platform/store-setup';

const prisma = new PrismaClient();

async function main() {
  console.log('Bootstrapping system reference data…\n');

  const permissionIds = await installPermissionCatalogue(prisma);
  console.log(`  permissions: ${permissionIds.size} installed`);
  const platformRole = await installPlatformRole(prisma, permissionIds);
  console.log(`  platform role System Administrator ${platformRole.permissions} permissions`);

  // Existing stores are brought up to date. A new installation has none:
  // the System Administrator creates each store (with its owner and trial)
  // from System Admin → Stores after first-time setup.
  const stores = await prisma.store.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });

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
    console.log('\nNext step: open /setup to create the System Administrator account.');
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
