import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isStorageConfigured } from '@/lib/env';
import { AppError, ValidationError } from '@/lib/errors';

/**
 * Supabase Storage wrapper for product images.
 *
 * Uploads go through the service-role key on the server so the bucket can stay
 * write-protected from the browser; reads use the public URL.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
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
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
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
    throw new ValidationError('Image must be JPEG, PNG, WebP, or AVIF.', {
      image: ['Unsupported image format.'],
    });
  }

  const supabase = getClient();
  const extension = EXTENSION_BY_MIME[file.type];
  const safeSku = productSku.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();
  const path = `products/${safeSku}-${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(bucket())
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });

  if (error) {
    throw new AppError(`Image upload failed: ${error.message}`, 'STORAGE_UPLOAD_FAILED', 502);
  }

  const { data } = supabase.storage.from(bucket()).getPublicUrl(path);
  return data.publicUrl;
}

/** Best-effort cleanup — a stale object costs pennies, a failed save costs the user their work. */
export async function deleteProductImage(publicUrl: string): Promise<void> {
  if (!publicUrl || !isStorageConfigured()) return;

  const marker = `/object/public/${bucket()}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return;

  const path = decodeURIComponent(publicUrl.slice(index + marker.length));
  const { error } = await getClient().storage.from(bucket()).remove([path]);
  if (error) console.error('[storage] failed to remove image', path, error.message);
}

export { isStorageConfigured };
