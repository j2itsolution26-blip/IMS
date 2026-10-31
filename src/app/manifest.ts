import type { MetadataRoute } from 'next';
import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME, BRAND_ICON_VERSION, BRAND_NAVY } from '@/lib/brand';

const icon = (name: string) => `/brand/${name}.png?v=${BRAND_ICON_VERSION}`;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: APP_DESCRIPTION,
    // Stable identity, so changing start_url later doesn't create a second app.
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'en',
    categories: ['business', 'finance', 'productivity'],
    prefer_related_applications: false,
    background_color: BRAND_NAVY,
    theme_color: BRAND_NAVY,
    // The official app icon, rendered from public/brand/tindahanpromax-icon.svg.
    // BRAND_ICON_VERSION changes the URLs when the artwork changes, so browsers
    // and Android's installed-app updater fetch the new files.
    icons: [
      { src: icon('icon-192'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon('icon-512'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: icon('icon-maskable-192'), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: icon('icon-maskable-512'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press / right-click on the installed icon. Pages still enforce
    // permissions, so a shortcut never grants access a user lacks.
    shortcuts: [
      { name: 'Point of Sale', short_name: 'POS', url: '/pos', icons: [{ src: icon('icon-192'), sizes: '192x192', type: 'image/png' }] },
      { name: 'Dashboard', url: '/dashboard', icons: [{ src: icon('icon-192'), sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
