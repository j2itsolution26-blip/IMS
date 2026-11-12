import { ageOn } from './dates';

const TZ = 'Asia/Manila';

export function peso(amount: number | string | { toString(): string }): string {
  const n = typeof amount === 'number' ? amount : Number(amount.toString());
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n);
}

export function fmtDate(at: Date): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric' }).format(at);
}

export function fmtDateTime(at: Date): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

/** Birth dates are calendar dates stored at UTC midnight. */
export function fmtBirthDate(at: Date): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(at);
}

type NameParts = { firstName: string; middleName: string; lastName: string; suffix: string };

/** "Juan Santos Dela Cruz Jr." */
export function fullName(r: NameParts): string {
  return [r.firstName, r.middleName, r.lastName, r.suffix].filter(Boolean).join(' ');
}

/** "Dela Cruz, Juan S." — for lists. */
export function listName(r: NameParts): string {
  const mi = r.middleName ? ` ${r.middleName[0]}.` : '';
  const sfx = r.suffix ? ` ${r.suffix}` : '';
  return `${r.lastName}, ${r.firstName}${mi}${sfx}`;
}

/**
 * "J*** D*** C***" — the name as the public verification page shows it:
 * enough to match the paper in hand, not enough to harvest the registry.
 */
export function maskedName(r: NameParts): string {
  return [r.firstName, r.lastName]
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + '*'.repeat(Math.max(2, w.length - 1)))
    .join(' ');
}

export function ageLabel(birthDate: Date): string {
  return `${ageOn(birthDate)} yrs`;
}

export const CIVIL_STATUS_LABELS = {
  SINGLE: 'Single',
  MARRIED: 'Married',
  WIDOWED: 'Widowed',
  SEPARATED: 'Separated',
  LIVE_IN: 'Live-in',
} as const;

export const CASE_STATUS_LABELS = {
  RECORDED: 'Recorded',
  MEDIATION: 'Mediation',
  CONCILIATION: 'Conciliation',
  ARBITRATION: 'Arbitration',
  SETTLED: 'Settled',
  CFA_ISSUED: 'Certificate to File Action',
  DISMISSED: 'Dismissed',
  WITHDRAWN: 'Withdrawn',
} as const;

export const OPEN_CASE_STATUSES = ['RECORDED', 'MEDIATION', 'CONCILIATION', 'ARBITRATION'] as const;
