import { expect, test } from '@playwright/test';
import { db } from './support/db';
import { closeReceipt, expectChip, expectPrepared, openTill, pendingReceipt, sellCash, signIn } from './support/till';

const stockOf = async (page: import('@playwright/test').Page, name: string) => {
  const tile = page.locator('div.group', { has: page.getByText(name, { exact: true }) }).first();
  return (await tile.innerText()).match(/([\d.]+) in stock/)?.[1];
};

test('the connection drops while the till is open: cash sales continue and sync once', async ({ page, context }) => {
  const seed = db.seed({ offline: true });
  await signIn(page, seed);
  await openTill(page);
  await expectPrepared(page);

  await context.setOffline(true);
  await expectChip(page, 'Offline · Sales available');

  // Scan from the device copy, then search by name.
  await page.locator('input[aria-label="Scan or search products"]').fill(seed.soapBarcode);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Current order')).toBeVisible();
  await page.locator('input[aria-label="Scan or search products"]').fill('Ric');
  await page.getByText('Rice', { exact: true }).first().click();

  // Cash only.
  await page.getByRole('button', { name: /^Charge/ }).click();
  await expect(page.getByRole('button', { name: 'GCash' })).toBeDisabled();
  await expect(page.getByText(/^Offline: cash only/)).toBeVisible();
  await page.locator('#cash-received').fill('100');
  await page.getByRole('button', { name: 'Complete Sale' }).click();
  const local = await pendingReceipt(page);
  await closeReceipt(page);

  // Stock on the device is the copy less this sale; the drawer waits for the connection.
  await page.locator('input[aria-label="Scan or search products"]').fill('');
  await expect.poll(() => stockOf(page, 'Bath Soap')).toBe('49');
  await expect(page.getByRole('button', { name: /Close shift/ }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: /Cash in/ }).first()).toBeDisabled();

  await context.setOffline(false);
  await expectChip(page, 'Synced');
  await expect.poll(() => stockOf(page, 'Bath Soap')).toBe('49');

  const state = db.state(seed.storeId);
  expect(state.sales).toEqual([expect.objectContaining({ origin: 'OFFLINE', localReceiptNumber: local })]);
  expect(state.stock['Bath Soap']).toBe(49);
  expect(state.stock.Rice).toBe(19);
});
