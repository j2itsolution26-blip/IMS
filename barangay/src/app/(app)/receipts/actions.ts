'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { audit } from '@/lib/audit';
import { formObject, money, text } from '@/lib/form';
import { peso } from '@/lib/format';
import { runAction, type ActionResult } from '@/lib/action';

const createSchema = z.object({
  orNumber: text('OR number', 30),
  payorName: text('Payor', 150),
  description: text('Nature of collection', 200),
  amount: money('Amount'),
});

export async function createReceipt(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('receipts.create');
    const input = createSchema.parse(formObject(fd));
    if (Number(input.amount) <= 0) return { error: 'Amount must be more than zero.' };
    const receipt = await prisma.receipt.create({ data: { ...input, collectedById: user.id } });
    await audit({
      userId: user.id,
      action: 'receipt.create',
      entity: 'Receipt',
      entityId: receipt.id,
      summary: `OR ${receipt.orNumber}: ${peso(receipt.amount)} from ${receipt.payorName} for ${receipt.description}`,
    });
    revalidatePath('/receipts');
    return { ok: `Recorded OR ${receipt.orNumber}.` };
  });
}

const cancelSchema = z.object({ id: text('Receipt', 40), reason: text('Reason', 300) });

export async function cancelReceipt(fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authorize('receipts.cancel');
    const { id, reason } = cancelSchema.parse(formObject(fd));
    const done = await prisma.receipt.updateMany({
      where: { id, status: 'PAID' },
      data: { status: 'CANCELLED', cancelReason: reason, cancelledAt: new Date() },
    });
    if (done.count === 0) return { error: 'This receipt is already cancelled.' };
    const r = await prisma.receipt.findUniqueOrThrow({ where: { id } });
    await audit({ userId: user.id, action: 'receipt.cancel', entity: 'Receipt', entityId: id, summary: `Cancelled OR ${r.orNumber}: ${reason}` });
    revalidatePath('/receipts');
    return { ok: `OR ${r.orNumber} cancelled.` };
  });
}
