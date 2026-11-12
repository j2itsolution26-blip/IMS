import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { can } from '@/lib/permissions';
import { fmtDateTime, listName } from '@/lib/format';
import { Badge, Empty, PageHeader } from '@/components/ui';

export const metadata = { title: 'Certificates' };

export default async function Certificates({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission('certificates.view');
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const where: Prisma.CertificateWhereInput = q
    ? {
        OR: [
          { controlNo: { contains: q, mode: 'insensitive' } },
          { resident: { lastName: { contains: q, mode: 'insensitive' } } },
          { resident: { firstName: { contains: q, mode: 'insensitive' } } },
        ],
      }
    : {};
  const certs = await prisma.certificate.findMany({
    where,
    orderBy: { issuedAt: 'desc' },
    take: 100,
    include: { resident: true, documentType: true, issuedBy: { select: { fullName: true } } },
  });

  return (
    <>
      <PageHeader
        title="Certificates"
        description="Most recent first. Search by control number or name."
        actions={
          can(user.role, 'certificates.issue') && (
            <Link href="/certificates/new" className="btn-primary">
              Issue a certificate
            </Link>
          )
        }
      />
      <form className="mb-4 flex max-w-xl gap-2">
        <input name="q" defaultValue={q} placeholder="BC-2026-000123 or a surname" className="input" />
        <button className="btn-secondary">Search</button>
      </form>
      {certs.length === 0 ? (
        <Empty>No certificates found.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="table">
            <thead>
              <tr>
                <th>Control no.</th>
                <th>Document</th>
                <th>Resident</th>
                <th>Issued</th>
                <th>By</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {certs.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/certificates/${c.id}`} className="font-medium text-brand-700 hover:underline">
                      {c.controlNo}
                    </Link>
                  </td>
                  <td>{c.documentType.name}</td>
                  <td>{listName(c.resident)}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(c.issuedAt)}</td>
                  <td>{c.issuedBy.fullName}</td>
                  <td>{c.status === 'ISSUED' ? <Badge tone="green">Issued</Badge> : <Badge tone="red">Revoked</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
