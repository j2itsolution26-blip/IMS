import 'server-only';
import { prisma } from './prisma';
import { manilaParts, toDateInput } from './dates';
import { fmtDateTime, fullName } from './format';

export type Range = { start: Date; end: Date };

export async function collectionsReport({ start, end }: Range) {
  const receipts = await prisma.receipt.findMany({
    where: { paidAt: { gte: start, lt: end } },
    orderBy: { paidAt: 'asc' },
    include: { collectedBy: { select: { fullName: true } } },
  });
  const byDay = new Map<string, { count: number; total: number }>();
  const byNature = new Map<string, { count: number; total: number }>();
  let total = 0;
  for (const r of receipts) {
    if (r.status !== 'PAID') continue;
    const amt = Number(r.amount);
    total += amt;
    const day = toDateInput(r.paidAt);
    const d = byDay.get(day) ?? { count: 0, total: 0 };
    byDay.set(day, { count: d.count + 1, total: d.total + amt });
    const n = byNature.get(r.description) ?? { count: 0, total: 0 };
    byNature.set(r.description, { count: n.count + 1, total: n.total + amt });
  }
  return {
    receipts,
    total,
    cancelled: receipts.filter((r) => r.status === 'CANCELLED').length,
    byDay: [...byDay.entries()].map(([day, v]) => ({ day, ...v })),
    byNature: [...byNature.entries()].map(([nature, v]) => ({ nature, ...v })).sort((a, b) => b.total - a.total),
  };
}

export async function certificatesReport({ start, end }: Range) {
  const certs = await prisma.certificate.findMany({
    where: { issuedAt: { gte: start, lt: end } },
    orderBy: { issuedAt: 'asc' },
    include: { documentType: true, resident: true, receipt: true, issuedBy: { select: { fullName: true } } },
  });
  const byType = new Map<string, number>();
  for (const c of certs) if (c.status === 'ISSUED') byType.set(c.documentType.name, (byType.get(c.documentType.name) ?? 0) + 1);
  return { certs, byType: [...byType.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) };
}

export function collectionsCsvRows(r: Awaited<ReturnType<typeof collectionsReport>>): (string | number)[][] {
  return [
    ['OR number', 'Date and time', 'Payor', 'Nature of collection', 'Amount', 'Status', 'Collected by'],
    ...r.receipts.map((x) => [x.orNumber, fmtDateTime(x.paidAt), x.payorName, x.description, Number(x.amount).toFixed(2), x.status, x.collectedBy.fullName]),
  ];
}

export function certificatesCsvRows(r: Awaited<ReturnType<typeof certificatesReport>>): (string | number)[][] {
  return [
    ['Control number', 'Date and time', 'Document', 'Resident', 'Purpose', 'OR number', 'Status', 'Issued by'],
    ...r.certs.map((c) => [
      c.controlNo,
      fmtDateTime(c.issuedAt),
      c.documentType.name,
      fullName(c.resident),
      c.purpose,
      c.receipt?.orNumber ?? '',
      c.status,
      c.issuedBy.fullName,
    ]),
  ];
}

/** Default report range: the current Manila month. */
export function defaultFrom(): string {
  const { y, m } = manilaParts(new Date());
  return `${y}-${String(m).padStart(2, '0')}-01`;
}
