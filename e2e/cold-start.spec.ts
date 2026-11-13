import { expect, test } from '@playwright/test';
import { db } from './support/db';
import { allowOfflineUnlock, closeReceipt, expectChip, expectPrepared, hasServiceWorker, openTill, pendingReceipt, sellCash, signIn, unlockOffline } from './support/till';

/**
 * A prepared till opens with no connection at all. Needs the service worker,
 * which only a production build registers (next build && next start).
 */
test('a prepared till opens with no connection, sells, and syncs once', async ({ page, context }) => {
  const seed = db.seed({ offline: true });
  await signIn(page, seed);
  await openTill(page);
  test.skip(!(await hasServiceWorker(page)), 'Cold start needs a production build: the service worker is not registered in development.');
  await expectPrepared(page);
  await allowOfflineUnlock(page, seed.pin);

  // The till asks the worker to keep the offline till once prepared.
  await expect
    .poll(() => page.evaluate(async () => Boolean(await (await caches.open('tpm-till-v6')).match('/pos-offline'))), { timeout: 60_000 })
    .toBe(true);
  const leaked = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const key of await (await caches.open(name)).keys()) if (/\/api\/|_rsc=/.test(key.url)) urls.push(key.url);
    return urls;
  });
  expect(leaked, 'no API or page data is ever cached').toEqual([]);
  await page.close();

  await context.setOffline(true);
  const cold = await context.newPage();
  await cold.goto('/pos').catch(() => undefined);
  await cold.waitForURL(/\/pos-offline$/, { timeout: 30_000 });
  await unlockOffline(cold, seed.username, seed.pin);
  await expect(cold.getByText('Bath Soap', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expectChip(cold, 'Offline · Sales available');

  await sellCash(cold, 50, { scan: seed.soapBarcode });
  const local = await pendingReceipt(cold);
  await expect(cold.getByRole('dialog')).toContainText('Till Owner');
  await closeReceipt(cold);

  await cold.reload().catch(() => undefined);
  // A reload ends the offline session: the PIN is asked again.
  await unlockOffline(cold, seed.username, seed.pin);
  await expectChip(cold, /1 pending/, 30_000);

  await context.setOffline(false);
  await expectChip(cold, 'Synced');
  await expect(cold.getByText('The connection is back.')).toBeVisible();

  const state = db.state(seed.storeId);
  expect(state.sales).toEqual([expect.objectContaining({ origin: 'OFFLINE', localReceiptNumber: local, total: 25 })]);
  expect(state.stock['Bath Soap']).toBe(49);
});
