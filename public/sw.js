/**
 * TindahanProMax service worker.
 *
 * It makes the app installable, loads the immutable build assets quickly,
 * and lets a till prepared for offline sales open with no connection:
 *
 *  - Only GET requests are ever answered from the cache. Sales, payments,
 *    shift and stock changes always go straight to the server; this worker
 *    never queues or replays them. Sales made offline are kept and sent by
 *    the app itself (src/features/offline), each with its own id, so the
 *    server can never record one twice.
 *  - Pages, page data (RSC), /api/* and other sites' images are never cached,
 *    so no account, sales or inventory data is ever stored by this worker.
 *  - Cached: content-hashed /_next/static files, public brand assets, the
 *    offline page, and the offline till (/pos-offline). That page is the same
 *    static HTML for everyone and holds no account data: it reads the
 *    device's own catalogue copy from IndexedDB. It is kept only on a device
 *    whose till asked for it after being prepared for offline sales
 *    (CACHE_OFFLINE_TILL), together with the build files it needs.
 *  - A page that cannot load (no network at all) opens the offline till when
 *    the device has it, else the offline page. A page the server answered,
 *    even with an error, is shown as it is.
 *
 * Updates: bump VERSION when this file changes. The new worker waits until
 * the user taps "Reload" in the update toast (see
 * src/features/pwa/service-worker-registrar.tsx), so it never interrupts a
 * sale in progress, and nobody has to reinstall the app. A device that had
 * the offline till fetches the new version's till while installing, so it
 * still opens offline after the update.
 */

const VERSION = 'v6';
const STATIC_CACHE = `tpm-static-${VERSION}`;
const SHELL_CACHE = `tpm-shell-${VERSION}`;
const TILL_CACHE = `tpm-till-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const OFFLINE_TILL_URL = '/pos-offline';
/** Background Sync tag the till registers after an offline sale. */
const SYNC_TAG = 'tpm-outbox';

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

/**
 * What a page load that could not reach the network gets:
 *   'till'      the offline till itself (the request was for it)
 *   'redirect'  a redirect to the offline till
 *   'page'      the offline page (this device has no offline till)
 */
function offlineTarget(pathname, hasTill) {
  if (!hasTill) return 'page';
  return pathname === OFFLINE_TILL_URL ? 'till' : 'redirect';
}

/**
 * The build files a page needs, from its HTML: script and style tags, and the
 * chunk lists in Next.js's inline page data (written as "static/chunks/…").
 */
function tillAssetUrls(html) {
  const found = new Set();
  const pattern = /(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'\\\s<>]+?\.(?:js|css|woff2?)(?:\?[^"'\\\s<>]*)?(?=["'\\\s<>]|$)/g;
  for (const match of html.matchAll(pattern)) {
    found.add(match[0].startsWith('/_next/') ? match[0] : `/_next/${match[0]}`);
  }
  return [...found];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `reload` bypasses the HTTP cache so a new worker gets the new page.
      await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
      // Best effort: a failure here must not stop the update.
      if (await hadOfflineTill()) await warmTill().catch(() => false);
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, SHELL_CACHE, TILL_CACHE]);
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
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  else if (type === 'CACHE_OFFLINE_TILL') event.waitUntil(warmTill().catch(() => false));
});

// Background Sync (Chromium): wakes the open app to send saved sales once the
// connection returns. The app's own sync engine does the sending.
self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'SYNC_OUTBOX' });
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === 'navigate') event.respondWith(navigate(event));
  else if (strategy === 'cache-first') event.respondWith(cacheFirst(event.request));
  else if (strategy === 'stale-while-revalidate') event.respondWith(staleWhileRevalidate(event));
});

/** Always the live page; the offline till or page only when the network is unreachable. */
async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const till = await (await caches.open(TILL_CACHE)).match(OFFLINE_TILL_URL);
    const target = offlineTarget(new URL(event.request.url).pathname, Boolean(till));
    if (target === 'till') return till;
    if (target === 'redirect') return Response.redirect(OFFLINE_TILL_URL, 303);
    const offline = await (await caches.open(SHELL_CACHE)).match(OFFLINE_URL);
    return offline || Response.error();
  }
}

async function cacheFirst(request) {
  // The offline till's files live in their own cache, outside the trimming below.
  const cached = (await caches.match(request, { cacheName: STATIC_CACHE })) || (await caches.match(request, { cacheName: TILL_CACHE }));
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
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

/** Whether an earlier version of this worker kept the offline till. */
async function hadOfflineTill() {
  for (const name of await caches.keys()) {
    if (!name.startsWith('tpm-till-') || name === TILL_CACHE) continue;
    if (await (await caches.open(name)).match(OFFLINE_TILL_URL)) return true;
  }
  return false;
}

let warming = null;

/** Keeps the offline till page and its build files. One run at a time. */
function warmTill() {
  warming = warming || cacheTill().finally(() => {
    warming = null;
  });
  return warming;
}

async function cacheTill() {
  // Only a real page: a signed-out device is redirected to sign in, and keeps nothing.
  const response = await fetch(OFFLINE_TILL_URL, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok || response.redirected || !(response.headers.get('content-type') || '').includes('text/html')) return false;

  const urls = tillAssetUrls(await response.clone().text());
  if (!urls.some((url) => url.endsWith('.js') || url.includes('.js?'))) return false;

  const till = await caches.open(TILL_CACHE);
  for (const url of urls) {
    if (await till.match(url)) continue;
    const asset = (await caches.match(url, { cacheName: STATIC_CACHE })) || (await fetch(url, { credentials: 'same-origin' }).catch(() => null));
    if (asset && asset.ok) await till.put(url, asset);
    // Scripts and styles are required; a missing font only looks different.
    else if (!/\.(?:woff2?)(?:\?|$)/.test(url)) return false;
  }
  // The page goes in last, so it is only ever served with its files present.
  await till.put(OFFLINE_TILL_URL, response);

  // Files of earlier builds are no longer needed.
  const keep = new Set([OFFLINE_TILL_URL, ...urls].map((url) => new URL(url, self.location.origin).href));
  await Promise.all((await till.keys()).filter((key) => !keep.has(key.url)).map((key) => till.delete(key)));
  return true;
}
