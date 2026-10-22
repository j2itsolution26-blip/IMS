/**
 * Installable-app helpers shared by the service-worker registration, the
 * install dialog and the tests. Pure functions only: anything that reads
 * `window` lives in src/features/pwa so it never runs during server rendering.
 */

/** Served from public/, so its scope is the whole origin. */
export const SERVICE_WORKER_URL = '/sw.js';

/** Self-contained fallback the service worker shows when a page cannot load. */
export const OFFLINE_PAGE_URL = '/offline.html';

/** Which set of install instructions applies to the current browser. */
export type InstallPlatform =
  | 'ios' // iPhone / iPad: Share → Add to Home Screen, in any browser on iOS 16.4+
  | 'android' // Chrome, Edge, Samsung Internet, Firefox: menu → Install app
  | 'desktop-chromium' // Chrome, Edge, Opera, Brave on Windows, macOS, Linux, ChromeOS
  | 'desktop-safari' // Safari 17+ on macOS: File → Add to Dock
  | 'desktop-firefox' // no web-app installation on desktop Firefox
  | 'other';

/**
 * Classifies a browser from its user agent.
 *
 * iPadOS 13+ reports a desktop Mac user agent, so a "Macintosh" with a touch
 * screen is treated as an iPad: only a touch Mac is an iPad today.
 */
export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Firefox\//i.test(userAgent)) return 'desktop-firefox';
  if (/Edg\/|OPR\/|Chrome\/|Chromium\//i.test(userAgent)) return 'desktop-chromium';
  if (/Macintosh/i.test(userAgent) && /Safari\//i.test(userAgent)) return 'desktop-safari';
  return 'other';
}
