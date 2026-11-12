import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { fmtDateTime } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui';

export const metadata = { title: 'Audit log' };
const PAGE = 100;

export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePermission('audit.view');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const where = q
    ? { OR: [{ summary: { contains: q, mode: 'insensitive' as const } }, { action: { contains: q, mode: 'insensitive' as const } }] }
    : {};
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * PAGE,
    take: PAGE + 1,
    include: { user: { select: { fullName: true } } },
  });

  return (
    <>
      <PageHeader title="Audit log" description="Every sign-in, record change, print and export. Entries cannot be edited or deleted from the app." />
      <form className="mb-4 flex max-w-xl gap-2">
        <input name="q" defaultValue={q} placeholder="Search (e.g. a name, OR number, “login.failed”)" className="input" />
        <button className="btn-secondary">Search</button>
      </form>
      {logs.length === 0 ? (
        <Empty>No entries.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.slice(0, PAGE).map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                  <td>{l.user?.fullName ?? '—'}</td>
                  <td className="font-mono text-xs">{l.action}</td>
                  <td>{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {page > 1 && (
          <Link className="btn-secondary" href={`/audit?q=${encodeURIComponent(q)}&page=${page - 1}`}>
            Newer
          </Link>
        )}
        {logs.length > PAGE && (
          <Link className="btn-secondary" href={`/audit?q=${encodeURIComponent(q)}&page=${page + 1}`}>
            Older
          </Link>
        )}
      </div>
    </>
  );
}
