import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('the app has exactly one theme control, in the header', () => {
  const shell = read('src/components/layout/app-shell.tsx');
  const sidebar = read('src/components/layout/sidebar.tsx');
  assert.equal(shell.match(/<ThemeToggle\b/g)?.length, 1, 'one control in the header');
  assert.doesNotMatch(sidebar, /ThemeToggle|useTheme/, 'no theme control or theme state in the sidebar');
});

test('theme state has one source: the root provider, following the device in System mode', () => {
  const layout = read('src/app/layout.tsx');
  assert.match(layout, /<ThemeProvider attribute="class" defaultTheme="system" enableSystem/);
  const toggle = read('src/components/theme-toggle.tsx');
  assert.match(toggle, /useTheme\(\)/);
  for (const value of ['light', 'dark', 'system']) assert.match(toggle, new RegExp(`value: '${value}'`));
});
