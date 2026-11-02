'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Archive,
  CircleCheck,
  CircleSlash,
  Eye,
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
import { KpiCard } from '@/components/kpi-card';
import { PageHeader } from '@/components/page-header';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  branchCapacity,
  branchParamsQuery,
  branchSummary,
  filterBranches,
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

const STATUS_LABEL: Record<BranchStatusFilter, string> = { all: 'All statuses', active: 'Active', inactive: 'Inactive' };
const SORT_LABEL: Record<BranchSort, string> = { name: 'Name', recent: 'Recently added', status: 'Status' };
const CAPACITY_ID = 'branch-capacity';

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
  canManage,
  writable,
  canUpgrade,
  canManageStaff,
  initialParams,
}: {
  branches: BranchListItem[];
  staff: BranchStaffMember[];
  /** Active branches in the whole store: what the plan counts. */
  activeInStore: number;
  limit: number | null;
  planName: string;
  /** The owner account with branches.manage. */
  canManage: boolean;
  /** False once the subscription has ended: records stay viewable only. */
  writable: boolean;
  canUpgrade: boolean;
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

  const actions = {
    view: (branch: BranchListItem) => setViewing(branch),
    edit: (branch: BranchListItem) => {
      setViewing(null);
      setEditing(branch);
    },
    deactivate: (branch: BranchListItem) => setDeactivating(branch),
    reactivate,
  };

  const filtered = params.q !== '' || params.status !== 'all';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Branch Management"
        description="Manage your physical stores, branch information, and assigned staff."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Branches' }]}
        actions={
          canManage && (
            <Button
              onClick={() => setEditing('new')}
              disabled={addBlocked !== null}
              aria-describedby={addBlocked ? `${CAPACITY_ID}-note` : undefined}
              title={addBlocked ?? undefined}
            >
              <Plus aria-hidden="true" /> Add branch
            </Button>
          )
        }
      />

      <section aria-label="Branch summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total locations" value={formatNumber(summary.total, 0)} icon={Store} hint={summary.inactive > 0 ? `${summary.inactive} inactive` : undefined} />
        <KpiCard label="Active branches" value={formatNumber(summary.active, 0)} icon={CircleCheck} tone="success" />
        <KpiCard
          label="Remaining slots"
          value={capacity.remaining === null ? 'Unlimited' : formatNumber(capacity.remaining, 0)}
          icon={LayoutGrid}
          tone={capacity.full ? 'warning' : 'default'}
          hint={capacity.limit === null ? undefined : `of ${formatNumber(capacity.limit, 0)} on ${planName}`}
        />
        <KpiCard label="Assigned staff" value={formatNumber(summary.assignedStaff, 0)} icon={Users} hint="Active accounts with a branch" />
      </section>

      <BranchCapacityCard id={CAPACITY_ID} capacity={capacity} planName={planName} canUpgrade={canUpgrade} isOwner={canManage} />

      {!writable && canManage && (
        <p className="rounded-card border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-warning-text">
          This store is read-only because its subscription has ended. Branches stay viewable; renew to add, edit or reactivate them.
        </p>
      )}

      <section aria-labelledby="branch-list-title" className="space-y-3">
        <h2 id="branch-list-title" className="sr-only">
          Branches
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 sm:min-w-[16rem] sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={params.q}
              onChange={(event) => update({ q: event.target.value.slice(0, 60) })}
              placeholder="Search by branch name or code"
              aria-label="Search branches by name or code"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={params.status} onValueChange={(value) => update({ status: value as BranchStatusFilter })}>
              <SelectTrigger className="min-w-0 flex-1 sm:w-[9.5rem] sm:flex-none" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABEL) as BranchStatusFilter[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {STATUS_LABEL[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={params.sort} onValueChange={(value) => update({ sort: value as BranchSort })}>
              <SelectTrigger className="min-w-0 flex-1 sm:w-[12rem] sm:flex-none" aria-label="Sort branches">
                {/* !flex: the trigger clamps its direct spans to one line. */}
                <span className="!flex min-w-0 items-center gap-1">
                  <span className="hidden text-muted-foreground sm:inline">Sort:</span>
                  <span className="truncate">
                    <SelectValue />
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
            <div role="group" aria-label="Layout" className="flex shrink-0 rounded-full border p-0.5">
              {(
                [
                  ['grid', LayoutGrid, 'Grid view'],
                  ['list', List, 'List view'],
                ] as const
              ).map(([view, Icon, label]) => (
                <Button
                  key={view}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn('h-8 w-8 rounded-full', params.view === view && 'bg-primary/10 text-primary hover:bg-primary/15')}
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

        {filtered && branches.length > 0 && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Showing {shown.length} of {branches.length} {branches.length === 1 ? 'branch' : 'branches'}
          </p>
        )}

        {branches.length === 0 ? (
          <div className="rounded-card border bg-card">
            <EmptyState
              icon={Store}
              title="No branches yet"
              description="Each branch is one physical store with its own stock, sales and shifts. Add your first location to get started."
              action={
                canChange && !capacity.full ? (
                  <Button onClick={() => setEditing('new')}>
                    <Plus aria-hidden="true" /> Add branch
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-card border bg-card">
            {params.q ? (
              <EmptyState
                icon={SearchX}
                title={`No branches match “${params.q}”`}
                description={params.status === 'all' ? 'Check the spelling, or search by the branch code instead.' : `Nothing matches among ${STATUS_LABEL[params.status].toLowerCase()} branches.`}
                action={
                  <Button variant="outline" onClick={() => update({ q: '', status: 'all' })}>
                    <X aria-hidden="true" /> Clear search and filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={params.status === 'inactive' ? Archive : CircleSlash}
                title={params.status === 'inactive' ? 'No inactive branches' : 'No active branches'}
                description={
                  params.status === 'inactive'
                    ? 'Every branch is active. Deactivated branches appear here with their history kept.'
                    : 'No branch is active right now.'
                }
                action={
                  <Button variant="outline" onClick={() => update({ status: 'all' })}>
                    Show all branches
                  </Button>
                }
              />
            )}
          </div>
        ) : params.view === 'grid' ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((branch) => (
              <BranchCard
                key={branch.id}
                branch={branch}
                staffCount={staffOf.get(branch.id)?.length ?? 0}
                menu={<BranchMenu branch={branch} canChange={canChange} canManageStaff={canManageStaff} full={capacity.full} busy={busyId === branch.id} actions={actions} />}
                onView={() => setViewing(branch)}
              />
            ))}
          </ul>
        ) : (
          <ul className="divide-y overflow-hidden rounded-card border bg-card shadow-card">
            {shown.map((branch) => (
              <BranchRow
                key={branch.id}
                branch={branch}
                staffCount={staffOf.get(branch.id)?.length ?? 0}
                menu={<BranchMenu branch={branch} canChange={canChange} canManageStaff={canManageStaff} full={capacity.full} busy={busyId === branch.id} actions={actions} />}
                onView={() => setViewing(branch)}
              />
            ))}
          </ul>
        )}
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

/** The "⋯" menu: only actions this account may take and the plan allows. */
function BranchMenu({
  branch,
  canChange,
  canManageStaff,
  full,
  busy,
  actions,
}: {
  branch: BranchListItem;
  canChange: boolean;
  canManageStaff: boolean;
  full: boolean;
  busy: boolean;
  actions: BranchActions;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full" aria-label={`Actions for ${branch.name}`} disabled={busy}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{branch.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => actions.view(branch)}>
          <Eye aria-hidden="true" /> View details
        </DropdownMenuItem>
        {canChange && (
          <DropdownMenuItem onSelect={() => actions.edit(branch)}>
            <Pencil aria-hidden="true" /> Edit branch
          </DropdownMenuItem>
        )}
        {canManageStaff && (
          <DropdownMenuItem asChild>
            <Link href="/settings/users">
              <Users aria-hidden="true" /> Manage staff
            </Link>
          </DropdownMenuItem>
        )}
        {canChange && !branch.isDefault && (
          <>
            <DropdownMenuSeparator />
            {branch.isActive ? (
              <DropdownMenuItem className="text-destructive-text focus:text-destructive-text" onSelect={() => actions.deactivate(branch)}>
                <Archive aria-hidden="true" /> Deactivate…
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled={full} onSelect={() => actions.reactivate(branch)}>
                <RotateCcw aria-hidden="true" />
                {full ? 'Reactivate (plan full)' : 'Reactivate'}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StaffCount({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Users className="h-3.5 w-3.5" aria-hidden="true" />
      {formatNumber(count, 0)} staff
    </span>
  );
}

function Activity({ branch }: { branch: BranchListItem }) {
  return <span>{branch.lastSaleAt ? `Last sale ${formatRelative(branch.lastSaleAt)}` : `Added ${formatDate(branch.createdAt)}`}</span>;
}

function BranchCard({ branch, staffCount, menu, onView }: { branch: BranchListItem; staffCount: number; menu: React.ReactNode; onView: () => void }) {
  return (
    <li
      className={cn(
        'group flex flex-col rounded-card border bg-card p-4 shadow-card transition-colors hover:border-primary/40 focus-within:border-primary/40',
        !branch.isActive && 'bg-muted/30',
        branch.restricted && 'border-warning/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onView}
            className="block max-w-full truncate rounded text-left font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {branch.name}
          </button>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{branch.code}</p>
        </div>
        {menu}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {branch.isDefault && <Badge variant="info">Main branch</Badge>}
        <BranchStatusBadge branch={branch} />
      </div>
      <p className={cn('mt-3 flex flex-1 items-start gap-1.5 text-sm', branch.address ? 'text-foreground/80' : 'text-muted-foreground')}>
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="line-clamp-2">{branch.address || 'Address not set'}</span>
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
        <StaffCount count={staffCount} />
        <Activity branch={branch} />
      </div>
    </li>
  );
}

function BranchRow({ branch, staffCount, menu, onView }: { branch: BranchListItem; staffCount: number; menu: React.ReactNode; onView: () => void }) {
  return (
    <li className={cn('flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40', !branch.isActive && 'bg-muted/20')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onView}
            className="max-w-full truncate rounded text-left font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {branch.name}
          </button>
          <span className="font-mono text-xs text-muted-foreground">{branch.code}</span>
          {branch.isDefault && <Badge variant="info">Main</Badge>}
          <BranchStatusBadge branch={branch} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{branch.address || 'Address not set'}</span>
          </span>
          <StaffCount count={staffCount} />
          <Activity branch={branch} />
        </div>
      </div>
      {menu}
    </li>
  );
}
