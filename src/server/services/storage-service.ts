import 'server-only';

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl, isStorageConfigured } from '@/lib/env';
import { AppError, ValidationError } from '@/lib/errors';

/**
 * Supabase Storage wrapper for product images.
 *
 * Uploads go through the service-role key on the server so the bucket can stay
 * write-protected from the browser; reads use the public URL.
 */

const MAX_BYTES = 5 * 1024 * 1024;
// Exactly the formats the UI advertises. SVG is deliberately excluded: it can
// carry script, and it is never needed for a product photograph.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!isStorageConfigured()) {
    throw new AppError(
      'Image storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      'STORAGE_NOT_CONFIGURED',
      503,
    );
  }
  if (!client) {
    client = createClient(
      getSupabaseUrl()!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return client;
}

const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || 'product-images';

export async function uploadProductImage(file: File, productSku: string): Promise<string> {
  if (file.size === 0) throw new ValidationError('The selected file is empty.', { image: ['File is empty.'] });
  if (file.size > MAX_BYTES) {
    throw new ValidationError('Image must be 5 MB or smaller.', { image: ['Image must be 5 MB or smaller.'] });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new ValidationError('Image must be a JPG, PNG, or WEBP file.', {
      image: ['Unsupported image format.'],
    });
  }

  const supabase = getClient();
  const extension = EXTENSION_BY_MIME[file.type];
  const safeSku = productSku.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase().slice(0, 40);

  // A UUID rather than a timestamp: two uploads for the same SKU inside the
  // same millisecond would otherwise collide, and `upsert: false` would reject
  // the second one. The SKU is kept only as a human-readable prefix — never as
  // the sole filename, so a user-supplied name can never determine the path.
  const path = `products/${safeSku}-${randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(bucket())
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });

  if (error) {
    throw new AppError(`Image upload failed: ${error.message}`, 'STORAGE_UPLOAD_FAILED', 502);
  }

  const { data } = supabase.storage.from(bucket()).getPublicUrl(path);
  return data.publicUrl;
}

export type DeleteImageResult =
  | { status: 'deleted'; path: string }
  /** Not a storage object — an externally hosted URL we do not own. */
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; path: string; error: string };

/**
 * Removes a previously uploaded image.
 *
 * Returns a result rather than throwing, and never reports success it did not
 * achieve. Callers delete an old image *after* the replacement has been saved,
 * so a failure here must not roll back the user's work — but it must also not
 * be swallowed, or orphaned objects accumulate invisibly. The outcome is
 * logged with the path so it can be cleaned up.
 *
 * Note the public URL may keep serving a cached copy through Supabase's CDN
 * for a while after the object is gone. That is harmless here because uploads
 * are UUID-named, so a replacement never reuses the old URL.
 */
export async function deleteProductImage(publicUrl: string): Promise<DeleteImageResult> {
  if (!publicUrl) return { status: 'skipped', reason: 'no image to remove' };
  if (!isStorageConfigured()) return { status: 'skipped', reason: 'storage not configured' };

  const marker = `/object/public/${bucket()}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) {
    // An externally hosted image. Clearing the product's reference is all we
    // can do — the file is not ours to delete.
    return { status: 'skipped', reason: 'externally hosted image' };
  }

  const path = decodeURIComponent(publicUrl.slice(index + marker.length));
  const { error } = await getClient().storage.from(bucket()).remove([path]);

  if (error) {
    console.error(`[storage] FAILED to remove "${path}": ${error.message} — object is now orphaned`);
    return { status: 'failed', path, error: error.message };
  }

  return { status: 'deleted', path };
}

export { isStorageConfigured };
