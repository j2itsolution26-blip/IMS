'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { NotFoundError } from '@/lib/errors';
import { money, toNum } from '@/lib/decimal';
import { diff, recordAudit } from '@/server/services/audit-service';
import { nextDocumentNumber } from '@/server/services/numbering-service';
import { expenseSchema } from '@/features/expenses/schema';

/**
 * Operating expenses.
 *
 * These are subtracted from gross profit to give net profit on the dashboard
 * and the profit report, so they are a first-class record rather than a note.
 */



export async function createExpense(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize('expenses.create');
    const values = parseInput(expenseSchema, input);

    const expense = await prisma.expense.create({
      data: {
        reference: await nextDocumentNumber('EXPENSE'),
        category: values.category,
        description: values.description,
        amount: money(values.amount),
        method: values.method,
        incurredAt: values.incurredAt,
        userId: user.id,
      },
      select: { id: true, reference: true },
    });

    await recordAudit({
      action: 'CREATE',
      entity: 'Expense',
      entityId: expense.id,
      summary: `Recorded expense ${expense.reference} — ${values.category} ${values.amount}`,
      userId: user.id,
    });

    revalidatePath('/expenses');
    revalidatePath('/dashboard');
    return { id: expense.id };
  });
}

export async function updateExpense(id: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize('expenses.update');
    const values = parseInput(expenseSchema, input);

    const before = await prisma.expense.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Expense');

    await prisma.expense.update({
      where: { id },
      data: {
        category: values.category,
        description: values.description,
        amount: money(values.amount),
        method: values.method,
        incurredAt: values.incurredAt,
      },
    });

    await recordAudit({
      action: 'UPDATE',
      entity: 'Expense',
      entityId: id,
      summary: `Updated expense ${before.reference}`,
      changes: diff({ ...before, amount: toNum(before.amount) }, { ...before, ...values } as never),
      userId: user.id,
    });

    revalidatePath('/expenses');
    revalidatePath('/dashboard');
    return { id };
  });
}

export async function deleteExpense(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await authorize('expenses.delete');

    const expense = await prisma.expense.findUnique({ where: { id }, select: { reference: true } });
    if (!expense) throw new NotFoundError('Expense');

    await prisma.expense.delete({ where: { id } });

    await recordAudit({
      action: 'DELETE',
      entity: 'Expense',
      entityId: id,
      summary: `Deleted expense ${expense.reference}`,
      userId: user.id,
    });

    revalidatePath('/expenses');
    revalidatePath('/dashboard');
  });
}
