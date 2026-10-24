import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTING_DEFINITIONS, settingProblem, settingRow } from '@/lib/settings-definitions';

/**
 * The setting rules shared by the settings form and `updateSettings`.
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
