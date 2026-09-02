import type { LucideIcon } from 'lucide-react';
import {
  Boxes,
  FileBarChart,
  LayoutDashboard,
  ScanBarcode,
  Settings,
  ShoppingCart,
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
    label: 'Store',
    items: [
      { label: 'POS', href: '/pos', icon: ScanBarcode, permission: 'pos.view' },
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      { label: 'Inventory', href: '/inventory', icon: Boxes, permission: 'inventory.view', badge: 'lowStock', exact: true },
      { label: 'Sales', href: '/sales', icon: ShoppingCart, permission: 'sales.view' },
      { label: 'Reports', href: '/reports', icon: FileBarChart, permission: 'reports.view' },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.view', exact: true },
    ],
  },
];
