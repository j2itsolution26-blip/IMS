import type { AuditAction, Prisma } from '@prisma/client';

/**
 * The store activity log's rules: how far back a plan may look, what category
 * and severity each entry has, and what is masked when an entry is opened.
 * Pure, so the boundaries and rules are unit-tested directly;
 * src/server/services/audit-queries.ts applies them to every store audit
 * query on the server.
 *
 * The window limits what a store can see. It never deletes anything: every
 * entry is kept (the audit_logs table is append-only), so an upgrade shows
 * the older history again.
 *
 * Category and severity are worked out from what an entry already records
 * (its action, its record type and the fixed wording the code writes), never
 * stored, so old entries are classified the same way as new ones and nothing
 * is rewritten. One ordered rule list drives both the labels in the browser
 * (`classifyAudit`) and the database filters (`categoryWhere`,
 * `severityWhere`), so the two cannot disagree.
 */

const DAY = 86_400_000;

/** The earliest entry a plan keeping `days` of history may see; null = all of it. */
export function auditWindowStart(days: number | null, now: Date = new Date()): Date | null {
  return days === null ? null : new Date(now.getTime() - days * DAY);
}

/** How the window reads on the page. */
export function auditWindowLabel(days: number | null): string {
  return days === null ? 'your full history' : `the last ${days} days`;
}

// ---------------------------------------------------------------------------
// Categories and severity
// ---------------------------------------------------------------------------

export type AuditCategory =
  | 'security'
  | 'sales'
  | 'refunds'
  | 'shifts'
  | 'cash'
  | 'inventory'
  | 'staff'
  | 'settings'
  | 'billing'
  | 'exports'
  | 'other';

export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  security: 'Sign-in and security',
  sales: 'Sales',
  refunds: 'Refunds and voids',
  shifts: 'Shifts and reviews',
  cash: 'Cash and GCash',
  inventory: 'Products and stock',
  staff: 'Staff and permissions',
  settings: 'Settings and branches',
  billing: 'Subscription and billing',
  exports: 'Data exports',
  other: 'Other',
};

export const AUDIT_CATEGORY_ORDER = Object.keys(AUDIT_CATEGORY_LABEL) as AuditCategory[];

export type AuditSeverity = 'normal' | 'attention' | 'critical';

export const AUDIT_SEVERITY_LABEL: Record<AuditSeverity, string> = {
  normal: 'Routine',
  attention: 'Attention',
  critical: 'Critical',
};

export const AUDIT_SEVERITY_ORDER: AuditSeverity[] = ['critical', 'attention', 'normal'];

/**
 * One matching rule. Every field given must match; within a field, any value
 * does. Summaries are the fixed wording written by the code (pinned by
 * tests/audit-log.test.ts), compared case-sensitively.
 */
export interface AuditRule {
  action?: AuditAction[];
  entity?: string[];
  summaryStartsWith?: string[];
  summaryContains?: string[];
  /** changes.attempt at least this (failed sign-ins). */
  minAttempt?: number;
}

/** Account changes that are about signing in rather than about the job. */
export const SECURITY_SUMMARY_PREFIXES = [
  'Set own screen-lock PIN',
  'Removed own screen-lock PIN',
  'Added a passkey',
  'Removed a passkey',
  'Reset password for',
  'Revoked ',
  'Temporary password change failed',
  'Replaced temporary password',
];

/** Settings an owner should notice being changed. Entries name keys, never values. */
export const SENSITIVE_SETTING_KEYS = [
  'sales.defaultTaxRate',
  'locale.currency',
  'company.gcashNumber',
  'pos.gcashServices',
  'pos.offlineMode',
  'pos.offlineAccessHours',
  'inventory.allowNegativeStock',
  'shifts.varianceTolerance',
  'security.autoLockMinutes',
];

/** Failed sign-ins logged per account per window; the last is critical. */
export const FAILED_SIGN_IN_WINDOW_MINUTES = 10;
export const FAILED_SIGN_IN_MAX_LOGGED = 5;

/** Ordered: the first rule an entry matches decides its category. */
export const CATEGORY_RULES: { category: Exclude<AuditCategory, 'other'>; rule: AuditRule }[] = [
  { category: 'security', rule: { action: ['LOGIN', 'LOGOUT', 'LOGIN_FAILED'] } },
  { category: 'security', rule: { entity: ['User'], summaryStartsWith: SECURITY_SUMMARY_PREFIXES } },
  { category: 'refunds', rule: { action: ['RETURN'] } },
  { category: 'refunds', rule: { entity: ['Sale'], action: ['UPDATE'] } },
  { category: 'sales', rule: { action: ['SALE'] } },
  { category: 'sales', rule: { entity: ['Sale'] } },
  { category: 'shifts', rule: { action: ['SHIFT_OPEN', 'SHIFT_CLOSE', 'SHIFT_REVIEW', 'SHIFT_ADJUSTMENT'] } },
  { category: 'cash', rule: { action: ['CASH_MOVEMENT'] } },
  { category: 'cash', rule: { entity: ['CashMovement', 'WalletTransaction'] } },
  { category: 'inventory', rule: { action: ['INVENTORY_CHANGE', 'PRICE_CHANGE'] } },
  { category: 'inventory', rule: { entity: ['Product', 'Category', 'Inventory'] } },
  { category: 'staff', rule: { entity: ['User', 'Role'] } },
  { category: 'settings', rule: { action: ['SETTINGS_CHANGE'] } },
  { category: 'settings', rule: { entity: ['Setting', 'Branch', 'Warehouse'] } },
  { category: 'billing', rule: { action: ['SUBSCRIPTION', 'PAYMENT'] } },
  { category: 'billing', rule: { entity: ['Store', 'Invoice', 'SubscriptionPayment', 'Billing'] } },
  { category: 'exports', rule: { action: ['EXPORT'] } },
  { category: 'exports', rule: { entity: ['Report', 'DataExport'] } },
];

/**
 * Ordered: the first rule decides. Anything unmatched is routine. Kept to
 * what genuinely warrants a look: a sign-in, a sale or an ordinary settings
 * update is never flagged.
 */
export const SEVERITY_RULES: { severity: Exclude<AuditSeverity, 'normal'>; rule: AuditRule }[] = [
  // Repeated failures on one account, and a lock screen that ran out of tries.
  { severity: 'critical', rule: { action: ['LOGIN_FAILED'], minAttempt: FAILED_SIGN_IN_MAX_LOGGED } },
  { severity: 'critical', rule: { action: ['LOGOUT'], summaryStartsWith: ['Session revoked after'] } },
  { severity: 'attention', rule: { action: ['LOGIN_FAILED'] } },
  {
    severity: 'attention',
    rule: {
      entity: ['User'],
      summaryStartsWith: ['Temporary password change failed', 'Reset password for', 'Revoked ', 'Deactivated', 'Deleted user', 'Updated user'],
    },
  },
  { severity: 'attention', rule: { entity: ['Role'] } },
  { severity: 'attention', rule: { action: ['RETURN'] } },
  { severity: 'attention', rule: { entity: ['Sale'], action: ['UPDATE'] } },
  { severity: 'attention', rule: { action: ['SHIFT_REVIEW'], summaryStartsWith: ['Discrepancy flagged'] } },
  { severity: 'attention', rule: { action: ['SHIFT_ADJUSTMENT'] } },
  { severity: 'attention', rule: { action: ['INVENTORY_CHANGE'], summaryStartsWith: ['Stock adjustment'] } },
  { severity: 'attention', rule: { entity: ['Product'], action: ['DELETE'] } },
  { severity: 'attention', rule: { action: ['SETTINGS_CHANGE'], summaryContains: SENSITIVE_SETTING_KEYS } },
  { severity: 'attention', rule: { entity: ['Branch'], summaryStartsWith: ['Archived branch'] } },
];

export interface ClassifiableEntry {
  action: AuditAction;
  entity: string;
  summary: string;
  changes?: unknown;
}

function attemptOf(changes: unknown): number | null {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return null;
  const attempt = (changes as Record<string, unknown>).attempt;
  return typeof attempt === 'number' && Number.isFinite(attempt) ? attempt : null;
}

export function matchesRule(entry: ClassifiableEntry, rule: AuditRule): boolean {
  if (rule.action && !rule.action.includes(entry.action)) return false;
  if (rule.entity && !rule.entity.includes(entry.entity)) return false;
  if (rule.summaryStartsWith && !rule.summaryStartsWith.some((prefix) => entry.summary.startsWith(prefix))) return false;
  if (rule.summaryContains && !rule.summaryContains.some((part) => entry.summary.includes(part))) return false;
  if (rule.minAttempt !== undefined && !((attemptOf(entry.changes) ?? -Infinity) >= rule.minAttempt)) return false;
  return true;
}

export function classifyAudit(entry: ClassifiableEntry): { category: AuditCategory; severity: AuditSeverity } {
  const category = CATEGORY_RULES.find(({ rule }) => matchesRule(entry, rule))?.category ?? 'other';
  const severity = SEVERITY_RULES.find(({ rule }) => matchesRule(entry, rule))?.severity ?? 'normal';
  return { category, severity };
}

/** The same rule as a database condition. */
export function ruleWhere(rule: AuditRule): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (rule.action) and.push({ action: { in: rule.action } });
  if (rule.entity) and.push({ entity: { in: rule.entity } });
  if (rule.summaryStartsWith) and.push({ OR: rule.summaryStartsWith.map((prefix) => ({ summary: { startsWith: prefix } })) });
  if (rule.summaryContains) and.push({ OR: rule.summaryContains.map((part) => ({ summary: { contains: part } })) });
  if (rule.minAttempt !== undefined) and.push({ changes: { path: ['attempt'], gte: rule.minAttempt } });
  return { AND: and };
}

/**
 * Entries whose first matching rule is in `wanted`: each wanted rule, minus
 * every earlier rule that leads elsewhere. Earlier rules never use
 * `minAttempt` against a row without `changes` in a way that turns NULL into a
 * wrong exclusion: that condition is always paired with the LOGIN_FAILED
 * action, which every such row carries `changes` for.
 */
function firstMatchWhere<K extends string>(
  rules: { key: K; rule: AuditRule }[],
  wanted: (key: K) => boolean,
): Prisma.AuditLogWhereInput {
  const branches: Prisma.AuditLogWhereInput[] = [];
  rules.forEach(({ key, rule }, index) => {
    if (!wanted(key)) return;
    const earlier = rules.slice(0, index).filter((other) => !wanted(other.key));
    branches.push(
      earlier.length === 0 ? ruleWhere(rule) : { AND: [ruleWhere(rule), { NOT: { OR: earlier.map((other) => ruleWhere(other.rule)) } }] },
    );
  });
  return branches.length === 0 ? { id: { in: [] } } : { OR: branches };
}

export function categoryWhere(category: AuditCategory): Prisma.AuditLogWhereInput {
  const rules = CATEGORY_RULES.map(({ category: key, rule }) => ({ key, rule }));
  if (category === 'other') return { NOT: { OR: rules.map(({ rule }) => ruleWhere(rule)) } };
  return firstMatchWhere(rules, (key) => key === category);
}

export function severityWhere(severity: AuditSeverity): Prisma.AuditLogWhereInput {
  const rules = SEVERITY_RULES.map(({ severity: key, rule }) => ({ key, rule }));
  if (severity === 'normal') return { NOT: { OR: rules.map(({ rule }) => ruleWhere(rule)) } };
  return firstMatchWhere(rules, (key) => key === severity);
}

/** Older links used these category names. */
const LEGACY_CATEGORY: Record<string, AuditCategory> = { cash: 'cash', sales: 'sales', inventory: 'inventory', staff: 'staff', billing: 'billing', settings: 'settings' };

export function parseAuditCategory(value: unknown): AuditCategory | null {
  // Own keys only: "toString" and friends are not categories.
  if (typeof value !== 'string') return null;
  if (Object.hasOwn(AUDIT_CATEGORY_LABEL, value)) return value as AuditCategory;
  return Object.hasOwn(LEGACY_CATEGORY, value) ? LEGACY_CATEGORY[value] : null;
}

export function parseAuditSeverity(value: unknown): AuditSeverity | null {
  return typeof value === 'string' && Object.hasOwn(AUDIT_SEVERITY_LABEL, value) ? (value as AuditSeverity) : null;
}

/** "Sale", "RETURN" → readable words for the action column. */
export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: 'Sign-in',
  LOGOUT: 'Sign-out',
  LOGIN_FAILED: 'Failed sign-in',
  CREATE: 'Created',
  UPDATE: 'Changed',
  DELETE: 'Deleted',
  INVENTORY_CHANGE: 'Stock',
  PRICE_CHANGE: 'Price',
  SALE: 'Sale',
  RETURN: 'Refund',
  SETTINGS_CHANGE: 'Settings',
  EXPORT: 'Export',
  SHIFT_OPEN: 'Shift opened',
  SHIFT_CLOSE: 'Shift closed',
  CASH_MOVEMENT: 'Cash',
  SHIFT_REVIEW: 'Shift review',
  SHIFT_ADJUSTMENT: 'Shift adjustment',
  SUBSCRIPTION: 'Subscription',
  PAYMENT: 'Payment',
};

/** Actions whose label or category name contains the search, so "refund" finds refunds. */
export function actionsMatchingSearch(search: string): AuditAction[] {
  const term = search.trim().toLowerCase();
  if (term.length < 3) return [];
  return (Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]).filter((action) => AUDIT_ACTION_LABEL[action].toLowerCase().includes(term));
}

export function categoriesMatchingSearch(search: string): AuditCategory[] {
  const term = search.trim().toLowerCase();
  if (term.length < 3) return [];
  return AUDIT_CATEGORY_ORDER.filter((category) => category !== 'other' && AUDIT_CATEGORY_LABEL[category].toLowerCase().includes(term));
}

// ---------------------------------------------------------------------------
// Related records and masking
// ---------------------------------------------------------------------------

/** Where an entry's record can be opened, when it has a page of its own. */
export function relatedLink(entry: { action: AuditAction; entity: string; entityId: string | null }): { label: string; href: string } | null {
  const id = entry.entityId;
  switch (entry.entity) {
    case 'Sale':
      return id ? { label: 'Open sale', href: `/sales/${id}` } : null;
    case 'Return':
      return id ? { label: 'Open refund', href: `/returns/${id}` } : null;
    case 'CashierShift':
      return id ? { label: 'Open shift', href: `/shifts/${id}` } : null;
    case 'Product':
      return id && entry.action !== 'DELETE' ? { label: 'Open product', href: `/products/${id}` } : null;
    case 'Inventory':
      return id ? { label: 'Stock movements', href: `/inventory/movements?q=${encodeURIComponent(id)}` } : null;
    case 'Category':
      return { label: 'Categories', href: '/products/categories' };
    case 'User':
      return { label: 'Staff accounts', href: '/settings/users' };
    case 'Role':
      return { label: 'Roles', href: '/settings/roles' };
    case 'Branch':
    case 'Warehouse':
      return { label: 'Branches', href: '/settings/branches' };
    case 'Setting':
      return { label: 'Settings', href: '/settings' };
    case 'Store':
    case 'Invoice':
    case 'SubscriptionPayment':
    case 'Billing':
      return { label: 'Subscription', href: '/settings/subscription' };
    default:
      return null;
  }
}

export const MASKED = '•••• hidden';

/**
 * A copy of recorded details with secrets replaced, depth- and size-bounded.
 */
export function maskSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => maskSensitive(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      out[key] = isSensitiveKey(key) ? MASKED : maskSensitive(inner, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

/**
 * Field names whose values are never shown, at any depth. camelCase is split
 * into words first, so "pinHash" and "newPin" are hidden while "shipping"
 * and "footprint" are not.
 */
export function isSensitiveKey(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const joined = words.join('_');
  if (words.some((word) => ['pin', 'otp', 'cvv'].includes(word))) return true;
  return /pass|secret|token|hash|credential|api_key|private_key|card_number|gcash_number|account_number/.test(joined);
}

export interface ChangeRow {
  field: string;
  from?: unknown;
  to?: unknown;
  value?: unknown;
}

/**
 * Recorded details as rows: `{ field: { from, to } }` pairs become before /
 * after rows; anything else is shown as recorded. Nothing is filled in that
 * the entry did not record.
 */
export function changeRows(changes: unknown): ChangeRow[] {
  const masked = maskSensitive(changes);
  if (!masked || typeof masked !== 'object' || Array.isArray(masked)) {
    return masked === null || masked === undefined ? [] : [{ field: 'details', value: masked }];
  }
  return Object.entries(masked as Record<string, unknown>).map(([field, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'from' in value && 'to' in value) {
      const pair = value as { from: unknown; to: unknown };
      return { field, from: pair.from, to: pair.to };
    }
    return { field, value };
  });
}
