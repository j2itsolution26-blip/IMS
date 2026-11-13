import { expect, test } from '@playwright/test';
import { db } from './support/db';
import { CHIP, closeReceipt, expectChip, openTill, pendingReceipt, sellCash, signIn } from './support/till';

/**
 * Every sale is saved on the device first, and recorded exactly once
 * however the connection behaves: a normal sale, a lost response, a full
 * outage with a reload in the middle.
 */
test('online sales, a lost response and an outage: each sale recorded exactly once', async ({ page }) => {
  const seed = db.seed();
  await signIn(page, seed);
  await openTill(page);

  // 1. A normal online sale gets its invoice straight away.
  await sellCash(page, 100);
  await expect(page.getByRole('heading', { name: 'Sale complete' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog').getByText(/^INV-\d{6}$/).first()).toBeVisible();
  await closeReceipt(page);

  // 2. The server records the sale but the answer never arrives.
  await page.route('**/api/pos/checkout', async (route) => {
    await route.fetch();
    await route.abort('connectionreset');
  });
  await sellCash(page, 50);
  const lost = await pendingReceipt(page);
  await expect(page.getByText('PENDING SYNC', { exact: true })).toBeVisible();
  await closeReceipt(page);
  await page.unroute('**/api/pos/checkout');

  // 3. Nothing reaches the server; the page is even reloaded while down.
  const down = (route: { abort: (code: string) => Promise<void> }) => route.abort('internetdisconnected');
  await page.route('**/api/pos/checkout', down);
  await page.route('**/api/pos/sync', down);
  await sellCash(page, 30);
  const outage = await pendingReceipt(page);
  await closeReceipt(page);
  await page.reload({ timeout: 120_000 });
  await expect(page.getByText('Bath Soap', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expectChip(page, /2 pending/);

  // 4. Back up: Retry sends everything.
  await page.unroute('**/api/pos/checkout');
  await page.unroute('**/api/pos/sync');
  await page.locator(CHIP).click();
  await page.getByRole('button', { name: /Retry now/ }).click();
  await expectChip(page, 'Synced');
  const sent = page.getByRole('dialog');
  await expect(sent).toContainText(lost);
  await expect(sent).toContainText(outage);

  const state = db.state(seed.storeId);
  expect(state.sales).toHaveLength(3);
  expect(new Set(state.sales.map((sale) => sale.clientRequestId)).size).toBe(3);
  expect(state.stock['Bath Soap']).toBe(47);
});
