'use client';

import Link from 'next/link';
import { MapPin, Pencil, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate, formatDateTime } from '@/lib/format';
import { BranchStatusBadge, type BranchListItem, type BranchStaffMember } from '@/features/branches/branch-item';

/**
 * One branch in full: its details and the staff assigned to it, from the
 * staff accounts themselves. Staff are assigned on Settings → Staff Accounts,
 * one branch per account, so nobody is listed under two branches.
 */
export function BranchDetailsDialog({
  branch,
  staff,
  canEdit,
  canManageStaff,
  onEdit,
  onClose,
}: {
  branch: BranchListItem | null;
  staff: BranchStaffMember[];
  canEdit: boolean;
  canManageStaff: boolean;
  onEdit: (branch: BranchListItem) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={branch !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {branch && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {branch.name}
                {branch.isDefault && <Badge variant="info">Main branch</Badge>}
                <BranchStatusBadge branch={branch} />
              </DialogTitle>
              <DialogDescription>Branch code {branch.code}</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Address</dt>
                <dd className="mt-0.5 flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {branch.address || <span className="text-muted-foreground">Address not set</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Added</dt>
                <dd className="mt-0.5">{formatDate(branch.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last sale</dt>
                <dd className="mt-0.5">{branch.lastSaleAt ? formatDateTime(branch.lastSaleAt) : <span className="text-muted-foreground">No sales yet</span>}</dd>
              </div>
            </dl>

            <section aria-labelledby="branch-staff-title">
              <h3 id="branch-staff-title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Assigned staff ({staff.length})
              </h3>
              {staff.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  No active staff are assigned to this branch.{canManageStaff && ' Assign staff from Staff Accounts by choosing this branch on their account.'}
                </p>
              ) : (
                <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                  {staff.map((member) => (
                    <li key={member.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{member.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{member.username}</p>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {member.roleName}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <DialogFooter className="gap-2 sm:gap-2">
              {canManageStaff && (
                <Button asChild variant="outline">
                  <Link href="/settings/users">
                    <Users aria-hidden="true" /> Manage staff
                  </Link>
                </Button>
              )}
              {canEdit && (
                <Button onClick={() => onEdit(branch)}>
                  <Pencil aria-hidden="true" /> Edit branch
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
