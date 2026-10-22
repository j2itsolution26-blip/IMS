import { NextResponse, type NextRequest } from 'next/server';
import { LOCKED_MESSAGE, getCurrentUser } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { RateLimitError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { CONTENT_TYPES, toCsv, toExcel, toPdf, type ExportFormat } from '@/server/reports/exporters';
import type { ReportColumn, ReportResult } from '@/server/reports/registry';
import { EXPORT_ROW_LIMIT, listShifts } from '@/server/services/shift-service';
import { getCompanyProfile } from '@/server/services/settings-service';
import { recordAuditSafe } from '@/server/services/audit-service';
import { resolveShiftQuery, type ShiftSearchParams } from '@/features/shifts/params';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const FORMATS: ExportFormat[] = ['csv', 'xlsx', 'pdf'];

const STATUS_LABEL = { OPEN: 'Open', CLOSED: 'Closed', REQUIRES_REVIEW: 'Requires review', REVIEWED: 'Reviewed' } as const;

const money = (key: string, label: string, total = false): ReportColumn => ({ key, label, format: 'currency', numeric: true, total });
const text = (key: string, label: string): ReportColumn => ({ key, label, format: 'text' });

/**
 * Shift history download — CSV, Excel or PDF of the rows Shift Management is
 * showing, with the same filters. Owner only, rate-limited and audited like
 * every other export.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.isLocked) return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 403 });
  if (!user.permissions.has(FINANCIAL_PERMISSION)) {
    return NextResponse.json({ error: 'You do not have permission to export shift records.' }, { status: 403 });
  }

  try {
    checkRateLimit(`export:${user.id}`, RATE_LIMITS.export);
  } catch (error) {
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    throw error;
  }

  const search = request.nextUrl.searchParams;
  const formatParam = (search.get('format') ?? 'csv').toLowerCase();
  const format = FORMATS.includes(formatParam as ExportFormat) ? (formatParam as ExportFormat) : 'csv';
  const params = Object.fromEntries(
    (['view', 'cashier', 'discrepancy', 'sort', 'q', 'period', 'from', 'to'] as const).map((key) => [key, search.get(key) ?? undefined]),
  ) as ShiftSearchParams;

  try {
    const [{ query, range }, company] = await Promise.all([resolveShiftQuery(params), getCompanyProfile()]);
    const { shifts, total } = await listShifts({ ...query, all: true });

    const result: ReportResult = {
      columns: [
        text('reference', 'Shift'),
        text('cashier', 'Cashier'),
        text('opened', 'Opened'),
        text('closed', 'Closed'),
        money('openingCash', 'Starting cash', true),
        money('cashSales', 'Cash sales', true),
        money('cashRefunds', 'Cash refunds', true),
        money('cashIn', 'Cash in', true),
        money('cashOut', 'Cash out', true),
        money('expectedCash', 'Expected cash', true),
        money('actualCash', 'Counted cash', true),
        money('difference', 'Variance', true),
        money('adjustedDifference', 'Variance after adjustments'),
        text('status', 'Status'),
        text('reviewedBy', 'Reviewed by'),
      ],
      rows: shifts.map((s) => ({
        reference: s.reference,
        cashier: s.cashierName,
        // Store time, written out, so a spreadsheet never shifts it to UTC.
        opened: formatDateTime(s.openedAt),
        closed: s.closedAt ? formatDateTime(s.closedAt) : '',
        openingCash: s.openingCash,
        cashSales: s.cashSales,
        cashRefunds: s.cashRefunds,
        cashIn: s.cashIn,
        cashOut: s.cashOut,
        expectedCash: s.expectedCash,
        actualCash: s.actualCash,
        difference: s.difference,
        adjustedDifference: s.adjustedDifference,
        status: STATUS_LABEL[s.displayStatus],
        reviewedBy: s.reviewedByName ? `${s.reviewedByName}, ${formatDateTime(s.reviewedAt)}` : '',
      })),
    };

    const context = {
      reportName: 'Shift history',
      periodLabel: query.view === 'open' || query.view === 'review' ? 'All dates' : range.label,
      companyName: company.name,
      currency: company.currency,
      generatedAt: new Date(),
    };

    let body: Buffer | string;
    if (format === 'csv') body = toCsv(result);
    else if (format === 'xlsx') body = await toExcel(result, context);
    else body = toPdf(result, context);

    recordAuditSafe({
      action: 'EXPORT',
      entity: 'Report',
      entityId: 'shift-history',
      summary: `Exported shift history (${format.toUpperCase()}, ${shifts.length} rows${total > EXPORT_ROW_LIMIT ? `, first ${EXPORT_ROW_LIMIT} of ${total}` : ''}) for ${context.periodLabel}`,
      userId: user.id,
    });

    return new NextResponse(body as BodyInit, {
      headers: {
        'Content-Type': CONTENT_TYPES[format],
        'Content-Disposition': `attachment; filename="shift-history-${new Date().toISOString().slice(0, 10)}.${format}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[export] shift history failed', format, error);
    return NextResponse.json({ error: 'The shift history could not be generated.' }, { status: 500 });
  }
}
