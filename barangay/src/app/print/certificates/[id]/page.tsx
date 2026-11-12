import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { appUrl } from '@/lib/app-url';
import { ageOn, manilaParts } from '@/lib/dates';
import { fmtDate, fullName } from '@/lib/format';
import { certificateBody } from '@/lib/certificate-text';
import { PrintButton } from '@/components/print-button';
import { audit } from '@/lib/audit';

export const metadata = { title: 'Print certificate' };
export const dynamic = 'force-dynamic';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default async function PrintCertificate({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('certificates.view');
  const { id } = await params;
  const [c, settings] = await Promise.all([
    prisma.certificate.findUnique({ where: { id }, include: { resident: true, documentType: true, receipt: true } }),
    prisma.barangaySettings.findUnique({ where: { id: 1 } }),
  ]);
  if (!c || !settings) notFound();
  if (c.status !== 'ISSUED') {
    return <p className="p-8 text-center">This certificate was revoked and cannot be printed.</p>;
  }

  await audit({ userId: user.id, action: 'certificate.print', entity: 'Certificate', entityId: c.id, summary: `Opened ${c.controlNo} for printing` });
  const verifyUrl = `${await appUrl()}/verify/${c.verifyCode}`;
  const qrSvg = await QRCode.toString(verifyUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  const r = c.resident;
  const paragraphs = certificateBody({
    template: c.documentType.template,
    name: fullName(r),
    age: ageOn(r.birthDate, c.issuedAt),
    sex: r.sex,
    civilStatus: r.civilStatus,
    citizenship: r.citizenship,
    address: r.address,
    barangay: settings.barangayName,
    city: settings.city,
    province: settings.province,
    residentSince: r.residentSince,
    purpose: c.purpose,
    businessName: c.businessName,
    businessAddress: c.businessAddress,
  });
  const { y, m, d } = manilaParts(c.issuedAt);
  const month = new Intl.DateTimeFormat('en-PH', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-between px-4">
        <a href={`/certificates/${c.id}`} className="btn-secondary">
          Back
        </a>
        <PrintButton />
      </div>
      <article className="mx-auto flex min-h-[260mm] max-w-[210mm] flex-col bg-white px-[18mm] py-[16mm] font-serif text-[12pt] leading-relaxed text-black shadow print:min-h-0 print:p-0 print:shadow-none">
        <header className="border-b-2 border-black pb-4 text-center">
          <p className="text-[11pt]">Republic of the Philippines</p>
          <p className="text-[11pt]">Province of {settings.province}</p>
          <p className="text-[11pt]">{settings.city}</p>
          <p className="mt-1 text-[15pt] font-bold uppercase tracking-wide">Barangay {settings.barangayName}</p>
          <p className="text-[10pt]">Office of the Punong Barangay</p>
          {settings.hallAddress && <p className="text-[9pt]">{settings.hallAddress}</p>}
        </header>

        <h1 className="mt-8 text-center text-[18pt] font-bold uppercase tracking-[0.2em]">{c.documentType.name}</h1>

        <div className="mt-8 flex-1 space-y-4 text-justify">
          <p className="font-bold">TO WHOM IT MAY CONCERN:</p>
          {paragraphs.map((p, i) => (
            <p key={i} className="indent-12">
              {p}
            </p>
          ))}
          <p className="indent-12">
            Issued this {ordinal(d)} day of {month}, {y} at Barangay {settings.barangayName}, {settings.city}, {settings.province}.
          </p>
        </div>

        <div className="mt-12 flex items-end justify-between gap-8">
          <div className="text-[9pt] leading-snug">
            <div className="h-24 w-24" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <p className="mt-1">Scan to verify</p>
            <p>Control no. {c.controlNo}</p>
            <p>Code {c.verifyCode}</p>
            <p>Valid until {fmtDate(c.validUntil)}</p>
            {c.receipt && (
              <p>
                OR no. {c.receipt.orNumber} · ₱{c.receipt.amount.toFixed(2)}
              </p>
            )}
          </div>
          <div className="text-center">
            <p className="text-[9pt]">Signature of requesting party: ____________________</p>
            <div className="mt-12 min-w-[70mm] border-t border-black pt-1">
              <p className="font-bold uppercase">{settings.captainName}</p>
              <p className="text-[10pt]">Punong Barangay</p>
            </div>
          </div>
        </div>
        <p className="mt-6 text-center text-[8pt] text-slate-600">Not valid without the barangay dry seal. Valid only if the QR code check shows “Valid”.</p>
      </article>
    </div>
  );
}
