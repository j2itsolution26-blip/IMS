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
  { key: 'company.name', value: 'My Store', type: 'STRING', group: 'company', label: 'Store name', description: 'Shown on receipts, reports, and the sidebar.' },
  { key: 'company.address', value: '', type: 'STRING', group: 'company', label: 'Address', description: 'Printed under the store name on receipts.' },
  { key: 'company.phone', value: '', type: 'STRING', group: 'company', label: 'Contact number', description: 'Contact number printed on receipts.' },
  { key: 'company.logoUrl', value: '', type: 'STRING', group: 'company', label: 'Store logo', description: 'Shown on receipts and the sidebar.' },

  // Regional.
  { key: 'locale.currency', value: 'PHP', type: 'STRING', group: 'regional', label: 'Currency code', description: 'ISO 4217 code used to format every monetary value.' },

  // Inventory behaviour — these feed the analytics engine directly.
  { key: 'inventory.allowNegativeStock', value: 'false', type: 'BOOLEAN', group: 'inventory', label: 'Allow negative stock', description: 'When off, a sale that would take stock below zero is rejected.' },
  { key: 'inventory.defaultLowStockLevel', value: '10', type: 'NUMBER', group: 'inventory', label: 'Default low-stock level', description: 'Used as the starting low-stock level for new products.' },
  { key: 'inventory.criticalStockRatio', value: '0.5', type: 'NUMBER', group: 'inventory', label: 'Critical stock ratio', description: 'Stock at or below this fraction of the low-stock level is flagged critical.' },
  { key: 'inventory.slowMovingDays', value: '14', type: 'NUMBER', group: 'inventory', label: 'Slow-moving threshold (days)', description: 'Stocked products with no sale in this many days count as slow moving.' },
  { key: 'inventory.deadStockDays', value: '30', type: 'NUMBER', group: 'inventory', label: 'Dead-stock threshold (days)', description: 'Stocked products with no sale in this many days count as dead stock.' },
  { key: 'inventory.forecastWindowDays', value: '30', type: 'NUMBER', group: 'inventory', label: 'Depletion forecast window (days)', description: 'Sales history window used to project how long remaining stock will last.' },

  // Sales.
  { key: 'sales.defaultTaxRate', value: '0', type: 'NUMBER', group: 'sales', label: 'Tax rate (%)', description: 'Applied to the subtotal of every sale. Set to 0 to disable tax.' },
  { key: 'pos.receiptFooter', value: 'Thank you for your business!', type: 'STRING', group: 'sales', label: 'Receipt footer', description: 'Message printed at the bottom of every receipt.' },
];

export const SETTING_DEFAULTS = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d.value]));
