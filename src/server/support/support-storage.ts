import 'server-only';

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseSecretKey, getSupabaseUrl, isStorageConfigured } from '@/lib/env';
import { AppError, ValidationError } from '@/lib/errors';
import {
  SUPPORT_IMAGE_TYPES,
  SUPPORT_MAX_TOTAL_BYTES,
  checkAttachmentLimits,
  detectImageType,
  safeAttachmentName,
  type SupportImageType,
} from '@/lib/support-files';

/**
 * Private storage for support screenshots.
 *
 * A separate bucket from product photos, and never public: a file is only
 * handed out as a signed URL that expires in a minute, after the caller has
 * passed the same check that guards the conversation. The bucket is created
 * private on first use, and refused if someone has made it public.
 */

const SIGNED_URL_SECONDS = 60;

const bucket = () => process.env.SUPPORT_STORAGE_BUCKET?.trim() || 'support-attachments';

let client: SupabaseClient | null = null;
let bucketReady = false;

function getClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const secret = getSupabaseSecretKey();
  if (!isStorageConfigured() || !url || !secret) {
    throw new AppError('Screenshots cannot be attached right now. Send your message without one.', 'STORAGE_NOT_CONFIGURED', 503);
  }
  client ??= createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

async function ensurePrivateBucket(supabase: SupabaseClient): Promise<void> {
  if (bucketReady) return;
  const name = bucket();
  const { data, error } = await supabase.storage.getBucket(name);
  if (data && !error) {
    if (data.public) {
      console.error(`[support-storage] bucket "${name}" is public; refusing to store support files in it.`);
      throw new AppError('Screenshots cannot be attached right now. Send your message without one.', 'STORAGE_MISCONFIGURED', 503);
    }
    bucketReady = true;
    return;
  }
  const created = await supabase.storage.createBucket(name, {
    public: false,
    fileSizeLimit: SUPPORT_MAX_TOTAL_BYTES,
    allowedMimeTypes: Object.keys(SUPPORT_IMAGE_TYPES),
  });
  if (created.error && !/already exists/i.test(created.error.message)) {
    console.error('[support-storage] could not create the bucket', created.error.message);
    throw new AppError('Screenshots cannot be attached right now. Send your message without one.', 'STORAGE_UPLOAD_FAILED', 502);
  }
  bucketReady = true;
}

export interface CheckedFile {
  bytes: Uint8Array;
  type: SupportImageType;
  name: string;
  size: number;
}

/** Reads and checks the files of one message. Throws a field error for anything unacceptable. */
export async function checkFiles(files: File[], maxFiles: number): Promise<CheckedFile[]> {
  const real = files.filter((file) => file && typeof file === 'object' && file.size > 0);
  const limit = checkAttachmentLimits(real.map((file) => ({ name: file.name, size: file.size })), maxFiles);
  if (limit) throw new ValidationError(limit, { attachments: [limit] });

  const checked: CheckedFile[] = [];
  for (const file of real) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectImageType(bytes);
    if (!type) {
      const message = 'Screenshots must be PNG, JPG or WEBP images.';
      throw new ValidationError(message, { attachments: [message] });
    }
    checked.push({ bytes, type, name: safeAttachmentName(file.name, type), size: bytes.byteLength });
  }
  return checked;
}

export interface StoredFile {
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Uploads checked files under random names, in the ticket's folder. */
export async function storeFiles(ticketId: string, files: CheckedFile[]): Promise<StoredFile[]> {
  if (files.length === 0) return [];
  const supabase = getClient();
  await ensurePrivateBucket(supabase);

  const stored: StoredFile[] = [];
  for (const file of files) {
    const storagePath = `tickets/${ticketId}/${randomUUID()}.${SUPPORT_IMAGE_TYPES[file.type]}`;
    const { error } = await supabase.storage
      .from(bucket())
      .upload(storagePath, file.bytes, { contentType: file.type, upsert: false });
    if (error) {
      console.error('[support-storage] upload failed', { storagePath, message: error.message });
      await removeFiles(stored.map((item) => item.storagePath));
      throw new AppError('The screenshot could not be uploaded. Please try again, or send without it.', 'STORAGE_UPLOAD_FAILED', 502);
    }
    stored.push({ storagePath, originalName: file.name, mimeType: file.type, sizeBytes: file.size });
  }
  return stored;
}

/** Best effort: removes uploads whose message was never saved. */
export async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await getClient().storage.from(bucket()).remove(paths);
    if (error) console.error('[support-storage] could not remove orphaned files', paths, error.message);
  } catch (error) {
    console.error('[support-storage] could not remove orphaned files', paths, error);
  }
}

/** A one-minute link to a file. Only call after the caller's access is checked. */
export async function signedUrlFor(storagePath: string, downloadName?: string): Promise<string> {
  const { data, error } = await getClient()
    .storage.from(bucket())
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) {
    throw new AppError('The file is not available right now.', 'STORAGE_UNAVAILABLE', 502);
  }
  return data.signedUrl;
}
