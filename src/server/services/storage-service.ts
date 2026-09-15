import 'server-only';

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  getDatabaseProjectRef,
  getSupabaseKeyProjectRef,
  getSupabaseSecretKey,
  getSupabaseSecretKeySource,
  getSupabaseUrl,
  isStorageConfigured,
  resolveSupabaseUrl,
} from '@/lib/env';
import { AppError, ValidationError } from '@/lib/errors';

/**
 * Supabase Storage wrapper for product images.
 *
 * Uploads go through the service-role key on the server so the bucket can stay
 * write-protected from the browser; reads use the public URL.
 *
 * Failures here are reported in terms of what an operator can actually act on.
 * A transport failure from Node reaches us as the single word "fetch failed",
 * with the real reason (DNS, refused connection, TLS, timeout) buried in a
 * chain of `cause`/`originalError` links — so that chain is unwrapped rather
 * than discarded, and the host being dialled is named in the message.
 */

const MAX_BYTES = 5 * 1024 * 1024;
// Exactly the formats the UI advertises. SVG is deliberately excluded: it can
// carry script, and it is never needed for a product photograph. HEIC is
// converted to JPEG in the browser before it ever reaches this point.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Transport failures are worth one more try; a rejected file never is. */
const UPLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = [400, 1200];

let client: SupabaseClient | null = null;

/**
 * The configured project URL, validated.
 *
 * A value with no scheme, or a stray quote picked up from a `.env` line, does
 * not fail here — it fails much later as an unexplained "fetch failed", so it
 * is caught at the point of use instead.
 */
function requireSupabaseUrl(): string {
  const raw = getSupabaseUrl();
  if (!raw) {
    throw new AppError(
      'Image storage is not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY.',
      'STORAGE_NOT_CONFIGURED',
      503,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError(
      `The configured Supabase URL is not valid (received "${raw}"). SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL must look like https://your-project.supabase.co`,
      'STORAGE_URL_INVALID',
      503,
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError(
      `The configured Supabase URL must start with https:// (received "${raw}").`,
      'STORAGE_URL_INVALID',
      503,
    );
  }

  return parsed.origin;
}

function getClient(): SupabaseClient {
  if (!isStorageConfigured()) {
    throw new AppError(
      'Image storage is not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY.',
      'STORAGE_NOT_CONFIGURED',
      503,
    );
  }
  if (!client) {
    client = createClient(requireSupabaseUrl(), getSupabaseSecretKey()!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

const bucket = () => process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'product-images';

const storageHost = () => {
  try {
    return new URL(requireSupabaseUrl()).host;
  } catch {
    return 'the storage host';
  }
};

/**
 * Every `code`/`errno` in an error's cause chain.
 *
 * supabase-js keeps the thrown `TypeError` on `originalError`, and Node keeps
 * the socket-level reason on `cause` — so both links have to be followed to
 * reach the code that actually says what went wrong.
 */
function causeCodes(error: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; current && depth < 6; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);

    const link = current as { code?: unknown; errno?: unknown; cause?: unknown; originalError?: unknown };
    if (typeof link.code === 'string') codes.push(link.code);
    if (typeof link.errno === 'string') codes.push(link.errno);

    current = link.cause ?? link.originalError;
  }

  return codes;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}

/** True when the failure is a network problem rather than a rejected request. */
function isTransportFailure(error: unknown): boolean {
  const codes = causeCodes(error);
  return (
    messageOf(error).toLowerCase().includes('fetch failed') ||
    codes.some((code) =>
      [
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'EPIPE',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT',
        'UND_ERR_SOCKET',
      ].includes(code),
    )
  );
}

/** Turns a storage failure into something an operator can act on. */
function describeFailure(error: unknown): string {
  const message = messageOf(error);
  const codes = causeCodes(error);
  const host = storageHost();

  if (/bucket not found/i.test(message) || codes.includes('NoSuchBucket')) {
    return `The storage bucket "${bucket()}" does not exist in this Supabase project. Create it (Storage → New bucket, public) or set SUPABASE_STORAGE_BUCKET to the correct name.`;
  }

  if (codes.includes('ENOTFOUND') || codes.includes('EAI_AGAIN')) {
    return `Could not reach image storage: the address ${host} could not be resolved. Check SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL points at the right Supabase project.`;
  }

  if (codes.includes('ECONNREFUSED')) {
    return `Could not reach image storage: ${host} refused the connection. The Supabase project may be paused.`;
  }

  if (
    codes.some((code) =>
      ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code),
    )
  ) {
    return `Could not reach image storage: the connection to ${host} timed out. Please try again.`;
  }

  if (codes.some((code) => code.startsWith('CERT_') || code.startsWith('DEPTH_ZERO'))) {
    return `Could not reach image storage: the TLS certificate for ${host} was rejected.`;
  }

  if (/invalid|jwt|unauthor|signature/i.test(message)) {
    // A key issued for another project is the usual cause, and the key itself
    // says which one — so name it rather than leaving the operator guessing.
    const keyProject = getSupabaseKeyProjectRef();
    const databaseProject = getDatabaseProjectRef();

    if (keyProject && databaseProject && keyProject !== databaseProject) {
      return `Image storage rejected the credentials: the key is for Supabase project "${keyProject}", but this application uses project "${databaseProject}". Replace ${
        getSupabaseSecretKeySource() ?? 'SUPABASE_SECRET_KEY'
      } with the key from project "${databaseProject}" and redeploy.`;
    }

    return 'Image storage rejected the credentials. Check SUPABASE_SECRET_KEY belongs to this Supabase project.';
  }

  if (isTransportFailure(error)) {
    return `Could not reach image storage at ${host}. Check the connection and that SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL is correct.`;
  }

  return `Image upload failed: ${message}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Set once the bucket is known to exist, so this costs one round trip per boot. */
let bucketReady = false;

/**
 * Makes sure the configured bucket exists, creating it if it does not.
 *
 * A shop owner has no reason to know what a storage bucket is, and a missing
 * one is otherwise a dead end that can only be cleared from the Supabase
 * dashboard. Creation is idempotent and uses the same limits the upload path
 * enforces, so the bucket can never be more permissive than the application.
 */
async function ensureBucket(supabase: SupabaseClient): Promise<void> {
  if (bucketReady) return;

  const name = bucket();
  const { data, error } = await supabase.storage.getBucket(name);

  if (data && !error) {
    if (!data.public) {
      console.warn(
        `[storage] bucket "${name}" is private — saved product photos will not be viewable. Make it public in Storage → Buckets.`,
      );
    }
    bucketReady = true;
    return;
  }

  if (error && !/bucket not found/i.test(messageOf(error))) {
    // Something other than absence — let the caller's error handling describe it.
    throw error;
  }

  const created = await supabase.storage.createBucket(name, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: [...ALLOWED_MIME],
  });

  // Another request may have won the race; an existing bucket is success here.
  if (created.error && !/already exists/i.test(messageOf(created.error))) {
    throw created.error;
  }

  console.info(`[storage] created public bucket "${name}"`);
  bucketReady = true;
}

export async function uploadProductImage(file: File, productSku: string): Promise<string> {
  if (file.size === 0) throw new ValidationError('The selected file is empty.', { image: ['File is empty.'] });
  if (file.size > MAX_BYTES) {
    throw new ValidationError('Image must be 5 MB or smaller.', { image: ['Image must be 5 MB or smaller.'] });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new ValidationError(
      `Image must be a JPG, PNG, or WEBP file${file.type ? ` (received ${file.type})` : ''}.`,
      { image: ['Unsupported image format.'] },
    );
  }

  const supabase = getClient();
  const extension = EXTENSION_BY_MIME[file.type];
  const safeSku = productSku.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase().slice(0, 40);

  // A UUID rather than a timestamp: two uploads for the same SKU inside the
  // same millisecond would otherwise collide, and `upsert: false` would reject
  // the second one. The SKU is kept only as a human-readable prefix — never as
  // the sole filename, so a user-supplied name can never determine the path.
  const path = `products/${safeSku}-${randomUUID()}.${extension}`;
  const body = await file.arrayBuffer();

  try {
    await ensureBucket(supabase);
  } catch (error) {
    console.error('[storage] could not prepare the bucket', {
      host: storageHost(),
      bucket: bucket(),
      message: messageOf(error),
      causes: causeCodes(error),
    });
    throw new AppError(describeFailure(error), 'STORAGE_UPLOAD_FAILED', 502);
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.storage
      .from(bucket())
      .upload(path, body, { contentType: file.type, upsert: false });

    if (!error) {
      const { data } = supabase.storage.from(bucket()).getPublicUrl(path);
      return data.publicUrl;
    }

    lastError = error;

    // A dropped connection on a phone or a cold serverless socket is worth
    // another attempt; a rejected file or a missing bucket never is.
    if (!isTransportFailure(error) || attempt === UPLOAD_ATTEMPTS - 1) break;

    console.warn(
      `[storage] upload attempt ${attempt + 1}/${UPLOAD_ATTEMPTS} failed (${messageOf(error)}; causes: ${
        causeCodes(error).join(', ') || 'none'
      }) — retrying`,
    );
    await wait(RETRY_DELAY_MS[attempt] ?? 1200);
  }

  // The full chain goes to the server log, where the operator can see it; the
  // thrown message is the human-readable half of the same finding.
  console.error('[storage] upload failed', {
    host: storageHost(),
    bucket: bucket(),
    path,
    contentType: file.type,
    bytes: file.size,
    message: messageOf(lastError),
    causes: causeCodes(lastError),
  });

  throw new AppError(describeFailure(lastError), 'STORAGE_UPLOAD_FAILED', 502);
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

export interface StorageDiagnosis {
  configured: boolean;
  host: string | null;
  /** Where the project URL came from — configured, or repaired from the database. */
  urlSource: string;
  urlNote?: string;
  bucket: string;
  /** Null when the check could not run because nothing is configured. */
  bucketExists: boolean | null;
  publicBucket: boolean | null;
  ok: boolean;
  problem?: string;
}

/**
 * Actively checks that uploads would work, rather than only that variables are
 * present. A missing bucket and an unreachable host both look identical from
 * the outside until something tries to use them.
 */
export async function verifyStorage(): Promise<StorageDiagnosis> {
  const configuredBucket = bucket();
  const resolution = resolveSupabaseUrl();

  if (!isStorageConfigured()) {
    return {
      configured: false,
      host: null,
      urlSource: resolution.source,
      urlNote: resolution.note,
      bucket: configuredBucket,
      bucketExists: null,
      publicBucket: null,
      ok: false,
      problem: resolution.url
        ? 'Image upload is disabled: SUPABASE_SECRET_KEY is not set. Copy it from Supabase → Project Settings → API Keys → secret key, add it to the deployment as a server-side variable, and redeploy.'
        : 'Image upload is disabled: no Supabase project could be determined. Set SUPABASE_URL and SUPABASE_SECRET_KEY, then redeploy.',
    };
  }

  try {
    const supabase = getClient();
    const { data, error } = await supabase.storage.getBucket(configuredBucket);

    if (error) {
      return {
        configured: true,
        host: storageHost(),
        urlSource: resolution.source,
        urlNote: resolution.note,
        bucket: configuredBucket,
        bucketExists: /bucket not found/i.test(messageOf(error)) ? false : null,
        publicBucket: null,
        ok: false,
        problem: /bucket not found/i.test(messageOf(error))
          ? `The bucket "${configuredBucket}" does not exist yet. It is created automatically the first time a photo is uploaded.`
          : describeFailure(error),
      };
    }

    return {
      configured: true,
      host: storageHost(),
      urlSource: resolution.source,
      urlNote: resolution.note,
      bucket: configuredBucket,
      bucketExists: true,
      publicBucket: Boolean(data?.public),
      ok: true,
      // `problem` is for something that is actually impaired. A project URL
      // that disagrees with the database is reported through `urlNote`, since
      // storage is reconciled to the database and keeps working regardless —
      // calling that a problem makes a healthy deployment read as a broken one.
      problem: data?.public
        ? undefined
        : `The bucket "${configuredBucket}" exists but is not public, so saved photos will not display. Make it public in Storage → Buckets.`,
    };
  } catch (error) {
    return {
      configured: true,
      host: storageHost(),
      urlSource: resolution.source,
      urlNote: resolution.note,
      bucket: configuredBucket,
      bucketExists: null,
      publicBucket: null,
      ok: false,
      problem: describeFailure(error),
    };
  }
}

export { isStorageConfigured };
