import { expect, type Page } from '@playwright/test';
import type { Seed } from './db';

/** The sync chip next to the till's title. */
export const CHIP = 'button[aria-label*="Show sales on this device"]';
export const LOCAL_RECEIPT = /^OFF-[0-9A-F]{4}-\d{6}$/;

export async function signIn(page: Page, seed: Seed): Promise<void> {
  // The whole suite signs in from one address; Better Auth's sign-in rate
  // limit (HTTP 429) is waited out rather than counted as a failure.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto('/sign-in');
    await page.locator('#identifier').fill(seed.username);
    await page.locator('#password').fill(seed.password);
    await page.locator('button[type="submit"]').click();
    const outcome = await Promise.race([
      page.waitForURL(/\/(dashboard|pos)/, { timeout: 90_000 }).then(() => 'in' as const),
      page.getByText('(HTTP 429)').waitFor({ timeout: 90_000 }).then(() => 'limited' as const),
    ]);
    if (outcome === 'in') return;
    await page.waitForTimeout(15_000);
  }
  throw new Error('Sign-in stayed rate limited.');
}

export async function openTill(page: Page): Promise<void> {
  await page.goto('/pos', { timeout: 120_000 });
  await expect(page.getByText('Bath Soap', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expectChip(page, 'Synced');
}

export async function expectChip(page: Page, text: string | RegExp, timeout = 60_000): Promise<void> {
  await expect(page.locator(CHIP)).toContainText(text, { timeout });
}

/** Waits until the till has its catalogue copy, as the sync dialog reports it. */
export async function expectPrepared(page: Page): Promise<void> {
  await page.locator(CHIP).click();
  await expect(page.getByText('Ready: cash sales continue', { exact: false })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
}

/** Adds products (by tapping their tile, or by scanning a code) and takes cash. */
export async function sellCash(page: Page, cash: number, add: { tap?: string; scan?: string } = { tap: 'Bath Soap' }): Promise<void> {
  if (add.scan) {
    await page.locator('input[aria-label="Scan or search products"]').fill(add.scan);
    await page.keyboard.press('Enter');
    await expect(page.getByText('Current order')).toBeVisible();
  } else {
    await page.getByText(add.tap ?? 'Bath Soap', { exact: true }).first().click();
  }
  await page.getByRole('button', { name: /^Charge/ }).click();
  await page.locator('#cash-received').fill(String(cash));
  await page.getByRole('button', { name: 'Complete Sale' }).click();
}

/** The PENDING SYNC receipt's local number. */
export async function pendingReceipt(page: Page): Promise<string> {
  await expect(page.getByRole('heading', { name: /pending sync/i })).toBeVisible({ timeout: 30_000 });
  return page.getByRole('dialog').getByText(LOCAL_RECEIPT).first().innerText();
}

export async function closeReceipt(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Whether this is a production build with the service worker (cold start needs it). */
export async function hasServiceWorker(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const ready = navigator.serviceWorker.ready.then(() => true);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15_000));
    return Promise.race([ready, timeout]);
  });
}

/** Allows offline unlock on this prepared device with the cashier's PIN (sync dialog). */
export async function allowOfflineUnlock(page: Page, pin: string): Promise<void> {
  await page.locator(CHIP).click();
  await page.locator('#offline-unlock-pin').fill(pin);
  await page.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(page.getByText('Ready: with no connection, you can open this till')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
}

/** Signs this browser out through the auth API (the device keeps its offline access). */
export async function signOutOnline(page: Page): Promise<void> {
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return response.status;
  });
  expect(status).toBe(200);
}

/** Waits for the service worker to keep the offline till. */
export async function expectTillKept(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(async () => Boolean(await (await caches.open('tpm-till-v6')).match('/pos-offline'))), { timeout: 60_000 })
    .toBe(true);
}

/** The offline sign-in form on /pos-offline. */
export async function unlockOffline(page: Page, username: string, pin: string): Promise<void> {
  await page.locator('#offline-username').fill(username);
  await page.locator('#offline-pin').fill(pin);
  await page.getByRole('button', { name: 'Unlock till' }).click();
}
