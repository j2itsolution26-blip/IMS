import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * The offline POS endpoints end to end (migration 20261120090000): a real
 * sign-in, real HTTP to /api/pos/devices, /api/pos/catalog and /api/pos/sync
 * on a running app, and the rows they leave in PostgreSQL.
 *
 * Needs the app running against the same local database:
 *
 *   INTEGRATION_DATABASE_URL=postgresql://…@localhost:54333/ims_test
 *   OFFLINE_API_URL=http://localhost:3107       (next dev/start on that database)
 *   npm run test:integration
 *
 * Refuses any database host but localhost. Leaves its uniquely named rows.
 */

const URL_ENV = process.env.INTEGRATION_DATABASE_URL;
const APP = process.env.OFFLINE_API_URL;

if (!URL_ENV || !APP) {
  test('offline sync API (integration)', { skip: 'set INTEGRATION_DATABASE_URL and OFFLINE_API_URL (a local app on that database)' }, () => {});
} else {
  const host = new URL(URL_ENV).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`Refusing to run offline sync tests against ${host}; use a local database.`);
  if (!['localhost', '127.0.0.1'].includes(new URL(APP).hostname)) throw new Error('OFFLINE_API_URL must be a local app.');
  process.env.DATABASE_URL = URL_ENV;

  const run = randomBytes(4).toString('hex');
  const password = 'OwnerPass1!x';
  let db: PrismaClient;
  let cookie = '';

  // Store A: the till under test. Store B: someone else's shop.
  const a = { storeId: '', ownerId: '', warehouseId: '', shiftId: '', otherUserId: '', otherShiftId: '', categoryId: '' };
  const b = { storeId: '', ownerId: '', warehouseId: '', productId: '', shiftId: '' };
  const product = { rice: '', soap: '', candy: '' };
  const deviceId = randomUUID();
  let catalogFetchedAt = '';

  /** Switches the store's offline selling on or off, as the owner does in Settings. */
  const setOfflineMode = (storeId: string, on: boolean) =>
    db.setting.upsert({
      where: { storeId_key: { storeId, key: 'pos.offlineMode' } },
      create: { storeId, key: 'pos.offlineMode', value: String(on), type: 'BOOLEAN', group: 'sales', label: 'Offline cash sales' },
      update: { value: String(on) },
    });

  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

  async function call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}) {
    const response = await fetch(`${APP}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        origin: APP!,
        ...(init.auth === false ? {} : { cookie }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    return { status: response.status, body };
  }

  let receiptSeq = 0;
  function offlineSale(overrides: Record<string, unknown> = {}) {
    receiptSeq += 1;
    return {
      id: randomUUID(),
      localReceiptNumber: `OFF-${run.toUpperCase().slice(0, 4)}-${String(receiptSeq).padStart(6, '0')}`,
      occurredAt: minutesAgo(5),
      catalogFetchedAt,
      userId: a.ownerId,
      shiftId: a.shiftId,
      warehouseId: a.warehouseId,
      taxRate: 0,
      items: [{ productId: product.rice, quantity: 0.25, unitPrice: 60 }],
      cashTendered: 20,
      total: 15,
      ...overrides,
    };
  }

  const sync = (sale: Record<string, unknown>, device = deviceId) => call('/api/pos/sync', { body: { deviceId: device, sale } });

  async function stock(productId: string, warehouseId = a.warehouseId) {
    const row = await db.inventory.findUnique({ where: { productId_warehouseId: { productId, warehouseId } }, select: { quantity: true } });
    return row ? Number(row.quantity) : 0;
  }

  async function newStore(label: string) {
    const subs = await import('@/server/platform/subscription-service');
    const admin = await db.user.findFirstOrThrow({ where: { role: { slug: 'system-admin' } }, select: { id: true, name: true } });
    const username = `${label}${run}`;
    const { storeId, ownerId } = await subs.createStore(admin, {
      storeName: `Offline ${label} ${run}`,
      owner: { name: `Owner ${label}`, username, email: `${username}@offline.test`, password },
      allowSimilar: true,
    });
    // An administrator-made owner must change the password first; this test is not about that.
    await db.user.update({ where: { id: ownerId }, data: { mustChangePassword: false } });
    const warehouse = await db.warehouse.findFirstOrThrow({ where: { storeId, isDefault: true }, select: { id: true } });
    const category = await db.category.create({ data: { storeId, name: `General ${label}`, slug: `general-${label}-${run}` }, select: { id: true } });
    return { storeId, ownerId, username, warehouseId: warehouse.id, categoryId: category.id };
  }

  before(async () => {
    ({ platformPrisma: db } = await import('@/lib/prisma'));
    const [row] = await db.$queryRaw<{ host: string | null }[]>`select inet_server_addr()::text as host`;
    if (row?.host && !/^(127\.|::1)/.test(row.host)) throw new Error(`Refusing: connected to ${row.host}`);

    const storeA = await newStore('a');
    Object.assign(a, { storeId: storeA.storeId, ownerId: storeA.ownerId, warehouseId: storeA.warehouseId, categoryId: storeA.categoryId });
    await setOfflineMode(storeA.storeId, true);
    const storeB = await newStore('b');
    Object.assign(b, { storeId: storeB.storeId, ownerId: storeB.ownerId, warehouseId: storeB.warehouseId });

    const make = (storeId: string, categoryId: string, sku: string, data: Record<string, unknown>) =>
      db.product.create({ data: { storeId, categoryId, sku, name: sku, ...data } as never, select: { id: true } });
    product.rice = (await make(a.storeId, a.categoryId, `RICE-${run}`, { sellingPrice: 60, costPrice: 45, unit: 'KILOGRAM', allowsDecimal: true, barcode: `4800 ${run}` })).id;
    product.soap = (await make(a.storeId, a.categoryId, `SOAP-${run}`, { sellingPrice: 25, costPrice: 18 })).id;
    product.candy = (await make(a.storeId, a.categoryId, `CANDY-${run}`, { sellingPrice: 2, costPrice: 1 })).id;
    b.productId = (await make(b.storeId, storeB.categoryId, `B-${run}`, { sellingPrice: 10 })).id;
    for (const [productId, quantity] of [[product.rice, 5], [product.soap, 1], [product.candy, 100]] as const) {
      await db.inventory.create({ data: { storeId: a.storeId, productId, warehouseId: a.warehouseId, quantity } });
    }

    a.shiftId = (await db.cashierShift.create({ data: { storeId: a.storeId, userId: a.ownerId, warehouseId: a.warehouseId, openingCash: 1000, openedAt: new Date(Date.now() - 3 * 3600_000) } })).id;
    b.shiftId = (await db.cashierShift.create({ data: { storeId: b.storeId, userId: b.ownerId, warehouseId: b.warehouseId, openingCash: 0 } })).id;

    // A second cashier in store A, who never signs in here.
    const cashierRole = await db.role.findFirstOrThrow({ where: { storeId: a.storeId, slug: { not: 'owner' } }, select: { id: true } });
    a.otherUserId = (
      await db.user.create({
        data: { storeId: a.storeId, name: 'Other cashier', username: `other${run}`, email: `other${run}@offline.test`, roleId: cashierRole.id, warehouseId: a.warehouseId },
        select: { id: true },
      })
    ).id;
    a.otherShiftId = (await db.cashierShift.create({ data: { storeId: a.storeId, userId: a.otherUserId, warehouseId: a.warehouseId, openingCash: 500 } })).id;

    const signIn = await fetch(`${APP}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP! },
      body: JSON.stringify({ username: storeA.username, password }),
    });
    assert.equal(signIn.status, 200, `sign-in failed: ${await signIn.text()}`);
    cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    assert.ok(cookie.length > 0, 'a session cookie was set');
  });

  after(async () => {
    await db?.$disconnect();
  });

  describe('guards', () => {
    test('no session: 401, and nothing is recorded', async () => {
      const sale = offlineSale();
      const response = await call('/api/pos/sync', { body: { deviceId, sale }, auth: false });
      assert.equal(response.status, 401);
      assert.equal(response.body.retryable, false);
      assert.equal(await db.sale.count({ where: { clientRequestId: sale.id } }), 0);
    });

    test('another site’s page cannot post a sale', async () => {
      const response = await call('/api/pos/sync', { body: { deviceId, sale: offlineSale() }, headers: { origin: 'https://evil.example' } });
      assert.equal(response.status, 403);
      assert.equal(response.body.code, 'CROSS_ORIGIN');
    });

    test('a form post (not JSON) is refused', async () => {
      const response = await fetch(`${APP}/api/pos/sync`, { method: 'POST', headers: { cookie, origin: APP!, 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
      assert.equal(response.status, 415);
    });

    test('a malformed sale is refused as permanent (422), not retried', async () => {
      const response = await sync({ ...offlineSale(), items: [] });
      assert.equal(response.status, 422);
      assert.equal(response.body.retryable, false);
    });
  });

  describe('preparing a device', () => {
    test('registers the device for this store', async () => {
      const response = await call('/api/pos/devices', { body: { deviceId, label: 'Counter tablet' } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.device.revoked, false);
      const row = await db.posDevice.findUniqueOrThrow({ where: { id: deviceId } });
      assert.equal(row.storeId, a.storeId);
      assert.equal(row.registeredById, a.ownerId);
    });

    test('the catalogue copy has selling data only, scoped to this store and branch', async () => {
      const response = await call(`/api/pos/catalog?deviceId=${deviceId}`);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const catalog = response.body.catalog;
      catalogFetchedAt = catalog.fetchedAt;
      assert.equal(catalog.store.id, a.storeId);
      assert.equal(catalog.openShift.id, a.shiftId);
      const rice = catalog.products.find((p: { id: string }) => p.id === product.rice);
      assert.equal(rice.stock, 5);
      assert.equal(rice.unit, 'KILOGRAM');
      assert.equal(rice.barcodeKey, `4800${run}`.toUpperCase(), 'barcodes are pre-normalised for scanning');
      assert.equal('costPrice' in rice, false, 'cost prices never leave the server');
      assert.equal(catalog.products.some((p: { id: string }) => p.id === b.productId), false, 'no other store’s products');
      assert.match(response.body && JSON.stringify(response.body), /fetchedAt/);
    });

    test('with offline selling switched off, no catalogue copy is handed out', async () => {
      await setOfflineMode(a.storeId, false);
      try {
        const response = await call(`/api/pos/catalog?deviceId=${deviceId}`);
        assert.equal(response.status, 403);
        assert.equal(response.body.code, 'OFFLINE_DISABLED');
      } finally {
        await setOfflineMode(a.storeId, true);
      }
    });

    test('the copy says how long the device may sell offline', async () => {
      const response = await call(`/api/pos/catalog?deviceId=${deviceId}`);
      assert.equal(response.body.catalog.offlineAccessHours, 72);
    });

    test('the catalogue is never cached', async () => {
      const response = await fetch(`${APP}/api/pos/catalog?deviceId=${deviceId}`, { headers: { cookie } });
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    });
  });

  describe('uploading offline sales', () => {
    let first: Record<string, unknown>;
    let firstInvoice = '';

    test('a cash sale is recorded as charged, filed at the time it happened', async () => {
      first = offlineSale({
        occurredAt: minutesAgo(30),
        items: [
          { productId: product.rice, quantity: 0.25, unitPrice: 60 },
          { productId: product.candy, quantity: 3, unitPrice: 2 },
        ],
        cashTendered: 50,
        total: 21,
      });
      const response = await sync(first);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.status, 'recorded');
      assert.deepEqual(response.body.issues, []);
      firstInvoice = response.body.sale.invoiceNumber;
      assert.match(firstInvoice, /^INV-\d{6}$/);
      assert.equal(response.body.sale.changeAmount, 29);

      const sale = await db.sale.findUniqueOrThrow({ where: { id: response.body.sale.id }, include: { items: true, payments: true } });
      assert.equal(sale.origin, 'OFFLINE');
      assert.equal(sale.storeId, a.storeId);
      assert.equal(sale.shiftId, a.shiftId);
      assert.equal(sale.deviceId, deviceId);
      assert.equal(sale.localReceiptNumber, first.localReceiptNumber);
      assert.equal(sale.clientRequestId, first.id);
      assert.equal(sale.createdAt.toISOString(), first.occurredAt, 'filed when it happened');
      assert.ok(sale.receivedAt.getTime() > sale.createdAt.getTime(), 'received later, recorded separately');
      assert.equal(Number(sale.total), 21);
      assert.equal(Number(sale.paidAmount), 21);
      assert.equal(sale.items.length, 2);
      assert.equal(Number(sale.items.find((i) => i.productId === product.rice)!.unitCost), 45, 'cost frozen per line');
      assert.equal(sale.payments.length, 1);
      assert.equal(sale.payments[0].method, 'CASH');
      assert.equal(Number(sale.payments[0].amount), 50, 'cash tendered, with change on the sale, as online');
      assert.equal(sale.payments[0].createdAt.toISOString(), first.occurredAt);
      assert.equal(await stock(product.rice), 4.75, 'a quarter kilo off exactly');
      assert.equal(await stock(product.candy), 97);
    });

    test('the same upload again (a lost response) records nothing new', async () => {
      const again = await sync(first);
      assert.equal(again.status, 200);
      assert.equal(again.body.status, 'duplicate');
      assert.equal(again.body.sale.invoiceNumber, firstInvoice);
      assert.equal(await db.sale.count({ where: { clientRequestId: first.id as string } }), 1);
      assert.equal(await db.payment.count({ where: { sale: { clientRequestId: first.id as string } } }), 1);
      assert.equal(await stock(product.rice), 4.75, 'stock is not deducted twice');
      assert.equal(await db.inventoryTransaction.count({ where: { productId: product.rice, referenceType: 'SALE' } }), 1);
    });

    test('the same sale uploaded five times at once records one sale', async () => {
      const sale = offlineSale({ items: [{ productId: product.candy, quantity: 1, unitPrice: 2 }], cashTendered: 2, total: 2 });
      const responses = await Promise.all(Array.from({ length: 5 }, () => sync(sale)));
      for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(new Set(responses.map((r) => r.body.sale.invoiceNumber)).size, 1);
      assert.equal(responses.filter((r) => r.body.status === 'recorded').length, 1);
      assert.equal(await db.sale.count({ where: { clientRequestId: sale.id as string } }), 1);
      assert.equal(await stock(product.candy), 96);
    });

    test('more than the stock on hand is still recorded, and flagged', async () => {
      const response = await sync(offlineSale({ items: [{ productId: product.soap, quantity: 3, unitPrice: 25 }], cashTendered: 100, total: 75 }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.issues, ['STOCK_SHORTFALL']);
      assert.equal(await stock(product.soap), -2);
      const issue = await db.syncIssue.findFirstOrThrow({ where: { saleId: response.body.sale.id } });
      assert.equal(issue.kind, 'STOCK_SHORTFALL');
      assert.equal(issue.status, 'OPEN');
      assert.equal(issue.productId, product.soap);
      assert.equal(issue.storeId, a.storeId);
      assert.equal(issue.warehouseId, a.warehouseId);
    });

    test('a price the product never had is recorded as charged, and flagged', async () => {
      const response = await sync(offlineSale({ items: [{ productId: product.candy, quantity: 1, unitPrice: 1 }], cashTendered: 1, total: 1 }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.issues, ['PRICE_MISMATCH']);
      const sale = await db.sale.findUniqueOrThrow({ where: { id: response.body.sale.id }, include: { items: true } });
      assert.equal(Number(sale.items[0].unitPrice), 1, 'the price actually charged');
    });

    test('a price changed after the catalogue was downloaded is honest, and not flagged', async () => {
      await db.product.update({ where: { id: product.candy }, data: { sellingPrice: 3 } });
      await db.priceHistory.create({ data: { storeId: a.storeId, productId: product.candy, field: 'SELLING', oldValue: 2, newValue: 3 } });
      const response = await sync(offlineSale({ items: [{ productId: product.candy, quantity: 1, unitPrice: 2 }], cashTendered: 2, total: 2 }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.issues, []);
    });

    test('a device total that does not add up is recorded at the server’s sum, and flagged', async () => {
      const response = await sync(offlineSale({ items: [{ productId: product.rice, quantity: 1, unitPrice: 60 }], cashTendered: 100, total: 50 }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.issues, ['TOTAL_MISMATCH']);
      assert.equal(response.body.sale.total, 60);
      assert.equal(response.body.sale.changeAmount, 40);
    });

    test('a clock in the future is filed now, never ahead', async () => {
      const sale = offlineSale({ occurredAt: new Date(Date.now() + 86_400_000).toISOString(), items: [{ productId: product.candy, quantity: 1, unitPrice: 3 }], cashTendered: 3, total: 3 });
      const response = await sync(sale);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const row = await db.sale.findUniqueOrThrow({ where: { id: response.body.sale.id } });
      assert.ok(row.createdAt.getTime() <= row.receivedAt.getTime());
    });
  });

  describe('live checkout at a stable URL (POST /api/pos/checkout)', () => {
    const checkout = (body: Record<string, unknown>) => call('/api/pos/checkout', { body });
    const basket = (id: string, extra: Record<string, unknown> = {}) => ({
      items: [{ productId: product.candy, quantity: 2 }],
      payments: [{ method: 'CASH', amount: 10 }],
      clientRequestId: id,
      ...extra,
    });

    test('a live sale is priced by the server and recorded once, however often it is sent', async () => {
      const id = randomUUID();
      const first = await checkout(basket(id));
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.body.status, 'recorded');
      assert.equal(first.body.sale.total, 6, 'server price (3) × 2, not anything the till sent');
      assert.equal('profit' in first.body.sale, false);
      const again = await checkout(basket(id));
      assert.equal(again.body.sale.invoiceNumber, first.body.sale.invoiceNumber);
      assert.equal(await db.sale.count({ where: { clientRequestId: id } }), 1);
      const sale = await db.sale.findFirstOrThrow({ where: { clientRequestId: id } });
      assert.equal(sale.origin, 'ONLINE');
    });

    test('a live sale whose answer was lost, sent again as an offline upload, is still one sale', async () => {
      const id = randomUUID();
      const live = await checkout(basket(id));
      assert.equal(live.status, 200);
      const stockAfterLive = await stock(product.candy);
      const upload = await sync(offlineSale({ id, items: [{ productId: product.candy, quantity: 2, unitPrice: 3 }], cashTendered: 10, total: 6 }));
      assert.equal(upload.status, 200, JSON.stringify(upload.body));
      assert.equal(upload.body.status, 'duplicate');
      assert.equal(upload.body.sale.invoiceNumber, live.body.sale.invoiceNumber);
      assert.equal(await db.sale.count({ where: { clientRequestId: id } }), 1);
      assert.equal(await stock(product.candy), stockAfterLive, 'stock deducted once');
    });

    test('the live rules still hold: no stock, unconfirmed GCash and a missing id are refused for good', async () => {
      const short = await checkout({ ...basket(randomUUID()), items: [{ productId: product.soap, quantity: 1 }], payments: [{ method: 'CASH', amount: 100 }] });
      assert.equal(short.status, 409);
      assert.equal(short.body.code, 'INSUFFICIENT_STOCK');
      assert.equal(short.body.retryable, false);
      const gcash = await checkout(basket(randomUUID(), { payments: [{ method: 'GCASH', amount: 6 }] }));
      assert.equal(gcash.status, 422);
      const noId = await checkout(basket(undefined as unknown as string));
      assert.equal(noId.status, 422);
    });

    test('no session: a JSON 401, never a redirect', async () => {
      const response = await call('/api/pos/checkout', { body: basket(randomUUID()), auth: false });
      assert.equal(response.status, 401);
      assert.equal(response.body.ok, false);
    });
  });

  describe('what is refused, and kept on the device', () => {
    test('another cashier’s sale waits for them: 403, nothing recorded', async () => {
      const sale = offlineSale({ userId: a.otherUserId, shiftId: a.otherShiftId });
      const response = await sync(sale);
      assert.equal(response.status, 403);
      assert.equal(response.body.code, 'OTHER_CASHIER');
      assert.equal(await db.sale.count({ where: { clientRequestId: sale.id as string } }), 0);
    });

    test('a shift that is not yours: 422', async () => {
      const response = await sync(offlineSale({ shiftId: a.otherShiftId }));
      assert.equal(response.status, 422);
      assert.equal(response.body.code, 'SHIFT_NOT_FOUND');
    });

    test('another store’s shift or product: 422, and that store is untouched', async () => {
      const salesBefore = await db.sale.count({ where: { storeId: b.storeId } });
      const shift = await sync(offlineSale({ shiftId: b.shiftId, warehouseId: b.warehouseId }));
      assert.equal(shift.status, 422);
      assert.equal(shift.body.code, 'SHIFT_NOT_FOUND');
      const foreign = await sync(offlineSale({ items: [{ productId: b.productId, quantity: 1, unitPrice: 10 }], cashTendered: 10, total: 10 }));
      assert.equal(foreign.status, 422);
      assert.equal(foreign.body.code, 'PRODUCT_NOT_FOUND');
      assert.equal(await db.sale.count({ where: { storeId: b.storeId } }), salesBefore);
    });

    test('a sale naming another branch than its shift: 422', async () => {
      const response = await sync(offlineSale({ warehouseId: b.warehouseId }));
      assert.equal(response.status, 422);
      assert.equal(response.body.code, 'BRANCH_MISMATCH');
    });

    test('a fraction of a whole-unit product: 422', async () => {
      const response = await sync(offlineSale({ items: [{ productId: product.soap, quantity: 0.5, unitPrice: 25 }], cashTendered: 20, total: 12.5 }));
      assert.equal(response.status, 422);
    });

    test('cash that does not cover the device’s own total: 422', async () => {
      const response = await sync(offlineSale({ cashTendered: 10, total: 15 }));
      assert.equal(response.status, 422);
      assert.equal(response.body.code, 'UNDERPAID');
    });

    test('a device id another store registered: 409, nothing recorded', async () => {
      const foreignDevice = randomUUID();
      await db.posDevice.create({ data: { id: foreignDevice, storeId: b.storeId, warehouseId: b.warehouseId, label: 'B till', registeredById: b.ownerId } });
      const sale = offlineSale();
      const response = await sync(sale, foreignDevice);
      assert.equal(response.status, 409);
      assert.equal(await db.sale.count({ where: { clientRequestId: sale.id as string } }), 0);
      const register = await call('/api/pos/devices', { body: { deviceId: foreignDevice } });
      assert.equal(register.status, 409);
    });
  });

  describe('revoked devices and closed shifts', () => {
    test('a revoked device gets no catalogue, but its sales still upload, flagged', async () => {
      const revoked = randomUUID();
      assert.equal((await call('/api/pos/devices', { body: { deviceId: revoked } })).status, 200);
      await db.posDevice.update({ where: { id: revoked }, data: { revokedAt: new Date(), revokedById: a.ownerId } });

      const catalog = await call(`/api/pos/catalog?deviceId=${revoked}`);
      assert.equal(catalog.status, 403);
      assert.equal(catalog.body.code, 'DEVICE_REVOKED');
      assert.equal((await call('/api/pos/devices', { body: { deviceId: revoked } })).status, 403, 'cannot be prepared again');

      // Sold five minutes ago, before the candy price rose to 3.
      const response = await sync(offlineSale({ items: [{ productId: product.candy, quantity: 1, unitPrice: 2 }], cashTendered: 2, total: 2 }), revoked);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.issues, ['DEVICE_REVOKED']);
    });

    test('a sale from before the close lands on the closed shift as an adjustment, and the frozen count stays', async () => {
      const closedAt = new Date(Date.now() - 10 * 60_000);
      await db.cashierShift.update({
        where: { id: a.shiftId },
        data: { status: 'CLOSED', closedAt, closedById: a.ownerId, expectedCash: 1000, actualCash: 1010, difference: 10, totalSales: 0, transactionCount: 0, cashSales: 0, cashRefunds: 0, cashIn: 0, cashOut: 0, walletCash: 0 },
      });
      const before = await db.cashierShift.findUniqueOrThrow({ where: { id: a.shiftId } });

      const response = await sync(offlineSale({ occurredAt: minutesAgo(20), items: [{ productId: product.candy, quantity: 5, unitPrice: 2 }], cashTendered: 10, total: 10 }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.issues, ['CLOSED_SHIFT']);

      const after = await db.cashierShift.findUniqueOrThrow({ where: { id: a.shiftId } });
      assert.equal(String(after.actualCash), String(before.actualCash));
      assert.equal(String(after.difference), String(before.difference), 'the frozen figures are untouched');
      assert.equal(after.reviewStatus, 'PENDING', 'and it goes to the owner');
      const adjustments = await db.shiftAdjustment.findMany({ where: { shiftId: a.shiftId } });
      assert.equal(adjustments.length, 1);
      assert.equal(Number(adjustments[0].amount), -10, 'the counted overage was this sale’s cash');
    });

    test('a sale rung up after the close is flagged, with no adjustment', async () => {
      const response = await sync(offlineSale({ occurredAt: minutesAgo(1), items: [{ productId: product.candy, quantity: 1, unitPrice: 2 }], cashTendered: 2, total: 2 }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.issues, ['CLOSED_SHIFT']);
      assert.equal(await db.shiftAdjustment.count({ where: { shiftId: a.shiftId } }), 1);
    });
  });
}
