/**
 * Validation for externally-hosted product image URLs.
 *
 * Pure and dependency-free so the same rule runs in the browser (live feedback
 * while typing) and on the server (the authority). A client-only check would be
 * trivially bypassed by posting the form directly.
 *
 * The rule is deliberately "does this address point at an image file", not
 * "does this look like a link". Pasting a *page* that happens to show an image
 * is the mistake people actually make — a Google results page, a Pinterest pin,
 * an Amazon listing. None of those are images, and all of them render as a
 * broken icon.
 */

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'] as const;

export const SUPPORTED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_URL_MESSAGE =
  'Please enter a direct image URL ending in an image file (.jpg, .png, .webp) or use Upload image.';

export type ImageUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/** True for a Supabase Storage public object URL, which has no file extension in some setups. */
function isStorageObjectUrl(url: URL): boolean {
  return url.pathname.includes('/storage/v1/object/public/');
}

export function validateImageUrl(raw: string | null | undefined): ImageUrlResult {
  const value = (raw ?? '').trim();

  // An empty field is valid — the image is simply optional.
  if (value === '') return { ok: true, url: '' };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'That is not a valid web address. It must start with https://' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Image URLs must start with https://' };
  }

  // Storage objects are trusted without an extension check.
  if (isStorageObjectUrl(url)) return { ok: true, url: value };

  // A search or listing page is the common mistake. Naming it explicitly is
  // more useful than "invalid URL", because the user believes they copied an
  // image — they copied the page that was displaying one.
  const path = url.pathname.toLowerCase();
  const looksLikeSearch =
    path === '/search' ||
    path.startsWith('/search/') ||
    url.searchParams.has('q') ||
    url.searchParams.has('query') ||
    url.searchParams.has('search_query');

  if (looksLikeSearch) {
    return {
      ok: false,
      reason:
        'That is a search results page, not an image. Open the image itself, copy its direct address, or use Upload image.',
    };
  }

  const hasImageExtension = IMAGE_EXTENSIONS.some((extension) => path.endsWith(extension));
  if (!hasImageExtension) {
    return { ok: false, reason: IMAGE_URL_MESSAGE };
  }

  return { ok: true, url: value };
}

/** Convenience for Zod `superRefine` and other boolean call sites. */
export function isValidImageUrl(raw: string | null | undefined): boolean {
  return validateImageUrl(raw).ok;
}
