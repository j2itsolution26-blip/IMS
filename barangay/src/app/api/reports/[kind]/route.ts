import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { can } from '@/lib/permissions';
import { readRange } from '@/lib/report-range';
import { certificatesCsvRows, certificatesReport, collectionsCsvRows, collectionsReport } from '@/lib/reports';
import { toCsv } from '@/lib/csv';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!can(user.role, 'reports.view')) return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

  const { kind } = await params;
  const range = readRange(req.nextUrl.searchParams.get('from') ?? undefined, req.nextUrl.searchParams.get('to') ?? undefined);
  let rows: (string | number)[][];
  if (kind === 'collections') rows = collectionsCsvRows(await collectionsReport(range));
  else if (kind === 'certificates') rows = certificatesCsvRows(await certificatesReport(range));
  else return NextResponse.json({ error: 'Unknown report.' }, { status: 404 });

  await audit({ userId: user.id, action: 'report.export', entity: 'Report', entityId: kind, summary: `Exported ${kind} ${range.from} to ${range.to}` });
  // BOM so Excel opens UTF-8 (₱, ñ) correctly.
  return new NextResponse('﻿' + toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${kind}-${range.from}-to-${range.to}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
