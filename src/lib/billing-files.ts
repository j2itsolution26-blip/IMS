import { detectImageType, safeAttachmentName, SUPPORT_IMAGE_TYPES, type SupportImageType } from './support-files';

/**
 * Checks for billing images: an owner's payment receipt and the GCash QR code
 * the administrator uploads. Pure, so they are unit-tested.
 *
 * The type is read from the file's own first bytes; the name and the type the
 * browser reports are never trusted. Raster images only (JPEG, PNG, WebP): a
 * GCash receipt is a screenshot, and SVG or PDF can carry script.
 */

export const BILLING_IMAGE_TYPES = SUPPORT_IMAGE_TYPES;
export type BillingImageType = SupportImageType;
export const BILLING_IMAGE_ACCEPT = Object.keys(BILLING_IMAGE_TYPES).join(',');

/** Server actions accept 6 MB (next.config.ts); a receipt stays inside it. */
export const RECEIPT_MAX_BYTES_CEILING = 5 * 1024 * 1024;
const RECEIPT_MAX_BYTES_FLOOR = 100 * 1024;
export const QR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * The receipt size limit: BILLING_RECEIPT_MAX_BYTES when it is a sensible
 * number, otherwise 5 MB. Never above 5 MB, which the request limit allows.
 */
export function receiptMaxBytes(raw: string | undefined = process.env.BILLING_RECEIPT_MAX_BYTES): number {
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value <= 0) return RECEIPT_MAX_BYTES_CEILING;
  return Math.min(RECEIPT_MAX_BYTES_CEILING, Math.max(RECEIPT_MAX_BYTES_FLOOR, value));
}

export const formatMegabytes = (bytes: number) => `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;

/** Size checks before any byte is read. Returns a message, or null when acceptable. */
export function checkImageSize(size: number, maxBytes: number, what = 'The receipt'): string | null {
  if (!Number.isFinite(size) || size <= 0) return `${what} file is empty.`;
  if (size > maxBytes) return `${what} must be ${formatMegabytes(maxBytes)} or smaller.`;
  return null;
}

export type ImageCheck =
  | { ok: true; type: BillingImageType; name: string }
  | { ok: false; message: string };

/** The full check on the bytes themselves: size, then the real type. */
export function checkBillingImage(bytes: Uint8Array, originalName: string, maxBytes: number, what = 'The receipt'): ImageCheck {
  const size = checkImageSize(bytes.byteLength, maxBytes, what);
  if (size) return { ok: false, message: size };
  const type = detectImageType(bytes);
  if (!type) return { ok: false, message: `${what} must be a JPG, PNG or WEBP image.` };
  return { ok: true, type, name: safeAttachmentName(originalName, type) };
}

/** Paths inside the private billing bucket. Random names, never the uploaded ones. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export function receiptFolder(storeId: string): string {
  if (!SAFE_ID.test(storeId)) throw new Error('A valid store id is required for a receipt path.');
  return `receipts/${storeId}/`;
}

/** Whether `path` is a receipt of this store: the only paths a receipt row may point at. */
export function isReceiptPathOf(path: string, storeId: string): boolean {
  if (!SAFE_ID.test(storeId) || !path.startsWith(`receipts/${storeId}/`)) return false;
  return UUID_FILE.test(path.slice(`receipts/${storeId}/`.length));
}

/** Whether `path` is a QR code image: the only paths a payment account may point at. */
export function isQrPath(path: string): boolean {
  return path.startsWith('qr/') && UUID_FILE.test(path.slice(3));
}
