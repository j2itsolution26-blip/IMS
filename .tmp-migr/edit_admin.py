def sub(p, old, new, n=1):
    s = open(p, encoding='utf-8').read()
    assert s.count(old) == n, (p, old, s.count(old))
    open(p, 'w', encoding='utf-8', newline='').write(s.replace(old, new))


p = 'src/features/admin/actions.ts'
sub(p, "import { prisma } from '@/lib/prisma';", "import { platformPrisma } from '@/lib/prisma';\nimport { getStoreContext, storeDb } from '@/lib/tenant/context';")
sub(p, """ * These are the highest-privilege actions in the system, so each one re-checks
 * the caller's permission and writes an audit entry.
 */""", """ * These are the highest-privilege actions in the system, so each one re-checks
 * the caller's permission and writes an audit entry.
 *
 * Everything goes through the caller's store client, so an id from another
 * store is simply "not found". The exceptions use the platform client and are
 * marked: usernames and emails are unique across the whole platform, and a
 * user editing their own profile may be a platform administrator.
 */""")
sub(p, """    const changed: string[] = [];

    for (const [key, rawValue] of Object.entries(values)) {""", """    const changed: string[] = [];
    const { db, storeId } = await getStoreContext();

    for (const [key, rawValue] of Object.entries(values)) {""")
sub(p, """      const existing = await prisma.setting.findUnique({ where: { key } });
      if (existing?.value === value) continue;

      await prisma.setting.upsert({
        where: { key },""", """      const existing = await db.setting.findFirst({ where: { key } });
      if (existing?.value === value) continue;

      await db.setting.upsert({
        where: { storeId_key: { storeId, key } },""")
sub(p, """async function loadManagedAccount(actor: CurrentUser, id: string, operations: AccountOperation[]) {
  const target = await prisma.user.findUnique({""", """async function loadManagedAccount(actor: CurrentUser, id: string, operations: AccountOperation[]) {
  const db = await storeDb();
  const target = await db.user.findUnique({""")
sub(p, """async function loadAssignableRole(actor: CurrentUser, roleId: string) {
  const role = await prisma.role.findUnique(""", """async function loadAssignableRole(actor: CurrentUser, roleId: string) {
  const db = await storeDb();
  const role = await db.role.findUnique(""")
sub(p, """/** Refuses a username another account holds. Case-insensitive because both sides are normalised. */
async function assertUsernameFree(username: string, exceptUserId?: string): Promise<void> {
  const holder = await prisma.user.findUnique(""", """/**
 * Refuses a username another account holds. Case-insensitive because both
 * sides are normalised. Usernames are unique across every store (sign-in has
 * no store picker), so this asks the platform client, for an id only.
 */
async function assertUsernameFree(username: string, exceptUserId?: string): Promise<void> {
  const holder = await platformPrisma.user.findUnique(""")
sub(p, """    const role = await loadAssignableRole(admin, values.roleId);

    // Checked up front so a duplicate reports against the email field rather
    // than surfacing as a generic failure from inside Better Auth.
    const existing = await prisma.user.findUnique({""", """    const role = await loadAssignableRole(admin, values.roleId);
    const { db, storeId } = await getStoreContext();

    // Checked up front so a duplicate reports against the email field rather
    // than surfacing as a generic failure from inside Better Auth. Emails are
    // unique across every store, so this asks the platform client.
    const existing = await platformPrisma.user.findUnique({""")
sub(p, """    // rather than by writing to the table directly. `runAsProvisioning` is what
    // tells the sign-up hook this is an authorised admin creation, not a public
    // registration.""", """    // rather than by writing to the table directly. `runAsProvisioning` is what
    // tells the sign-up hook this is an authorised admin creation, not a public
    // registration, and which store and role the new account gets.""")
sub(p, """      created = await runAsProvisioning(async () =>""", """      created = await runAsProvisioning({ storeId, roleId: role.id }, async () =>""")
sub(p, """    const persisted = await prisma.user.findUnique({""", """    const persisted = await db.user.findUnique({""")
sub(p, """      await prisma.user.update({
        where: { id: userId },
        data: { roleId: values.roleId, phone: values.phone || null, isActive: values.isActive },
      });
    } catch (error) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);""", """      await db.user.update({
        where: { id: userId },
        data: { roleId: values.roleId, phone: values.phone || null, isActive: values.isActive },
      });
    } catch (error) {
      await db.user.delete({ where: { id: userId } }).catch(() => undefined);""")
sub(p, """    const target = await loadManagedAccount(admin, id, ['edit']);
""", """    const target = await loadManagedAccount(admin, id, ['edit']);
    const db = await storeDb();
""")
sub(p, """      const otherOwners = await prisma.user.count({
        where: { id: { not: id }, isActive: true, role: { slug: 'owner' } },
      });
      if (otherOwners === 0) {
        throw new ConflictError(""", """      const otherOwners = await db.user.count({
        where: { id: { not: id }, isActive: true, role: { slug: 'owner' } },
      });
      if (otherOwners === 0) {
        throw new ConflictError(""")
sub(p, """    await prisma.user
      .update({""", """    await db.user
      .update({""")
sub(p, """    if (!values.isActive) {
      await prisma.session.deleteMany({ where: { userId: id } });
    }""", """    if (!values.isActive) {
      await db.session.deleteMany({ where: { userId: id } });
    }""")
sub(p, """    // change, and it forces the staff member to sign in with the new one.
    await prisma.session.deleteMany({ where: { userId: id } });""", """    // change, and it forces the staff member to sign in with the new one.
    await (await storeDb()).session.deleteMany({ where: { userId: id } });""")
sub(p, """    const [{ count }] = await prisma.$transaction([
      prisma.passkey.deleteMany({ where: { userId: id } }),
      prisma.session.deleteMany({ where: { userId: id } }),
    ]);""", """    const db = await storeDb();
    const [{ count }] = await db.$transaction([
      db.passkey.deleteMany({ where: { userId: id } }),
      db.session.deleteMany({ where: { userId: id } }),
    ]);""")
sub(p, """    const target = await loadManagedAccount(admin, id, ['delete']);
""", """    const target = await loadManagedAccount(admin, id, ['delete']);
    const db = await storeDb();
""")
sub(p, """      const otherOwners = await prisma.user.count({
        where: { id: { not: id }, isActive: true, role: { slug: 'owner' } },
      });
      if (otherOwners === 0) throw new ConflictError('You cannot delete the last Owner account.');
    }

    await prisma.user.delete({ where: { id } });""", """      const otherOwners = await db.user.count({
        where: { id: { not: id }, isActive: true, role: { slug: 'owner' } },
      });
      if (otherOwners === 0) throw new ConflictError('You cannot delete the last Owner account.');
    }

    await db.user.delete({ where: { id } });""")
sub(p, """    const permissions = await prisma.permission.findMany({
      where: { key: { in: valid } },
      select: { id: true },
    });

    const role = await prisma.role.create({""", """    const db = await storeDb();
    const permissions = await db.permission.findMany({
      where: { key: { in: valid } },
      select: { id: true },
    });

    const role = await db.role.create({""")
sub(p, """    const role = await prisma.role.findUnique({ where: { id: roleId }, select: ROLE_POLICY_SELECT });
    if (!role) throw new NotFoundError('Role');""", """    const db = await storeDb();
    const role = await db.role.findUnique({ where: { id: roleId }, select: ROLE_POLICY_SELECT });
    if (!role) throw new NotFoundError('Role');""")
sub(p, """    const permissions = await prisma.permission.findMany({
      where: { key: { in: valid } },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({""", """    const permissions = await db.permission.findMany({
      where: { key: { in: valid } },
      select: { id: true },
    });

    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId } }),
      db.rolePermission.createMany({""")
sub(p, """    const role = await prisma.role.findUnique({
      where: { id },
      select: { ...ROLE_POLICY_SELECT, isSystem: true, _count: { select: { users: true } } },
    });""", """    const db = await storeDb();
    const role = await db.role.findUnique({
      where: { id },
      select: { ...ROLE_POLICY_SELECT, isSystem: true, _count: { select: { users: true } } },
    });""")
sub(p, """    await prisma.role.delete({ where: { id } });""", """    await db.role.delete({ where: { id } });""")
sub(p, """    const values = parseInput(profileSchema, input);

    await prisma.user.update({
      where: { id: user.id },""", """    const values = parseInput(profileSchema, input);

    // Platform administrators have a profile too but no store, so this writes
    // through the platform client, limited to the caller's own row.
    await platformPrisma.user.update({
      where: { id: user.id },""")
print('ok')
