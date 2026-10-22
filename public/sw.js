/**
 * TindahanProMax service worker.
 *
 * It exists to make the app installable, to load the immutable build assets
 * quickly, and to show a clear offline page instead of the browser's error.
 * It is deliberately NOT an offline POS:
 *
 *  - Only GET requests are ever answered from the cache. Sales, payments,
 *    shift and stock changes are server actions (POST) and always go straight
 *    to the server; nothing is queued or replayed, so a sale can never be
 *    recorded twice or against stale stock by this worker.
 *  - Pages, page data (RSC), /api/* and other sites' images are never cached,
 *    so no account, sales or inventory data is ever stored on the device.
 *  - Only content-hashed /_next/static files and public brand assets are
 *    cached. Those never contain user data.
 *
 * Updates: bump VERSION when this file changes. The new worker waits until
 * the user taps "Reload" in the update toast (see
 * src/features/pwa/service-worker-registrar.tsx), so it never interrupts a
 * sale in progress, and nobody has to reinstall the app.
 */

const VERSION = 'v1';
const STATIC_CACHE = `tpm-static-${VERSION}`;
const SHELL_CACHE = `tpm-shell-${VERSION}`;
const OFFLINE_URL = '/offline.html';

/** Fetched when the worker installs, so the offline page works on first loss. */
const PRECACHE_URLS = [OFFLINE_URL, '/brand/icon-192.png'];

/** Hashed build files pile up across deploys; keep only the most recent ones. */
const MAX_STATIC_ENTRIES = 300;

/**
 * How a request is handled. Anything other than 'navigate', 'cache-first' or
 * 'stale-while-revalidate' is left entirely to the browser.
 */
function strategyFor(request, origin) {
  if (request.method !== 'GET') return 'network';

  const url = new URL(request.url);
  if (url.origin !== origin) return 'network';
  if (url.pathname.startsWith('/api/')) return 'network';

  // Client-side navigations fetch React Server Component payloads, which hold
  // the signed-in user's data. They are never cached.
  if (request.headers.get('RSC') || url.searchParams.has('_rsc')) return 'network';

  if (request.mode === 'navigate') return 'navigate';
  if (url.pathname.startsWith('/_next/static/')) return 'cache-first';
  if (url.pathname.startsWith('/brand/')) return 'stale-while-revalidate';
  return 'network';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `reload` bypasses the HTTP cache so a new worker gets the new page.
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, SHELL_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('tpm-') && !keep.has(name)).map((name) => caches.delete(name)));
      // Starts the page request while the worker boots, so intercepting
      // navigations adds no delay where the browser supports it.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === 'navigate') event.respondWith(navigate(event));
  else if (strategy === 'cache-first') event.respondWith(cacheFirst(event.request));
  else if (strategy === 'stale-while-revalidate') event.respondWith(staleWhileRevalidate(event));
});

/** Always the live page; the offline page only when the network is unreachable. */
async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache, MAX_STATIC_ENTRIES);
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then(async (response) => {
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}

/** Deletes the oldest entries (keys are in insertion order). */
async function trim(cache, max) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)));
}
