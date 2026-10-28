import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  Boxes,
  CreditCard,
  Inbox,
  LifeBuoy,
  FileBarChart,
  KeyRound,
  LayoutDashboard,
  List,
  Package,
  PackageCheck,
  ScanBarcode,
  ScrollText,
  Settings,
  SlidersHorizontal,
  ShieldCheck,
  Store,
  ShoppingCart,
  Tags,
  Users,
  Wallet,
  ReceiptText,
} from 'lucide-react';
import { FINANCIAL_PERMISSION, type PermissionKey } from '@/lib/permissions';

export type NavBadge = 'lowStock' | 'support' | 'payments';
export type NavBadgeCounts = Record<NavBadge, number>;

/** The count a link shows; zero shows nothing. */
export function navBadgeCount(link: NavLink, counts: NavBadgeCounts): number {
  return link.badge ? counts[link.badge] : 0;
}

export interface NavLink {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: PermissionKey;
  /** Renders a live count next to the item: low stock, support (unread replies / tickets awaiting an answer), or payments awaiting verification. */
  badge?: NavBadge;
  /** Exact match only — stops `/settings` lighting up while on `/settings/users`. */
  exact?: boolean;
  /** Paths that light the item up instead of `href` (each matches its sub-paths too). */
  match?: string[];
  /** Sub-paths that belong to a sibling, so this item stays dark on them. */
  exclude?: string[];
}

/** An expandable parent. It has no page of its own; it shows when any child does. */
export interface NavGroup {
  label: string;
  icon: LucideIcon;
  children: NavLink[];
}

export type NavItem = NavLink | NavGroup;

export interface NavSection {
  label: string;
  items: NavItem[];
}

export function isNavGroup(item: NavItem): item is NavGroup {
  return 'children' in item;
}

function underPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isNavLinkActive(link: NavLink, pathname: string): boolean {
  if (link.exact) return pathname === link.href;
  if (link.exclude?.some((prefix) => underPath(pathname, prefix))) return false;
  return (link.match ?? [link.href]).some((prefix) => underPath(pathname, prefix));
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return isNavGroup(item)
    ? item.children.some((child) => isNavLinkActive(child, pathname))
    : isNavLinkActive(item, pathname);
}

/**
 * Drops every link the user cannot open, then any group left with no
 * children and any section left with no items.
 */
export function visibleNavigation(sections: NavSection[], granted: ReadonlySet<string>): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.flatMap((item): NavItem[] => {
        if (!isNavGroup(item)) return granted.has(item.permission) ? [item] : [];
        const children = item.children.filter((child) => granted.has(child.permission));
        return children.length > 0 ? [{ ...item, children }] : [];
      }),
    }))
    .filter((section) => section.items.length > 0);
}

// Sign-out lives in the sidebar footer, satisfying "Logout" without a route.
export const NAVIGATION: NavSection[] = [
  {
    // Only a platform administrator holds these, and the sidebar hides a
    // section whose every item is unpermitted — so store users never see it.
    label: 'Platform',
    items: [
      { label: 'Overview', href: '/system-admin', icon: ShieldCheck, permission: 'platform.view', exact: true },
      { label: 'Stores', href: '/system-admin/stores', icon: Store, permission: 'platform.view' },
      { label: 'Billing', href: '/system-admin/billing', icon: CreditCard, permission: 'platform.view' },
      { label: 'Payment verification', href: '/system-admin/payments', icon: ReceiptText, permission: 'platform.view', badge: 'payments' },
      { label: 'Support inbox', href: '/system-admin/support', icon: Inbox, permission: 'platform.view', badge: 'support' },
      { label: 'Owner accounts', href: '/system-admin/owners', icon: Users, permission: 'platform.view' },
      { label: 'Audit log', href: '/system-admin/audit', icon: ScrollText, permission: 'platform.view' },
    ],
  },
  {
    label: 'Store',
    items: [
      // The sidebar drops items a role cannot open, so Inventory Staff see
      // Dashboard → Products → Inventory → Reports, and a cashier
      // Dashboard → POS → Products → Inventory → Reports → Sales. POS sits
      // second because ringing up sales is a cashier's whole day.
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      { label: 'POS', href: '/pos', icon: ScanBarcode, permission: 'pos.view' },
      {
        label: 'Products',
        icon: Package,
        children: [
          // Product detail, new and edit pages live under /products too.
          { label: 'All Products', href: '/products', icon: List, permission: 'products.view', exclude: ['/products/categories'] },
          { label: 'Categories', href: '/products/categories', icon: Tags, permission: 'categories.view' },
          // The stock register — the page that has always lived at /inventory.
          { label: 'Stock Management', href: '/inventory', icon: PackageCheck, permission: 'inventory.view', badge: 'lowStock', exact: true },
        ],
      },
      // The stock ledger and the adjustment workflow that writes to it.
      {
        label: 'Inventory',
        href: '/inventory/movements',
        icon: Boxes,
        permission: 'inventory.view',
        match: ['/inventory/movements', '/inventory/adjustments'],
      },
      { label: 'Reports', href: '/reports', icon: FileBarChart, permission: 'reports.view' },
      // Refunds hang off their sale, so their pages light Sales up too.
      { label: 'Sales', href: '/sales', icon: ShoppingCart, permission: 'sales.view', match: ['/sales', '/returns'] },
      // Cash put into or taken from a drawer. Cashiers see their own; the owner everyone's.
      { label: 'Cash In / Out', href: '/cash-movements', icon: ArrowLeftRight, permission: 'pos.view' },
      // Every cashier's drawer — owner only, so it uses the financial key.
      { label: 'Shift Management', href: '/shifts', icon: Wallet, permission: FINANCIAL_PERMISSION },
      // Every settings page has its own entry, so the menu stays lit wherever
      // the owner is in Settings. Each child needs its own permission, so
      // someone delegated only staff management still finds Staff Accounts.
      // (My Profile, open to everyone, lives in the account menu.)
      {
        label: 'Settings',
        icon: Settings,
        children: [
          { label: 'Store Settings', href: '/settings', icon: SlidersHorizontal, permission: 'settings.view', exact: true },
          { label: 'Staff Accounts', href: '/settings/users', icon: Users, permission: 'users.view' },
          { label: 'Roles & Permissions', href: '/settings/roles', icon: KeyRound, permission: 'roles.view' },
          { label: 'Subscription & Billing', href: '/settings/subscription', icon: CreditCard, permission: 'billing.view' },
        ],
      },
    ],
  },
  {
    // Every store role holds support.create; the badge counts replies the
    // account has not read yet.
    label: 'Help',
    items: [{ label: 'Support', href: '/support', icon: LifeBuoy, permission: 'support.create', badge: 'support' }],
  },
];
