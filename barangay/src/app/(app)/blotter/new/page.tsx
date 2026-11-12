import { requirePermission } from '@/lib/session';
import { ActionForm } from '@/components/action-form';
import { Card, Field, PageHeader } from '@/components/ui';
import { createCase } from '../actions';

export const metadata = { title: 'Record a case' };

export default async function NewCase() {
  await requirePermission('blotter.edit');
  return (
    <>
      <PageHeader title="Record a case" description="Case records are confidential. Only the Punong Barangay, Secretary, Kagawad and Lupon can see them." />
      <Card className="max-w-3xl">
        <ActionForm action={createCase} submitLabel="Record case">
          <Field label="Type">
            <select name="kind" className="input" defaultValue="KP">
              <option value="KP">Katarungang Pambarangay dispute (for settlement)</option>
              <option value="BLOTTER">Blotter entry (record only)</option>
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Complainant(s)">
              <input name="complainant" className="input" required />
            </Field>
            <Field label="Respondent(s)">
              <input name="respondent" className="input" required />
            </Field>
            <Field label="Nature of the case" hint="e.g. unpaid debt, noise, boundary dispute">
              <input name="natureOfCase" className="input" required />
            </Field>
            <Field label="Date and time of the incident">
              <input name="incidentAt" type="datetime-local" className="input" required />
            </Field>
          </div>
          <Field label="Place of the incident">
            <input name="incidentPlace" className="input" required />
          </Field>
          <Field label="Narrative" hint="What happened, in the complainant's words.">
            <textarea name="narrative" rows={6} className="input" required />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
