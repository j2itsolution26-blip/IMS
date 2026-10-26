import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_PAYMENT_ACCOUNTS,
  checkoutAccounts,
  checkoutProblems,
  formatGcashNumber,
  keepStoredQrPaths,
  normalizeGcashNumber,
  parseStoredPaymentAccounts,
  reportableMethods,
  validatePaymentAccounts,
  type PaymentAccount,
} from '@/lib/payment-accounts';

const gcash = (overrides: Record<string, unknown> = {}) => ({
  id: 'g1',
  kind: 'GCASH',
  bankName: null,
  accountName: 'Juan Dela Cruz',
  accountNumber: '0917 123 4567',
  note: null,
  enabled: true,
  ...overrides,
});
const bank = (overrides: Record<string, unknown> = {}) => ({
  id: 'b1',
  kind: 'BANK_TRANSFER',
  bankName: 'BDO',
  accountName: 'J2 IT Solutions',
  accountNumber: '0012-3456-7890',
  note: 'Savings account',
  enabled: true,
  ...overrides,
});

test('GCash numbers are normalised to 09XXXXXXXXX from local and +63 forms, and anything else is refused', () => {
  assert.equal(normalizeGcashNumber('0917 123 4567'), '09171234567');
  assert.equal(normalizeGcashNumber('+63 917-123-4567'), '09171234567');
  assert.equal(normalizeGcashNumber('639171234567'), '09171234567');
  assert.equal(normalizeGcashNumber('0817 123 4567'), null);
  assert.equal(normalizeGcashNumber('0917 123 456'), null);
  assert.equal(normalizeGcashNumber('0917123456a'), null);
  assert.equal(formatGcashNumber('09171234567'), '0917 123 4567');
});

test('a valid list is accepted and normalised; bank name is dropped for GCash', () => {
  const result = validatePaymentAccounts([gcash({ bankName: 'ignored', accountName: '  Juan   Dela Cruz ' }), bank()]);
  assert.ok(result.ok);
  assert.deepEqual(result.accounts[0], {
    id: 'g1',
    kind: 'GCASH',
    bankName: null,
    accountName: 'Juan Dela Cruz',
    accountNumber: '09171234567',
    note: null,
    enabled: true,
    qrPath: null,
  });
  assert.equal(result.accounts[1].accountNumber, '0012-3456-7890');
  assert.deepEqual(validatePaymentAccounts([]), { ok: true, accounts: [] });
});

test('every field is checked, and errors point at the row and field', () => {
  const result = validatePaymentAccounts([
    gcash({ accountNumber: '12345' }),
    bank({ bankName: '', accountNumber: 'abc' }),
    bank({ id: 'b2', accountName: '<script>', note: 'x'.repeat(121) }),
    { id: 'z', kind: 'CRYPTO', accountName: 'Someone', accountNumber: '123456', enabled: true },
    gcash({ id: 'g2', enabled: 'yes' }),
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors['0.accountNumber']);
  assert.ok(result.errors['1.bankName']);
  assert.ok(result.errors['1.accountNumber']);
  assert.ok(result.errors['2.accountName'], 'markup is refused in names');
  assert.ok(result.errors['2.note']);
  assert.ok(result.errors['3.kind'], 'only GCash and bank transfer');
  assert.ok(result.errors['4.enabled']);
});

test('the same account twice, too many accounts, bad ids and non-lists are refused', () => {
  const duplicate = validatePaymentAccounts([gcash(), gcash({ id: 'g2', accountNumber: '+639171234567' })]);
  assert.equal(duplicate.ok, false);
  assert.match(!duplicate.ok ? duplicate.errors['1.accountNumber'] : '', /row 1/);

  const many = Array.from({ length: MAX_PAYMENT_ACCOUNTS + 1 }, (_, i) => gcash({ id: `g${i}`, accountNumber: `0917123450${i}` }));
  assert.equal(validatePaymentAccounts(many).ok, false);

  assert.equal(validatePaymentAccounts([gcash({ id: '../etc' })]).ok, false);
  assert.equal(validatePaymentAccounts([gcash(), bank({ id: 'g1' })]).ok, false, 'ids must be unique');
  assert.equal(validatePaymentAccounts({ accounts: [] }).ok, false);
  assert.equal(validatePaymentAccounts(null).ok, false);
});

test('stored accounts are read back only if still valid; anything unreadable shows no accounts', () => {
  const ok = validatePaymentAccounts([gcash()]);
  assert.ok(ok.ok);
  assert.deepEqual(parseStoredPaymentAccounts(JSON.stringify(ok.accounts)), ok.accounts);
  assert.deepEqual(parseStoredPaymentAccounts(null), []);
  assert.deepEqual(parseStoredPaymentAccounts('not json'), []);
  assert.deepEqual(parseStoredPaymentAccounts(JSON.stringify([gcash({ accountNumber: 'tampered' })])), []);
});

const QR = 'qr/0b6e4a8c-1d2f-4a3b-9c8d-7e6f5a4b3c2d.png';

test('owners can pay only into usable accounts: enabled, and GCash with its QR code; none means checkout is closed', () => {
  const accounts = (validatePaymentAccounts([gcash({ qrPath: QR }), bank({ enabled: false })]) as { ok: true; accounts: PaymentAccount[] }).accounts;
  assert.deepEqual(reportableMethods(accounts), ['GCASH']);
  assert.deepEqual(reportableMethods(accounts.map((account) => ({ ...account, enabled: true }))), ['GCASH', 'BANK_TRANSFER']);
  // Nothing set up: no method at all, never "any method".
  assert.deepEqual(reportableMethods([]), []);
  assert.deepEqual(reportableMethods(accounts.map((account) => ({ ...account, enabled: false }))), []);
  // An enabled GCash account without its QR code is not usable.
  const noQr = accounts.map((account) => ({ ...account, qrPath: null }));
  assert.deepEqual(checkoutAccounts(noQr), []);
  assert.deepEqual(reportableMethods(noQr), []);
  assert.match(checkoutProblems(noQr).join(' '), /Owners cannot pay yet/);
  assert.match(checkoutProblems(noQr).join(' '), /QR code/);
  assert.deepEqual(checkoutProblems(accounts), []);
});

test('a QR path is kept only when well formed and on a GCash account', () => {
  const read = (row: Record<string, unknown>) =>
    (validatePaymentAccounts([row]) as { ok: true; accounts: PaymentAccount[] }).accounts[0].qrPath;
  assert.equal(read(gcash({ qrPath: QR })), QR);
  for (const bad of ['receipts/store1/0b6e4a8c-1d2f-4a3b-9c8d-7e6f5a4b3c2d.png', 'qr/../secret.png', 'qr/x.png', '/qr/a.png', 42]) {
    assert.equal(read(gcash({ qrPath: bad })), null, String(bad));
  }
  assert.equal(read(bank({ qrPath: QR })), null);
});

test('saving the list keeps each account\'s stored QR code, whatever the form sends', () => {
  const stored = (validatePaymentAccounts([gcash({ qrPath: QR })]) as { ok: true; accounts: PaymentAccount[] }).accounts;
  const sent = (
    validatePaymentAccounts([gcash({ qrPath: 'qr/11111111-2222-4333-8444-555555555555.png' }), gcash({ id: 'g2', accountNumber: '09181234567', qrPath: QR })]) as {
      ok: true;
      accounts: PaymentAccount[];
    }
  ).accounts;
  const kept = keepStoredQrPaths(sent, stored);
  assert.equal(kept[0].qrPath, QR, 'the stored image, not the one the form named');
  assert.equal(kept[1].qrPath, null, 'a new account cannot borrow another account\'s image');
});

test('only the platform administrator can save payment accounts, and the server validates them again', () => {
  const actions = readFileSync('src/features/platform/subscription-actions.ts', 'utf8');
  const action = actions.slice(actions.indexOf('export async function setPaymentAccountsAction'));
  assert.match(action.slice(0, 400), /requireManager\('change the payment accounts'\)/);
  const service = readFileSync('src/server/platform/billing-service.ts', 'utf8');
  const save = service.slice(service.indexOf('export async function setPaymentAccounts'));
  assert.match(save.slice(0, 400), /validatePaymentAccounts\(input\.accounts\)/);
  assert.match(save, /platformAudit\(/, 'changes are audited');
  // Owners' payment reports are checked against the listed methods on the server.
  const submit = service.slice(service.indexOf('export async function submitPayment'));
  assert.match(submit.slice(0, 2500), /reportableMethods\(parseStoredPaymentAccounts/);
  // Owner billing actions cannot reach it.
  assert.doesNotMatch(readFileSync('src/features/billing/actions.ts', 'utf8'), /setPaymentAccounts/);
});
