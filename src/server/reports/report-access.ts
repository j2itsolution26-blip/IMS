import { FINANCIAL_PERMISSION, type PermissionKey } from '@/lib/permissions';

/**
 * Who may open a report, and which of its columns they may see. Kept free of
 * database imports so the rules are unit-tested directly; the registry, the
 * report page and the export route all go through these two functions.
 */

export interface PermissionHolder {
  permissions: { has: (key: PermissionKey) => boolean };
}

export interface ReportAccessRule {
  permission: PermissionKey;
  /** Revenue, takings or profit: also needs the owner's financial permission. */
  financial?: boolean;
  /** Cost- or money-based columns removed for viewers without that permission. */
  costColumns?: string[];
}

export interface TabularResult {
  columns: { key: string }[];
  rows: Record<string, unknown>[];
}

export function canOpenReport(user: PermissionHolder, report: ReportAccessRule): boolean {
  if (!user.permissions.has(report.permission)) return false;
  return !report.financial || user.permissions.has(FINANCIAL_PERMISSION);
}

export function visibleReportResult<T extends TabularResult>(user: PermissionHolder, report: ReportAccessRule, result: T): T {
  if (!report.costColumns?.length || user.permissions.has(FINANCIAL_PERMISSION)) return result;
  const hidden = new Set(report.costColumns);
  return {
    ...result,
    columns: result.columns.filter((column) => !hidden.has(column.key)),
    rows: result.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.has(key)))),
  };
}
