import { prisma } from '@/lib/prisma';
import { fmtDate, maskedName } from '@/lib/format';

export const metadata = { title: 'Verify certificate' };
export const dynamic = 'force-dynamic';

export default async function Verify({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  const [c, settings] = await Promise.all([
    clean
      ? prisma.certificate.findUnique({
          where: { verifyCode: clean },
          include: { documentType: { select: { name: true } }, resident: { select: { firstName: true, middleName: true, lastName: true, suffix: true } } },
        })
      : null,
    prisma.barangaySettings.findUnique({ where: { id: 1 } }),
  ]);

  const state = !c ? 'unknown' : c.status === 'REVOKED' ? 'revoked' : c.validUntil < new Date() ? 'expired' : 'valid';
  const look = {
    valid: { title: 'Valid certificate', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
    expired: { title: 'Expired certificate', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
    revoked: { title: 'Revoked certificate', cls: 'border-red-300 bg-red-50 text-red-900' },
    unknown: { title: 'Not found', cls: 'border-red-300 bg-red-50 text-red-900' },
  }[state];

  return (
    <main className="mx-auto max-w-md p-4 py-10">
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
        {settings ? `Barangay ${settings.barangayName}, ${settings.city}` : 'Barangay'} · Certificate check
      </p>
      <div className={`mt-4 rounded-lg border-2 p-6 ${look.cls}`}>
        <h1 className="text-xl font-semibold">{look.title}</h1>
        {c ? (
          <dl className="mt-4 space-y-2 text-sm">
            <div>
              <dt className="text-xs uppercase opacity-70">Document</dt>
              <dd className="font-medium">{c.documentType.name}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-70">Issued to</dt>
              <dd className="font-medium">{maskedName(c.resident)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-70">Control number</dt>
              <dd className="font-medium">{c.controlNo}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-70">Issued · valid until</dt>
              <dd className="font-medium">
                {fmtDate(c.issuedAt)} · {fmtDate(c.validUntil)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm">No certificate has this code. The document may be fake, or the code was typed wrong.</p>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">
        Compare the details above with the paper certificate. Names are partly hidden to protect residents&apos; privacy.
      </p>
    </main>
  );
}
