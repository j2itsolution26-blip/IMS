import type { Resident } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { toDateInput } from '@/lib/dates';
import { CIVIL_STATUS_LABELS } from '@/lib/format';
import { ActionForm } from '@/components/action-form';
import { Card, Field } from '@/components/ui';
import type { ActionResult } from '@/lib/action';

export async function ResidentForm({
  action,
  resident,
  defaultHouseholdId,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  resident?: Resident;
  defaultHouseholdId?: string;
}) {
  const [puroks, households] = await Promise.all([
    prisma.purok.findMany({ orderBy: { name: 'asc' } }),
    prisma.household.findMany({ orderBy: { householdNo: 'asc' }, select: { id: true, householdNo: true, address: true } }),
  ]);
  const r = resident;
  const household = households.find((h) => h.id === (r?.householdId ?? defaultHouseholdId));

  return (
    <ActionForm action={action} submitLabel={r ? 'Save changes' : 'Add resident'}>
      {r && <input type="hidden" name="id" value={r.id} />}
      <Card title="Personal information">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Last name">
            <input name="lastName" className="input" defaultValue={r?.lastName} required />
          </Field>
          <Field label="First name">
            <input name="firstName" className="input" defaultValue={r?.firstName} required />
          </Field>
          <Field label="Middle name">
            <input name="middleName" className="input" defaultValue={r?.middleName} />
          </Field>
          <Field label="Suffix" hint="Jr., Sr., III">
            <input name="suffix" className="input" defaultValue={r?.suffix} />
          </Field>
          <Field label="Sex">
            <select name="sex" className="input" defaultValue={r?.sex ?? ''} required>
              <option value="" disabled>
                Choose…
              </option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
          </Field>
          <Field label="Birth date">
            <input name="birthDate" type="date" className="input" defaultValue={r ? r.birthDate.toISOString().slice(0, 10) : ''} max={toDateInput(new Date())} required />
          </Field>
          <Field label="Birth place">
            <input name="birthPlace" className="input" defaultValue={r?.birthPlace} />
          </Field>
          <Field label="Civil status">
            <select name="civilStatus" className="input" defaultValue={r?.civilStatus ?? ''} required>
              <option value="" disabled>
                Choose…
              </option>
              {Object.entries(CIVIL_STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Citizenship">
            <input name="citizenship" className="input" defaultValue={r?.citizenship ?? 'Filipino'} />
          </Field>
          <Field label="Occupation">
            <input name="occupation" className="input" defaultValue={r?.occupation} />
          </Field>
          <Field label="Contact number">
            <input name="contactNumber" className="input" inputMode="tel" defaultValue={r?.contactNumber} />
          </Field>
          <Field label="Resident since (year)">
            <input name="residentSince" className="input" inputMode="numeric" defaultValue={r?.residentSince ?? ''} />
          </Field>
        </div>
      </Card>

      <Card title="Address and household">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Purok / sitio">
            <select name="purokId" className="input" defaultValue={r?.purokId ?? ''} required>
              <option value="" disabled>
                Choose…
              </option>
              {puroks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Address" className="sm:col-span-1 lg:col-span-3">
            <input name="address" className="input" defaultValue={r?.address ?? household?.address} placeholder="House no., street" required />
          </Field>
          <Field label="Household">
            <select name="householdId" className="input" defaultValue={household?.id ?? ''}>
              <option value="">None</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.householdNo} — {h.address}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Relationship to household head" hint="Head, Spouse, Son, Daughter…">
            <input name="relationshipToHead" className="input" defaultValue={r?.relationshipToHead} />
          </Field>
          {r && (
            <Field label="Status">
              <select name="status" className="input" defaultValue={r.status}>
                <option value="ACTIVE">Active</option>
                <option value="MOVED_OUT">Moved out</option>
                <option value="DECEASED">Deceased</option>
              </select>
            </Field>
          )}
        </div>
      </Card>

      <Card title="Sectors">
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {(
            [
              ['isVoter', 'Registered voter'],
              ['isPwd', 'Person with disability'],
              ['is4Ps', '4Ps member'],
              ['isSoloParent', 'Solo parent'],
              ['isIndigent', 'Indigent'],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="flex items-center gap-2">
              <input type="checkbox" name={name} defaultChecked={r?.[name]} className="h-4 w-4" />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Senior citizens are counted automatically from the birth date (60 and over).</p>
      </Card>
    </ActionForm>
  );
}
