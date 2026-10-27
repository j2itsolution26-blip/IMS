import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_NAME, APP_SHORT_NAME, VENDOR_NAME } from '../src/lib/brand';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the product is named TindahanProMax Mobile POS, with a short name that fits under a home-screen icon', () => {
  assert.equal(APP_NAME, 'TindahanProMax Mobile POS');
  assert.equal(APP_SHORT_NAME, 'TindahanProMax');
});

test('the sign-in footer credits J2ItSecureTech by its exact name', () => {
  assert.equal(VENDOR_NAME, 'J2ItSecureTech');
  const layout = source('src/app/(auth)/layout.tsx');
  assert.match(layout, /<footer[\s\S]*\{VENDOR_NAME\}[\s\S]*<\/footer>/);
  assert.match(layout, /\{APP_NAME\}/);
});

test('no screen spells out the old product name by hand', () => {
  for (const path of ['src/app/(auth)/setup/page.tsx', 'src/features/billing/invoices-table.tsx']) {
    assert.doesNotMatch(source(path), /TindahanProMax POS/, path);
  }
});
