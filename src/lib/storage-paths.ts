/**
 * Where each store's uploaded files live in the storage bucket, and which
 * files a store may remove. Pure, so the rule is unit-tested directly.
 */

/**
 * Images uploaded before stores existed sit under `products/`; they all belong
 * to the original store, `store_default` (migration 20261023090000).
 */
export const LEGACY_STORE_ID = 'store_default';

/** The storage folder for a store's files, e.g. `stores/abc123/`. */
export function storeFolder(storeId: string): string {
  const safe = storeId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('A store id is required for a storage path.');
  return `stores/${safe}/`;
}

/** Whether `path` (inside the bucket) is one of this store's files. */
export function ownsImagePath(path: string, storeId: string): boolean {
  if (!path || path.includes('..') || path.startsWith('/')) return false;
  if (path.startsWith(storeFolder(storeId))) return true;
  return storeId === LEGACY_STORE_ID && path.startsWith('products/');
}
