import type { Role } from '@prisma/client';

/** Every action the app checks. Pages and server actions both use these. */
export type Permission =
  | 'residents.view'
  | 'residents.edit'
  | 'certificates.view'
  | 'certificates.issue'
  | 'certificates.revoke'
  | 'receipts.view'
  | 'receipts.create'
  | 'receipts.cancel'
  | 'blotter.view'
  | 'blotter.edit'
  | 'reports.view'
  | 'settings.manage'
  | 'users.manage'
  | 'audit.view';

const ALL: Role[] = ['CAPTAIN', 'SECRETARY', 'TREASURER', 'KAGAWAD', 'LUPON', 'STAFF'];

const MATRIX: Record<Permission, Role[]> = {
  'residents.view': ALL,
  'residents.edit': ['CAPTAIN', 'SECRETARY', 'STAFF'],
  'certificates.view': ['CAPTAIN', 'SECRETARY', 'TREASURER', 'KAGAWAD', 'STAFF'],
  'certificates.issue': ['CAPTAIN', 'SECRETARY', 'STAFF'],
  'certificates.revoke': ['CAPTAIN', 'SECRETARY'],
  'receipts.view': ['CAPTAIN', 'SECRETARY', 'TREASURER', 'KAGAWAD'],
  'receipts.create': ['CAPTAIN', 'SECRETARY', 'TREASURER'],
  'receipts.cancel': ['CAPTAIN', 'TREASURER'],
  'blotter.view': ['CAPTAIN', 'SECRETARY', 'KAGAWAD', 'LUPON'],
  'blotter.edit': ['CAPTAIN', 'SECRETARY', 'LUPON'],
  'reports.view': ['CAPTAIN', 'SECRETARY', 'TREASURER', 'KAGAWAD'],
  'settings.manage': ['CAPTAIN'],
  'users.manage': ['CAPTAIN'],
  'audit.view': ['CAPTAIN'],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[permission].includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  CAPTAIN: 'Punong Barangay',
  SECRETARY: 'Secretary',
  TREASURER: 'Treasurer',
  KAGAWAD: 'Kagawad',
  LUPON: 'Lupon member',
  STAFF: 'Front-desk staff',
};
