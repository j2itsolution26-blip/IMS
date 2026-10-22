'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ValidationError } from '@/lib/errors';
import { parseCashAmount } from '@/lib/cash-amount';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { addShiftAdjustment, reviewShift } from '@/server/services/shift-service';
import {
  listNotifications,
  markNotificationsRead,
  syncOverdueShiftNotifications,
  type NotificationView,
} from '@/server/services/notification-service';

/**
 * Owner actions on shifts and the owner's notifications. Every one checks the
 * financial permission on the server before reading or writing anything; the
 * acting user is always the signed-in owner, never an id from the browser.
 */

async function owner(bucket: 'mutation' | 'read') {
  const user = await authorize(FINANCIAL_PERMISSION);
  checkRateLimit(`shifts:${bucket}:${user.id}`, RATE_LIMITS[bucket]);
  return user;
}

function refresh(shiftId: string) {
  revalidatePath('/shifts');
  revalidatePath(`/shifts/${shiftId}`);
}

const reviewSchema = z.object({
  shiftId: z.string().min(1).max(64),
  note: z.string().trim().min(3, 'Give a short resolution note.').max(1000),
});

export async function reviewShiftAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await owner('mutation');
    const values = parseInput(reviewSchema, input);
    await reviewShift({ shiftId: values.shiftId, actorId: user.id, note: values.note });
    refresh(values.shiftId);
  });
}

const adjustmentSchema = z.object({
  shiftId: z.string().min(1).max(64),
  direction: z.enum(['ADD', 'SUBTRACT']),
  amount: z.union([z.string(), z.number()]),
  reason: z.string().trim().min(3, 'Give a reason for the adjustment.').max(500),
});

export async function addShiftAdjustmentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await owner('mutation');
    const values = parseInput(adjustmentSchema, input);
    const parsed = parseCashAmount(values.amount, { allowZero: false });
    if (!parsed.ok) throw new ValidationError(parsed.error, { amount: [parsed.error] });

    const amount = values.direction === 'ADD' ? parsed.value : -parsed.value;
    const result = await addShiftAdjustment({ shiftId: values.shiftId, actorId: user.id, amount, reason: values.reason });
    refresh(values.shiftId);
    return result;
  });
}

export async function listNotificationsAction(): Promise<ActionResult<{ items: NotificationView[]; unread: number }>> {
  return runAction(async () => {
    await owner('read');
    await syncOverdueShiftNotifications();
    return listNotifications(20);
  });
}

const markReadSchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(50).optional() });

export async function markNotificationsReadAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await owner('mutation');
    const values = parseInput(markReadSchema, input);
    await markNotificationsRead(user.id, values.ids);
  });
}
