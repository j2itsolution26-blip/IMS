import 'server-only';

import { Prisma } from '@prisma/client';
import { getBranchScope } from '@/lib/tenant/branch';
import { NotFoundError } from '@/lib/errors';

/**
 * The branch filter for reads, from the signed-in account's branch scope
 * (src/lib/tenant/branch.ts): null means the whole store (the owner's "all
 * branches"), otherwise the ids to keep. Every report, dashboard and list
 * over sales, stock or shifts applies it, so a figure always covers exactly
 * the branches the account may see.
 */
export async function readBranchIds(): Promise<string[] | null> {
  return (await getBranchScope()).filterIds;
}

/** The branches whose single records (a sale, a shift) the account may open; null = any. */
export async function visibleBranchIds(): Promise<string[] | null> {
  return (await getBranchScope()).visibleIds;
}

/** Refuses (as not found) a branch the signed-in account may not open records of. */
export async function assertRecordBranchVisible(warehouseId: string, what: string): Promise<void> {
  const visible = await visibleBranchIds();
  if (visible !== null && !visible.includes(warehouseId)) {
    throw new NotFoundError(what);
  }
}

/** ` AND <column> IN (…)` for raw SQL, or nothing for the whole store. */
export function sqlBranch(column: string, ids: string[] | null): Prisma.Sql {
  if (ids === null) return Prisma.empty;
  return Prisma.sql` AND ${Prisma.raw(column)} IN (${Prisma.join(ids)})`;
}

/** `{ warehouseId: { in } }` for Prisma where clauses, or nothing. */
export function whereBranch(ids: string[] | null): { warehouseId?: { in: string[] } } {
  return ids === null ? {} : { warehouseId: { in: ids } };
}

/** Sales filter through the sale's branch, for rows that hang off a sale. */
export function whereSaleBranch(ids: string[] | null): { sale?: { warehouseId: { in: string[] } } } {
  return ids === null ? {} : { sale: { warehouseId: { in: ids } } };
}

/** Rows that hang off a shift (cash movements, GCash services, adjustments). */
export function whereShiftBranch(ids: string[] | null): { shift?: { warehouseId: { in: string[] } } } {
  return ids === null ? {} : { shift: { warehouseId: { in: ids } } };
}
