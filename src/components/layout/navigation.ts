import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  Bell,
  Boxes,
  Building2,
  ClipboardList,
  Coins,
  FileBarChart,
  LayoutDashboard,
  Package,
  Receipt,
  RotateCcw,
  ScanBarcode,
  Scale,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tags,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import type { PermissionKey } from '@/lib/permissions';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: PermissionKey;
  /** Renders the live low-stock count next to the item. */
  badge?: 'lowStock' | 'notifications';
  /** Exact match only — stops `/sales` lighting up while on `/sales/new`. */
  exact?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      { label: 'Analytics', href: '/analytics', icon: TrendingUp, permission: 'analytics.view' },
      { label: 'Point of Sale', href: '/pos', icon: ScanBarcode, permission: 'pos.view' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { label: 'Products', href: '/products', icon: Package, permission: 'products.view' },
      { label: 'Categories', href: '/categories', icon: Tags, permission: 'categories.view' },
      { label: 'Brands', href: '/brands', icon: Building2, permission: 'brands.view' },
      { label: 'Units', href: '/units', icon: Scale, permission: 'units.view' },
    ],
  },
  {
    label: 'Stock',
    items: [
      { label: 'Stock levels', href: '/inventory', icon: Boxes, permission: 'inventory.view', badge: 'lowStock', exact: true },
      { label: 'Adjustments', href: '/inventory/adjustments', icon: ClipboardList, permission: 'inventory.create' },
      { label: 'Transfers', href: '/inventory/transfers', icon: ArrowLeftRight, permission: 'inventory.create' },
      { label: 'Movements', href: '/inventory/movements', icon: FileBarChart, permission: 'inventory.view' },
      { label: 'Warehouses', href: '/warehouses', icon: Warehouse, permission: 'warehouses.view' },
    ],
  },
  {
    label: 'Trading',
    items: [
      { label: 'Sales', href: '/sales', icon: ShoppingCart, permission: 'sales.view' },
      { label: 'Purchases', href: '/purchases', icon: Truck, permission: 'purchases.view' },
      { label: 'Returns', href: '/returns', icon: RotateCcw, permission: 'returns.view' },
      { label: 'Payments', href: '/payments', icon: Coins, permission: 'payments.view' },
      { label: 'Expenses', href: '/expenses', icon: Receipt, permission: 'expenses.view' },
    ],
  },
  {
    label: 'Partners',
    items: [
      { label: 'Suppliers', href: '/suppliers', icon: Truck, permission: 'suppliers.view' },
      { label: 'Customers', href: '/customers', icon: Users, permission: 'customers.view' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { label: 'Reports', href: '/reports', icon: FileBarChart, permission: 'reports.view' },
      { label: 'Notifications', href: '/notifications', icon: Bell, permission: 'notifications.view', badge: 'notifications' },
      { label: 'Audit log', href: '/audit', icon: ShieldCheck, permission: 'audit.view' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', href: '/settings/users', icon: Users, permission: 'users.view' },
      { label: 'Roles', href: '/settings/roles', icon: ShieldCheck, permission: 'roles.view' },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.view', exact: true },
    ],
  },
];
