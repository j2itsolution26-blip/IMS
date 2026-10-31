/**
 * The permission catalogue. This is the single definition of what can be
 * guarded — the database `permissions` table is synced from it by
 * `prisma/bootstrap.ts`, so adding a capability here and re-running bootstrap
 * is the whole workflow.
 */

export const RESOURCES = [
  'dashboard',
  'products',
  'categories',
  'inventory',
  'sales',
  'pos',
  'returns',
  'reports',
  'users',
  'roles',
  'settings',
  'billing',
  'audit',
  'support',
  'platform',
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ['view', 'create', 'update', 'delete', 'export', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];

export type PermissionKey = `${Resource}.${Action}`;

type ResourceSpec = { actions: readonly Action[]; description: string };

const CATALOGUE: Record<Resource, ResourceSpec> = {
  dashboard: { actions: ['view'], description: 'Business overview and KPIs' },
  products: { actions: ['view', 'create', 'update', 'delete', 'export'], description: 'Product catalogue' },
  categories: { actions: ['view', 'create', 'update', 'delete'], description: 'Product categories' },
  inventory: { actions: ['view', 'create', 'update', 'export'], description: 'Stock levels, stock-in, adjustments' },
  sales: { actions: ['view', 'create', 'update', 'delete', 'export'], description: 'Sales and receipts' },
  pos: { actions: ['view', 'create'], description: 'Point of sale terminal' },
  returns: { actions: ['view', 'create', 'update', 'delete'], description: 'Refunds' },
  reports: { actions: ['view', 'export'], description: 'Reporting suite' },
  users: { actions: ['view', 'create', 'update', 'delete'], description: 'User accounts' },
  roles: { actions: ['view', 'create', 'update', 'delete'], description: 'Roles and permissions' },
  settings: { actions: ['view', 'update'], description: 'System settings' },
  // Granted to every Owner role by migration 20261026090000, not bootstrap.
  billing: { actions: ['view', 'manage'], description: 'Subscription plan, usage and payments' },
  // Granted to every Owner role by migration 20261110090000, not bootstrap.
  audit: { actions: ['view'], description: 'Store activity log, as far back as the plan audit history allows' },
  // Granted to every built-in store role by migration 20261031090000.
  support: { actions: ['create'], description: 'Contact support and follow your own tickets' },
  platform: {
    actions: ['view', 'manage'],
    description: 'Platform administration — owner accounts and the admin audit trail',
  },
};

export interface PermissionDefinition {
  key: PermissionKey;
  resource: Resource;
  action: Action;
  description: string;
}

export const ALL_PERMISSIONS: PermissionDefinition[] = (
  Object.entries(CATALOGUE) as [Resource, ResourceSpec][]
).flatMap(([resource, spec]) =>
  spec.actions.map((action) => ({
    key: `${resource}.${action}` as PermissionKey,
    resource,
    action,
    description: `${action[0].toUpperCase()}${action.slice(1)} — ${spec.description}`,
  })),
);

export const ALL_PERMISSION_KEYS: PermissionKey[] = ALL_PERMISSIONS.map((p) => p.key);

/** True for the platform-administration keys, which no store role may hold. */
export function isPlatformPermission(key: PermissionKey): boolean {
  return key.startsWith('platform.');
}

/**
 * Everything inside the store.
 *
 * This is what the Owner's `'ALL'` resolves to. Platform permissions are
 * excluded deliberately: an owner who could administer the platform could
 * reinstate themselves after being deactivated, which defeats the point of
 * having an administrator at all.
 */
export const STORE_PERMISSION_KEYS: PermissionKey[] = ALL_PERMISSION_KEYS.filter(
  (key) => !isPlatformPermission(key),
);

/**
 * System roles. `OWNER` is intentionally unrestricted — the store owner
 * should never be locked out of their own data.
 */
export interface RoleDefinition {
  slug: string;
  name: string;
  description: string;
  permissions: PermissionKey[] | 'ALL';
}

export const SYSTEM_ROLES: RoleDefinition[] = [
  {
    slug: 'system-admin',
    name: 'System Administrator',
    description:
      'Maintains the platform and the owner account. Holds no store permissions, so the POS, inventory and sales data are out of reach.',
    permissions: ['platform.view', 'platform.manage'],
  },
  {
    slug: 'owner',
    name: 'Owner',
    description: 'Full, unrestricted access to every module and setting.',
    permissions: 'ALL',
  },
  {
    slug: 'cashier',
    name: 'Cashier',
    description: 'Operates the POS and views sales history. Cannot process refunds or change settings.',
    permissions: [
      'dashboard.view',
      'pos.view',
      'pos.create',
      'products.view',
      'inventory.view',
      'sales.view',
      'sales.create',
      'reports.view',
      'support.create',
    ],
  },
  {
    slug: 'inventory-staff',
    name: 'Inventory Staff',
    description: 'Manages products and stock. Cannot use the POS or change settings.',
    permissions: [
      'dashboard.view',
      'products.view',
      'products.create',
      'products.update',
      'products.export',
      'categories.view',
      'categories.create',
      'inventory.view',
      'inventory.create',
      'inventory.update',
      'inventory.export',
      'reports.view',
      'support.create',
    ],
  },
];

/**
 * The Owner role is created once, during first-run setup. Every other role is
 * a staff role and is what the Add Staff form offers — Owner is deliberately
 * not assignable from there, so the system keeps exactly one owner.
 */
export const OWNER_ROLE_SLUG = 'owner';
export const SYSTEM_ADMIN_ROLE_SLUG = 'system-admin';

/** Roles that may never be handed out from an in-app account form. */
export const PRIVILEGED_ROLE_SLUGS: string[] = [OWNER_ROLE_SLUG, SYSTEM_ADMIN_ROLE_SLUG];

export function resolveRolePermissions(role: RoleDefinition): PermissionKey[] {
  return role.permissions === 'ALL' ? STORE_PERMISSION_KEYS : role.permissions;
}

/**
 * The gate for cost, profit, margin and stock value.
 *
 * `reports.export` is held by the Owner and by no default staff role, so it
 * already separates the owner's money figures from staff work. Every page,
 * query and export that would reveal cost or profit checks this key on the
 * server and strips those figures before anything reaches the browser.
 */
export const FINANCIAL_PERMISSION: PermissionKey = 'reports.export';

/** Route -> permission required to open it. Consumed by the sidebar and middleware. */
export const ROUTE_PERMISSIONS: { prefix: string; permission: PermissionKey }[] = [
  { prefix: '/dashboard', permission: 'dashboard.view' },
  { prefix: '/pos', permission: 'pos.view' },
  { prefix: '/products', permission: 'products.view' },
  { prefix: '/inventory', permission: 'inventory.view' },
  { prefix: '/sales', permission: 'sales.view' },
  // A cashier may open their own shift's report; the pages check
  // FINANCIAL_PERMISSION for everything else under /shifts.
  { prefix: '/shifts', permission: 'pos.view' },
  // Cashiers see their own movements; the page widens it for FINANCIAL_PERMISSION.
  { prefix: '/cash-movements', permission: 'pos.view' },
  { prefix: '/gcash-services', permission: 'pos.view' },
  { prefix: '/returns', permission: 'returns.view' },
  { prefix: '/reports', permission: 'reports.view' },
  { prefix: '/settings/users', permission: 'users.view' },
  { prefix: '/settings/roles', permission: 'roles.view' },
  { prefix: '/settings/subscription', permission: 'billing.view' },
  { prefix: '/settings/audit', permission: 'audit.view' },
  { prefix: '/support', permission: 'support.create' },
  { prefix: '/settings', permission: 'settings.view' },
];
