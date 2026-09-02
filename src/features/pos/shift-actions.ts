'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { openShift, closeShift, previewShiftClose, type ShiftCloseSummary, type CloseShiftResult } from '@/server/services/shift-service';

const openShiftSchema = z.object({
  openingCash: z.number().min(0, 'Opening cash cannot be negative.'),
});

export async function openShiftAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    const values = parseInput(openShiftSchema, input);

    const shift = await openShift({ userId: user.id, openingCash: values.openingCash });

    revalidatePath('/pos');
    return { id: shift.id };
  });
}

export async function previewShiftCloseAction(): Promise<ActionResult<ShiftCloseSummary>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    return previewShiftClose(user.id);
  });
}

const closeShiftSchema = z.object({
  actualCash: z.number().min(0, 'Counted cash cannot be negative.'),
  notes: z.string().max(500).optional(),
});

export async function closeShiftAction(input: unknown): Promise<ActionResult<CloseShiftResult>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    const values = parseInput(closeShiftSchema, input);

    const result = await closeShift({ userId: user.id, actualCash: values.actualCash, notes: values.notes });

    revalidatePath('/pos');
    return result;
  });
}
