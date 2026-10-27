'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ValidationError } from '@/lib/errors';
import { parseCashAmount } from '@/lib/cash-amount';
import {
  addCashMovement,
  correctCashMovement,
  closeShift,
  closeShiftForCashier,
  openShift,
  previewShiftClose,
  type CloseShiftResult,
  type RecordedMovement,
  type ShiftCloseSummary,
} from '@/server/services/shift-service';

/**
 * Shift actions. The cashier is always the signed-in user — no action takes a
 * cashier or shift id from the browser except the owner's close, which checks
 * the owner's own permission first. Amounts are parsed here with the same
 * rules the dialog shows, then validated again in the service.
 */

function amountOf(field: string, value: unknown, { allowZero }: { allowZero: boolean }): number {
  const parsed = parseCashAmount(value, { allowZero });
  if (!parsed.ok) throw new ValidationError(parsed.error, { [field]: [parsed.error] });
  return parsed.value;
}

function refresh() {
  revalidatePath('/pos');
  revalidatePath('/dashboard');
  revalidatePath('/shifts', 'layout');
}

const openShiftSchema = z.object({
  openingCash: z.union([z.string(), z.number()]),
  openingNotes: z.string().trim().max(500).optional(),
});

export async function openShiftAction(
  input: unknown,
): Promise<ActionResult<{ id: string; openedAt: string; openingCash: number; resumed: boolean }>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    const values = parseInput(openShiftSchema, input);
    const openingCash = amountOf('openingCash', values.openingCash, { allowZero: true });

    const { shift, resumed } = await openShift({ userId: user.id, openingCash, openingNotes: values.openingNotes });

    refresh();
    return { id: shift.id, openedAt: shift.openedAt.toISOString(), openingCash: shift.openingCash, resumed };
  });
}

export async function previewShiftCloseAction(): Promise<ActionResult<ShiftCloseSummary>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    const { shiftId: _id, openedAt: _at, ...summary } = await previewShiftClose(user.id);
    return summary;
  });
}

const closeShiftSchema = z.object({
  actualCash: z.union([z.string(), z.number()]),
  notes: z.string().trim().max(500).optional(),
});

export async function closeShiftAction(input: unknown): Promise<ActionResult<CloseShiftResult>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    const values = parseInput(closeShiftSchema, input);
    const actualCash = amountOf('actualCash', values.actualCash, { allowZero: true });

    const result = await closeShift({ userId: user.id, actualCash, notes: values.notes });

    // No revalidation: any revalidatePath in an action re-renders the page the
    // cashier is on, which would swap the till for the Open Shift gate before
    // they have read the closing summary. The summary's Done button refreshes
    // the POS, and the dashboard and shift history render fresh on each visit.
    return result;
  });
}

const movementSchema = z.object({
  type: z.enum(['CASH_IN', 'CASH_OUT']),
  amount: z.union([z.string(), z.number()]),
  reason: z.string().trim().min(3, 'Give a short reason.').max(200),
  // CORRECTION is not accepted here; corrections go through correctCashMovementAction.
  category: z
    .enum(['CHANGE_FUND', 'OWNER_TOP_UP', 'SUPPLIER_PAYMENT', 'EXPENSE', 'BANK_DEPOSIT', 'OWNER_WITHDRAWAL', 'OTHER'])
    .default('OTHER'),
  notes: z.string().trim().max(500).optional(),
  // One per attempt, so a doubled submit records the movement once.
  clientRequestId: z.string().uuid().optional(),
});

export async function addCashMovementAction(input: unknown): Promise<ActionResult<RecordedMovement>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    const values = parseInput(movementSchema, input);
    const amount = amountOf('amount', values.amount, { allowZero: false });

    const movement = await addCashMovement({
      userId: user.id,
      type: values.type,
      amount,
      reason: values.reason,
      category: values.category,
      notes: values.notes,
      clientRequestId: values.clientRequestId,
    });

    refresh();
    revalidatePath('/cash-movements');
    return movement;
  });
}

const correctionSchema = z.object({
  movementId: z.string().min(1),
  reason: z.string().trim().min(3, 'Give a short reason.').max(150),
});

/**
 * Reverses a cash movement recorded by mistake. A cashier may correct only
 * their own; the owner any, while its shift is open (checked in the service).
 */
export async function correctCashMovementAction(input: unknown): Promise<ActionResult<RecordedMovement>> {
  return runAction(async () => {
    const user = await authorize('pos.create');
    const values = parseInput(correctionSchema, input);
    const movement = await correctCashMovement({
      movementId: values.movementId,
      actorId: user.id,
      isOwner: userCan(user, FINANCIAL_PERMISSION),
      reason: values.reason,
    });
    refresh();
    revalidatePath('/cash-movements');
    return movement;
  });
}

const ownerCloseSchema = closeShiftSchema.extend({ shiftId: z.string().min(1) });

/** The owner closes a shift a cashier left open, after counting that drawer. */
export async function closeShiftForCashierAction(input: unknown): Promise<ActionResult<CloseShiftResult>> {
  return runAction(async () => {
    const owner = await authorize(FINANCIAL_PERMISSION);
    const values = parseInput(ownerCloseSchema, input);
    const actualCash = amountOf('actualCash', values.actualCash, { allowZero: true });

    const result = await closeShiftForCashier({ shiftId: values.shiftId, actorId: owner.id, actualCash, notes: values.notes });

    refresh();
    return result;
  });
}
