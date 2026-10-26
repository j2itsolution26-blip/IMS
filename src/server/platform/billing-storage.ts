import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseSecretKey, getSupabaseUrl, isStorageConfigured } from '@/lib/env';
import { AppError, ValidationError } from '@/lib/errors';
import {
  BILLING_IMAGE_TYPES,
  QR_MAX_BYTES,
  RECEIPT_MAX_BYTES_CEILING,
  checkBillingImage,
  checkImageSize,
  receiptFolder,
  receiptMaxBytes,
  type BillingImageType,
} from '@/lib/billing-files';

/**
 * Private storage for billing images: owners' payment receipts and the GCash
 * QR codes the administrator uploads.
 *
 * Its own bucket, never public: a file is only handed out as a signed URL
 * that expires in a minute, after the caller's access to it was checked
 * (src/app/api/billing). The bucket is created private on first use, and
 * refused if someone has made it public.
 */

const SIGNED_URL_SECONDS = 60;

const bucket = () => process.env.BILLING_STORAGE_BUCKET?.trim() || 'billing-files';

let client: SupabaseClient | null = null;
let bucketReady = false;

const unavailable = (code: string, status = 503) =>
  new AppError('Files cannot be uploaded right now. Please try again later.', code, status);

function getClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const secret = getSupabaseSecretKey();
  if (!isStorageConfigured() || !url || !secret) throw unavailable('STORAGE_NOT_CONFIGURED');
  client ??= createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

async function ensurePrivateBucket(supabase: SupabaseClient): Promise<void> {
  if (bucketReady) return;
  const name = bucket();
  const { data, error } = await supabase.storage.getBucket(name);
  if (data && !error) {
    if (data.public) {
      console.error(`[billing-storage] bucket "${name}" is public; refusing to store billing files in it.`);
      throw unavailable('STORAGE_MISCONFIGURED');
    }
    bucketReady = true;
    return;
  }
  const created = await supabase.storage.createBucket(name, {
    public: false,
    fileSizeLimit: RECEIPT_MAX_BYTES_CEILING,
    allowedMimeTypes: Object.keys(BILLING_IMAGE_TYPES),
  });
  if (created.error && !/already exists/i.test(created.error.message)) {
    console.error('[billing-storage] could not create the bucket', created.error.message);
    throw unavailable('STORAGE_UPLOAD_FAILED', 502);
  }
  bucketReady = true;
}

export interface CheckedImage {
  bytes: Uint8Array;
  type: BillingImageType;
  name: string;
  size: number;
  sha256: string;
}

/** Reads and checks one uploaded image. Throws a field error for anything unacceptable. */
async function checkImage(file: unknown, field: string, maxBytes: number, what: string): Promise<CheckedImage> {
  if (!file || typeof file !== 'object' || typeof (file as File).arrayBuffer !== 'function') {
    const message = `Attach ${what.toLowerCase()} image.`;
    throw new ValidationError(message, { [field]: [message] });
  }
  const upload = file as File;
  // Refuse an oversized file before reading it.
  const early = checkImageSize(upload.size, maxBytes, what);
  if (early) throw new ValidationError(early, { [field]: [early] });

  const bytes = new Uint8Array(await upload.arrayBuffer());
  const checked = checkBillingImage(bytes, upload.name ?? '', maxBytes, what);
  if (!checked.ok) throw new ValidationError(checked.message, { [field]: [checked.message] });
  return {
    bytes,
    type: checked.type,
    name: checked.name,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export const checkReceipt = (file: unknown) => checkImage(file, 'receipt', receiptMaxBytes(), 'The receipt');
export const checkQrImage = (file: unknown) => checkImage(file, 'qr', QR_MAX_BYTES, 'The QR code');

export interface StoredImage {
  storagePath: string;
  originalName: string;
  mimeType: BillingImageType;
  sizeBytes: number;
  sha256: string;
}

async function upload(storagePath: string, image: CheckedImage): Promise<StoredImage> {
  const supabase = getClient();
  await ensurePrivateBucket(supabase);
  const { error } = await supabase.storage.from(bucket()).upload(storagePath, image.bytes, { contentType: image.type, upsert: false });
  if (error) {
    console.error('[billing-storage] upload failed', { storagePath, message: error.message });
    throw new AppError('The image could not be uploaded. Please try again.', 'STORAGE_UPLOAD_FAILED', 502);
  }
  return { storagePath, originalName: image.name, mimeType: image.type, sizeBytes: image.size, sha256: image.sha256 };
}

/** Uploads a checked receipt under a random name in the store's folder. */
export function storeReceipt(storeId: string, image: CheckedImage): Promise<StoredImage> {
  return upload(`${receiptFolder(storeId)}${randomUUID()}.${BILLING_IMAGE_TYPES[image.type]}`, image);
}

/** Uploads a checked QR code image under a random name. */
export function storeQrImage(image: CheckedImage): Promise<StoredImage> {
  return upload(`qr/${randomUUID()}.${BILLING_IMAGE_TYPES[image.type]}`, image);
}

/** Best effort: removes uploads whose database row was never saved, or a replaced QR code. */
export async function removeBillingFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await getClient().storage.from(bucket()).remove(paths);
    if (error) console.error('[billing-storage] could not remove files', paths, error.message);
  } catch (error) {
    console.error('[billing-storage] could not remove files', paths, error);
  }
}

/** A one-minute link to a file. Only call after the caller's access is checked. */
export async function billingSignedUrl(storagePath: string, downloadName?: string): Promise<string> {
  const { data, error } = await getClient()
    .storage.from(bucket())
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) throw new AppError('The file is not available right now.', 'STORAGE_UNAVAILABLE', 502);
  return data.signedUrl;
}
