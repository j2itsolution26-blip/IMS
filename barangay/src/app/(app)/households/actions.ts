'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { audit } from '@/lib/audit';
import { formObject, text } from '@/lib/form';
import { runAction, type ActionResult } from '@/lib/action';

const schema = z.object({
  householdNo: text('Household number', 30),
  purokId: text('Purok', 40),
  address: text('Address', 200),
});

export async function createHousehold(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('residents.edit');
    const data = schema.parse(formObject(fd));
    if (!(await prisma.purok.findUnique({ where: { id: data.purokId } }))) return { error: 'Choose a purok.' };
    const h = await prisma.household.create({ data });
    await audit({ userId: user.id, action: 'household.create', entity: 'Household', entityId: h.id, summary: `Added household ${h.householdNo}` });
    revalidatePath('/households');
    redirect(`/households/${h.id}`);
  });
}
