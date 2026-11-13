/**
 * Labels and guidance for the owner's offline sync review (/sales/offline).
 * Pure, so the page, the service and the tests read the same words.
 */

export type SyncIssueKindKey =
  | 'STOCK_SHORTFALL'
  | 'PRICE_MISMATCH'
  | 'TAX_RATE_MISMATCH'
  | 'TOTAL_MISMATCH'
  | 'PRODUCT_UNAVAILABLE'
  | 'CLOSED_SHIFT'
  | 'DEVICE_REVOKED';

export const SYNC_ISSUE_LABEL: Record<SyncIssueKindKey, string> = {
  STOCK_SHORTFALL: 'Stock went below zero',
  PRICE_MISMATCH: 'Sold at an old price',
  TAX_RATE_MISMATCH: 'Different tax rate',
  TOTAL_MISMATCH: 'Total differs',
  PRODUCT_UNAVAILABLE: 'Product no longer active',
  CLOSED_SHIFT: 'Arrived after the shift closed',
  DEVICE_REVOKED: 'From a removed device',
};

/** What the owner is asked to check before marking an issue resolved. */
export const SYNC_ISSUE_ACTION: Record<SyncIssueKindKey, string> = {
  STOCK_SHORTFALL: 'Count the product on the shelf and record a stock adjustment.',
  PRICE_MISMATCH: 'The customer paid the price the till showed. Decide whether to follow up; the sale stays as charged.',
  TAX_RATE_MISMATCH: 'The tax rate changed while the device was offline. The sale stays as charged.',
  TOTAL_MISMATCH: 'Compare the receipt with the items. The sale is recorded as charged.',
  PRODUCT_UNAVAILABLE: 'The product was archived after the device downloaded its list. Check the stock record.',
  CLOSED_SHIFT: 'Check that shift’s drawer count; the adjustment is listed in its report.',
  DEVICE_REVOKED: 'Find out who used the removed device. The money it took is recorded.',
};

export function syncIssueLabel(kind: string): string {
  return SYNC_ISSUE_LABEL[kind as SyncIssueKindKey] ?? kind;
}

export function syncIssueAction(kind: string): string {
  return SYNC_ISSUE_ACTION[kind as SyncIssueKindKey] ?? 'Check the sale and record what was done.';
}

/** A short, recognisable name for a device from its browser's user agent. */
export function deviceKind(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const os = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/i.test(ua)
            ? 'Mac'
            : /CrOS/i.test(ua)
              ? 'ChromeOS'
              : /Linux/i.test(ua)
                ? 'Linux'
                : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  if (os && browser) return `${browser} on ${os}`;
  return os ?? browser ?? 'Unknown browser';
}

export type DeviceState = 'active' | 'idle' | 'revoked';

/** A device unseen for this long is shown as idle: likely put away or reset. */
export const DEVICE_IDLE_DAYS = 14;

export function deviceState(device: { revokedAt: Date | null; lastSeenAt: Date | null }, now: Date): DeviceState {
  if (device.revokedAt) return 'revoked';
  if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > DEVICE_IDLE_DAYS * 86_400_000) return 'idle';
  return 'active';
}

/**
 * The four characters a device prints on its offline receipts
 * (OFF-3F2A-000012), so a paper receipt leads to the device that made it.
 */
export function deviceCode(deviceId: string): string {
  return deviceId.replace(/-/g, '').slice(0, 4).toUpperCase();
}
