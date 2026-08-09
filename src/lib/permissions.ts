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
  'brands',
  'units',
  'suppliers',
  'customers',
  'warehouses',
  'inventory',
  'purchases',
  'sales',
  'pos',
  'returns',
  'payments',
  'expenses',
  'reports',
  'analytics',
  'notifications',
  'audit',
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
  brands: { actions: ['view', 'create', 'update', 'delete'], description: 'Product brands' },
  units: { actions: ['view', 'create', 'update', 'delete'], description: 'Units of measure' },
  suppliers: { actions: ['view', 'create', 'update', 'delete', 'export'], description: 'Suppliers' },
  customers: { actions: ['view', 'create', 'update', 'delete', 'export'], description: 'Customers' },
  warehouses: { actions: ['view', 'create', 'update', 'delete'], description: 'Warehouses and locations' },
  inventory: { actions: ['view', 'create', 'update', 'export'], description: 'Stock levels, adjustments, transfers' },
  purchases: { actions: ['view', 'create', 'update', 'delete', 'export'], description: 'Purchase orders and receiving' },
  sales: { actions: ['view', 'create', 'update', 'delete', 'export'], description: 'Sales and invoices' },
  pos: { actions: ['view', 'create'], description: 'Point of sale terminal' },
  returns: { actions: ['view', 'create', 'update', 'delete'], description: 'Sales and purchase returns' },
  payments: { actions: ['view', 'create', 'delete'], description: 'Payments in and out' },
  expenses: { actions: ['view', 'create', 'update', 'delete'], description: 'Operating expenses' },
  reports: { actions: ['view', 'export'], description: 'Reporting suite' },
  analytics: { actions: ['view'], description: 'Analytics and trends' },
  notifications: { actions: ['view', 'manage'], description: 'Notification centre' },
  audit: { actions: ['view', 'export'], description: 'Audit trail' },
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

const keysFor = (resource: Resource): PermissionKey[] =>
  CATALOGUE[resource].actions.map((a) => `${resource}.${a}` as PermissionKey);

const viewOnly = (...resources: Resource[]): PermissionKey[] =>
  resources.map((r) => `${r}.view` as PermissionKey);

/**
 * System roles. `OWNER` is intentionally unrestricted — the business owner
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
    slug: 'manager',
    name: 'Manager',
    description: 'Runs day-to-day operations. No user, role, or system settings access.',
    permissions: [
      ...keysFor('dashboard'),
      ...keysFor('products'),
      ...keysFor('categories'),
      ...keysFor('brands'),
      ...keysFor('units'),
      ...keysFor('suppliers'),
      ...keysFor('customers'),
      ...keysFor('warehouses'),
      ...keysFor('inventory'),
      ...keysFor('purchases'),
      ...keysFor('sales'),
      ...keysFor('pos'),
      ...keysFor('returns'),
      ...keysFor('payments'),
      ...keysFor('expenses'),
      ...keysFor('reports'),
      ...keysFor('analytics'),
      ...keysFor('notifications'),
      ...keysFor('audit'),
      ...viewOnly('users', 'settings'),
    ],
  },
  {
    slug: 'inventory-clerk',
    name: 'Inventory Clerk',
    description: 'Receives stock, runs adjustments and transfers, maintains the catalogue.',
    permissions: [
      'dashboard.view',
      'products.view',
      'products.create',
      'products.update',
      'categories.view',
      'brands.view',
      'units.view',
      'suppliers.view',
      'warehouses.view',
      ...keysFor('inventory'),
      'purchases.view',
      'purchases.create',
      'purchases.update',
      'returns.view',
      'returns.create',
      'reports.view',
      'notifications.view',
    ],
  },
  {
    slug: 'cashier',
    name: 'Cashier',
    description: 'Operates the POS terminal and processes returns.',
    permissions: [
      'dashboard.view',
      'pos.view',
      'pos.create',
      'products.view',
      'customers.view',
      'customers.create',
      'sales.view',
      'sales.create',
      'returns.view',
      'returns.create',
      'payments.view',
      'payments.create',
      'inventory.view',
      'notifications.view',
    ],
  },
  {
    slug: 'accountant',
    name: 'Accountant',
    description: 'Read access to trading data plus full control of expenses and payments.',
    permissions: [
      'dashboard.view',
      'analytics.view',
      ...keysFor('reports'),
      ...keysFor('expenses'),
      ...keysFor('payments'),
      'sales.view',
      'sales.export',
      'purchases.view',
      'purchases.export',
      'products.view',
      'inventory.view',
      'inventory.export',
      'suppliers.view',
      'customers.view',
      'returns.view',
      'audit.view',
      'notifications.view',
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
  { prefix: '/categories', permission: 'categories.view' },
  { prefix: '/brands', permission: 'brands.view' },
  { prefix: '/units', permission: 'units.view' },
  { prefix: '/suppliers', permission: 'suppliers.view' },
  { prefix: '/customers', permission: 'customers.view' },
  { prefix: '/warehouses', permission: 'warehouses.view' },
  { prefix: '/inventory', permission: 'inventory.view' },
  { prefix: '/purchases', permission: 'purchases.view' },
  { prefix: '/sales', permission: 'sales.view' },
  { prefix: '/returns', permission: 'returns.view' },
  { prefix: '/payments', permission: 'payments.view' },
  { prefix: '/expenses', permission: 'expenses.view' },
  { prefix: '/reports', permission: 'reports.view' },
  { prefix: '/analytics', permission: 'analytics.view' },
  { prefix: '/notifications', permission: 'notifications.view' },
  { prefix: '/audit', permission: 'audit.view' },
  { prefix: '/settings/users', permission: 'users.view' },
  { prefix: '/settings/roles', permission: 'roles.view' },
  { prefix: '/settings', permission: 'settings.view' },
];
