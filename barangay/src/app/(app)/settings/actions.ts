'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { audit } from '@/lib/audit';
import { checkbox, formObject, money, optionalText, text } from '@/lib/form';
import { runAction, type ActionResult } from '@/lib/action';

const profileSchema = z.object({
  barangayName: text('Barangay name', 100),
  city: text('City or municipality', 100),
  province: text('Province', 100),
  region: optionalText(100),
  hallAddress: optionalText(200),
  contactNumber: optionalText(60),
  captainName: text("Punong Barangay's name", 120),
  secretaryName: optionalText(120),
  treasurerName: optionalText(120),
  validityDays: z.coerce.number().int().min(1, 'Validity must be at least 1 day.').max(730, 'Validity can be at most 730 days.'),
});

export async function saveProfile(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('settings.manage');
    const data = profileSchema.parse(formObject(fd));
    await prisma.barangaySettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit({ userId: user.id, action: 'settings.update', entity: 'BarangaySettings', summary: 'Updated barangay profile' });
    revalidatePath('/', 'layout');
    return { ok: 'Saved.' };
  });
}

export async function addPurok(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('settings.manage');
    const name = text('Purok name', 60).parse(fd.get('name'));
    await prisma.purok.create({ data: { name } });
    await audit({ userId: user.id, action: 'purok.create', entity: 'Purok', summary: `Added purok ${name}` });
    revalidatePath('/settings');
    return { ok: `Added ${name}.` };
  });
}

const typeSchema = z.object({
  id: optionalText(40),
  name: text('Document name', 100),
  template: z.enum(['CLEARANCE', 'RESIDENCY', 'INDIGENCY', 'BUSINESS', 'GENERIC']),
  fee: money('Fee'),
  active: checkbox,
});

export async function saveDocumentType(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('settings.manage');
    const { id, ...data } = typeSchema.parse(formObject(fd));
    const saved = id
      ? await prisma.documentType.update({ where: { id }, data })
      : await prisma.documentType.create({ data: { ...data, active: true } });
    await audit({ userId: user.id, action: 'documentType.save', entity: 'DocumentType', entityId: saved.id, summary: `Saved document type ${saved.name} (fee ${data.fee})` });
    revalidatePath('/settings');
    return { ok: `Saved ${saved.name}.` };
  });
}
