/**
 * Screenshot checks for support attachments. Pure, so they are unit-tested.
 *
 * The type is read from the file's own first bytes; the name and the type the
 * browser reports are never trusted. Only raster screenshots are accepted:
 * no SVG (it can carry script), no PDF, no archives, nothing executable.
 */

export const SUPPORT_IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
export type SupportImageType = keyof typeof SUPPORT_IMAGE_TYPES;

/** Server actions accept 6 MB (next.config.ts); the files of one message stay inside it. */
export const SUPPORT_MAX_TOTAL_BYTES = 5 * 1024 * 1024;
export const SUPPORT_MAX_FILES = 3;
export const SUPPORT_MAX_FILES_PUBLIC = 1;

/** The image type the bytes actually are, or null for anything else. */
export function detectImageType(bytes: Uint8Array): SupportImageType | null {
  const starts = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);

  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  // RIFF....WEBP
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/**
 * A display name safe to show and to put in a download header: no path,
 * no control or quote characters, a bounded length, and the extension of the
 * detected type rather than whatever the uploader claimed.
 */
export function safeAttachmentName(name: string, type: SupportImageType): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .replace(/\.[^.]*$/, '')
    .replace(/[\u0000-\u001F\u007F"'<>`;:*?|%]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'screenshot'}.${SUPPORT_IMAGE_TYPES[type]}`;
}

export interface FileCheck {
  name: string;
  size: number;
}

/** Count and size limits, checked before any byte is read. Returns a message, or null when acceptable. */
export function checkAttachmentLimits(files: FileCheck[], maxFiles: number): string | null {
  if (files.length > maxFiles) {
    return maxFiles === 1 ? 'You can attach one screenshot.' : `You can attach up to ${maxFiles} screenshots.`;
  }
  if (files.some((file) => file.size <= 0)) return 'One of the files is empty.';
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > SUPPORT_MAX_TOTAL_BYTES) return 'Screenshots must be 5 MB or less in total.';
  return null;
}
