import 'server-only';

import { AppError, ValidationError } from '@/lib/errors';
import { isBackgroundRemovalConfigured } from '@/lib/env';
import { describeRemoveBgFailure, resolveRemoveBgSize } from '@/server/services/remove-bg-response';

/**
 * Product photo background removal through remove.bg.
 *
 * The API key is read here, on the server, and never leaves it — the browser
 * sends the photo to a server action, which forwards it. Nothing is stored:
 * the cut-out goes back to the browser for review, and only reaches product
 * storage if the user chooses to save it.
 */

const ENDPOINT = 'https://api.remove.bg/v1.0/removebg';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TIMEOUT_MS = 30_000;

export interface BackgroundRemovalResult {
  bytes: Buffer;
  contentType: 'image/png';
}

export async function removeProductBackground(file: File): Promise<BackgroundRemovalResult> {
  if (!isBackgroundRemovalConfigured()) {
    throw new AppError(
      'Background removal is not set up. Add REMOVE_BG_API_KEY to the server environment and redeploy.',
      'BACKGROUND_REMOVAL_NOT_CONFIGURED',
      503,
    );
  }

  if (file.size === 0) throw new ValidationError('The selected photo is empty.');
  if (file.size > MAX_BYTES) throw new ValidationError('Photo must be 5 MB or smaller.');
  if (!ALLOWED_MIME.has(file.type)) {
    throw new ValidationError(`Photo must be a JPG, PNG, or WEBP file${file.type ? ` (received ${file.type})` : ''}.`);
  }

  const form = new FormData();
  form.append('image_file', new Blob([await file.arrayBuffer()], { type: file.type }), 'photo');
  form.append('size', resolveRemoveBgSize(process.env.REMOVE_BG_SIZE));
  // Tuned for objects on a counter rather than people, and asked for PNG
  // explicitly — JPG output would bring back a solid background.
  form.append('type', 'product');
  form.append('format', 'png');

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY!.trim() },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error('[background-removal] request failed', error);
    throw new AppError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Background removal took too long. Try again, or use the original photo.'
        : 'Could not reach the background-removal service. Check the connection and try again.',
      'BACKGROUND_REMOVAL_UNREACHABLE',
      502,
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    console.error('[background-removal] rejected', { status: response.status, body });
    throw new AppError(describeRemoveBgFailure(response.status, body), 'BACKGROUND_REMOVAL_FAILED', 502);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/png')) {
    console.error('[background-removal] unexpected response type', contentType);
    throw new AppError('The background-removal service returned an unexpected result.', 'BACKGROUND_REMOVAL_FAILED', 502);
  }

  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: 'image/png' };
}
