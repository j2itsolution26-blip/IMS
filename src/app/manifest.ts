import type { MetadataRoute } from 'next';
import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME, BRAND_NAVY } from '@/lib/brand';

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
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press / right-click on the installed icon. Pages still enforce
    // permissions, so a shortcut never grants access a user lacks.
    shortcuts: [
      { name: 'Point of Sale', short_name: 'POS', url: '/pos', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Dashboard', url: '/dashboard', icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
