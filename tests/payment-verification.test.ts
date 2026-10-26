import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  QR_MAX_BYTES,
  RECEIPT_MAX_BYTES_CEILING,
  checkBillingImage,
  checkImageSize,
  isQrPath,
  isReceiptPathOf,
  receiptFolder,
  receiptMaxBytes,
} from '@/lib/billing-files';
import { INVOICE_GRACE_DAYS, invoiceDisplayStatus, invoiceExpiresAt, isInvoiceExpired, paymentTimeline } from '@/lib/billing';
import { checkoutSteps } from '@/lib/billing-checkout';
import { MODEL_SCOPES } from '@/lib/tenant/scope';

/**
 * GCash payment verification: receipt and QR checks, invoice expiry, the
 * owner's checkout progress, and the access rules around receipts and
 * approvals (read from the source where the rule is a call that must stay).
 */

const DAY = 86_400_000;
const NOW = new Date('2026-10-20T04:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const read = (path: string) => readFileSync(path, 'utf8');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0]);
const ascii = (text: string) => new TextEncoder().encode(text);

// --- Files ----------------------------------------------------------------------

test('receipts are accepted by their real bytes: JPEG, PNG and WEBP only', () => {
  for (const [bytes, type] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp']] as const) {
    const result = checkBillingImage(bytes, 'gcash receipt.png', RECEIPT_MAX_BYTES_CEILING);
    assert.ok(result.ok, type);
    assert.equal(result.ok && result.type, type);
  }
  // Renamed or disguised files are refused whatever their name says.
  for (const [bytes, name] of [
    [ascii('%PDF-1.7 receipt'), 'receipt.pdf'],
    [ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'receipt.png'],
    [ascii('<html><body>hi</body></html>'), 'receipt.jpg'],
    [ascii('GIF89a......'), 'receipt.gif'],
    [new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), 'receipt.webp'],
  ] as const) {
    const result = checkBillingImage(bytes, name, RECEIPT_MAX_BYTES_CEILING);
    assert.equal(result.ok, false, name);
    assert.match(!result.ok ? result.message : '', /JPG, PNG or WEBP/);
  }
});

test('receipt names are made safe and take the detected extension', () => {
  const result = checkBillingImage(PNG, '../../etc/<passwd>".jpg', RECEIPT_MAX_BYTES_CEILING);
  assert.ok(result.ok);
  assert.equal(result.ok && result.name, 'passwd.png');
});

test('empty and oversized files are refused before and after reading', () => {
  assert.match(checkImageSize(0, 1000) ?? '', /empty/);
  assert.match(checkImageSize(1001, 1000) ?? '', /1000|MB or smaller/);
  assert.equal(checkImageSize(1000, 1000), null);
  const big = new Uint8Array(QR_MAX_BYTES + 1);
  big.set(PNG);
  assert.equal(checkBillingImage(big, 'qr.png', QR_MAX_BYTES, 'The QR code').ok, false);
});

test('the receipt size limit is configurable but never above the 5 MB request limit', () => {
  assert.equal(receiptMaxBytes(undefined), RECEIPT_MAX_BYTES_CEILING);
  assert.equal(receiptMaxBytes(''), RECEIPT_MAX_BYTES_CEILING);
  assert.equal(receiptMaxBytes('abc'), RECEIPT_MAX_BYTES_CEILING);
  assert.equal(receiptMaxBytes('-5'), RECEIPT_MAX_BYTES_CEILING);
  assert.equal(receiptMaxBytes(String(2 * 1024 * 1024)), 2 * 1024 * 1024);
  assert.equal(receiptMaxBytes(String(50 * 1024 * 1024)), RECEIPT_MAX_BYTES_CEILING);
  assert.equal(receiptMaxBytes('10'), 100 * 1024, 'a tiny limit is raised to a usable floor');
});

test('a receipt row can only point into its own store\'s receipt folder; a QR code only into qr/', () => {
  const file = '0b6e4a8c-1d2f-4a3b-9c8d-7e6f5a4b3c2d.jpg';
  assert.equal(receiptFolder('store_1'), 'receipts/store_1/');
  assert.throws(() => receiptFolder('../x'));
  assert.ok(isReceiptPathOf(`receipts/store_1/${file}`, 'store_1'));
  assert.equal(isReceiptPathOf(`receipts/store_2/${file}`, 'store_1'), false, 'another store');
  assert.equal(isReceiptPathOf(`receipts/store_1/../store_2/${file}`, 'store_1'), false, 'traversal');
  assert.equal(isReceiptPathOf(`receipts/store_1/receipt.jpg`, 'store_1'), false, 'not a random name');
  assert.equal(isReceiptPathOf(`qr/${file}`, 'store_1'), false);
  assert.ok(isQrPath(`qr/${file}`));
  assert.equal(isQrPath(`receipts/store_1/${file}`), false);
  assert.equal(isQrPath(`qr/../receipts/store_1/${file}`), false);
});

// --- Invoices -------------------------------------------------------------------

test(`an unpaid invoice expires ${INVOICE_GRACE_DAYS} days after its due date; a pending payment keeps it awaiting review`, () => {
  const dueAt = at(-1);
  assert.equal(invoiceExpiresAt(dueAt).getTime(), dueAt.getTime() + INVOICE_GRACE_DAYS * DAY);
  assert.equal(isInvoiceExpired({ dueAt }, NOW), false);
  assert.equal(invoiceDisplayStatus({ status: 'OPEN', dueAt }, false, NOW), 'OVERDUE');
  const long = at(-(INVOICE_GRACE_DAYS + 1));
  assert.equal(isInvoiceExpired({ dueAt: long }, NOW), true);
  assert.equal(invoiceDisplayStatus({ status: 'OPEN', dueAt: long }, false, NOW), 'EXPIRED');
  assert.equal(invoiceDisplayStatus({ status: 'OPEN', dueAt: long }, true, NOW), 'AWAITING_VERIFICATION');
  assert.equal(invoiceDisplayStatus({ status: 'PAID', dueAt: long }, false, NOW), 'PAID');
});

// --- Checkout progress ------------------------------------------------------------

const progress = (payments: Parameters<typeof paymentTimeline>[0]['payments'], invoiceStatus: 'OPEN' | 'PAID' = 'OPEN') => {
  const timeline = paymentTimeline({ issuedAt: at(-3), invoiceStatus, paidAt: invoiceStatus === 'PAID' ? at(0) : null, payments }).map((step) => ({
    ...step,
    at: step.at?.toISOString() ?? null,
  }));
  const pending = payments.some((payment) => payment.status === 'PENDING' && payment.voidedAt === null);
  const rejection = [...payments].reverse().find((payment) => payment.status === 'REJECTED');
  return checkoutSteps({ issuedAt: at(-3).toISOString(), timeline, hasPending: pending, rejectionReason: rejection?.rejectReason ?? null });
};
const states = (steps: ReturnType<typeof checkoutSteps>) => steps.map((step) => `${step.label}:${step.state}`);
const payment = (status: 'PENDING' | 'VERIFIED' | 'REJECTED', extra: Record<string, unknown> = {}) => ({
  status,
  voidedAt: null,
  createdAt: at(-1),
  verifiedAt: status === 'VERIFIED' ? at(0) : null,
  rejectedAt: status === 'REJECTED' ? at(0) : null,
  rejectReason: status === 'REJECTED' ? 'No such reference in GCash.' : null,
  ...extra,
});

test('checkout shows the six steps, and nothing is active until the invoice is paid', () => {
  assert.deepEqual(states(progress([])), [
    'Choose plan:done',
    'Review invoice:done',
    'Pay via GCash:current',
    'Upload receipt:upcoming',
    'Await verification:upcoming',
    'Active subscription:upcoming',
  ]);
  const pending = progress([payment('PENDING')]);
  assert.deepEqual(states(pending).slice(2), ['Pay via GCash:done', 'Upload receipt:done', 'Await verification:current', 'Active subscription:upcoming']);
  const paid = progress([payment('VERIFIED')], 'PAID');
  assert.ok(paid.every((step) => step.state === 'done'));
});

test('a rejected payment shows its reason and asks for corrected proof; a new submission resumes the wait', () => {
  const rejected = progress([payment('REJECTED')]);
  assert.deepEqual(states(rejected).slice(3), ['Upload receipt:current', 'Rejected:failed', 'Active subscription:upcoming']);
  assert.equal(rejected[4].note, 'No such reference in GCash.');
  const resubmitted = progress([payment('REJECTED', { createdAt: at(-2) }), payment('PENDING', { createdAt: at(-1) })]);
  assert.deepEqual(states(resubmitted).slice(3), ['Upload receipt:done', 'Await verification:current', 'Active subscription:upcoming']);
});

// --- Access rules -----------------------------------------------------------------

test('receipts never go through a store client, and their file route checks the owner or the administrator', () => {
  assert.deepEqual(MODEL_SCOPES.SubscriptionPaymentReceipt, { kind: 'denied' });
  const route = read('src/app/api/billing/receipts/[id]/route.ts');
  assert.match(route, /userCan\(user, 'platform\.view'\)\s*\?\s*await findReceiptForAdmin\(id\)/);
  assert.match(route, /findReceiptForOwner\(user\.id, id\)/);
  assert.match(route, /status: 404/);
  assert.doesNotMatch(route, /getPublicUrl/);
  const queries = read('src/server/platform/payment-review-queries.ts');
  const owner = queries.slice(queries.indexOf('export async function findReceiptForOwner'));
  assert.match(owner.slice(0, 400), /store: \{ ownerId: userId \}/, 'only the store owner, not its staff');
  const storage = read('src/server/platform/billing-storage.ts');
  assert.match(storage, /public: false/);
  assert.match(storage, /refusing to store billing files/);
});

test('only the platform administrator approves, and only after confirming the money arrived', () => {
  const actions = read('src/features/platform/subscription-actions.ts');
  const verify = actions.slice(actions.indexOf('export async function verifyPaymentAction'));
  assert.match(verify.slice(0, 400), /requireManager\('verify a subscription payment'\)/);
  assert.match(verify.slice(0, 400), /parseInput\(verifySchema, input\)/);
  assert.match(actions, /confirmedReceived: z\.literal\(true/);
  const reject = actions.slice(actions.indexOf('export async function rejectPaymentAction'));
  assert.match(reject.slice(0, 300), /requireManager\('reject a subscription payment'\)/);
  // The owner's actions can neither verify nor reject.
  const owner = read('src/features/billing/actions.ts');
  assert.doesNotMatch(owner, /verifyPayment|rejectPayment|status:\s*'VERIFIED'/);
});

test('owner submissions need the store owner, a receipt in that store\'s folder, and an open, unexpired invoice', () => {
  const service = read('src/server/platform/billing-service.ts');
  const submit = service.slice(service.indexOf('export async function submitPayment'), service.indexOf('// --- Administrator'));
  assert.match(submit, /isReceiptPathOf\(input\.receipt\.storagePath, owner\.storeId\)/);
  assert.match(submit, /lockOwnedStore\(tx, owner\)/);
  assert.match(submit, /isInvoiceExpired\(invoice, now\)/);
  assert.match(submit, /status: 'PENDING'/);
  assert.match(submit, /subscriptionPaymentReceipt\.create/);
  assert.doesNotMatch(submit, /tx\.store\.update/, 'submitting never touches the subscription');
  const lock = service.slice(service.indexOf('async function lockOwnedStore'));
  assert.match(lock.slice(0, 500), /row\.ownerId !== owner\.id/);
});

test('approval compares money as decimals and re-checks every state under the store lock', () => {
  const service = read('src/server/platform/billing-service.ts');
  const verify = service.slice(service.indexOf('export async function verifyPayment'), service.indexOf('export async function rejectPayment'));
  assert.match(verify, /lockStore\(tx, target\.storeId\)/);
  assert.match(verify, /payment\.status !== 'PENDING'/);
  assert.match(verify, /payment\.invoice\.status !== 'OPEN'/);
  assert.match(verify, /payment\.amount\.equals\(payment\.invoice\.amount\)/);
  assert.match(verify, /payment\.invoice\.storeId !== store\.id/);
  assert.doesNotMatch(verify, /Number\(payment\.amount\)\s*[!=]==/, 'no floating-point comparison');
});

test('the migration keeps evidence permanent and makes a receipt mandatory for owner submissions', () => {
  const sql = read('prisma/migrations/20261101090000_payment_receipts/migration.sql');
  assert.match(sql, /subscription_payment_receipts_append_only/);
  assert.match(sql, /CONSTRAINT TRIGGER "subscription_payments_need_receipt"[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /"subscription_payments_reference_unless_rejected"[\s\S]*WHERE "status" <> 'REJECTED'/);
  assert.match(sql, /"subscription_payments_one_pending_per_invoice"[\s\S]*WHERE "status" = 'PENDING'/);
  // The unique reference guard is created before the old one is dropped.
  assert.ok(sql.indexOf('CREATE UNIQUE INDEX "subscription_payments_reference_unless_rejected"') < sql.indexOf('DROP INDEX "subscription_payments_method_reference_key"'));
});
