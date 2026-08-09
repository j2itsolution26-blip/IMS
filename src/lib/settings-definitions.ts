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
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // Company — printed on receipts and report headers.
  { key: 'company.name', value: 'My Company', type: 'STRING', group: 'company', label: 'Company name', description: 'Shown on receipts, invoices, and exported reports.' },
  { key: 'company.address', value: '', type: 'STRING', group: 'company', label: 'Address', description: 'Printed under the company name on receipts.' },
  { key: 'company.phone', value: '', type: 'STRING', group: 'company', label: 'Phone', description: 'Contact number printed on receipts.' },
  { key: 'company.email', value: '', type: 'STRING', group: 'company', label: 'Email', description: 'Contact email printed on receipts.' },
  { key: 'company.taxNumber', value: '', type: 'STRING', group: 'company', label: 'Tax / VAT number', description: 'Tax registration number for invoices.' },

  // Regional.
  { key: 'locale.currency', value: 'PHP', type: 'STRING', group: 'regional', label: 'Currency code', description: 'ISO 4217 code used to format every monetary value.' },

  // Inventory behaviour — these feed the analytics engine directly.
  { key: 'inventory.allowNegativeStock', value: 'false', type: 'BOOLEAN', group: 'inventory', label: 'Allow negative stock', description: 'When off, a sale or transfer that would take stock below zero is rejected.' },
  { key: 'inventory.criticalStockRatio', value: '0.5', type: 'NUMBER', group: 'inventory', label: 'Critical stock ratio', description: 'Stock at or below this fraction of the reorder level is flagged critical.' },
  { key: 'inventory.slowMovingDays', value: '14', type: 'NUMBER', group: 'inventory', label: 'Slow-moving threshold (days)', description: 'Stocked products with no sale in this many days count as slow moving.' },
  { key: 'inventory.deadStockDays', value: '30', type: 'NUMBER', group: 'inventory', label: 'Dead-stock threshold (days)', description: 'Stocked products with no sale in this many days count as dead stock.' },
  { key: 'inventory.forecastWindowDays', value: '30', type: 'NUMBER', group: 'inventory', label: 'Depletion forecast window (days)', description: 'Sales history window used to project how long remaining stock will last.' },

  // Sales.
  { key: 'sales.defaultTaxRate', value: '0', type: 'NUMBER', group: 'sales', label: 'Default tax rate (%)', description: 'Applied to new products that do not specify their own rate.' },
  { key: 'sales.largeSaleThreshold', value: '10000', type: 'NUMBER', group: 'sales', label: 'Large sale alert threshold', description: 'Completed sales at or above this total raise a notification.' },
  { key: 'pos.receiptFooter', value: 'Thank you for your business!', type: 'STRING', group: 'sales', label: 'Receipt footer', description: 'Message printed at the bottom of every receipt.' },
];

export const SETTING_DEFAULTS = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d.value]));
