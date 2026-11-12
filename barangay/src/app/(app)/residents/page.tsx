import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { can } from '@/lib/permissions';
import { bornOnOrBefore } from '@/lib/dates';
import { ageLabel, listName } from '@/lib/format';
import { Badge, Empty, PageHeader } from '@/components/ui';

export const metadata = { title: 'Residents' };

const PAGE_SIZE = 50;
const SECTORS: Record<string, { label: string; where: () => Prisma.ResidentWhereInput }> = {
  senior: { label: 'Senior citizens', where: () => ({ birthDate: { lte: bornOnOrBefore(60) } }) },
  pwd: { label: 'PWD', where: () => ({ isPwd: true }) },
  '4ps': { label: '4Ps', where: () => ({ is4Ps: true }) },
  solo: { label: 'Solo parents', where: () => ({ isSoloParent: true }) },
  voter: { label: 'Voters', where: () => ({ isVoter: true }) },
  indigent: { label: 'Indigent', where: () => ({ isIndigent: true }) },
};

type Search = { q?: string; purok?: string; sector?: string; status?: string; page?: string };

export default async function Residents({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission('residents.view');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const status = sp.status === 'all' ? undefined : sp.status === 'MOVED_OUT' || sp.status === 'DECEASED' ? sp.status : 'ACTIVE';

  const and: Prisma.ResidentWhereInput[] = [];
  if (status) and.push({ status });
  if (sp.purok) and.push({ purokId: sp.purok });
  if (sp.sector && SECTORS[sp.sector]) and.push(SECTORS[sp.sector].where());
  for (const word of q.split(/\s+/).filter(Boolean).slice(0, 4)) {
    and.push({
      OR: [
        { lastName: { contains: word, mode: 'insensitive' } },
        { firstName: { contains: word, mode: 'insensitive' } },
        { middleName: { contains: word, mode: 'insensitive' } },
      ],
    });
  }
  const where: Prisma.ResidentWhereInput = { AND: and };

  const [residents, total, puroks] = await Promise.all([
    prisma.resident.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { purok: true },
    }),
    prisma.resident.count({ where }),
    prisma.purok.findMany({ orderBy: { name: 'asc' } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageLink = (p: number) => {
    const params = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `/residents?${params}`;
  };

  return (
    <>
      <PageHeader
        title="Residents"
        description={`${total} ${total === 1 ? 'resident' : 'residents'} found`}
        actions={
          can(user.role, 'residents.edit') && (
            <Link href="/residents/new" className="btn-primary">
              Add resident
            </Link>
          )
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <input name="q" defaultValue={q} placeholder="Search by name" className="input" />
        <select name="purok" defaultValue={sp.purok ?? ''} className="input">
          <option value="">All puroks</option>
          {puroks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select name="sector" defaultValue={sp.sector ?? ''} className="input">
          <option value="">All sectors</option>
          {Object.entries(SECTORS).map(([k, s]) => (
            <option key={k} value={k}>
              {s.label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="input">
          <option value="">Active</option>
          <option value="MOVED_OUT">Moved out</option>
          <option value="DECEASED">Deceased</option>
          <option value="all">All</option>
        </select>
        <button className="btn-secondary">Filter</button>
      </form>

      {residents.length === 0 ? (
        <Empty>No residents match. {can(user.role, 'residents.edit') && 'Add one with “Add resident”.'}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Age</th>
                <th>Sex</th>
                <th>Purok</th>
                <th>Address</th>
                <th>Sectors</th>
              </tr>
            </thead>
            <tbody>
              {residents.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/residents/${r.id}`} className="font-medium text-brand-700 hover:underline">
                      {listName(r)}
                    </Link>
                    {r.status !== 'ACTIVE' && (
                      <span className="ml-2">
                        <Badge>{r.status === 'MOVED_OUT' ? 'Moved out' : 'Deceased'}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="tabular-nums">{ageLabel(r.birthDate)}</td>
                  <td>{r.sex === 'MALE' ? 'M' : 'F'}</td>
                  <td>{r.purok.name}</td>
                  <td className="max-w-xs truncate">{r.address}</td>
                  <td className="space-x-1">
                    {r.isVoter && <Badge tone="blue">Voter</Badge>}
                    {r.isPwd && <Badge tone="amber">PWD</Badge>}
                    {r.is4Ps && <Badge tone="green">4Ps</Badge>}
                    {r.isSoloParent && <Badge>Solo parent</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageLink(page - 1)} className="btn-secondary">
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={pageLink(page + 1)} className="btn-secondary">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
