import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { can } from '@/lib/permissions';
import { ActionForm } from '@/components/action-form';
import { Card, Empty, Field, PageHeader } from '@/components/ui';
import { createHousehold } from './actions';

export const metadata = { title: 'Households' };

export default async function Households({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission('residents.view');
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const [households, puroks] = await Promise.all([
    prisma.household.findMany({
      where: q
        ? { OR: [{ householdNo: { contains: q, mode: 'insensitive' } }, { address: { contains: q, mode: 'insensitive' } }] }
        : undefined,
      orderBy: { householdNo: 'asc' },
      take: 200,
      include: { purok: true, _count: { select: { members: { where: { status: 'ACTIVE' } } } } },
    }),
    prisma.purok.findMany({ orderBy: { name: 'asc' } }),
  ]);

  return (
    <>
      <PageHeader title="Households" description="Each household groups the residents living under one roof." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <form className="mb-4 flex gap-2">
            <input name="q" defaultValue={q} placeholder="Search number or address" className="input" />
            <button className="btn-secondary">Search</button>
          </form>
          {households.length === 0 ? (
            <Empty>No households yet.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="table">
                <thead>
                  <tr>
                    <th>Household no.</th>
                    <th>Purok</th>
                    <th>Address</th>
                    <th className="text-right">Members</th>
                  </tr>
                </thead>
                <tbody>
                  {households.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <Link href={`/households/${h.id}`} className="font-medium text-brand-700 hover:underline">
                          {h.householdNo}
                        </Link>
                      </td>
                      <td>{h.purok.name}</td>
                      <td>{h.address}</td>
                      <td className="text-right tabular-nums">{h._count.members}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {can(user.role, 'residents.edit') && (
          <Card title="Add household">
            <ActionForm action={createHousehold} submitLabel="Add household">
              <Field label="Household number" hint="As used in your RBI forms, e.g. P1-0001">
                <input name="householdNo" className="input" required />
              </Field>
              <Field label="Purok / sitio">
                <select name="purokId" className="input" required defaultValue="">
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
              <Field label="Address">
                <input name="address" className="input" required />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
