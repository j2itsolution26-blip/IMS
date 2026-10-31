import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { APP_NAME, APP_SHORT_NAME, VENDOR_LOGO, VENDOR_NAME } from '../src/lib/brand';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the product is named TindahanProMax Mobile POS, with a short name that fits under a home-screen icon', () => {
  assert.equal(APP_NAME, 'TindahanProMax Mobile POS');
  assert.equal(APP_SHORT_NAME, 'TindahanProMax');
});

test('the sign-in screens credit J2SecureTech by its exact name, with its real logo', () => {
  assert.equal(VENDOR_NAME, 'J2SecureTech');
  assert.equal(VENDOR_LOGO.src, '/brand/j2securetech-logo.jpg');
  assert.ok(existsSync(new URL(`../public${VENDOR_LOGO.src}`, import.meta.url)), 'the logo file is in the repository');
  const layout = source('src/app/(auth)/layout.tsx');
  // Footer: © year TindahanProMax Mobile POS | Powered by J2SecureTech.
  assert.match(layout, /<footer[\s\S]*\{APP_NAME\}[\s\S]*\|<\/span> Powered by[\s\S]*\{VENDOR_NAME\}[\s\S]*<\/footer>/);
  // The branding panel shows the logo with "Powered by".
  assert.match(layout, /<VendorLogo size="lg" \/>[\s\S]*Powered by/);
  assert.match(source('src/app/(auth)/sign-in/page.tsx'), /Sign in to your \{APP_NAME\} account\./);
});

test('no screen spells out the old product name by hand', () => {
  for (const path of ['src/app/(auth)/setup/page.tsx', 'src/features/billing/invoices-table.tsx']) {
    assert.doesNotMatch(source(path), /TindahanProMax POS/, path);
  }
});

test('one official app icon: the green cart mark everywhere the product brand appears', async () => {
  const { BRAND_MARK_SRC } = await import('../src/lib/brand');
  assert.equal(BRAND_MARK_SRC, '/brand/tindahanpromax-icon.svg');
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  // Entry screens and the app shell show the mark through the shared component.
  for (const path of [
    'src/app/(auth)/layout.tsx',
    'src/app/not-found.tsx',
    'src/features/auth/locked-view.tsx',
    'src/features/auth/change-password-view.tsx',
  ]) {
    assert.match(read(path), /<BrandLockup\b/, path);
  }
  assert.match(read('src/components/layout/sidebar.tsx'), /<BrandMark\b/);
  assert.match(read('src/components/layout/app-shell.tsx'), /<BrandMark\b/);
  assert.doesNotMatch(read('src/components/brand.tsx'), /tindahanpromax-logo/, 'the promotional logo is not the app icon');

  // Favicon, home-screen and install icons are all generated from the SVG.
  for (const file of ['src/app/favicon.ico', 'src/app/icon.png', 'src/app/apple-icon.png', 'public/brand/icon-192.png', 'public/brand/icon-512.png', 'public/brand/icon-maskable-192.png', 'public/brand/icon-maskable-512.png']) {
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
  }
  assert.match(read('scripts/build-brand-assets.ts'), /tindahanpromax-icon\.svg/);
  const manifest = read('src/app/manifest.ts');
  assert.match(manifest, /icon\('icon-maskable-192'\), sizes: '192x192', type: 'image\/png', purpose: 'maskable'/);
  assert.match(manifest, /icon\('icon-maskable-512'\), sizes: '512x512', type: 'image\/png', purpose: 'maskable'/);
});
