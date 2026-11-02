import 'server-only';

import { getStoreContext, type StoreContext } from '@/lib/tenant/context';
import { ConflictError, NotFoundError, PlanLimitError, StoreReadOnlyError, ValidationError } from '@/lib/errors';
import { limitMessage } from '@/lib/plans';
import { withinLimit } from '@/server/services/entitlements';
import { diff, recordAudit } from '@/server/services/audit-service';

/**
 * Store locations (branches). A branch is a physical store, stored as a
 * `Warehouse` row: stock, its ledger and sales already carry one. Devices,
 * browsers and accounts never count — only active branches do.
 *
 * Every function works through the signed-in user's store-scoped client, so
 * a branch id from another store is simply not found. The plan's limit is
 * checked here for a clear message and again by the database trigger
 * (migration 20261112090000) under a lock on the store's row, so two
 * requests at once cannot both pass it.
 *
 * Lifecycle: active → archived → active again. Archived branches keep all
 * their history, take no new sales or stock, and do not count toward the
 * plan. The main branch can never be archived. Branches are never deleted.
 *
 * Callers authorise first (branches.manage and the owner account).
 */

export interface BranchRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
}

const SELECT = { id: true, code: true, name: true, address: true, isActive: true, isDefault: true, createdAt: true } as const;

export interface BranchInput {
  name: string;
  code?: string | null;
  address?: string | null;
}

/** Every branch of the signed-in user's store: main first, then active, then by name. */
export async function listBranches(ctx?: StoreContext): Promise<BranchRow[]> {
  const { db } = ctx ?? (await getStoreContext());
  return db.warehouse.findMany({ orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { name: 'asc' }], select: SELECT });
}

/** "BR2", "BR3", … — the first free code. */
async function nextCode(ctx: StoreContext): Promise<string> {
  const taken = new Set((await ctx.db.warehouse.findMany({ select: { code: true } })).map((row) => row.code));
  for (let n = taken.size + 1; ; n++) if (!taken.has(`BR${n}`)) return `BR${n}`;
}

async function assertCodeFree(ctx: StoreContext, code: string, exceptId?: string): Promise<void> {
  const clash = await ctx.db.warehouse.findFirst({ where: { code, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  if (clash) {
    const message = `Another branch already uses the code ${code}.`;
    // On the Code field, so the form shows it there.
    throw new ValidationError(message, { code: [message] });
  }
}

async function findBranch(ctx: StoreContext, id: string): Promise<BranchRow> {
  const branch = await ctx.db.warehouse.findFirst({ where: { id }, select: SELECT });
  if (!branch) throw new NotFoundError('Branch');
  return branch;
}

async function requireRoom(ctx: StoreContext): Promise<void> {
  if (!ctx.access.writable) throw new StoreReadOnlyError();
  const check = await withinLimit(ctx, 'branches');
  if (!check.allowed) throw new PlanLimitError(limitMessage('branches', check.limit as number));
}

export async function createBranch(userId: string, input: BranchInput): Promise<BranchRow> {
  const ctx = await getStoreContext();
  await requireRoom(ctx);
  const code = input.code || (await nextCode(ctx));
  await assertCodeFree(ctx, code);
  const branch = await ctx.db.warehouse.create({
    data: { code, name: input.name, address: input.address || null, isActive: true, isDefault: false },
    select: SELECT,
  });
  await recordAudit({ action: 'CREATE', entity: 'Branch', entityId: branch.id, summary: `Added branch ${branch.name} (${branch.code})`, userId }, ctx.db);
  return branch;
}

export async function updateBranch(userId: string, id: string, input: BranchInput): Promise<BranchRow> {
  const ctx = await getStoreContext();
  const before = await findBranch(ctx, id);
  const code = input.code || before.code;
  if (code !== before.code) await assertCodeFree(ctx, code, id);
  const after = await ctx.db.warehouse.update({
    where: { id },
    data: { code, name: input.name, address: input.address || null },
    select: SELECT,
  });
  const changes = diff(
    { code: before.code, name: before.name, address: before.address },
    { code: after.code, name: after.name, address: after.address },
  );
  if (changes) {
    await recordAudit({ action: 'UPDATE', entity: 'Branch', entityId: id, summary: `Edited branch ${after.name}`, changes, userId }, ctx.db);
  }
  return after;
}

/**
 * Archives a branch: its history stays, it stops counting toward the plan and
 * takes no new sales or stock. Refused for the main branch, for a branch with
 * an open cashier shift, and for one that still has active staff assigned.
 */
export async function archiveBranch(userId: string, id: string): Promise<void> {
  const ctx = await getStoreContext();
  const branch = await findBranch(ctx, id);
  if (branch.isDefault) throw new ConflictError('The main branch cannot be archived.');
  if (!branch.isActive) return;
  const blockers = await branchArchiveBlockers(ctx, id);
  if (blockers) throw new ConflictError(blockers);
  await ctx.db.warehouse.update({ where: { id }, data: { isActive: false } });
  await recordAudit({ action: 'UPDATE', entity: 'Branch', entityId: id, summary: `Archived branch ${branch.name}`, userId }, ctx.db);
}

/** Brings an archived branch back, if the plan has room for one more active branch. */
export async function reactivateBranch(userId: string, id: string): Promise<void> {
  const ctx = await getStoreContext();
  const branch = await findBranch(ctx, id);
  if (branch.isActive) return;
  await requireRoom(ctx);
  await ctx.db.warehouse.update({ where: { id }, data: { isActive: true } });
  await recordAudit({ action: 'UPDATE', entity: 'Branch', entityId: id, summary: `Reactivated branch ${branch.name}`, userId }, ctx.db);
}

/**
 * Why a branch cannot be archived yet, or null: an open drawer must be
 * counted and closed first, and active staff moved or deactivated. The
 * database refuses the same (migration 20261113090000).
 */
export async function branchArchiveBlockers(ctx: StoreContext, id: string): Promise<string | null> {
  const [openShifts, staff] = await Promise.all([
    ctx.db.cashierShift.count({ where: { warehouseId: id, status: 'OPEN' } }),
    ctx.db.user.count({ where: { warehouseId: id, isActive: true } }),
  ]);
  if (openShifts > 0) return `Close the ${openShifts === 1 ? 'open shift' : `${openShifts} open shifts`} at this branch before archiving it.`;
  if (staff > 0) return `Move or deactivate the ${staff === 1 ? 'staff member' : `${staff} staff members`} at this branch before archiving it.`;
  return null;
}

/** Active staff per branch, for the branch list. */
export async function staffPerBranch(ctx?: StoreContext): Promise<Map<string, number>> {
  const { db } = ctx ?? (await getStoreContext());
  const rows = await db.user.groupBy({ by: ['warehouseId'], where: { isActive: true, warehouseId: { not: null } }, _count: { _all: true } });
  return new Map(rows.map((row) => [row.warehouseId as string, row._count._all]));
}
