import type { CertificateTemplate, CivilStatus, Sex } from '@prisma/client';
import { CIVIL_STATUS_LABELS } from './format';

export type CertificateFacts = {
  template: CertificateTemplate;
  name: string;
  age: number;
  sex: Sex;
  civilStatus: CivilStatus;
  citizenship: string;
  address: string;
  barangay: string;
  city: string;
  province: string;
  residentSince: number | null;
  purpose: string;
  businessName: string;
  businessAddress: string;
};

/** The body paragraphs of a certificate. Plain text: the page lays it out. */
export function certificateBody(f: CertificateFacts): string[] {
  const place = `Barangay ${f.barangay}, ${f.city}, ${f.province}`;
  const who = `${f.name.toUpperCase()}, ${f.age} years old, ${CIVIL_STATUS_LABELS[f.civilStatus].toLowerCase()}, ${f.citizenship}`;
  const pronoun = f.sex === 'MALE' ? 'his' : 'her';
  const request = `This certification is issued upon the request of the above-named person for ${f.purpose.replace(/\.$/, '')}.`;

  switch (f.template) {
    case 'CLEARANCE':
      return [
        `This is to certify that ${who}, and a bona fide resident of ${f.address}, ${place}, is known to be of good moral character and a law-abiding citizen in the community.`,
        `This further certifies that, as of this date, ${pronoun} name has no derogatory record on file in this barangay.`,
        request,
      ];
    case 'RESIDENCY':
      return [
        `This is to certify that ${who}, is a bona fide resident of ${f.address}, ${place}${f.residentSince ? `, and has resided in this barangay since ${f.residentSince}` : ''}.`,
        request,
      ];
    case 'INDIGENCY':
      return [
        `This is to certify that ${who}, a resident of ${f.address}, ${place}, belongs to an indigent family in this barangay, whose income is not sufficient to meet the family's basic needs.`,
        request,
      ];
    case 'BUSINESS':
      return [
        `This is to certify that the business ${f.businessName.toUpperCase()}, located at ${f.businessAddress}, ${place}, owned and operated by ${f.name.toUpperCase()}, is hereby granted barangay clearance to operate in this barangay.`,
        'This clearance is subject to the business complying with all existing barangay ordinances and the laws and regulations of the city and national government.',
        `Issued for ${f.purpose.replace(/\.$/, '')}.`,
      ];
    default:
      return [`This is to certify that ${who}, is a resident of ${f.address}, ${place}.`, request];
  }
}
