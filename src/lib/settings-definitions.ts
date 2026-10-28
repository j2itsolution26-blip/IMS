import type { SettingType } from '@prisma/client';

/**
 * Default application settings.
 *
 * Kept out of the service layer (which is `server-only`) so the bootstrap
 * script can import it from a plain Node process.
 */

export interface SettingDefinition {
  key: string;
  value: string;
  type: SettingType;
  group: string;
  label: string;
  description: string;
  /**
   * Limits enforced by `settingProblem` on save (server and client alike).
   * Omitted keys accept any value of the declared type.
   */
  rules?: SettingRules;
}

export interface SettingRules {
  /** Rejects an empty value. NUMBER settings are always required. */
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  /** Whole-value pattern, with the message shown when it does not match. */
  pattern?: { source: string; message: string };
  /** Only http(s) URLs, so a stored link can never run script. */
  url?: boolean;
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // Company — printed on receipts and report headers.
  { key: 'company.name', value: 'My Store', type: 'STRING', group: 'company', label: 'Store name', description: 'Shown on receipts, reports, and the sidebar.', rules: { required: true, maxLength: 120 } },
  { key: 'company.address', value: '', type: 'STRING', group: 'company', label: 'Address', description: 'Printed under the store name on receipts.', rules: { maxLength: 300 } },
  { key: 'company.phone', value: '', type: 'STRING', group: 'company', label: 'Contact number', description: 'Contact number printed on receipts.', rules: { maxLength: 40 } },
  { key: 'company.logoUrl', value: '', type: 'STRING', group: 'company', label: 'Store logo', description: 'Saved with your store information.', rules: { maxLength: 2000, url: true } },
  { key: 'company.gcashNumber', value: '', type: 'STRING', group: 'company', label: 'GCash number', description: 'Shown to the cashier at checkout so the customer knows where to send a GCash payment.', rules: { maxLength: 40 } },
  { key: 'company.gcashName', value: '', type: 'STRING', group: 'company', label: 'GCash account name', description: 'The name registered to that GCash number.', rules: { maxLength: 120 } },

  // Regional.
  { key: 'locale.currency', value: 'PHP', type: 'STRING', group: 'regional', label: 'Currency code', description: 'ISO 4217 code used to format every monetary value.', rules: { required: true, pattern: { source: '^[A-Z]{3}$', message: 'Use a three-letter ISO 4217 code, such as PHP.' } } },

  // Inventory behaviour — these feed the analytics engine directly.
  { key: 'inventory.allowNegativeStock', value: 'false', type: 'BOOLEAN', group: 'inventory', label: 'Allow negative stock', description: 'When off, a sale that would take stock below zero is rejected.' },
  { key: 'inventory.defaultLowStockLevel', value: '10', type: 'NUMBER', group: 'inventory', label: 'Default low-stock level', description: 'Used as the starting low-stock level for new products.', rules: { min: 0, max: 1_000_000, integer: true } },
  { key: 'inventory.criticalStockRatio', value: '0.5', type: 'NUMBER', group: 'inventory', label: 'Critical stock ratio', description: 'Stock at or below this fraction of the low-stock level is flagged critical.', rules: { min: 0, max: 1 } },
  { key: 'inventory.slowMovingDays', value: '14', type: 'NUMBER', group: 'inventory', label: 'Slow-moving threshold (days)', description: 'Stocked products with no sale in this many days count as slow moving.', rules: { min: 1, max: 3650, integer: true } },
  { key: 'inventory.deadStockDays', value: '30', type: 'NUMBER', group: 'inventory', label: 'Dead-stock threshold (days)', description: 'Stocked products with no sale in this many days count as dead stock.', rules: { min: 1, max: 3650, integer: true } },
  { key: 'inventory.forecastWindowDays', value: '30', type: 'NUMBER', group: 'inventory', label: 'Depletion forecast window (days)', description: 'Sales history window used to project how long remaining stock will last.', rules: { min: 1, max: 365, integer: true } },

  // Sales.
  { key: 'sales.defaultTaxRate', value: '0', type: 'NUMBER', group: 'sales', label: 'Tax rate (%)', description: 'Applied to the subtotal of every sale. Set to 0 to disable tax.', rules: { min: 0, max: 100 } },
  { key: 'pos.receiptFooter', value: 'Thank you for your business!', type: 'STRING', group: 'sales', label: 'Receipt footer', description: 'Message printed at the bottom of every receipt.', rules: { maxLength: 300 } },
  { key: 'pos.gcashServices', value: 'false', type: 'BOOLEAN', group: 'sales', label: 'GCash cash-in / cash-out services', description: 'Lets cashiers record GCash cash-in and cash-out for customers, with your service fee, from the POS. These are kept apart from product sales; only the fee is revenue.' },
  { key: 'pos.suggestedOpeningCash', value: '1000', type: 'NUMBER', group: 'sales', label: 'Suggested starting cash (₱)', description: 'Shown as a hint when a cashier opens a shift. The cashier still enters the cash they actually counted. 0 hides the hint.', rules: { min: 0, max: 10_000_000 } },

  // Shifts — when a drawer count needs the owner's review, and when an open
  // shift is flagged as left open.
  { key: 'shifts.varianceTolerance', value: '0', type: 'NUMBER', group: 'shifts', label: 'Variance tolerance (₱)', description: 'A closed shift that counts short or over by more than this needs your review. 0 flags every peso.', rules: { min: 0, max: 10_000_000 } },
  { key: 'shifts.overdueHours', value: '0', type: 'NUMBER', group: 'shifts', label: 'Flag shifts open longer than (hours)', description: 'Notifies you when a shift has been open this long. 0 turns the notice off.', rules: { min: 0, max: 720 } },

  // Security. Auto-lock is off by default: the counter must be ready for the
  // next customer, and the cashier can lock the screen by hand at any time.
  { key: 'security.autoLockMinutes', value: '0', type: 'NUMBER', group: 'security', label: 'Auto-lock screen after (minutes)', description: 'Locks the screen after this many minutes without use. The cashier stays signed in and unlocks with their PIN or password. 0 turns auto-lock off.', rules: { min: 0, max: 1440, integer: true } },
];

/**
 * Why `value` is not acceptable for `definition`, or null when it is. Pure and
 * shared, so the settings form and `updateSettings` apply the same rules.
 * The value is checked as it would be stored, trimmed.
 */
export function settingProblem(definition: SettingDefinition, rawValue: string): string | null {
  const value = rawValue.trim();
  const rules = definition.rules ?? {};

  if (definition.type === 'BOOLEAN') {
    return value === 'true' || value === 'false' ? null : 'Choose on or off.';
  }

  if (definition.type === 'NUMBER') {
    if (value === '') return 'Enter a number.';
    const number = Number(value);
    if (!Number.isFinite(number)) return 'Enter a number.';
    if (rules.integer && !Number.isInteger(number)) return 'Enter a whole number.';
    if (rules.min !== undefined && number < rules.min) return `Must be ${rules.min} or more.`;
    if (rules.max !== undefined && number > rules.max) return `Must be ${rules.max.toLocaleString('en-US')} or less.`;
    return null;
  }

  if (value === '') return rules.required ? 'This field is required.' : null;
  if (rules.maxLength !== undefined && value.length > rules.maxLength) {
    return `Use ${rules.maxLength} characters or fewer.`;
  }
  if (rules.pattern && !new RegExp(rules.pattern.source).test(value)) return rules.pattern.message;
  if (rules.url) {
    let protocol = '';
    try {
      protocol = new URL(value).protocol;
    } catch {
      // Falls through to the message below.
    }
    if (protocol !== 'https:' && protocol !== 'http:') return 'Enter a web address starting with https://.';
  }
  return null;
}

/** The database columns of a definition — `rules` is code, never stored. */
export function settingRow(definition: SettingDefinition) {
  const { key, value, type, group, label, description } = definition;
  return { key, value, type, group, label, description };
}

export const SETTING_DEFAULTS = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d.value]));
