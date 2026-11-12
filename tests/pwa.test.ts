import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import manifest from '@/app/manifest';
import { OFFLINE_PAGE_URL, detectInstallPlatform } from '@/lib/pwa';

const root = path.resolve(__dirname, '..');
const ORIGIN = 'https://pos.example.com';

/** Loads public/sw.js in a sandbox and returns its top-level functions. */
function loadWorker() {
  const context = vm.createContext({ self: { addEventListener: () => {} }, URL });
  vm.runInContext(readFileSync(path.join(root, 'public', 'sw.js'), 'utf8'), context);
  return context as unknown as {
    strategyFor: (request: unknown, origin: string) => string;
    offlineTarget: (pathname: string, hasTill: boolean) => string;
    tillAssetUrls: (html: string) => string[];
  };
}

const loadStrategy = () => loadWorker().strategyFor;

function request(url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  return { url: new URL(url, ORIGIN).href, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers };
}

test('the service worker never caches writes, API calls, page data or other sites', () => {
  const strategyFor = loadStrategy();
  const passThrough: [string, ReturnType<typeof request>][] = [
    ['checkout server action', request('/pos', { method: 'POST', headers: { 'Next-Action': 'abc' } })],
    ['any POST', request('/api/shifts/export', { method: 'POST' })],
    ['API GET', request('/api/search?q=coke')],
    ['auth session', request('/api/auth/get-session')],
    ['RSC navigation payload', request('/sales', { headers: { RSC: '1' } })],
    ['RSC by query', request('/inventory?_rsc=xyz')],
    ['remote product photo', request('https://abc.supabase.co/storage/v1/object/public/p/1.jpg')],
    ['optimised image', request('/_next/image?url=x&w=64&q=75')],
    ['report export', request('/api/reports/sales/export')],
  ];
  for (const [label, req] of passThrough) assert.equal(strategyFor(req, ORIGIN), 'network', label);
});

test('the service worker caches only build assets and brand files, and guards page loads', () => {
  const strategyFor = loadStrategy();
  assert.equal(strategyFor(request('/_next/static/chunks/main-abc123.js'), ORIGIN), 'cache-first');
  assert.equal(strategyFor(request('/_next/static/media/poppins.woff2'), ORIGIN), 'cache-first');
  assert.equal(strategyFor(request('/brand/icon-192.png'), ORIGIN), 'stale-while-revalidate');
  assert.equal(strategyFor(request('/brand/icon-192.png?v=2'), ORIGIN), 'stale-while-revalidate');
  assert.equal(strategyFor(request('/pos', { mode: 'navigate' }), ORIGIN), 'navigate');
});

test('the offline fallback is precached and served from the shared constant', () => {
  const source = readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  assert.match(source, new RegExp(`const OFFLINE_URL = '${OFFLINE_PAGE_URL}'`));
  const page = readFileSync(path.join(root, 'public', OFFLINE_PAGE_URL), 'utf8');
  // Must not depend on build assets that may not be cached.
  assert.doesNotMatch(page, /_next\//);
});

test('a page that cannot load opens the offline till only on a device that keeps it', () => {
  const { offlineTarget, strategyFor } = loadWorker();
  assert.equal(strategyFor(request('/pos-offline', { mode: 'navigate' }), ORIGIN), 'navigate', 'live first, like any page');
  assert.equal(offlineTarget('/pos', false), 'page');
  assert.equal(offlineTarget('/dashboard', false), 'page');
  assert.equal(offlineTarget('/pos', true), 'redirect');
  assert.equal(offlineTarget('/sales/abc', true), 'redirect');
  assert.equal(offlineTarget('/pos-offline', true), 'till');
});

test('the offline till keeps the build files named in its HTML and page data', () => {
  const { tillAssetUrls } = loadWorker();
  const html = [
    '<link rel="stylesheet" href="/_next/static/css/app-1a2b.css" data-precedence="next"/>',
    '<link rel="preload" href="/_next/static/media/poppins-latin.woff2" as="font"/>',
    '<script src="/_next/static/chunks/webpack-9f8e.js" async=""></script>',
    '<script src="/_next/static/chunks/main-app-77aa.js?dpl=dpl_123" async=""></script>',
    '<script>self.__next_f.push([1,"3:I[\\"123\\",[\\"static/chunks/123-abc.js\\",\\"static/chunks/app/pos-offline/page-def.js\\"],\\"OfflineTill\\"]"])</script>',
    '<img src="/_next/image?url=x&w=64"/><a href="/api/pos/catalog">x</a>',
  ].join('');
  assert.deepEqual([...tillAssetUrls(html)].sort(), [
    '/_next/static/chunks/123-abc.js',
    '/_next/static/chunks/app/pos-offline/page-def.js',
    '/_next/static/chunks/main-app-77aa.js?dpl=dpl_123',
    '/_next/static/chunks/webpack-9f8e.js',
    '/_next/static/css/app-1a2b.css',
    '/_next/static/media/poppins-latin.woff2',
  ]);
});

test('the offline till page is static and carries no account data', () => {
  const page = readFileSync(path.join(root, 'src', 'app', 'pos-offline', 'page.tsx'), 'utf8');
  assert.match(page, /export const dynamic = 'force-static'/);
  assert.doesNotMatch(page, /session|requireUser|requirePermission|getSettings|prisma/i);
  const source = readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  assert.match(source, /const OFFLINE_TILL_URL = '\/pos-offline'/);
});

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): string {
  const data = readFileSync(file);
  return `${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`;
}

test('the manifest makes a standalone app with real, correctly sized icons', () => {
  const m = manifest();
  assert.equal(m.name, 'TindahanProMax Mobile POS');
  assert.equal(m.short_name, 'TindahanProMax');
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url?.startsWith(m.scope ?? '/'));

  const sizes = new Set<string>();
  for (const icon of m.icons ?? []) {
    // Strip the cache-busting query; it isn't part of the file name.
    assert.equal(pngSize(path.join(root, 'public', icon.src.split('?')[0])), icon.sizes, icon.src);
    sizes.add(icon.sizes ?? '');
  }
  assert.ok(sizes.has('192x192') && sizes.has('512x512'));
  assert.ok(m.icons?.some((icon) => icon.purpose === 'maskable'));
});

test('install instructions match the browser', () => {
  const cases: [string, number, string][] = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', 5, 'ios'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1', 5, 'ios'],
    // iPadOS asks for the desktop site; only the touch points give it away.
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', 5, 'ios'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15', 0, 'desktop-safari'],
    ['Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', 5, 'android'],
    ['Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0', 5, 'android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0', 0, 'desktop-chromium'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', 0, 'desktop-chromium'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0', 0, 'desktop-firefox'],
    ['curl/8.0', 0, 'other'],
  ];
  for (const [ua, touch, expected] of cases) assert.equal(detectInstallPlatform(ua, touch), expected, ua);
});
