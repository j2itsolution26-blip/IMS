'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { authorize } from '@/lib/session';
import { runAction, parseInput, type ActionResult } from '@/lib/action';
import { ForbiddenError } from '@/lib/errors';
import { isStoreOwner } from '@/server/platform/billing-service';
import { archiveBranch, createBranch, reactivateBranch, updateBranch } from '@/server/services/branch-service';
import { ALL_BRANCHES, BRANCH_COOKIE, getBranchScope } from '@/lib/tenant/branch';

/**
 * Branch management. Each action needs `branches.manage` and the store's
 * owner account; the store comes from the session, never from the request,
 * and a branch id from another store is not found by the store-scoped client.
 */

async function requireOwner(): Promise<{ id: string }> {
  const user = await authorize('branches.manage');
  if (!user.store) throw new ForbiddenError('This account does not belong to a store.');
  if (!(await isStoreOwner(user.id, user.store.id))) throw new ForbiddenError('Only the store owner can manage branches.');
  return { id: user.id };
}

function refresh() {
  revalidatePath('/settings/branches');
  revalidatePath('/dashboard');
}

const branchSchema = z.object({
  name: z.string().trim().min(2, 'Enter a branch name.').max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(12)
    .regex(/^[A-Z0-9-]*$/, 'Use letters, numbers and dashes only.')
    .optional()
    .transform((value) => value || null),
  address: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => value || null),
});

const idSchema = z.object({ id: z.string().trim().min(1).max(64) });

export async function createBranchAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const owner = await requireOwner();
    const values = parseInput(branchSchema, input);
    const branch = await createBranch(owner.id, values);
    refresh();
    return { id: branch.id };
  });
}

export async function updateBranchAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const owner = await requireOwner();
    const { id, ...values } = parseInput(branchSchema.merge(idSchema), input);
    await updateBranch(owner.id, id, values);
    refresh();
  });
}

export async function archiveBranchAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const owner = await requireOwner();
    const { id } = parseInput(idSchema, input);
    await archiveBranch(owner.id, id);
    refresh();
  });
}

export async function reactivateBranchAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const owner = await requireOwner();
    const { id } = parseInput(idSchema, input);
    await reactivateBranch(owner.id, id);
    refresh();
  });
}

const selectSchema = z.object({ branch: z.string().trim().min(1).max(64) });

/**
 * Remembers which branch the owner is looking at. Only a branch this account
 * may see (or "all branches" for the owner) is accepted; every request checks
 * the remembered value again, so the cookie can never widen access.
 */
export async function selectBranchAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { branch } = parseInput(selectSchema, input);
    const scope = await getBranchScope();
    const allowed = branch === ALL_BRANCHES ? scope.canSwitch : scope.canSwitch && scope.branches.some((b) => b.id === branch);
    if (!allowed) throw new ForbiddenError('You do not have access to that branch.');
    (await cookies()).set(BRANCH_COOKIE, branch, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
    revalidatePath('/', 'layout');
  });
}
