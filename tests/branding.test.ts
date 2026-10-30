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
