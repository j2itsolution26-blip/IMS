import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { RateLimitError } from '@/lib/errors';
import { parsePeriod, resolveRange } from '@/server/analytics/date-range';
import { getReport } from '@/server/reports/registry';
import {
  CONTENT_TYPES,
  toCsv,
  toExcel,
  toPdf,
  type ExportFormat,
} from '@/server/reports/exporters';
import { getCompanyProfile } from '@/server/services/settings-service';
import { recordAuditSafe } from '@/server/services/audit-service';

export const dynamic = 'force-dynamic';
// Exports build a whole workbook in memory; the Node runtime is required.
export const runtime = 'nodejs';
export const maxDuration = 60;

const FORMATS: ExportFormat[] = ['csv', 'xlsx', 'pdf'];

/**
 * Report download endpoint.
 *
 * Generates CSV, Excel, or PDF from the same report definition the on-screen
 * table uses. Every export is rate-limited and written to the audit trail —
 * bulk data leaving the system is something an owner should be able to see.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ report: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { report: reportId } = await params;
  const report = getReport(reportId);
  if (!report) return NextResponse.json({ error: 'Unknown report' }, { status: 404 });

  if (!user.permissions.has(report.permission) || !user.permissions.has('reports.export')) {
    return NextResponse.json({ error: 'You do not have permission to export this report.' }, { status: 403 });
  }

  try {
    checkRateLimit(`export:${user.id}`, RATE_LIMITS.export);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

  const formatParam = (request.nextUrl.searchParams.get('format') ?? 'csv').toLowerCase();
  const format = FORMATS.includes(formatParam as ExportFormat) ? (formatParam as ExportFormat) : 'csv';

  const period = parsePeriod(request.nextUrl.searchParams.get('period') ?? undefined, 'last30');
  const range = resolveRange(period);

  try {
    const company = await getCompanyProfile();
    const result = await report.load(range, company.currency);

    const context = {
      reportName: report.name,
      periodLabel: report.usesDateRange ? range.label : 'Current position',
      companyName: company.name,
      currency: company.currency,
      generatedAt: new Date(),
    };

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${report.id}-${stamp}.${format}`;

    let body: Buffer | string;
    if (format === 'csv') body = toCsv(result);
    else if (format === 'xlsx') body = await toExcel(result, context);
    else body = toPdf(result, context);

    recordAuditSafe({
      action: 'EXPORT',
      entity: 'Report',
      entityId: report.id,
      summary: `Exported "${report.name}" (${format.toUpperCase()}, ${result.rows.length} rows) for ${context.periodLabel}`,
      userId: user.id,
    });

    return new NextResponse(body as BodyInit, {
      headers: {
        'Content-Type': CONTENT_TYPES[format],
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[export] failed', reportId, format, error);
    return NextResponse.json({ error: 'The report could not be generated.' }, { status: 500 });
  }
}
