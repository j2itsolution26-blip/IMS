import { FINANCIAL_PERMISSION, type PermissionKey } from '@/lib/permissions';

/**
 * Which dashboard a signed-in user gets, decided from the permissions their
 * role holds — the existing RBAC, not role names — so a custom role lands on
 * the dashboard its permissions justify.
 *
 *   platform  — no store dashboard; a platform administrator is sent to /system-admin
 *   owner     — sales analytics (with cost and profit) plus inventory analytics
 *   cashier   — till-side view: their own shift, availability, low-stock notices
 *   inventory — inventory operations: stock levels, restocking, movements
 *   none      — no dashboard access at all
 *
 * The page renders, and queries, only the variant returned here, so a role
 * never receives figures it is not entitled to.
 */

export type DashboardVariant = 'platform' | 'owner' | 'cashier' | 'inventory' | 'none';

export function resolveDashboardVariant(permissions: { has: (key: PermissionKey) => boolean }): DashboardVariant {
  if (!permissions.has('dashboard.view')) {
    return permissions.has('platform.view') ? 'platform' : 'none';
  }
  if (permissions.has(FINANCIAL_PERMISSION) && permissions.has('sales.view')) return 'owner';
  if (permissions.has('pos.create')) return 'cashier';
  if (permissions.has('inventory.view')) return 'inventory';
  return 'none';
}
