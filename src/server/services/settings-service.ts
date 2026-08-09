import 'server-only';

import { cache } from 'react';
import { prisma } from '@/lib/prisma';
import {
  SETTING_DEFAULTS as DEFAULTS,
  SETTING_DEFINITIONS,
  type SettingDefinition,
} from '@/lib/settings-definitions';

/**
 * Typed application settings.
 *
 * Defaults live in `@/lib/settings-definitions` so a fresh install works before
 * anyone opens the settings page, and so a missing row can never produce
 * `undefined` in a calculation.
 */

export { SETTING_DEFINITIONS };
export type { SettingDefinition };

export type SettingsMap = Map<string, string>;

/** All settings for one request, defaults merged in. Cached per request. */
export const getSettings = cache(async (): Promise<SettingsMap> => {
  const map = new Map(DEFAULTS);
  try {
    const rows = await prisma.setting.findMany({ where: { group: { not: 'counters' } } });
    for (const row of rows) map.set(row.key, row.value);
  } catch (error) {
    // Settings must never take the whole app down; defaults are viable.
    console.error('[settings] falling back to defaults', error);
  }
  return map;
});

export function readString(settings: SettingsMap, key: string): string {
  return settings.get(key) ?? DEFAULTS.get(key) ?? '';
}

export function readNumber(settings: SettingsMap, key: string): number {
  const parsed = Number(settings.get(key) ?? DEFAULTS.get(key));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readBoolean(settings: SettingsMap, key: string): boolean {
  return (settings.get(key) ?? DEFAULTS.get(key)) === 'true';
}

/** Convenience for the many call sites that only need the currency code. */
export async function getCurrency(): Promise<string> {
  return readString(await getSettings(), 'locale.currency') || 'PHP';
}

export interface CompanyProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxNumber: string;
  receiptFooter: string;
  currency: string;
}

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const settings = await getSettings();
  return {
    name: readString(settings, 'company.name'),
    address: readString(settings, 'company.address'),
    phone: readString(settings, 'company.phone'),
    email: readString(settings, 'company.email'),
    taxNumber: readString(settings, 'company.taxNumber'),
    receiptFooter: readString(settings, 'pos.receiptFooter'),
    currency: readString(settings, 'locale.currency') || 'PHP',
  };
}
