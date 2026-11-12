import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, bornOnOrBefore, manilaDayStart, manilaTodayRange, parseCalendarDate, parseManilaDate, parseManilaDateTime, toDateInput } from '../src/lib/dates';
import { fullName, listName, maskedName } from '../src/lib/format';
import { formatSequence, randomCode } from '../src/lib/codes';
import { toCsv } from '../src/lib/csv';
import { can } from '../src/lib/permissions';
import { hashPassword, passwordProblem, verifyPassword } from '../src/lib/password';
import { certificateBody } from '../src/lib/certificate-text';

test('Manila day boundaries are UTC+8', () => {
  // 2026-11-12 00:30 Manila = 2026-11-11 16:30 UTC
  const { start, end } = manilaTodayRange(new Date('2026-11-11T16:30:00Z'));
  assert.equal(start.toISOString(), '2026-11-11T16:00:00.000Z');
  assert.equal(end.toISOString(), '2026-11-12T16:00:00.000Z');
  assert.equal(toDateInput(new Date('2026-11-11T16:30:00Z')), '2026-11-12');
});

test('date parsing rejects impossible dates', () => {
  assert.equal(parseManilaDate('2026-02-30'), null);
  assert.equal(parseCalendarDate('2026-13-01'), null);
  assert.equal(parseManilaDate('2026-02-28')?.toISOString(), manilaDayStart(2026, 2, 28).toISOString());
  assert.equal(parseManilaDateTime('2026-11-12T09:15')?.toISOString(), '2026-11-12T01:15:00.000Z');
  assert.equal(parseManilaDateTime('2026-11-12T24:00'), null);
});

test('age counts birthdays in Manila time', () => {
  const birth = parseCalendarDate('1966-11-12')!;
  assert.equal(ageOn(birth, new Date('2026-11-11T15:59:00Z')), 59); // 11 Nov, 23:59 Manila
  assert.equal(ageOn(birth, new Date('2026-11-11T16:00:00Z')), 60); // 12 Nov, 00:00 Manila
  // A senior cut-off includes someone turning 60 today.
  assert.ok(birth <= bornOnOrBefore(60, new Date('2026-11-11T16:00:00Z')));
});

test('names', () => {
  const r = { firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz', suffix: 'Jr.' };
  assert.equal(fullName(r), 'Juan Santos Dela Cruz Jr.');
  assert.equal(listName(r), 'Dela Cruz, Juan S. Jr.');
  assert.equal(maskedName(r), 'J*** D*** C***');
  assert.ok(!maskedName(r).includes('uan'));
});

test('codes', () => {
  assert.equal(formatSequence('BC', 2026, 42), 'BC-2026-000042');
  const code = randomCode();
  assert.match(code, /^[A-HJKMNP-Z2-9]{12}$/);
  assert.notEqual(randomCode(), code);
});

test('CSV quotes and blocks spreadsheet formulas', () => {
  assert.equal(toCsv([['a,b', 'say "hi"', 5], ['=HYPERLINK("x")', '-1', -1]]), '"a,b","say ""hi""",5\r\n"\'=HYPERLINK(""x"")",\'-1,-1');
});

test('permissions', () => {
  assert.ok(can('CAPTAIN', 'users.manage'));
  assert.ok(!can('SECRETARY', 'users.manage'));
  assert.ok(can('STAFF', 'certificates.issue'));
  assert.ok(!can('STAFF', 'blotter.view'));
  assert.ok(!can('TREASURER', 'blotter.view'));
  assert.ok(can('LUPON', 'blotter.edit'));
  assert.ok(!can('KAGAWAD', 'receipts.cancel'));
});

test('passwords', async () => {
  assert.ok(passwordProblem('short1'));
  assert.ok(passwordProblem('onlyletterslong'));
  assert.equal(passwordProblem('mangnao2026'), null);
  const hash = await hashPassword('mangnao2026');
  assert.ok(await verifyPassword('mangnao2026', hash));
  assert.ok(!(await verifyPassword('mangnao2027', hash)));
  assert.ok(!(await verifyPassword('x', 'garbage')));
});

test('certificate wording', () => {
  const base = {
    name: 'Maria Reyes',
    age: 34,
    sex: 'FEMALE' as const,
    civilStatus: 'MARRIED' as const,
    citizenship: 'Filipino',
    address: '12 Rizal St.',
    barangay: 'Sample',
    city: 'Sample City',
    province: 'Sample Province',
    residentSince: 2010,
    purpose: 'employment.',
    businessName: 'Maria Sari-Sari Store',
    businessAddress: '12 Rizal St.',
  };
  const clearance = certificateBody({ ...base, template: 'CLEARANCE' }).join(' ');
  assert.match(clearance, /MARIA REYES, 34 years old, married, Filipino/);
  assert.match(clearance, /her name has no derogatory record/);
  assert.match(clearance, /for employment\.$/);
  assert.match(certificateBody({ ...base, template: 'RESIDENCY' })[0], /since 2010/);
  assert.match(certificateBody({ ...base, template: 'BUSINESS' })[0], /MARIA SARI-SARI STORE/);
});
