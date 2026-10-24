import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTING_DEFINITIONS, settingProblem, settingRow } from '@/lib/settings-definitions';
import { SETTINGS_SECTIONS, changedKeys, currencySymbol, logoFileProblem } from '@/features/admin/settings-sections';

/**
 * The setting rules shared by the settings form and `updateSettings`, and the
 * form's layout helpers.
 */

const definition = (key: string) => {
  const found = SETTING_DEFINITIONS.find((d) => d.key === key);
  assert.ok(found, `missing definition ${key}`);
  return found;
};
const problem = (key: string, value: string) => settingProblem(definition(key), value);

test('every default value passes its own rules', () => {
  for (const d of SETTING_DEFINITIONS) {
    assert.equal(settingProblem(d, d.value), null, `${d.key} default "${d.value}" is rejected`);
  }
});

test('numbers: required, finite, within range, whole where needed', () => {
  assert.equal(problem('inventory.criticalStockRatio', ''), 'Enter a number.');
  assert.equal(problem('inventory.criticalStockRatio', 'abc'), 'Enter a number.');
  assert.equal(problem('inventory.criticalStockRatio', 'Infinity'), 'Enter a number.');
  assert.equal(problem('inventory.criticalStockRatio', '0.25'), null);
  assert.match(problem('inventory.criticalStockRatio', '1.5') ?? '', /1 or less/);
  assert.match(problem('sales.defaultTaxRate', '-1') ?? '', /0 or more/);
  assert.equal(problem('sales.defaultTaxRate', '12'), null);
  assert.equal(problem('inventory.slowMovingDays', '7.5'), 'Enter a whole number.');
  assert.match(problem('inventory.deadStockDays', '0') ?? '', /1 or more/);
  assert.equal(problem('security.autoLockMinutes', '0'), null);
  assert.match(problem('security.autoLockMinutes', '2000') ?? '', /1,440 or less/);
  assert.equal(problem('shifts.overdueHours', ' 12 '), null, 'values are checked trimmed');
});

test('booleans accept only true or false', () => {
  assert.equal(problem('inventory.allowNegativeStock', 'true'), null);
  assert.equal(problem('inventory.allowNegativeStock', 'false'), null);
  assert.ok(problem('inventory.allowNegativeStock', 'yes'));
});

test('text: required, length, currency code', () => {
  assert.equal(problem('company.name', '   '), 'This field is required.');
  assert.equal(problem('company.address', ''), null);
  assert.match(problem('company.name', 'x'.repeat(121)) ?? '', /120 characters/);
  assert.equal(problem('locale.currency', 'PHP'), null);
  assert.ok(problem('locale.currency', 'php'));
  assert.ok(problem('locale.currency', 'PESO'));
  assert.ok(problem('locale.currency', ''));
});

test('the logo must be an http(s) address or empty', () => {
  assert.equal(problem('company.logoUrl', ''), null);
  assert.equal(problem('company.logoUrl', 'https://example.supabase.co/storage/v1/object/public/b/logo.png'), null);
  assert.ok(problem('company.logoUrl', 'javascript:alert(1)'));
  assert.ok(problem('company.logoUrl', 'data:image/png;base64,AAAA'));
  assert.ok(problem('company.logoUrl', 'not a url'));
});

test('a database row never carries the rules', () => {
  const row = settingRow(definition('sales.defaultTaxRate'));
  assert.deepEqual(Object.keys(row).sort(), ['description', 'group', 'key', 'label', 'type', 'value']);
});

test('the layout places every setting once, in its own group, and nothing else', () => {
  const placed = SETTINGS_SECTIONS.flatMap((section) => section.fields.map((field) => ({ key: field.key, group: section.group })));
  assert.equal(new Set(placed.map((p) => p.key)).size, placed.length, 'a setting is placed twice');
  for (const { key, group } of placed) assert.equal(definition(key).group, group, `${key} is in the wrong card`);
  assert.deepEqual(placed.map((p) => p.key).sort(), SETTING_DEFINITIONS.map((d) => d.key).sort());
});

test('changedKeys lists only values that differ from what is saved', () => {
  const saved = { a: '1', b: 'x', c: '' };
  assert.deepEqual(changedKeys({ ...saved }, saved), []);
  assert.deepEqual(changedKeys({ ...saved, b: 'y', c: ' ' }, saved), ['b', 'c']);
});

test('currencySymbol writes pesos as ₱ and falls back to the code', () => {
  assert.equal(currencySymbol('PHP'), '₱');
  assert.equal(currencySymbol('not-a-code'), 'not-a-code');
});

test('logo files: PNG, JPG or WEBP, not empty, at most 5 MB', () => {
  assert.equal(logoFileProblem({ type: 'image/png', size: 2048 }), null);
  assert.equal(logoFileProblem({ type: 'image/webp', size: 5 * 1024 * 1024 }), null);
  assert.ok(logoFileProblem({ type: 'image/svg+xml', size: 2048 }), 'SVG can carry script');
  assert.ok(logoFileProblem({ type: 'image/gif', size: 2048 }));
  assert.ok(logoFileProblem({ type: 'image/png', size: 0 }));
  assert.ok(logoFileProblem({ type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }));
});
