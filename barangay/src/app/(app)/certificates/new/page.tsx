import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { ageLabel, fullName, listName, peso } from '@/lib/format';
import { ActionForm } from '@/components/action-form';
import { Card, Empty, Field, Notice, PageHeader } from '@/components/ui';
import { issueCertificate } from '../actions';

export const metadata = { title: 'Issue certificate' };

export default async function NewCertificate({ searchParams }: { searchParams: Promise<{ resident?: string; q?: string }> }) {
  await requirePermission('certificates.issue');
  const sp = await searchParams;
  const resident = sp.resident
    ? await prisma.resident.findFirst({ where: { id: sp.resident, status: 'ACTIVE' }, include: { purok: true } })
    : null;

  if (!resident) {
    const q = (sp.q ?? '').trim().slice(0, 100);
    const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
    const matches = words.length
      ? await prisma.resident.findMany({
          where: {
            status: 'ACTIVE',
            AND: words.map((w) => ({
              OR: [
                { lastName: { contains: w, mode: 'insensitive' as const } },
                { firstName: { contains: w, mode: 'insensitive' as const } },
                { middleName: { contains: w, mode: 'insensitive' as const } },
              ],
            })),
          },
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          take: 30,
          include: { purok: true },
        })
      : [];
    return (
      <>
        <PageHeader title="Issue certificate" description="Step 1 of 2: find the resident." />
        <form className="mb-4 flex max-w-xl gap-2">
          <input name="q" defaultValue={q} placeholder="Type the resident's name" className="input" autoFocus />
          <button className="btn-primary">Search</button>
        </form>
        {words.length > 0 &&
          (matches.length === 0 ? (
            <Empty>
              No active resident matches “{q}”.{' '}
              <Link href="/residents/new" className="text-brand-700 underline">
                Add them to the registry first.
              </Link>
            </Empty>
          ) : (
            <ul className="max-w-xl divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {matches.map((m) => (
                <li key={m.id}>
                  <Link href={`/certificates/new?resident=${m.id}`} className="flex justify-between px-4 py-3 text-sm hover:bg-slate-50">
                    <span className="font-medium">{listName(m)}</span>
                    <span className="text-slate-500">
                      {ageLabel(m.birthDate)} · {m.purok.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </>
    );
  }

  const types = await prisma.documentType.findMany({ where: { active: true }, orderBy: { name: 'asc' } });

  return (
    <>
      <PageHeader title="Issue certificate" description="Step 2 of 2: choose the document." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Resident">
          <p className="font-medium">{fullName(resident)}</p>
          <p className="text-sm text-slate-500">
            {ageLabel(resident.birthDate)} · {resident.address}, {resident.purok.name}
          </p>
          <Link href="/certificates/new" className="mt-3 inline-block text-sm text-brand-700 hover:underline">
            Choose someone else
          </Link>
        </Card>
        <Card title="Certificate" className="lg:col-span-2">
          {types.length === 0 ? (
            <Notice tone="red">No document types are active. The Punong Barangay can add them in Settings.</Notice>
          ) : (
            <ActionForm action={issueCertificate} submitLabel="Issue and open for printing">
              <input type="hidden" name="residentId" value={resident.id} />
              <Field label="Document">
                <select name="documentTypeId" className="input" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.fee.gt(0) ? peso(t.fee) : 'free'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Purpose" hint="e.g. employment, scholarship, bank requirement, medical assistance">
                <input name="purpose" className="input" required maxLength={200} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" hint="Business clearance only">
                  <input name="businessName" className="input" />
                </Field>
                <Field label="Business address" hint="Business clearance only">
                  <input name="businessAddress" className="input" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Official receipt no." hint="From the OR booklet. Required when there is a fee.">
                  <input name="orNumber" className="input" />
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" name="feeWaived" className="h-4 w-4" />
                  Fee waived (exempt under ordinance)
                </label>
              </div>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
