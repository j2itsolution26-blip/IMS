import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { db, type Seed } from './support/db';
import {
  allowOfflineUnlock,
  closeReceipt,
  expectChip,
  expectPrepared,
  expectTillKept,
  hasServiceWorker,
  openTill,
  pendingReceipt,
  sellCash,
  signIn,
  signOutOnline,
  unlockOffline,
} from './support/till';

/**
 * Offline sign-in on a trusted device: the till opens with no connection only
 * for a cashier who allowed offline unlock on this device while online, with
 * their username and PIN. Needs the service worker (production build).
 */

async function preparedDevice(page: Page, seed: Seed, options: { allow: boolean }) {
  await signIn(page, seed);
  await openTill(page);
  test.skip(!(await hasServiceWorker(page)), 'Offline sign-in needs a production build: the service worker is not registered in development.');
  await expectPrepared(page);
  if (options.allow) await allowOfflineUnlock(page, seed.pin);
  await expectTillKept(page);
}

/** A new page with the connection cut, at the offline till (as the service worker redirects). */
async function offlinePage(context: BrowserContext): Promise<Page> {
  await context.setOffline(true);
  const page = await context.newPage();
  await page.goto('/pos').catch(() => undefined);
  await page.waitForURL(/\/pos-offline$/, { timeout: 30_000 });
  return page;
}

test('without offline unlock set up, the device cannot be opened offline, even by its URL', async ({ page, context }) => {
  const seed = db.seed({ offline: true });
  await preparedDevice(page, seed, { allow: false });
  await page.close();

  const cold = await offlinePage(context);
  await expect(cold.getByRole('heading', { name: 'Offline setup required' })).toBeVisible({ timeout: 30_000 });
  await expect(cold.getByText(/An internet connection is needed the first time/)).toBeVisible();
  await expect(cold.getByText('Bath Soap', { exact: true })).toHaveCount(0);

  await cold.goto('/pos-offline').catch(() => undefined);
  await expect(cold.getByRole('heading', { name: 'Offline setup required' })).toBeVisible({ timeout: 30_000 });
  await expect(cold.getByText('Bath Soap', { exact: true })).toHaveCount(0);
});

test('a signed-out cashier unlocks offline with their PIN, sells, locks, and the sale syncs once after signing in', async ({ page, context }) => {
  const seed = db.seed({ offline: true });
  await preparedDevice(page, seed, { allow: true });
  // Signing out keeps the PIN-protected offline access.
  await signOutOnline(page);
  await page.close();

  const cold = await offlinePage(context);
  await expect(cold.getByRole('heading', { name: 'Offline sign-in' })).toBeVisible({ timeout: 30_000 });
  await expect(cold.getByText('Bath Soap', { exact: true })).toHaveCount(0);

  // A wrong PIN and an unknown username read the same.
  await unlockOffline(cold, seed.username, '0000');
  await expect(cold.locator('main [role="alert"]')).toHaveText('Username or PIN is incorrect.');
  await unlockOffline(cold, 'nobody-here', seed.pin);
  await expect(cold.locator('main [role="alert"]')).toHaveText('Username or PIN is incorrect.');

  await unlockOffline(cold, seed.username, seed.pin);
  await expect(cold.getByText('Bath Soap', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expectChip(cold, 'Offline · Sales available');

  await sellCash(cold, 50, { scan: seed.soapBarcode });
  const local = await pendingReceipt(cold);
  await closeReceipt(cold);

  // Lock: back to sign-in, nothing of the till shown, the sale kept.
  await cold.getByRole('button', { name: 'Lock' }).click();
  await expect(cold.getByRole('heading', { name: 'Offline sign-in' })).toBeVisible();
  await expect(cold.getByText('Bath Soap', { exact: true })).toHaveCount(0);
  await expect(cold.getByText('1 sale is saved on this device, waiting to sync.')).toBeVisible();

  // A reload asks for the PIN again; the sale survives it.
  await cold.reload().catch(() => undefined);
  await expect(cold.getByRole('heading', { name: 'Offline sign-in' })).toBeVisible({ timeout: 30_000 });
  await expect(cold.getByText('1 sale is saved on this device, waiting to sync.')).toBeVisible();
  await unlockOffline(cold, seed.username, seed.pin);
  await expectChip(cold, /1 pending/, 30_000);

  // Back online with no session in this browser: the sale waits for sign-in.
  await context.setOffline(false);
  await expect(cold.getByText('The connection is back.')).toBeVisible({ timeout: 30_000 });
  expect(db.state(seed.storeId).sales).toEqual([]);
  await cold.getByRole('button', { name: 'Open the full till' }).click();
  await cold.waitForURL(/\/sign-in/, { timeout: 60_000 });

  await signIn(cold, seed);
  await cold.goto('/pos', { timeout: 120_000 });
  await expectChip(cold, 'Synced', 90_000);
  const state = db.state(seed.storeId);
  expect(state.sales).toEqual([expect.objectContaining({ origin: 'OFFLINE', localReceiptNumber: local, total: 25 })]);
  expect(state.stock['Bath Soap']).toBe(49);
  expect(state.audits).toContain('PosDevice');
});

test('wrong PINs pause offline sign-in, and expired offline access refuses the right PIN', async ({ page, context }) => {
  const seed = db.seed({ offline: true });
  await preparedDevice(page, seed, { allow: true });
  await page.close();

  const cold = await offlinePage(context);
  await expect(cold.getByRole('heading', { name: 'Offline sign-in' })).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 5; i += 1) await unlockOffline(cold, seed.username, '0000');
  await expect(cold.locator('main [role="alert"]')).toContainText('Too many attempts: try again in 1 minute.');
  await expect(cold.getByRole('button', { name: /Try again in/ })).toBeDisabled();
  await cold.close();

  // 25 hours later, still offline: the 24-hour access period has ended.
  const later = await context.newPage();
  await later.clock.install({ time: Date.now() + 25 * 3_600_000 });
  await later.goto('/pos-offline').catch(() => undefined);
  await expect(later.getByRole('heading', { name: 'Offline sign-in' })).toBeVisible({ timeout: 30_000 });
  await unlockOffline(later, seed.username, seed.pin);
  await expect(later.getByRole('heading', { name: 'Offline authorization expired' })).toBeVisible({ timeout: 30_000 });
  await expect(later.getByText('Bath Soap', { exact: true })).toHaveCount(0);
});

test('a disabled account loses offline access as soon as the device is back online', async ({ page, context }) => {
  const seed = db.seed({ offline: true });
  await preparedDevice(page, seed, { allow: true });
  await signOutOnline(page);
  await page.close();

  const cold = await offlinePage(context);
  await expect(cold.getByRole('heading', { name: 'Offline sign-in' })).toBeVisible({ timeout: 30_000 });

  db.disableOwner(seed.storeId);
  await context.setOffline(false);
  // The device asks the server (no session needed) and drops the account.
  await expect(cold.getByRole('heading', { name: 'Offline setup required' })).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);
  await cold.reload().catch(() => undefined);
  await expect(cold.getByRole('heading', { name: 'Offline setup required' })).toBeVisible({ timeout: 30_000 });
});
