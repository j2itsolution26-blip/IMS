'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { audit } from '@/lib/audit';
import { formObject } from '@/lib/form';
import { residentSchema } from '@/lib/resident-schema';
import { fullName } from '@/lib/format';
import { runAction, type ActionResult } from '@/lib/action';

async function checkHousehold(householdId: string | null, purokId: string) {
  if (!(await prisma.purok.findUnique({ where: { id: purokId } }))) return 'Choose a purok.';
  if (householdId && !(await prisma.household.findUnique({ where: { id: householdId } }))) return 'That household no longer exists.';
  return null;
}

export async function createResident(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('residents.edit');
    const data = residentSchema.parse(formObject(fd));
    const problem = await checkHousehold(data.householdId, data.purokId);
    if (problem) return { error: problem };
    const resident = await prisma.resident.create({ data });
    await audit({ userId: user.id, action: 'resident.create', entity: 'Resident', entityId: resident.id, summary: `Added resident ${fullName(resident)}` });
    revalidatePath('/residents');
    redirect(`/residents/${resident.id}`);
  });
}

export async function updateResident(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('residents.edit');
    const id = String(fd.get('id') ?? '');
    const data = residentSchema.parse(formObject(fd));
    const problem = await checkHousehold(data.householdId, data.purokId);
    if (problem) return { error: problem };
    const resident = await prisma.resident.update({ where: { id }, data });
    await audit({ userId: user.id, action: 'resident.update', entity: 'Resident', entityId: id, summary: `Updated resident ${fullName(resident)}` });
    revalidatePath(`/residents/${id}`);
    redirect(`/residents/${id}`);
  });
}
