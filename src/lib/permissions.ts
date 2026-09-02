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
  'units',
  'inventory',
  'sales',
  'pos',
  'returns',
  'reports',
  'users',
  'roles',
  'settings',
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
  units: { actions: ['view', 'create', 'update', 'delete'], description: 'Units of measure' },
  inventory: { actions: ['view', 'create', 'update', 'export'], description: 'Stock levels, stock-in, adjustments' },
  sales: { actions: ['view', 'create', 'update', 'delete', 'export'], description: 'Sales and receipts' },
  pos: { actions: ['view', 'create'], description: 'Point of sale terminal' },
  returns: { actions: ['view', 'create', 'update', 'delete'], description: 'Refunds' },
  reports: { actions: ['view', 'export'], description: 'Reporting suite' },
  users: { actions: ['view', 'create', 'update', 'delete'], description: 'User accounts' },
  roles: { actions: ['view', 'create', 'update', 'delete'], description: 'Roles and permissions' },
  settings: { actions: ['view', 'update'], description: 'System settings' },
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
    ],
  },
];

export function resolveRolePermissions(role: RoleDefinition): PermissionKey[] {
  return role.permissions === 'ALL' ? ALL_PERMISSION_KEYS : role.permissions;
}

/** Route -> permission required to open it. Consumed by the sidebar and middleware. */
export const ROUTE_PERMISSIONS: { prefix: string; permission: PermissionKey }[] = [
  { prefix: '/dashboard', permission: 'dashboard.view' },
  { prefix: '/pos', permission: 'pos.view' },
  { prefix: '/products', permission: 'products.view' },
  { prefix: '/inventory', permission: 'inventory.view' },
  { prefix: '/sales', permission: 'sales.view' },
  { prefix: '/returns', permission: 'returns.view' },
  { prefix: '/reports', permission: 'reports.view' },
  { prefix: '/settings/users', permission: 'users.view' },
  { prefix: '/settings/roles', permission: 'roles.view' },
  { prefix: '/settings', permission: 'settings.view' },
];
