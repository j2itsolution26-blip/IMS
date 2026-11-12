import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ageLabel, listName } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui';

export const metadata = { title: 'Household' };

export default async function HouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('residents.view');
  const { id } = await params;
  const h = await prisma.household.findUnique({
    where: { id },
    include: { purok: true, members: { orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] } },
  });
  if (!h) notFound();

  return (
    <>
      <PageHeader
        title={`Household ${h.householdNo}`}
        description={`${h.address}, ${h.purok.name}`}
        actions={
          can(user.role, 'residents.edit') && (
            <Link href={`/residents/new?household=${h.id}`} className="btn-primary">
              Add member
            </Link>
          )
        }
      />
      {h.members.length === 0 ? (
        <Empty>No members yet.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Relationship</th>
                <th>Age</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {h.members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/residents/${m.id}`} className="font-medium text-brand-700 hover:underline">
                      {listName(m)}
                    </Link>
                  </td>
                  <td>{m.relationshipToHead || '—'}</td>
                  <td className="tabular-nums">{ageLabel(m.birthDate)}</td>
                  <td>{m.status === 'ACTIVE' ? 'Active' : m.status === 'MOVED_OUT' ? 'Moved out' : 'Deceased'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
