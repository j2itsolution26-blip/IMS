import { expect, test } from '@playwright/test';
import { db } from './support/db';
import { closeReceipt, expectChip, expectPrepared, openTill, pendingReceipt, sellCash, signIn } from './support/till';

test('the owner reviews a flagged offline sale and removes the device', async ({ page, context }) => {
  const seed = db.seed({ offline: true });
  await signIn(page, seed);
  await openTill(page);
  await expectPrepared(page);

  // The shelf count changes on the server after the device took its copy.
  db.zeroStock(seed.storeId, seed.soap);
  await context.setOffline(true);
  await expectChip(page, 'Offline · Sales available');
  await sellCash(page, 50, { scan: seed.soapBarcode });
  const local = await pendingReceipt(page);
  await closeReceipt(page);
  await context.setOffline(false);
  await expectChip(page, 'Synced');

  await page.goto('/dashboard');
  await expect(page.getByText(/1 offline sale needs a look/)).toBeVisible({ timeout: 30_000 });
  await page.goto('/sales');
  await expect(page.getByText('Offline sale', { exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await page.goto('/sales/offline');
  await expect(page.getByText('Stock went below zero').first()).toBeVisible();
  await expect(page.getByText(`OFF-${local.split('-')[1]}`, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Resolve' }).first().click();
  await page.getByLabel('What was checked or done').fill('Counted 3 on the shelf, adjusted stock.');
  await page.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(page.getByText('Nothing to review')).toBeVisible();

  await page.goto('/sales/offline?status=resolved');
  await expect(page.getByText(/Counted 3 on the shelf/)).toBeVisible();
  await page.getByRole('link', { name: /^INV-/ }).first().click();
  await expect(page.getByText(local, { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto(`/shifts/${db.shiftId(seed.storeId)}`);
  await expect(page.getByText(/1 sale on this shift .* was made\s+offline/)).toBeVisible({ timeout: 30_000 });

  await page.goto('/sales/offline');
  await page.getByRole('button', { name: 'Remove' }).first().click();
  await page.getByRole('button', { name: 'Remove device' }).click();
  await expect(page.getByText('Removed', { exact: true }).first()).toBeVisible();

  // A removed device is refused the product list.
  const answer = await page.evaluate(async () => {
    const deviceId = await new Promise<string>((resolve, reject) => {
      const open = indexedDB.open('tindahanpromax-pos');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const get = open.result.transaction('meta').objectStore('meta').get('device');
        get.onsuccess = () => resolve((get.result as { id: string }).id);
      };
    });
    const response = await fetch(`/api/pos/catalog?deviceId=${deviceId}`);
    return { status: response.status, code: ((await response.json()) as { code?: string }).code };
  });
  expect(answer).toEqual({ status: 403, code: 'DEVICE_REVOKED' });

  const state = db.state(seed.storeId);
  expect(state.issues).toEqual([{ kind: 'STOCK_SHORTFALL', status: 'RESOLVED', resolutionNote: 'Counted 3 on the shelf, adjusted stock.' }]);
  expect(state.devices).toEqual([expect.objectContaining({ revoked: true })]);
  expect(state.audits.sort()).toEqual(['PosDevice', 'SyncIssue']);
  expect(state.stock['Bath Soap']).toBe(-1);
});
