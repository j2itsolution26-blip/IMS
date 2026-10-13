/**
 * Provisions the first System Administrator.
 *
 * Deliberately a deployment-time command rather than a page: there is no
 * public route that can mint a privileged account, and nothing ships with a
 * default administrator or a known password.
 *
 * Usage:
 *   npm run admin:create -- --email=admin@example.com --name="Platform Admin"
 *
 * The password is read from ADMIN_PASSWORD, or generated and printed once if
 * that is unset. It is never written to the audit trail or committed anywhere.
 *
 * Re-running is safe: the command refuses once an administrator exists, so a
 * repeated deploy cannot quietly add a second privileged account. To replace a
 * lost administrator, deactivate the old row first, then run this again.
 */
import { randomBytes } from 'node:crypto';
import { auth } from '../src/lib/auth';
import { prisma } from '../src/lib/prisma';
import { runAsProvisioning } from '../src/lib/provisioning-context';
import { SYSTEM_ADMIN_ROLE_SLUG } from '../src/lib/permissions';

function arg(name: string): string | undefined {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match?.slice(name.length + 3).trim() || undefined;
}

/** Meets the application's own password policy without a human inventing one. */
function generatePassword(): string {
  const raw = randomBytes(18).toString('base64url');
  return `Aa1!${raw}`;
}

async function main() {
  const email = arg('email')?.toLowerCase();
  const name = arg('name') ?? 'System Administrator';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Usage: npm run admin:create -- --email=you@example.com [--name="Full Name"]');
    process.exit(1);
  }

  const role = await prisma.role.findUnique({
    where: { slug: SYSTEM_ADMIN_ROLE_SLUG },
    select: { id: true },
  });
  if (!role) {
    console.error(
      `No "${SYSTEM_ADMIN_ROLE_SLUG}" role found. Run "npm run db:bootstrap" first to sync roles and permissions.`,
    );
    process.exit(1);
  }

  const existing = await prisma.user.count({ where: { roleId: role.id } });
  if (existing > 0) {
    console.error(
      `A System Administrator already exists (${existing}). Refusing to create another.\n` +
        'Deactivate the existing account first if you are replacing it.',
    );
    process.exit(1);
  }

  const duplicate = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (duplicate) {
    console.error(`${email} already has an account. Choose a different address.`);
    process.exit(1);
  }

  const password = process.env.ADMIN_PASSWORD?.trim() || generatePassword();
  const generated = !process.env.ADMIN_PASSWORD?.trim();

  // Better Auth owns hashing, so the account is created through it rather than
  // written to the table directly.
  const created = await runAsProvisioning(async () =>
    auth.api.signUpEmail({ body: { name, email, password } }),
  );

  const userId = created?.user?.id;
  if (!userId) throw new Error('The account could not be created.');

  await prisma.user.update({ where: { id: userId }, data: { roleId: role.id } });

  console.log(`\nSystem Administrator created: ${email}`);
  if (generated) {
    console.log(`Temporary password: ${password}`);
    console.log('Store it in your password manager and change it after signing in.');
  } else {
    console.log('Password taken from ADMIN_PASSWORD.');
  }
  console.log('Sign in at /sign-in; you will land on /system-admin.\n');

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
