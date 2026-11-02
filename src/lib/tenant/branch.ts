import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { assertPasswordSettled, getCurrentUser } from '@/lib/session';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { getStoreContext } from '@/lib/tenant/context';
import { ALL_BRANCHES, BRANCH_COOKIE, chooseBranch, rankBranches, seesAllBranches } from '@/lib/branch-choice';

/**
 * Which branch (store location) a request works in, decided on the server.
 *
 *   Staff with a branch  — that branch only, always. Nothing the browser
 *                          sends can widen it.
 *   Owner                — every active branch. Picks one, or "all branches"
 *                          for monitoring, with the branch cookie; the cookie
 *                          is only a preference and is checked against the
 *                          store's own active branches on every request.
 *   Anyone else          — the main branch.
 *
 * Writes (sales, shifts, stock) always need one branch: `operatingBranchId`.
 * Reads take `branchIds` and filter by them; "all branches" lists every
 * branch the account may see, so a consolidated figure can never include
 * another store's data or a branch the account is not allowed.
 */

export { ALL_BRANCHES, BRANCH_COOKIE, chooseBranch, rankBranches, seesAllBranches } from '@/lib/branch-choice';

export interface BranchOption {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  /**
   * Over the plan's limit after a downgrade: viewable, but takes no new
   * shifts, sales or stock until the owner archives enough branches.
   */
  restricted: boolean;
}

export interface BranchScope {
  /** Branches this account may see, main first. */
  branches: BranchOption[];
  /** The selected branch, or ALL_BRANCHES. */
  selected: string;
  /** Branch ids to filter reads by. */
  branchIds: string[];
  /**
   * The read filter: null for the owner's "all branches" (the whole store,
   * archived branches' history included), otherwise the one branch.
   */
  filterIds: string[] | null;
  /**
   * Which records the account may open one by one (a sale, a shift, a
   * refund): null for the owner (any branch, archived ones included),
   * otherwise its own branch.
   */
  visibleIds: string[] | null;
  /** Whether the account may choose between branches (owner with more than one). */
  canSwitch: boolean;
  /** The branch the account works at, if it is held to one. */
  assignedId: string | null;
  /** Active branches in the whole store, and the plan's limit (null = none). */
  storeBranches: number;
  limit: number | null;
}

export const getBranchScope = cache(async (): Promise<BranchScope> => {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  assertPasswordSettled(user);
  const ctx = await getStoreContext();
  const rows = await ctx.db.warehouse.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, isDefault: true, createdAt: true },
  });
  const ranked = rankBranches(rows, ctx.access.plan.limits.branches).map(({ createdAt: _createdAt, ...branch }) => branch);
  const main = ranked.find((branch) => branch.isDefault) ?? ranked[0];
  if (!main) throw new ForbiddenError('This store has no active branch.');

  const all = seesAllBranches(user);
  let assignedId: string | null = null;
  let visible: BranchOption[];
  if (all) {
    visible = ranked;
  } else if (user.branchId) {
    const own = ranked.find((branch) => branch.id === user.branchId);
    if (!own) throw new ForbiddenError('Your branch is archived. Ask the owner to assign you to another branch.');
    assignedId = own.id;
    visible = [own];
  } else {
    visible = [main];
  }

  const canSwitch = all && visible.length > 1;
  const preference = (await cookies()).get(BRANCH_COOKIE)?.value;
  const selected = chooseBranch({ visible: visible.map((b) => b.id), mainId: main.id, assignedId, canSwitch, preference });
  return {
    branches: visible,
    selected,
    branchIds: selected === ALL_BRANCHES ? visible.map((b) => b.id) : [selected],
    filterIds: selected === ALL_BRANCHES ? null : [selected],
    visibleIds: all ? null : visible.map((b) => b.id),
    canSwitch,
    assignedId,
    storeBranches: ranked.length,
    limit: ctx.access.plan.limits.branches,
  };
});

/**
 * The one branch this request writes to: the assigned branch, or the owner's
 * selected branch (the main branch while "all branches" is selected).
 */
export async function operatingBranch(): Promise<BranchOption> {
  const scope = await getBranchScope();
  const id = scope.selected === ALL_BRANCHES ? (scope.branches.find((b) => b.isDefault) ?? scope.branches[0]).id : scope.selected;
  return scope.branches.find((b) => b.id === id) as BranchOption;
}

export async function operatingBranchId(): Promise<string> {
  return (await operatingBranch()).id;
}

/** The operating branch, refused when it is over the plan's limit (see BranchOption.restricted). */
export async function writableBranchId(): Promise<string> {
  const branch = await operatingBranch();
  if (branch.restricted) {
    throw new ForbiddenError(
      `${branch.name} is over your plan's location limit, so it takes no new sales, shifts or stock. The owner can archive a branch or upgrade to continue.`,
    );
  }
  return branch.id;
}

/** Throws unless `branchId` is one the signed-in account may see. */
export async function assertBranchVisible(branchId: string): Promise<void> {
  const scope = await getBranchScope();
  if (!scope.branches.some((branch) => branch.id === branchId)) throw new ForbiddenError('You do not have access to that branch.');
}
