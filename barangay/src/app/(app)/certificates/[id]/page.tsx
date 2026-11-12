import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { can } from '@/lib/permissions';
import { fmtDate, fmtDateTime, fullName, peso } from '@/lib/format';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Field, Notice, PageHeader } from '@/components/ui';
import { revokeCertificate } from '../actions';

export const metadata = { title: 'Certificate' };

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('certificates.view');
  const { id } = await params;
  const c = await prisma.certificate.findUnique({
    where: { id },
    include: { resident: true, documentType: true, receipt: true, issuedBy: { select: { fullName: true } } },
  });
  if (!c) notFound();

  const rows: [string, React.ReactNode][] = [
    ['Document', c.documentType.name],
    [
      'Resident',
      <Link key="r" href={`/residents/${c.residentId}`} className="text-brand-700 hover:underline">
        {fullName(c.resident)}
      </Link>,
    ],
    ['Purpose', c.purpose],
    ...(c.businessName ? ([['Business', `${c.businessName}, ${c.businessAddress}`]] as [string, string][]) : []),
    ['Issued', `${fmtDateTime(c.issuedAt)} by ${c.issuedBy.fullName}`],
    ['Valid until', fmtDate(c.validUntil)],
    ['Payment', c.receipt ? `OR ${c.receipt.orNumber} · ${peso(c.receipt.amount)}` : c.documentType.fee.gt(0) ? 'Fee waived' : 'Free'],
    ['Verification code', <span key="v" className="font-mono">{c.verifyCode}</span>],
  ];

  return (
    <>
      <PageHeader
        title={c.controlNo}
        description={c.documentType.name}
        actions={
          c.status === 'ISSUED' && (
            <Link href={`/print/certificates/${c.id}`} className="btn-primary" target="_blank">
              Print certificate
            </Link>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4">{c.status === 'ISSUED' ? <Badge tone="green">Issued</Badge> : <Badge tone="red">Revoked</Badge>}</div>
          {c.status === 'REVOKED' && (
            <div className="mb-4">
              <Notice tone="red">
                Revoked {c.revokedAt && fmtDateTime(c.revokedAt)}: {c.revokedReason}
              </Notice>
            </div>
          )}
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
                <dd className="mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        {c.status === 'ISSUED' && can(user.role, 'certificates.revoke') && (
          <Card title="Revoke">
            <p className="mb-3 text-sm text-slate-500">
              Use this when a certificate was issued by mistake or is being replaced. Its QR code will show it as revoked.
              {c.receipt && ' The official receipt is not cancelled; cancel it separately in Receipts if the fee was refunded.'}
            </p>
            <ActionForm action={revokeCertificate} submitLabel="Revoke certificate" submitClassName="btn-danger" confirm="Revoke this certificate? This cannot be undone.">
              <input type="hidden" name="id" value={c.id} />
              <Field label="Reason">
                <input name="reason" className="input" required />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
