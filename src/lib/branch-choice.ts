import { OWNER_ROLE_SLUG } from '@/lib/permissions';

/**
 * The pure rules behind branch selection (src/lib/tenant/branch.ts), kept
 * free of server imports so they are unit-tested directly.
 */

export const BRANCH_COOKIE = 'ims-branch';
export const ALL_BRANCHES = 'all';

/** The owner account sees and switches between every branch. */
export function seesAllBranches(user: { branchId: string | null; role: { slug: string } }): boolean {
  return user.branchId === null && user.role.slug === OWNER_ROLE_SLUG;
}

/**
 * Orders active branches main-first, then oldest first, and marks the ones
 * past the plan's limit. The main branch is never restricted.
 */
export function rankBranches<T extends { isDefault: boolean; createdAt: Date }>(rows: T[], limit: number | null): (T & { restricted: boolean })[] {
  return [...rows]
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.getTime() - b.createdAt.getTime())
    .map((row, index) => ({ ...row, restricted: limit !== null && index >= limit }));
}

/** Pure choice of the selected branch, so it can be unit-tested. */
export function chooseBranch(options: { visible: string[]; mainId: string; assignedId: string | null; canSwitch: boolean; preference: string | undefined }): string {
  const { visible, mainId, assignedId, canSwitch, preference } = options;
  if (assignedId) return assignedId;
  if (canSwitch && preference === ALL_BRANCHES) return ALL_BRANCHES;
  if (preference && visible.includes(preference)) return preference;
  return visible.includes(mainId) ? mainId : visible[0];
}

