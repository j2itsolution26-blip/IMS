import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { ROLE_LABELS } from '@/lib/permissions';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Field, PageHeader } from '@/components/ui';
import { createUser, updateUser } from './actions';

export const metadata = { title: 'Accounts' };

function RoleSelect({ value }: { value?: string }) {
  return (
    <select name="role" className="input" defaultValue={value ?? 'STAFF'}>
      {Object.entries(ROLE_LABELS).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export default async function Users() {
  await requirePermission('users.manage');
  const users = await prisma.user.findMany({ orderBy: [{ active: 'desc' }, { fullName: 'asc' }] });

  return (
    <>
      <PageHeader title="Staff accounts" description="Each person gets their own account so the audit log shows who did what. Never share accounts." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {users.map((u) => (
            <Card key={u.id}>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{u.fullName}</div>
                  <div className="text-sm text-slate-500">@{u.username}</div>
                </div>
                {u.active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}
              </div>
              <ActionForm action={updateUser} submitLabel="Save" submitClassName="btn-secondary" className="grid items-end gap-3 sm:grid-cols-4">
                <input type="hidden" name="id" value={u.id} />
                <Field label="Role">
                  <RoleSelect value={u.role} />
                </Field>
                <Field label="Status">
                  <select name="active" className="input" defaultValue={String(u.active)}>
                    <option value="true">Active</option>
                    <option value="false">Deactivated</option>
                  </select>
                </Field>
                <Field label="New password" hint="Leave blank to keep">
                  <input name="password" type="password" className="input" autoComplete="new-password" />
                </Field>
              </ActionForm>
            </Card>
          ))}
        </div>
        <Card title="Add an account">
          <ActionForm action={createUser} submitLabel="Create account" resetOnSuccess>
            <Field label="Full name">
              <input name="fullName" className="input" required />
            </Field>
            <Field label="Username">
              <input name="username" className="input" required autoComplete="off" />
            </Field>
            <Field label="Role">
              <RoleSelect />
            </Field>
            <Field label="Temporary password" hint="At least 10 characters, with a letter and a number">
              <input name="password" type="password" className="input" required autoComplete="new-password" />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
