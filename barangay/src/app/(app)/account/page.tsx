import { requireUser } from '@/lib/session';
import { ROLE_LABELS } from '@/lib/permissions';
import { ActionForm } from '@/components/action-form';
import { Card, Field, PageHeader } from '@/components/ui';
import { changePassword } from './actions';

export const metadata = { title: 'My account' };

export default async function Account() {
  const me = await requireUser();
  return (
    <>
      <PageHeader title="My account" description={`${me.fullName} · @${me.username} · ${ROLE_LABELS[me.role]}`} />
      <Card title="Change password" className="max-w-md">
        <ActionForm action={changePassword} submitLabel="Change password" resetOnSuccess>
          <Field label="Current password">
            <input name="current" type="password" className="input" autoComplete="current-password" required />
          </Field>
          <Field label="New password" hint="At least 10 characters, with a letter and a number">
            <input name="next" type="password" className="input" autoComplete="new-password" required />
          </Field>
          <Field label="Repeat new password">
            <input name="confirm" type="password" className="input" autoComplete="new-password" required />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
