import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { can } from '@/lib/permissions';
import { CASE_STATUS_LABELS, fmtDate, OPEN_CASE_STATUSES } from '@/lib/format';
import { Badge, Empty, PageHeader } from '@/components/ui';

export const metadata = { title: 'Blotter & KP' };

export default async function Blotter({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePermission('blotter.view');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const and: Prisma.BlotterCaseWhereInput[] = [];
  if (sp.status === 'open') and.push({ status: { in: [...OPEN_CASE_STATUSES] } });
  if (sp.status === 'closed') and.push({ status: { notIn: [...OPEN_CASE_STATUSES] } });
  if (q)
    and.push({
      OR: [
        { caseNo: { contains: q, mode: 'insensitive' } },
        { complainant: { contains: q, mode: 'insensitive' } },
        { respondent: { contains: q, mode: 'insensitive' } },
        { natureOfCase: { contains: q, mode: 'insensitive' } },
      ],
    });
  const cases = await prisma.blotterCase.findMany({ where: { AND: and }, orderBy: { filedAt: 'desc' }, take: 200 });

  return (
    <>
      <PageHeader
        title="Blotter & Katarungang Pambarangay"
        description="Incident records and disputes for amicable settlement."
        actions={
          can(user.role, 'blotter.edit') && (
            <Link href="/blotter/new" className="btn-primary">
              Record a case
            </Link>
          )
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Case no., name or nature" className="input w-auto flex-1" />
        <select name="status" defaultValue={sp.status ?? ''} className="input w-auto">
          <option value="">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <button className="btn-secondary">Filter</button>
      </form>
      {cases.length === 0 ? (
        <Empty>No cases found.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>Case no.</th>
                <th>Parties</th>
                <th>Nature</th>
                <th>Filed</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/blotter/${c.id}`} className="font-medium text-brand-700 hover:underline">
                      {c.caseNo}
                    </Link>
                  </td>
                  <td>
                    {c.complainant} <span className="text-slate-400">vs.</span> {c.respondent}
                  </td>
                  <td>{c.natureOfCase}</td>
                  <td className="whitespace-nowrap">{fmtDate(c.filedAt)}</td>
                  <td>
                    <Badge tone={(OPEN_CASE_STATUSES as readonly string[]).includes(c.status) ? 'amber' : c.status === 'SETTLED' ? 'green' : 'gray'}>
                      {CASE_STATUS_LABELS[c.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
