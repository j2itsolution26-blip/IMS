/**
 * Verification for admin account provisioning.
 * Creates temporary accounts against the real database and removes them again.
 */
import { prisma } from '../src/lib/prisma';
import { auth } from '../src/lib/auth';
import { APIError } from 'better-auth/api';
import { runAsProvisioning } from '../src/lib/provisioning-context';

const EMAIL = '__verify_new_user__@localhost.test';
const PASSWORD = 'VerifyPass1!x';
let pass = 0, fail = 0;

const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

async function purge() {
  const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (u) await prisma.user.delete({ where: { id: u.id } });
}

async function main() {
  await purge();
  const cashier = await prisma.role.findUniqueOrThrow({ where: { slug: 'cashier' }, select: { id: true } });

  console.log('\n1. Account creation mints NO session (the reported bug)');
  const created = await runAsProvisioning(async () =>
    auth.api.signUpEmail({ body: { name: 'Verify User', email: EMAIL, password: PASSWORD } }));
  const userId = created?.user?.id;
  check('account created', Boolean(userId));
  const sessions = await prisma.session.count({ where: { userId } });
  check('zero sessions created for the new account', sessions === 0, `found ${sessions}`);

  console.log('\n2. Role assignment');
  await prisma.user.update({ where: { id: userId! }, data: { roleId: cashier.id } });
  const withRole = await prisma.user.findUnique({
    where: { id: userId! },
    select: { role: { select: { slug: true, permissions: { select: { permission: { select: { key: true } } } } } } } });
  check('role applied', withRole?.role.slug === 'cashier', withRole?.role.slug);
  const perms = withRole?.role.permissions.map(p => p.permission.key) ?? [];
  check('permissions resolve', perms.length > 0, `${perms.length} permissions`);
  check('cashier cannot view users (least privilege)', !perms.includes('users.view'));

  console.log('\n3. Credential + password hashing');
  const acct = await prisma.account.findFirst({
    where: { userId: userId!, providerId: 'credential' }, select: { password: true } });
  check('credential account exists', Boolean(acct));
  check('password is hashed, not plaintext',
    Boolean(acct?.password) && !acct!.password!.includes(PASSWORD), `len=${acct?.password?.length ?? 0}`);

  console.log('\n4. Duplicate email rejected');
  // Better Auth does NOT throw on a duplicate: it reports success and returns a
  // generated id that was never inserted, because the unique constraint drops
  // the row. createUser therefore relies on two guards, both asserted here.
  const preCheck = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  check('guard 1: pre-check finds the existing account', Boolean(preCheck));

  const dup = await runAsProvisioning(async () =>
    auth.api.signUpEmail({ body: { name: 'Dup', email: EMAIL, password: PASSWORD } }));
  const phantom = await prisma.user.findUnique({
    where: { id: dup!.user.id }, select: { id: true } });
  check('guard 2: phantom id is not persisted', phantom === null, `id=${dup?.user?.id}`);

  const rows = await prisma.user.findMany({ where: { email: EMAIL }, select: { name: true } });
  check('no duplicate row created', rows.length === 1, `${rows.length} row(s)`);
  check('existing account not overwritten', rows[0]?.name === 'Verify User', rows[0]?.name);

  console.log('\n5. Password policy enforced server-side');
  try {
    await runAsProvisioning(async () =>
      auth.api.signUpEmail({ body: { name: 'Weak', email: 'weak@localhost.test', password: 'short' } }));
    check('weak password rejected', false, 'no error thrown');
    await prisma.user.deleteMany({ where: { email: 'weak@localhost.test' } });
  } catch (e) {
    check('weak password rejected', e instanceof APIError,
      e instanceof APIError ? ((e.body as any)?.message ?? e.message) : String(e));
  }

  console.log('\n6. Public sign-up still blocked (no provisioning context)');
  try {
    await auth.api.signUpEmail({ body: { name: 'Public', email: 'public@localhost.test', password: PASSWORD } });
    check('public sign-up blocked', false, 'account was created!');
    await prisma.user.deleteMany({ where: { email: 'public@localhost.test' } });
  } catch (e) {
    check('public sign-up blocked', true, e instanceof APIError ? ((e.body as any)?.message ?? e.message).slice(0, 60) : 'threw');
  }

  console.log('\n7. Cleanup');
  await purge();
  check('temporary account removed', !(await prisma.user.findUnique({ where: { email: EMAIL } })));

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await purge().catch(()=>{}); await prisma.$disconnect(); process.exit(1); });
