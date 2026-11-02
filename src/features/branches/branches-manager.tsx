'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  BarChart3,
  CalendarDays,
  Check,
  CircleCheck,
  CircleSlash,
  Clock,
  Eye,
  Layers,
  LayoutGrid,
  List,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  Store,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { formatDate, formatDateTime, formatNumber, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  branchCapacity,
  branchParamsQuery,
  branchSummary,
  filterBranches,
  staffByRole,
  type BranchListParams,
  type BranchSort,
  type BranchStatusFilter,
} from '@/lib/branch-list';
import { archiveBranchAction, reactivateBranchAction } from '@/features/branches/actions';
import { BranchCapacityCard } from '@/features/branches/branch-capacity-card';
import { BranchDetailsDialog } from '@/features/branches/branch-details-dialog';
import { BranchFormDialog } from '@/features/branches/branch-form-dialog';
import { BranchStatusBadge, type BranchListItem, type BranchStaffMember } from '@/features/branches/branch-item';

export type { BranchListItem, BranchStaffMember } from '@/features/branches/branch-item';

const STATUS_TABS: { key: BranchStatusFilter; label: string; icon: LucideIcon }[] = [
  { key: 'all', label: 'All Branches', icon: Store },
  { key: 'active', label: 'Active', icon: Check },
  { key: 'inactive', label: 'Inactive', icon: CircleSlash },
];
const SORT_LABEL: Record<BranchSort, string> = { name: 'Name (A–Z)', recent: 'Recently added', status: 'Status' };
const CAPACITY_ID = 'branch-capacity';
/** This page's buttons: squared corners, as in the approved design. */
const SQUARE = 'rounded-lg';

/**
 * Branch Management: the store's physical locations, their plan capacity and
 * assigned staff. Buttons follow the plan's room and the viewer's rights, but
 * the server actions and the database trigger are what enforce them.
 */
export function BranchesManager({
  branches,
  staff,
  activeInStore,
  limit,
  planName,
  planPrice,
  higherPlans,
  canManage,
  writable,
  canUpgrade,
  canViewReports,
  canManageStaff,
  initialParams,
}: {
  branches: BranchListItem[];
  staff: BranchStaffMember[];
  /** Active branches in the whole store: what the plan counts. */
  activeInStore: number;
  limit: number | null;
  planName: string;
  /** The plan's monthly price from the platform price list, if one is set. */
  planPrice: { amount: number; currency: string } | null;
  /** Plans above this one with their own limits, for the upgrade message. */
  higherPlans: { name: string; branches: number | null }[];
  /** The owner account with branches.manage. */
  canManage: boolean;
  /** False once the subscription has ended: records stay viewable only. */
  writable: boolean;
  canUpgrade: boolean;
  canViewReports: boolean;
  canManageStaff: boolean;
  initialParams: BranchListParams;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [params, setParams] = React.useState(initialParams);
  const [editing, setEditing] = React.useState<BranchListItem | 'new' | null>(null);
  const [viewing, setViewing] = React.useState<BranchListItem | null>(null);
  const [deactivating, setDeactivating] = React.useState<BranchListItem | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const capacity = branchCapacity(activeInStore, limit);
  const summary = branchSummary(branches, staff);
  const shown = filterBranches(branches, params);
  const canChange = canManage && writable;
  const addBlocked = !writable ? 'This store is read-only because its subscription has ended. Renew to add branches.' : capacity.full ? 'Every location on your plan is in use.' : null;
  const counts: Record<BranchStatusFilter, number> = { all: summary.total, active: summary.active, inactive: summary.inactive };

  const staffOf = React.useMemo(() => {
    const map = new Map<string, BranchStaffMember[]>();
    for (const member of staff) map.set(member.branchId, [...(map.get(member.branchId) ?? []), member]);
    return map;
  }, [staff]);

  // The choices live in the address so a refresh or a shared link keeps them.
  // replaceState updates it without asking the server to render the page again.
  const update = (patch: Partial<BranchListParams>) => {
    const next = { ...params, ...patch };
    setParams(next);
    window.history.replaceState(null, '', `${pathname}${branchParamsQuery(next)}`);
  };

  const reactivate = async (branch: BranchListItem) => {
    setBusyId(branch.id);
    const result = await reactivateBranchAction({ id: branch.id });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    toast.success(`${branch.name} is active again.`);
    router.refresh();
  };

  const deactivate = async () => {
    if (!deactivating) return;
    setBusyId(deactivating.id);
    const result = await archiveBranchAction({ id: deactivating.id });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    toast.success(`${deactivating.name} deactivated. Its history is kept.`);
    setDeactivating(null);
    router.refresh();
  };

  const actions: BranchActions = {
    view: (branch) => setViewing(branch),
    edit: (branch) => {
      setViewing(null);
      setEditing(branch);
    },
    deactivate: (branch) => setDeactivating(branch),
    reactivate,
  };
  const rights = { canChange, canManageStaff, full: capacity.full };

  const activeSub =
    summary.inactive > 0 ? `${formatNumber(summary.inactive, 0)} inactive` : summary.active === 1 ? 'Your branch is active' : summary.active > 1 ? 'All branches are active' : 'No active branches';
  const remainingSub =
    capacity.remaining === null
      ? 'No limit on your plan'
      : capacity.full
        ? higherPlans.length > 0
          ? 'Upgrade to add more branches'
          : 'Your plan limit is reached'
        : `of ${formatNumber(capacity.limit ?? 0, 0)} on ${planName}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Branch Management"
        description="Manage your physical stores, branch information, and assigned staff."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Branches' }]}
        className="mb-0"
        leading={
          <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm sm:flex">
            <Store className="h-7 w-7" aria-hidden="true" />
          </span>
        }
        actions={
          <>
            {canViewReports && (
              <Button asChild variant="outline" size="lg" className={cn(SQUARE, 'border-primary/50 text-primary hover:bg-primary/5 hover:text-primary')}>
                <Link href="/reports">
                  <BarChart3 aria-hidden="true" /> View Branch Reports
                </Link>
              </Button>
            )}
            {canManage && (
              <Button
                size="lg"
                className={cn(SQUARE, 'font-semibold')}
                onClick={() => setEditing('new')}
                disabled={addBlocked !== null}
                aria-describedby={addBlocked ? `${CAPACITY_ID}-note` : undefined}
                title={addBlocked ?? undefined}
              >
                <Plus aria-hidden="true" /> Add Branch
              </Button>
            )}
          </>
        }
      />

      <section aria-label="Branch summary" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        <SummaryStat
          icon={Store}
          tone="success"
          label="Total Locations"
          value={formatNumber(summary.total, 0)}
          sub={capacity.limit === null ? 'No plan limit' : `${formatNumber(capacity.used, 0)} of ${formatNumber(capacity.limit, 0)} plan locations in use`}
        />
        <SummaryStat icon={CircleCheck} tone="success" label="Active Branches" value={formatNumber(summary.active, 0)} sub={activeSub} />
        <SummaryStat
          icon={Layers}
          tone="warning"
          label="Remaining Slots"
          value={capacity.remaining === null ? 'Unlimited' : formatNumber(capacity.remaining, 0)}
          sub={remainingSub}
        />
        <SummaryStat
          icon={Users}
          tone="info"
          label="Assigned Staff"
          value={formatNumber(summary.assignedStaff, 0)}
          sub={summary.total > 1 ? 'Across all locations' : 'Active accounts at this branch'}
        />
      </section>

      <BranchCapacityCard
        id={CAPACITY_ID}
        capacity={capacity}
        planName={planName}
        planPrice={planPrice}
        higherPlans={higherPlans}
        canUpgrade={canUpgrade}
        isOwner={canManage}
      />

      {!writable && canManage && (
        <p className="rounded-card border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning-text">
          This store is read-only because its subscription has ended. Branches stay viewable; renew to add, edit or reactivate them.
        </p>
      )}

      <section aria-labelledby="branch-list-title" className="overflow-hidden rounded-card border bg-card shadow-card">
        <h2 id="branch-list-title" className="sr-only">
          Branches
        </h2>
        <div className="flex flex-col gap-3 border-b p-3 sm:p-4 xl:flex-row xl:items-center">
          <div role="group" aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {STATUS_TABS.map(({ key, label, icon: Icon }) => {
              const selected = params.status === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update({ status: key })}
                  className={cn(
                    'inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors sm:px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="hidden h-4 w-4 min-[400px]:block" aria-hidden="true" />
                  {label} ({formatNumber(counts[key], 0)})
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
            <div className="relative min-w-0 sm:flex-1 xl:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={params.q}
                onChange={(event) => update({ q: event.target.value.slice(0, 60) })}
                placeholder="Search by branch name or code..."
                aria-label="Search branches by name or code"
                className="h-10 rounded-lg pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select value={params.sort} onValueChange={(value) => update({ sort: value as BranchSort })}>
                <SelectTrigger className="h-10 min-w-0 flex-1 rounded-lg sm:w-[13.5rem] sm:flex-none" aria-label="Sort branches">
                  {/* !flex: the trigger clamps its direct spans to one line. */}
                  <span className="!flex min-w-0 items-center gap-1">
                    <span className="hidden text-muted-foreground sm:inline">Sort by:</span>
                    <span className="truncate">
                      {/* The label is given, so it shows before the options load. */}
                      <SelectValue>{SORT_LABEL[params.sort]}</SelectValue>
                    </span>
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABEL) as BranchSort[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {SORT_LABEL[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div role="group" aria-label="Layout" className="flex h-10 shrink-0 items-center rounded-lg border p-0.5">
                {(
                  [
                    ['list', List, 'List view'],
                    ['grid', LayoutGrid, 'Grid view'],
                  ] as const
                ).map(([view, Icon, label]) => (
                  <Button
                    key={view}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn('h-8 w-8 rounded-md', params.view === view && 'bg-primary/10 text-primary hover:bg-primary/15')}
                    aria-label={label}
                    aria-pressed={params.view === view}
                    onClick={() => update({ view })}
                  >
                    <Icon aria-hidden="true" />
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 sm:p-4">
          {(params.q !== '' || params.status !== 'all') && branches.length > 0 && shown.length > 0 && (
            <p className="mb-3 text-xs text-muted-foreground" aria-live="polite">
              Showing {shown.length} of {branches.length} {branches.length === 1 ? 'branch' : 'branches'}
            </p>
          )}

          {branches.length === 0 ? (
            <EmptyState
              icon={Store}
              title="No branches yet"
              description="Each branch is one physical store with its own stock, sales and shifts. Add your first location to get started."
              action={
                canChange && !capacity.full ? (
                  <Button className={SQUARE} onClick={() => setEditing('new')}>
                    <Plus aria-hidden="true" /> Add Branch
                  </Button>
                ) : undefined
              }
            />
          ) : shown.length === 0 ? (
            params.q ? (
              <EmptyState
                icon={SearchX}
                title={`No branches match “${params.q}”`}
                description={params.status === 'all' ? 'Check the spelling, or search by the branch code instead.' : `Nothing matches among ${params.status} branches.`}
                action={
                  <Button variant="outline" className={SQUARE} onClick={() => update({ q: '', status: 'all' })}>
                    <X aria-hidden="true" /> Clear search and filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={params.status === 'inactive' ? Archive : CircleSlash}
                title={params.status === 'inactive' ? 'No inactive branches' : 'No active branches'}
                description={params.status === 'inactive' ? 'Every branch is active. Deactivated branches appear here with their history kept.' : 'No branch is active right now.'}
                action={
                  <Button variant="outline" className={SQUARE} onClick={() => update({ status: 'all' })}>
                    Show all branches
                  </Button>
                }
              />
            )
          ) : params.view === 'list' ? (
            <ul className="space-y-3">
              {shown.map((branch) => (
                <BranchRow
                  key={branch.id}
                  branch={branch}
                  staff={staffOf.get(branch.id) ?? []}
                  rights={rights}
                  busy={busyId === branch.id}
                  actions={actions}
                />
              ))}
            </ul>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((branch) => (
                <BranchCard
                  key={branch.id}
                  branch={branch}
                  staff={staffOf.get(branch.id) ?? []}
                  menu={<BranchMenu branch={branch} rights={rights} busy={busyId === branch.id} actions={actions} />}
                  onView={() => setViewing(branch)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      <BranchFormDialog target={editing} takenCodes={branches.map((branch) => branch.code)} onClose={() => setEditing(null)} />

      <BranchDetailsDialog
        branch={viewing}
        staff={viewing ? (staffOf.get(viewing.id) ?? []) : []}
        canEdit={canChange}
        canManageStaff={canManageStaff}
        onEdit={actions.edit}
        onClose={() => setViewing(null)}
      />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name ?? ''}?`}
        description="Its sales, stock and shift history are kept and still appear in reports. It stops taking new sales and stock, and frees a location on your plan. Open shifts must be closed and staff moved first. You can reactivate it later."
        confirmLabel="Deactivate"
        loading={busyId !== null && busyId === deactivating?.id}
        loadingLabel="Deactivating…"
        icon={Archive}
        onConfirm={deactivate}
      />
    </div>
  );
}

type BranchActions = {
  view: (branch: BranchListItem) => void;
  edit: (branch: BranchListItem) => void;
  deactivate: (branch: BranchListItem) => void;
  reactivate: (branch: BranchListItem) => void;
};

type Rights = { canChange: boolean; canManageStaff: boolean; full: boolean };

const TONE: Record<'success' | 'warning' | 'info', string> = {
  success: 'bg-success/10 text-success-text',
  warning: 'bg-warning/15 text-warning-text',
  info: 'bg-info/10 text-info-text',
};

/** One summary figure: icon on the left, label, value and a plain-language line. */
function SummaryStat({ icon: Icon, tone, label, value, sub }: { icon: LucideIcon; tone: keyof typeof TONE; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-start gap-4 rounded-card border bg-card p-4 shadow-card sm:p-5">
      <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', TONE[tone])}>
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-snug">{label}</p>
        <p className="tabular mt-1 text-2xl font-bold leading-none tracking-tight sm:text-[1.875rem]">{value}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

/**
 * The "⋯" menu: only actions this account may take and the plan allows.
 * `extrasOnly` leaves out what the row already shows as buttons.
 */
function BranchMenu({ branch, rights, busy, actions, extrasOnly = false }: { branch: BranchListItem; rights: Rights; busy: boolean; actions: BranchActions; extrasOnly?: boolean }) {
  const status = rights.canChange && !branch.isDefault;
  if (extrasOnly && !status) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className={cn(SQUARE, 'h-10 w-10 shrink-0')} aria-label={`More actions for ${branch.name}`} disabled={busy}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{branch.name}</DropdownMenuLabel>
        {!extrasOnly && (
          <>
            <DropdownMenuItem onSelect={() => actions.view(branch)}>
              <Eye aria-hidden="true" /> View details
            </DropdownMenuItem>
            {rights.canChange && (
              <DropdownMenuItem onSelect={() => actions.edit(branch)}>
                <Pencil aria-hidden="true" /> Edit branch
              </DropdownMenuItem>
            )}
            {rights.canManageStaff && (
              <DropdownMenuItem asChild>
                <Link href="/settings/users">
                  <Users aria-hidden="true" /> Manage staff
                </Link>
              </DropdownMenuItem>
            )}
          </>
        )}
        {status && (
          <>
            {!extrasOnly && <DropdownMenuSeparator />}
            {branch.isActive ? (
              <DropdownMenuItem className="text-destructive-text focus:text-destructive-text" onSelect={() => actions.deactivate(branch)}>
                <Archive aria-hidden="true" /> Deactivate…
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={rights.full} onSelect={() => actions.reactivate(branch)}>
                <RotateCcw aria-hidden="true" />
                {rights.full ? 'Reactivate (plan full)' : 'Reactivate'}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const sameDay = (a: Date, b: Date) => formatDate(a) === formatDate(b);

/** "Today, 10:32 AM", or the full date and time on other days. */
function whenText(iso: string): string {
  const at = new Date(iso);
  return sameDay(at, new Date()) ? `Today, ${formatTime(at)}` : formatDateTime(at);
}

function staffText(staff: BranchStaffMember[]): string {
  if (staff.length === 0) return 'No staff assigned';
  return `${formatNumber(staff.length, 0)} assigned staff (${staffByRole(staff.map((member) => member.roleName))})`;
}

/** The branch's picture area. Branches have no photos, so it shows the store mark and code. */
function BranchTile({ branch, className }: { branch: BranchListItem; className?: string }) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border bg-gradient-to-br from-primary/15 via-primary/5 to-transparent text-primary',
        !branch.isActive && 'from-muted via-muted/40 text-muted-foreground',
        className,
      )}
      aria-hidden="true"
    >
      <Store className="h-9 w-9" />
      <span className="font-mono text-xs font-semibold tracking-wider">{branch.code}</span>
    </div>
  );
}

function Fact({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** The wide branch row from the approved design. */
function BranchRow({ branch, staff, rights, busy, actions }: { branch: BranchListItem; staff: BranchStaffMember[]; rights: Rights; busy: boolean; actions: BranchActions }) {
  return (
    <li
      className={cn(
        'flex gap-4 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40 focus-within:border-primary/40 sm:p-4',
        !branch.isActive && 'bg-muted/30',
        branch.restricted && 'border-warning/40',
      )}
    >
      <BranchTile branch={branch} className="hidden h-[124px] w-[168px] sm:flex md:w-[200px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <button
                type="button"
                onClick={() => actions.view(branch)}
                className="max-w-full truncate rounded text-left text-lg font-bold leading-tight hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {branch.name}
              </button>
              {branch.isDefault && <Badge variant="info">Main</Badge>}
              <BranchStatusBadge branch={branch} />
            </div>
            {/* Phones and tablets: every action in one menu. */}
            <div className="lg:hidden">
              <BranchMenu branch={branch} rights={rights} busy={busy} actions={actions} />
            </div>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">Code: {branch.code}</p>
          <ul className="mt-2.5 space-y-1.5 text-sm">
            <Fact icon={MapPin}>{branch.address || <span className="text-muted-foreground">Address not set</span>}</Fact>
            <Fact icon={Users}>{staffText(staff)}</Fact>
            <Fact icon={CalendarDays}>Created: {formatDate(branch.createdAt)}</Fact>
            {branch.lastSaleAt && <Fact icon={Clock}>Last sale: {whenText(branch.lastSaleAt)}</Fact>}
          </ul>
        </div>
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <Button variant="outline" className={cn(SQUARE, 'h-10 border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary')} onClick={() => actions.view(branch)}>
            <Eye aria-hidden="true" /> View
          </Button>
          {rights.canChange && (
            <Button variant="outline" className={cn(SQUARE, 'h-10')} onClick={() => actions.edit(branch)}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
          )}
          {rights.canManageStaff && (
            <Button asChild variant="outline" className={cn(SQUARE, 'h-10')}>
              <Link href="/settings/users">
                <Users aria-hidden="true" /> Manage Staff
              </Link>
            </Button>
          )}
          <BranchMenu branch={branch} rights={rights} busy={busy} actions={actions} extrasOnly />
        </div>
      </div>
    </li>
  );
}

/** The compact card for the grid view. */
function BranchCard({ branch, staff, menu, onView }: { branch: BranchListItem; staff: BranchStaffMember[]; menu: React.ReactNode; onView: () => void }) {
  return (
    <li
      className={cn(
        'flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-primary/40 focus-within:border-primary/40',
        !branch.isActive && 'bg-muted/30',
        branch.restricted && 'border-warning/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onView}
            className="block max-w-full truncate rounded text-left text-base font-bold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {branch.name}
          </button>
          <p className="mt-0.5 text-xs text-muted-foreground">Code: {branch.code}</p>
        </div>
        {menu}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {branch.isDefault && <Badge variant="info">Main</Badge>}
        <BranchStatusBadge branch={branch} />
      </div>
      <ul className="mt-3 flex-1 space-y-1.5 text-sm">
        <Fact icon={MapPin}>
          <span className="line-clamp-2">{branch.address || <span className="text-muted-foreground">Address not set</span>}</span>
        </Fact>
        <Fact icon={Users}>{staffText(staff)}</Fact>
      </ul>
      <p className="mt-3 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {branch.lastSaleAt ? `Last sale: ${whenText(branch.lastSaleAt)}` : `Created: ${formatDate(branch.createdAt)}`}
      </p>
    </li>
  );
}
