import type { CertificateTemplate } from '@prisma/client';

/** Starting document types and fees. Each barangay edits these in Settings to match its ordinance. */
export const DEFAULT_DOCUMENT_TYPES: { name: string; template: CertificateTemplate; fee: string }[] = [
  { name: 'Barangay Clearance', template: 'CLEARANCE', fee: '50.00' },
  { name: 'Certificate of Residency', template: 'RESIDENCY', fee: '50.00' },
  { name: 'Certificate of Indigency', template: 'INDIGENCY', fee: '0.00' },
  { name: 'Barangay Business Clearance', template: 'BUSINESS', fee: '200.00' },
];
