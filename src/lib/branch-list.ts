/**
 * Branch Management list logic: search, status filter, sorting, the summary
 * figures and the plan-capacity reading. Pure, so the screen and the tests
 * share one definition. The plan limit always comes from the caller (the
 * store's plan in src/lib/plans.ts); nothing here knows a plan's numbers.
 */

export type BranchStatusFilter = 'all' | 'active' | 'inactive';
export type BranchSort = 'name' | 'recent' | 'status';
export type BranchView = 'grid' | 'list';

export interface BranchListParams {
  q: string;
  status: BranchStatusFilter;
  sort: BranchSort;
  view: BranchView;
}

export const DEFAULT_BRANCH_PARAMS: BranchListParams = { q: '', status: 'all', sort: 'name', view: 'grid' };

const STATUSES: readonly BranchStatusFilter[] = ['all', 'active', 'inactive'];
const SORTS: readonly BranchSort[] = ['name', 'recent', 'status'];
const VIEWS: readonly BranchView[] = ['grid', 'list'];

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** Reads the list's choices from the page address; anything unknown falls back to the default. */
export function parseBranchParams(params: Record<string, string | string[] | undefined>): BranchListParams {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    q: (first('q') ?? '').trim().slice(0, 60),
    status: pick(first('status'), STATUSES, DEFAULT_BRANCH_PARAMS.status),
    sort: pick(first('sort'), SORTS, DEFAULT_BRANCH_PARAMS.sort),
    view: pick(first('view'), VIEWS, DEFAULT_BRANCH_PARAMS.view),
  };
}

/** The address query for the given choices, leaving defaults out so a plain URL stays plain. */
export function branchParamsQuery(params: BranchListParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  for (const key of ['status', 'sort', 'view'] as const) {
    if (params[key] !== DEFAULT_BRANCH_PARAMS[key]) query.set(key, params[key]);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export interface ListableBranch {
  name: string;
  code: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string | Date;
}

const time = (value: string | Date) => new Date(value).getTime();

/**
 * The branches to show for the current search, status and sort. The main
 * branch leads a name or status sort; "recently added" is strictly newest first.
 */
export function filterBranches<T extends ListableBranch>(rows: readonly T[], params: Pick<BranchListParams, 'q' | 'status' | 'sort'>): T[] {
  const q = params.q.trim().toLowerCase();
  const matches = rows.filter((row) => {
    if (params.status === 'active' && !row.isActive) return false;
    if (params.status === 'inactive' && row.isActive) return false;
    return !q || row.name.toLowerCase().includes(q) || row.code.toLowerCase().includes(q);
  });
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const compare: Record<BranchSort, (a: T, b: T) => number> = {
    name: (a, b) => Number(b.isDefault) - Number(a.isDefault) || byName(a, b),
    recent: (a, b) => time(b.createdAt) - time(a.createdAt) || byName(a, b),
    status: (a, b) => Number(b.isActive) - Number(a.isActive) || Number(b.isDefault) - Number(a.isDefault) || byName(a, b),
  };
  return [...matches].sort(compare[params.sort]);
}

export interface BranchCapacity {
  /** Active branches: the ones the plan counts. Archived branches are free. */
  used: number;
  /** The plan's limit, or null for no limit. */
  limit: number | null;
  /** Free places, never below zero; null for no limit. */
  remaining: number | null;
  /** 0–100 for the progress bar. */
  percent: number;
  /** Every place in use (or more): no new or reactivated branch. */
  full: boolean;
  /** More active branches than the plan allows, after a downgrade. */
  over: boolean;
}

export function branchCapacity(activeBranches: number, limit: number | null): BranchCapacity {
  if (limit === null) return { used: activeBranches, limit, remaining: null, percent: 0, full: false, over: false };
  return {
    used: activeBranches,
    limit,
    remaining: Math.max(0, limit - activeBranches),
    percent: limit > 0 ? Math.min(100, Math.round((activeBranches / limit) * 100)) : 100,
    full: activeBranches >= limit,
    over: activeBranches > limit,
  };
}

export interface BranchSummary {
  total: number;
  active: number;
  inactive: number;
  /** Distinct active accounts assigned to any of the listed branches. */
  assignedStaff: number;
}

/**
 * The four summary figures. Staff are counted by account id, so nobody is
 * counted twice even if a list ever repeats them.
 */
export function branchSummary(rows: readonly { id: string; isActive: boolean }[], staff: readonly { id: string; branchId: string }[]): BranchSummary {
  const listed = new Set(rows.map((row) => row.id));
  const active = rows.filter((row) => row.isActive).length;
  return {
    total: rows.length,
    active,
    inactive: rows.length - active,
    assignedStaff: new Set(staff.filter((member) => listed.has(member.branchId)).map((member) => member.id)).size,
  };
}
