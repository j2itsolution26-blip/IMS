import type { PaymentMethod } from './subscription';

/**
 * The accounts owners pay their subscription into: GCash numbers and bank
 * accounts, entered by the platform administrator. Public payment
 * destinations, not secrets — but owners copy them to send money, so every
 * field is validated strictly, on the server as well as in the form.
 *
 * Pure (no server imports): the admin form, the owner's billing page and the
 * server all use the same rules, and the rules are unit-tested.
 */

export type PaymentAccountKind = 'GCASH' | 'BANK_TRANSFER';

export const PAYMENT_ACCOUNT_KINDS: PaymentAccountKind[] = ['GCASH', 'BANK_TRANSFER'];

export const PAYMENT_ACCOUNT_KIND_LABEL: Record<PaymentAccountKind, string> = { GCASH: 'GCash', BANK_TRANSFER: 'Bank transfer' };

export interface PaymentAccount {
  /** A stable key for the list; carries no meaning. */
  id: string;
  kind: PaymentAccountKind;
  /** The bank's name; null for GCash. */
  bankName: string | null;
  accountName: string;
  /** Digits only for GCash (09XXXXXXXXX); digits, spaces and dashes for a bank. */
  accountNumber: string;
  /** A short line owners see under the account, e.g. "Savings account, BGC branch". */
  note: string | null;
  enabled: boolean;
}

export const MAX_PAYMENT_ACCOUNTS = 6;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
// Letters (any script), digits, spaces and the punctuation names actually use. No control characters or markup.
const NAME = /^[\p{L}\p{M}\p{N} .,'&()\-/]+$/u;
const BANK_NUMBER = /^[0-9][0-9 -]*[0-9]$/;

const clean = (value: unknown) => (typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '');

/** A GCash number as 09XXXXXXXXX, accepting +63 / 63 prefixes, spaces and dashes; null if it is not one. */
export function normalizeGcashNumber(value: string): string | null {
  const digits = value.replace(/[\s-]/g, '');
  const local = /^\+?63(9\d{9})$/.exec(digits)?.[1] ?? /^0(9\d{9})$/.exec(digits)?.[1] ?? null;
  return local ? `0${local}` : null;
}

/** "0917 123 4567" — easier to read back and check than eleven digits in a row. */
export function formatGcashNumber(number: string): string {
  return /^09\d{9}$/.test(number) ? `${number.slice(0, 4)} ${number.slice(4, 7)} ${number.slice(7)}` : number;
}

export type PaymentAccountsResult =
  | { ok: true; accounts: PaymentAccount[] }
  /** Errors keyed "<row>.<field>" (e.g. "0.accountNumber"), or "list" for the list as a whole. */
  | { ok: false; errors: Record<string, string> };

/** Checks and normalises the whole list an administrator saves. Anything unexpected is refused, not repaired silently. */
export function validatePaymentAccounts(input: unknown): PaymentAccountsResult {
  const errors: Record<string, string> = {};
  if (!Array.isArray(input)) return { ok: false, errors: { list: 'Send a list of accounts.' } };
  if (input.length > MAX_PAYMENT_ACCOUNTS) {
    return { ok: false, errors: { list: `Add at most ${MAX_PAYMENT_ACCOUNTS} accounts.` } };
  }

  const accounts: PaymentAccount[] = [];
  const seen = new Map<string, number>();
  input.forEach((raw, index) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const fail = (field: string, message: string) => {
      errors[`${index}.${field}`] ??= message;
    };

    const id = typeof row.id === 'string' && ID.test(row.id) ? row.id : null;
    if (!id) fail('id', 'This row is not valid. Remove it and add it again.');

    const kind = PAYMENT_ACCOUNT_KINDS.includes(row.kind as PaymentAccountKind) ? (row.kind as PaymentAccountKind) : null;
    if (!kind) fail('kind', 'Choose GCash or bank transfer.');

    const accountName = clean(row.accountName);
    if (accountName.length < 2 || accountName.length > 80) fail('accountName', 'Enter the account name as registered (2–80 characters).');
    else if (!NAME.test(accountName)) fail('accountName', 'Use letters, numbers, spaces and . , \' & ( ) - / only.');

    let bankName: string | null = null;
    if (kind === 'BANK_TRANSFER') {
      bankName = clean(row.bankName);
      if (bankName.length < 2 || bankName.length > 60) fail('bankName', 'Enter the bank name (2–60 characters).');
      else if (!NAME.test(bankName)) fail('bankName', 'Use letters, numbers, spaces and . , \' & ( ) - / only.');
    }

    let accountNumber = clean(row.accountNumber);
    if (kind === 'GCASH') {
      const number = normalizeGcashNumber(accountNumber);
      if (!number) fail('accountNumber', 'Enter an 11-digit mobile number starting with 09, e.g. 0917 123 4567.');
      else accountNumber = number;
    } else if (kind === 'BANK_TRANSFER') {
      const digits = accountNumber.replace(/\D/g, '');
      if (!BANK_NUMBER.test(accountNumber) || digits.length < 6 || digits.length > 20) {
        fail('accountNumber', 'Enter the account number: 6–20 digits; spaces and dashes are allowed.');
      }
    }

    const note = clean(row.note) || null;
    if (note && note.length > 120) fail('note', 'Keep the note under 120 characters.');
    else if (note && /[<>]/.test(note)) fail('note', 'Remove < and > from the note.');

    if (typeof row.enabled !== 'boolean') fail('enabled', 'Choose whether owners see this account.');

    if (kind && accountNumber) {
      const key = `${kind}:${accountNumber.replace(/\D/g, '')}`;
      const first = seen.get(key);
      if (first !== undefined) fail('accountNumber', `This is the same account as row ${first + 1}.`);
      else seen.set(key, index);
    }

    if (id && kind) {
      accounts.push({ id, kind, bankName, accountName, accountNumber, note, enabled: row.enabled === true });
    }
  });

  if (new Set(accounts.map((account) => account.id)).size !== accounts.length) errors.list ??= 'Two rows share an id. Reload the page and try again.';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, accounts };
}

/**
 * What is stored, read back. Stored data was validated when saved; if it is
 * ever unreadable, owners see no accounts (and the admin a prompt to fix it)
 * rather than a half-parsed account number.
 */
export function parseStoredPaymentAccounts(raw: string | null | undefined): PaymentAccount[] {
  if (!raw) return [];
  try {
    const result = validatePaymentAccounts(JSON.parse(raw));
    return result.ok ? result.accounts : [];
  } catch {
    return [];
  }
}

/**
 * The methods an owner may report a payment with. Once the administrator
 * lists enabled accounts, only those kinds; while none are enabled, every
 * method the app has always accepted — an owner is never left unable to
 * report a payment.
 */
export function reportableMethods(accounts: PaymentAccount[]): PaymentMethod[] {
  const enabled = accounts.filter((account) => account.enabled);
  if (enabled.length === 0) return ['GCASH', 'BANK_TRANSFER', 'OTHER'];
  return PAYMENT_ACCOUNT_KINDS.filter((kind) => enabled.some((account) => account.kind === kind));
}
