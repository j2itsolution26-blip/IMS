import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { ActionForm } from '@/components/action-form';
import { Card, Field, PageHeader } from '@/components/ui';
import { addPurok, saveDocumentType, saveProfile } from './actions';

export const metadata = { title: 'Settings' };

const TEMPLATES = [
  ['CLEARANCE', 'Barangay clearance wording'],
  ['RESIDENCY', 'Residency wording'],
  ['INDIGENCY', 'Indigency wording'],
  ['BUSINESS', 'Business clearance wording'],
  ['GENERIC', 'General certification wording'],
] as const;

export default async function Settings() {
  await requirePermission('settings.manage');
  const [s, puroks, types] = await Promise.all([
    prisma.barangaySettings.findUnique({ where: { id: 1 } }),
    prisma.purok.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { residents: true } } } }),
    prisma.documentType.findMany({ orderBy: { name: 'asc' } }),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Barangay profile, puroks and document fees." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Barangay profile" className="lg:col-span-2">
          <ActionForm action={saveProfile} submitLabel="Save profile">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Barangay name">
                <input name="barangayName" className="input" defaultValue={s?.barangayName} required />
              </Field>
              <Field label="City or municipality">
                <input name="city" className="input" defaultValue={s?.city} required />
              </Field>
              <Field label="Province">
                <input name="province" className="input" defaultValue={s?.province} required />
              </Field>
              <Field label="Region">
                <input name="region" className="input" defaultValue={s?.region} />
              </Field>
              <Field label="Barangay hall address">
                <input name="hallAddress" className="input" defaultValue={s?.hallAddress} />
              </Field>
              <Field label="Contact number">
                <input name="contactNumber" className="input" defaultValue={s?.contactNumber} />
              </Field>
              <Field label="Punong Barangay" hint="Printed as the signatory on certificates">
                <input name="captainName" className="input" defaultValue={s?.captainName} required />
              </Field>
              <Field label="Barangay Secretary">
                <input name="secretaryName" className="input" defaultValue={s?.secretaryName} />
              </Field>
              <Field label="Barangay Treasurer">
                <input name="treasurerName" className="input" defaultValue={s?.treasurerName} />
              </Field>
              <Field label="Certificate validity (days)">
                <input name="validityDays" type="number" min={1} max={730} className="input" defaultValue={s?.validityDays ?? 180} required />
              </Field>
            </div>
          </ActionForm>
        </Card>

        <Card title="Puroks / sitios">
          <ul className="mb-4 divide-y divide-slate-100 text-sm">
            {puroks.map((p) => (
              <li key={p.id} className="flex justify-between py-1.5">
                <span>{p.name}</span>
                <span className="text-slate-500">{p._count.residents} residents</span>
              </li>
            ))}
          </ul>
          <ActionForm action={addPurok} submitLabel="Add purok" resetOnSuccess>
            <input name="name" className="input" placeholder="Purok name" required />
          </ActionForm>
        </Card>

        <Card title="Documents and fees" className="lg:col-span-3">
          <p className="mb-4 text-sm text-slate-500">Set fees to match your barangay revenue ordinance. Set a fee to 0 for free documents.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...types, null].map((t) => (
              <div key={t?.id ?? 'new'} className="rounded-md border border-slate-200 p-4">
                <h3 className="mb-3 text-sm font-semibold">{t ? t.name : 'Add a document type'}</h3>
                <ActionForm action={saveDocumentType} submitLabel={t ? 'Save' : 'Add'} submitClassName="btn-secondary" resetOnSuccess={!t}>
                  {t && <input type="hidden" name="id" value={t.id} />}
                  <Field label="Name">
                    <input name="name" className="input" defaultValue={t?.name} required />
                  </Field>
                  <Field label="Wording">
                    <select name="template" className="input" defaultValue={t?.template ?? 'GENERIC'}>
                      {TEMPLATES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Fee (₱)">
                    <input name="fee" className="input" inputMode="decimal" defaultValue={t ? t.fee.toFixed(2) : '0.00'} required />
                  </Field>
                  {t && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="active" defaultChecked={t.active} className="h-4 w-4" />
                      Available for issuing
                    </label>
                  )}
                </ActionForm>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
