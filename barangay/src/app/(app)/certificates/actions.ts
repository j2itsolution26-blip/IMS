'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { audit } from '@/lib/audit';
import { checkbox, formObject, optionalText, text } from '@/lib/form';
import { nextNumber } from '@/lib/counters';
import { formatSequence, randomCode } from '@/lib/codes';
import { manilaParts } from '@/lib/dates';
import { fullName, peso } from '@/lib/format';
import { runAction, type ActionResult } from '@/lib/action';

const issueSchema = z.object({
  residentId: text('Resident', 40),
  documentTypeId: text('Document type', 40),
  purpose: text('Purpose', 200),
  businessName: optionalText(150),
  businessAddress: optionalText(200),
  orNumber: optionalText(30),
  feeWaived: checkbox,
});

export async function issueCertificate(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('certificates.issue');
    const input = issueSchema.parse(formObject(fd));

    const [resident, type, settings] = await Promise.all([
      prisma.resident.findUnique({ where: { id: input.residentId } }),
      prisma.documentType.findUnique({ where: { id: input.documentTypeId } }),
      prisma.barangaySettings.findUnique({ where: { id: 1 } }),
    ]);
    if (!resident || resident.status !== 'ACTIVE') return { error: 'Only active residents can be issued certificates.' };
    if (!type || !type.active) return { error: 'Choose an available document type.' };
    if (!settings) return { error: 'Finish the barangay settings first.' };
    if (type.template === 'BUSINESS' && (!input.businessName || !input.businessAddress))
      return { error: 'Enter the business name and business address.' };

    const charge = type.fee.gt(0) && !input.feeWaived;
    if (charge && !input.orNumber) return { error: `Enter the official receipt number for the ${peso(type.fee)} fee.` };

    const now = new Date();
    const { y } = manilaParts(now);
    const cert = await prisma.$transaction(async (tx) => {
      const receipt = charge
        ? await tx.receipt.create({
            data: {
              orNumber: input.orNumber,
              payorName: fullName(resident),
              residentId: resident.id,
              description: type.name,
              amount: type.fee,
              collectedById: user.id,
            },
          })
        : null;
      const n = await nextNumber(tx, `certificate-${y}`);
      const created = await tx.certificate.create({
        data: {
          controlNo: formatSequence('BC', y, n),
          verifyCode: randomCode(),
          residentId: resident.id,
          documentTypeId: type.id,
          purpose: input.purpose,
          businessName: type.template === 'BUSINESS' ? input.businessName : '',
          businessAddress: type.template === 'BUSINESS' ? input.businessAddress : '',
          issuedAt: now,
          validUntil: new Date(now.getTime() + settings.validityDays * 86_400_000),
          issuedById: user.id,
          receiptId: receipt?.id ?? null,
        },
      });
      await audit(
        {
          userId: user.id,
          action: 'certificate.issue',
          entity: 'Certificate',
          entityId: created.id,
          summary: `Issued ${type.name} ${created.controlNo} to ${fullName(resident)}${
            receipt ? ` (OR ${receipt.orNumber}, ${peso(type.fee)})` : type.fee.gt(0) ? ' (fee waived)' : ''
          }`,
        },
        tx,
      );
      return created;
    });

    revalidatePath('/certificates');
    redirect(`/certificates/${cert.id}`);
  });
}

const revokeSchema = z.object({ id: text('Certificate', 40), reason: text('Reason', 300) });

export async function revokeCertificate(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('certificates.revoke');
    const { id, reason } = revokeSchema.parse(formObject(fd));
    const updated = await prisma.certificate.updateMany({
      where: { id, status: 'ISSUED' },
      data: { status: 'REVOKED', revokedReason: reason, revokedAt: new Date() },
    });
    if (updated.count === 0) return { error: 'This certificate is already revoked.' };
    const cert = await prisma.certificate.findUniqueOrThrow({ where: { id } });
    await audit({ userId: user.id, action: 'certificate.revoke', entity: 'Certificate', entityId: id, summary: `Revoked ${cert.controlNo}: ${reason}` });
    revalidatePath(`/certificates/${id}`);
    return { ok: 'Certificate revoked. Its QR code now shows it as revoked.' };
  });
}

