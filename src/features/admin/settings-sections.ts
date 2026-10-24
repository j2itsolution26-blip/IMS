import {
  Boxes,
  Globe,
  type LucideIcon,
  ReceiptText,
  ShieldCheck,
  Store,
  Wallet,
} from 'lucide-react';
import { DEFAULT_LOCALE } from '@/lib/format';

/**
 * How the settings form lays out the catalogue in `@/lib/settings-definitions`.
 *
 * Presentation only — keys, types, defaults and limits stay in the catalogue.
 * A setting that is not placed here still appears, in a fallback card for its
 * group, so adding a setting never requires touching this file.
 */

export interface FieldLayout {
  key: string;
  /** Replaces the catalogue label where a unit is shown beside the input instead. */
  label?: string;
  /** Spans both columns on wide screens. */
  full?: boolean;
  /** Caps the input width so short values do not sit in a long field. */
  width?: 'short' | 'medium';
  /** `currency` is the saved currency symbol, e.g. ₱. */
  prefix?: 'currency';
  suffix?: string;
  inputType?: 'text' | 'tel' | 'url';
  autoComplete?: string;
  placeholder?: string;
  /** Upper-cases as the user types (currency codes). */
  uppercase?: boolean;
  /** Shows a live "12 / 300" counter for long free text. */
  counter?: boolean;
}

export interface SectionLayout {
  id: string;
  group: string;
  title: string;
  description: string;
  icon: LucideIcon;
  fields: FieldLayout[];
}

export const SETTINGS_SECTIONS: SectionLayout[] = [
  {
    id: 'store',
    group: 'company',
    title: 'Store Information',
    description: 'Printed on receipts, used as headers on exported reports, and shown to the cashier at checkout.',
    icon: Store,
    fields: [
      { key: 'company.name', autoComplete: 'organization' },
      { key: 'company.phone', inputType: 'tel', autoComplete: 'tel', width: 'medium' },
      { key: 'company.address', full: true, autoComplete: 'street-address' },
      { key: 'company.logoUrl', full: true, inputType: 'url', placeholder: 'https://' },
      { key: 'company.gcashNumber', inputType: 'tel', width: 'medium', placeholder: '09XX XXX XXXX' },
      { key: 'company.gcashName' },
    ],
  },
  {
    id: 'regional',
    group: 'regional',
    title: 'Regional Settings',
    description: 'How money is formatted throughout the application.',
    icon: Globe,
    fields: [{ key: 'locale.currency', width: 'short', uppercase: true, placeholder: 'PHP' }],
  },
  {
    id: 'inventory',
    group: 'inventory',
    title: 'Inventory',
    description: 'These thresholds decide what counts as low, critical, slow moving, and dead stock.',
    icon: Boxes,
    fields: [
      { key: 'inventory.allowNegativeStock' },
      { key: 'inventory.defaultLowStockLevel', width: 'short', suffix: 'units' },
      { key: 'inventory.criticalStockRatio', width: 'short' },
      { key: 'inventory.slowMovingDays', label: 'Slow-moving threshold', width: 'short', suffix: 'days' },
      { key: 'inventory.deadStockDays', label: 'Dead-stock threshold', width: 'short', suffix: 'days' },
      { key: 'inventory.forecastWindowDays', label: 'Depletion forecast window', width: 'short', suffix: 'days' },
    ],
  },
  {
    id: 'sales',
    group: 'sales',
    title: 'Sales & POS',
    description: 'Defaults applied at the till.',
    icon: ReceiptText,
    fields: [
      { key: 'sales.defaultTaxRate', label: 'Tax rate', width: 'short', suffix: '%' },
      { key: 'pos.suggestedOpeningCash', label: 'Suggested starting cash', width: 'short', prefix: 'currency' },
      { key: 'pos.receiptFooter', full: true, counter: true },
    ],
  },
  {
    id: 'shifts',
    group: 'shifts',
    title: 'Shifts & Cash Drawer',
    description: 'When a drawer count is flagged for your review, and when an open shift counts as left open.',
    icon: Wallet,
    fields: [
      { key: 'shifts.varianceTolerance', label: 'Variance tolerance', width: 'short', prefix: 'currency' },
      { key: 'shifts.overdueHours', label: 'Flag shifts open longer than', width: 'short', suffix: 'hours' },
    ],
  },
  {
    id: 'security',
    group: 'security',
    title: 'Security',
    description: 'Screen locking for shared counter devices. Signing out is always manual.',
    icon: ShieldCheck,
    fields: [{ key: 'security.autoLockMinutes', label: 'Auto-lock screen after', width: 'short', suffix: 'minutes' }],
  },
];

/** The keys whose draft differs from the saved value. */
export function changedKeys(draft: Record<string, string>, saved: Record<string, string>): string[] {
  return Object.keys(draft).filter((key) => draft[key] !== saved[key]);
}

/** The symbol a currency is written with, e.g. ₱ for PHP; the code itself if unknown. */
export function currencySymbol(code: string, locale = DEFAULT_LOCALE): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: code }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}
