import type { LucideIcon } from 'lucide-react';
import {
  Boxes,
  FileBarChart,
  LayoutDashboard,
  Package,
  ScanBarcode,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
} from 'lucide-react';
import type { PermissionKey } from '@/lib/permissions';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: PermissionKey;
  /** Renders the live low-stock count next to the item. */
  badge?: 'lowStock';
  /** Exact match only — stops `/settings` lighting up while on `/settings/users`. */
  exact?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Sign-out lives in the sidebar footer, satisfying "Logout" without a route.
export const NAVIGATION: NavSection[] = [
  {
    // Only a platform administrator holds these, and the sidebar hides a
    // section whose every item is unpermitted — so store users never see it.
    label: 'Platform',
    items: [
      { label: 'Overview', href: '/system-admin', icon: ShieldCheck, permission: 'platform.view', exact: true },
      { label: 'Owner accounts', href: '/system-admin/owners', icon: Users, permission: 'platform.view' },
      { label: 'Audit log', href: '/system-admin/audit', icon: ScrollText, permission: 'platform.view' },
    ],
  },
  {
    label: 'Store',
    items: [
      // The sidebar drops items a role cannot open, so Inventory Staff see
      // Dashboard → Products → Inventory → Reports, and a cashier Dashboard → POS.
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      { label: 'POS', href: '/pos', icon: ScanBarcode, permission: 'pos.view' },
      { label: 'Products', href: '/products', icon: Package, permission: 'products.view' },
      { label: 'Inventory', href: '/inventory', icon: Boxes, permission: 'inventory.view', badge: 'lowStock', exact: true },
      { label: 'Sales', href: '/sales', icon: ShoppingCart, permission: 'sales.view' },
      { label: 'Reports', href: '/reports', icon: FileBarChart, permission: 'reports.view' },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.view', exact: true },
    ],
  },
];
