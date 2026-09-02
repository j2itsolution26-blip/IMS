import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const SHOTS = 'C:\\Users\\JANMIC~1\\AppData\\Local\\Temp\\claude\\c--Users-Jan-Michael-Desktop-IMS\\77870b2a-f820-43ec-bb11-da814d6a234b\\scratchpad\\shots';
let shotIndex = 0;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

  const shot = async (name: string) => {
    shotIndex += 1;
    const path = `${SHOTS}\\${String(shotIndex).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path, fullPage: true });
    console.log('screenshot:', path);
  };

  console.log('--- sign up (first account becomes Owner) ---');
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
  await page.fill('#name', 'Store Owner');
  await page.fill('#email', 'owner@sari-sari.test');
  await page.fill('#password', 'OwnerPass123!');
  await page.fill('#confirmPassword', 'OwnerPass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  await shot('dashboard');
  console.log('signed up as owner, on dashboard');

  console.log('--- create product ---');
  await page.goto(`${BASE}/products/new`, { waitUntil: 'networkidle' });
  await page.fill('#name', 'Test Chippy 55g');
  await page.fill('#sku', 'E2E-CHIPPY-55');
  await page.fill('#barcode', '4801234567890');
  await page.fill('#costPrice', '10');
  await page.fill('#sellingPrice', '15');

  // Category via inline quick-add
  const catAddBtn = page.locator('button[aria-label="Add category"]');
  await catAddBtn.click();
  await page.fill('#quick-category-name', 'E2E Snacks');
  await page.click('div[role="dialog"] button:has-text("Add")');
  await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 10000 });

  // Unit via inline quick-add
  const unitAddBtn = page.locator('button[aria-label="Add unit"]');
  await unitAddBtn.click();
  await page.fill('#quick-unit-name', 'E2E Piece');
  await page.fill('#quick-unit-abbr', 'e2epc');
  await page.click('div[role="dialog"] button:has-text("Add")');
  await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 10000 });

  await shot('product-form-filled');
  await page.click('button:has-text("Create product")');
  await page.waitForURL((url) => /\/products\/[a-z0-9]+$/i.test(url.pathname) && !url.pathname.endsWith('/new'), {
    timeout: 15000,
  });
  await shot('product-created');
  const productUrl = page.url();
  console.log('product created at', productUrl);

  console.log('--- stock in via inventory ---');
  await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder*="Search name"]', 'Chippy');
  await page.waitForTimeout(600);
  await shot('inventory-search');
  await page.click('button:has-text("Stock in")');
  await page.waitForSelector('#stock-in-qty');
  await page.fill('#stock-in-qty', '50');
  await shot('stock-in-dialog');
  await page.click('div[role="dialog"] button:has-text("Save")');
  await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 10000 });
  await shot('stock-in-done');

  console.log('--- POS: open shift ---');
  await page.goto(`${BASE}/pos`, { waitUntil: 'networkidle' });
  await shot('pos-initial');
  const openingCashInput = page.locator('#opening-cash');
  if (await openingCashInput.isVisible().catch(() => false)) {
    await openingCashInput.fill('500');
    await page.click('button:has-text("Open shift")');
  } else {
    console.log('shift already open, skipping open-shift step');
  }
  const searchBox = page.locator('input[aria-label="Scan or search products"]');
  await searchBox.waitFor({ state: 'visible', timeout: 15000 });
  await shot('pos-shift-open');

  console.log('--- POS: search and add product ---');
  await searchBox.fill('Chippy');
  await page.waitForTimeout(700);
  await shot('pos-search-results');
  await page.click('button:has-text("Test Chippy 55g")');
  await page.waitForTimeout(500);
  await shot('pos-cart-with-item');

  console.log('--- POS: take payment ---');
  await page.click('button:has-text("Take payment")');
  await page.waitForSelector('text=Take payment');
  await shot('pos-payment-dialog');
  // Default tender is CASH pre-filled with exact total; overpay to see change.
  const amountInput = page.locator('div[role="dialog"] input[aria-label="Amount tendered"]').first();
  await amountInput.fill('100');
  await shot('pos-payment-overpaid');
  await page.click('button:has-text("Complete sale")');
  await page.waitForSelector('text=Sale complete', { timeout: 15000 });
  await shot('pos-receipt');
  console.log('sale completed, receipt shown');
  await page.click('div[role="dialog"] button:has-text("Close")');
  await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 10000 });

  console.log('--- POS: close shift ---');
  await page.click('button:has-text("Close shift")');
  await page.waitForSelector('text=Expected cash', { timeout: 10000 });
  await shot('pos-close-shift-preview');
  const actualCashInput = page.locator('#actual-cash');
  await actualCashInput.fill('599');
  // The dialog footer button is also labelled "Close shift" — scope to the dialog to avoid ambiguity with the header trigger.
  await page.locator('div[role="dialog"] button:has-text("Close shift")').click();
  await page.waitForSelector('text=Shift closed', { timeout: 10000 });
  await shot('pos-shift-closed-summary');
  await page.click('div[role="dialog"] button:has-text("Done")');
  await page.waitForTimeout(500);
  await shot('pos-after-shift-closed');

  console.log('--- Sales: find the sale and refund it ---');
  await page.goto(`${BASE}/sales`, { waitUntil: 'networkidle' });
  await shot('sales-list');
  await page.click('table tbody tr:first-child a');
  await page.waitForURL(/\/sales\/[a-z0-9]+$/i);
  await shot('sale-detail-before-refund');

  const recordReturnBtn = page.locator('button:has-text("Record return")');
  await recordReturnBtn.click();
  await page.waitForSelector('text=Return against');
  await shot('refund-dialog');
  const qtyInput = page.locator('div[role="dialog"] input[type="number"]').first();
  await qtyInput.fill('1');
  await page.fill('#return-reason', 'E2E test refund');
  await shot('refund-dialog-filled');
  await page.click('button:has-text("Process return")');
  await page.waitForTimeout(1500);
  await shot('sale-detail-after-refund');

  console.log('--- verify inventory restored ---');
  await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' });
  await page.fill('input[placeholder*="Search name"]', 'Chippy');
  await page.waitForTimeout(700);
  await shot('inventory-after-refund');

  console.log('\nCONSOLE/PAGE ERRORS:', errors.length === 0 ? 'none' : errors);
  await browser.close();
  console.log('\nDONE ✔');
}

main().catch((error) => {
  console.error('BROWSER E2E FAILED:', error);
  process.exitCode = 1;
});
