import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ageOn } from '@/lib/dates';
import { CIVIL_STATUS_LABELS, fmtBirthDate, fmtDate, fullName } from '@/lib/format';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';

export const metadata = { title: 'Resident' };

export default async function ResidentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('residents.view');
  const { id } = await params;
  const r = await prisma.resident.findUnique({
    where: { id },
    include: { purok: true, household: true },
  });
  if (!r) notFound();
  const certificates = can(user.role, 'certificates.view')
    ? await prisma.certificate.findMany({
        where: { residentId: r.id },
        orderBy: { issuedAt: 'desc' },
        take: 20,
        include: { documentType: true },
      })
    : null;
  const age = ageOn(r.birthDate);

  const rows: [string, React.ReactNode][] = [
    ['Sex', r.sex === 'MALE' ? 'Male' : 'Female'],
    ['Birth date', `${fmtBirthDate(r.birthDate)} (${age} years old)`],
    ['Birth place', r.birthPlace || '—'],
    ['Civil status', CIVIL_STATUS_LABELS[r.civilStatus]],
    ['Citizenship', r.citizenship],
    ['Occupation', r.occupation || '—'],
    ['Contact number', r.contactNumber || '—'],
    ['Address', `${r.address}, ${r.purok.name}`],
    [
      'Household',
      r.household ? (
        <Link href={`/households/${r.household.id}`} className="text-brand-700 hover:underline">
          {r.household.householdNo}
          {r.relationshipToHead && ` · ${r.relationshipToHead}`}
        </Link>
      ) : (
        '—'
      ),
    ],
    ['Resident since', r.residentSince ?? '—'],
  ];

  return (
    <>
      <PageHeader
        title={fullName(r)}
        description={r.status === 'ACTIVE' ? 'Active resident' : r.status === 'MOVED_OUT' ? 'Moved out' : 'Deceased'}
        actions={
          <>
            {can(user.role, 'residents.edit') && (
              <Link href={`/residents/${r.id}/edit`} className="btn-secondary">
                Edit
              </Link>
            )}
            {can(user.role, 'certificates.issue') && r.status === 'ACTIVE' && (
              <Link href={`/certificates/new?resident=${r.id}`} className="btn-primary">
                Issue certificate
              </Link>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
                <dd className="mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-1">
            {age >= 60 && <Badge tone="blue">Senior citizen</Badge>}
            {r.isVoter && <Badge tone="blue">Registered voter</Badge>}
            {r.isPwd && <Badge tone="amber">PWD</Badge>}
            {r.is4Ps && <Badge tone="green">4Ps</Badge>}
            {r.isSoloParent && <Badge>Solo parent</Badge>}
            {r.isIndigent && <Badge>Indigent</Badge>}
          </div>
        </Card>
        {certificates && (
          <Card title="Certificates issued">
            {certificates.length === 0 ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {certificates.map((c) => (
                  <li key={c.id} className="py-2">
                    <Link href={`/certificates/${c.id}`} className="font-medium text-brand-700 hover:underline">
                      {c.documentType.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {c.controlNo} · {fmtDate(c.issuedAt)} {c.status === 'REVOKED' && '· Revoked'}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
