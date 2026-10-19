/**
 * remove.bg request options and error translation.
 *
 * Kept apart from the service (which is `server-only` and does the network
 * call) so the mapping from API failure to shop-floor message is unit-tested.
 *
 * API reference: https://www.remove.bg/api
 */

/**
 * Output resolutions remove.bg offers, and what each costs:
 *   preview — up to 0.25 megapixels (e.g. 500×500). 0.25 credit; the first 50
 *             calls each month are free. Plenty for a product card or receipt.
 *   full    — up to 25 megapixels. 1 credit.
 *   auto    — the highest resolution the photo supports. Up to 1 credit.
 */
export const REMOVE_BG_SIZES = ['preview', 'full', 'auto'] as const;
export type RemoveBgSize = (typeof REMOVE_BG_SIZES)[number];

/** `REMOVE_BG_SIZE` from the environment, falling back to the cheap `preview`. */
export function resolveRemoveBgSize(raw: string | undefined): RemoveBgSize {
  const value = raw?.trim().toLowerCase();
  return (REMOVE_BG_SIZES as readonly string[]).includes(value ?? '') ? (value as RemoveBgSize) : 'preview';
}

interface RemoveBgErrorBody {
  errors?: { title?: string; code?: string; detail?: string }[];
}

/**
 * Turns a failed remove.bg response into a message the person holding the
 * phone can act on. Credential and billing problems are worded for whoever
 * runs the shop, since only they can fix them.
 */
export function describeRemoveBgFailure(status: number, body: unknown): string {
  const first = (body as RemoveBgErrorBody | null)?.errors?.[0];
  const code = first?.code ?? '';

  if (code === 'unknown_foreground' || (status === 400 && /foreground/i.test(first?.title ?? ''))) {
    return 'No product could be found in this photo. Retake it with the product filling more of the frame, against a plain background.';
  }
  if (status === 402 || code === 'insufficient_credits') {
    return 'The background-removal account has run out of credits. Ask the store owner to top it up at remove.bg, or use the original photo for now.';
  }
  if (status === 401 || status === 403 || code === 'auth_failed') {
    return 'Background removal is not set up correctly: the REMOVE_BG_API_KEY was rejected. Ask the store owner to check it.';
  }
  if (status === 429 || code === 'rate_limit_exceeded') {
    return 'Too many photos are being processed right now. Wait a moment and try again.';
  }
  if (status === 413 || code === 'file_too_large') {
    return 'This photo is too large to process. Try a smaller one.';
  }
  if (status >= 500) {
    return 'The background-removal service is having trouble right now. Try again in a moment, or use the original photo.';
  }
  return first?.title
    ? `The background could not be removed: ${first.title}`
    : 'The background could not be removed. Try again, or use the original photo.';
}
