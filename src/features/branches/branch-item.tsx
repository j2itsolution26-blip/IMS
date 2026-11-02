import { Badge } from '@/components/ui/badge';

export interface BranchListItem {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  /** When the branch last rang up a sale; null if it never has. */
  lastSaleAt: string | null;
  /**
   * Active but past the plan's limit after a downgrade: viewable, takes no
   * new shifts, sales or stock until enough branches are deactivated.
   */
  restricted: boolean;
}

/** An active account assigned to a branch (users.warehouseId). */
export interface BranchStaffMember {
  id: string;
  name: string;
  username: string;
  roleName: string;
  branchId: string;
}

export function BranchStatusBadge({ branch }: { branch: Pick<BranchListItem, 'isActive' | 'restricted'> }) {
  if (branch.restricted) return <Badge variant="warning">Over plan limit</Badge>;
  return <Badge variant={branch.isActive ? 'success' : 'secondary'}>{branch.isActive ? 'Active' : 'Inactive'}</Badge>;
}
