import { NextResponse } from 'next/server';
import { LOCKED_MESSAGE, getCurrentUser } from '@/lib/session';
import { MUST_CHANGE_PASSWORD_MESSAGE } from '@/lib/password-change';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { AppError } from '@/lib/errors';
import { getStoreContext } from '@/lib/tenant/context';
import { DATA_EXPORTS, DATA_EXPORT_ROW_LIMIT, dataExportFilename, parseDataExport } from '@/lib/data-export';
import { toCsv } from '@/server/reports/exporters';
import { recordAudit } from '@/server/services/audit-service';
import { buildDataExport } from '@/server/services/data-export-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * "Download your data": CSV of the store's own products or sales, on every
 * plan, including a read-only store (its records are still its own). A
 * suspended store is refused by the store context.
 *
 * Needs the dataset's export permission; reads through the store-scoped
 * client only; rate-limited like every export; capped at
 * DATA_EXPORT_ROW_LIMIT rows; and recorded in the audit trail before the
 * file is sent, so no download goes unrecorded.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: MUST_CHANGE_PASSWORD_MESSAGE }, { status: 403 });
  if (user.isLocked) return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 403 });

  const dataset = parseDataExport((await params).dataset);
  if (!dataset) return NextResponse.json({ error: 'Unknown download' }, { status: 404 });
  const definition = DATA_EXPORTS[dataset];
  if (!user.permissions.has(definition.permission)) {
    return NextResponse.json({ error: `You do not have permission to download ${definition.label.toLowerCase()}.` }, { status: 403 });
  }

  try {
    checkRateLimit(`export:${user.id}`, RATE_LIMITS.export);
    const ctx = await getStoreContext();
    const now = new Date();
    const includeCost = user.permissions.has(FINANCIAL_PERMISSION);
    const { result, truncated } = await buildDataExport(ctx.db, dataset, { includeCost, now });

    await recordAudit({
      action: 'EXPORT',
      entity: 'DataExport',
      entityId: dataset,
      summary: `Downloaded ${definition.label.toLowerCase()} as CSV (${result.rows.length} rows${truncated ? `, first ${DATA_EXPORT_ROW_LIMIT}` : ''})`,
      changes: { dataset, rows: result.rows.length, truncated, includeCost },
      userId: user.id,
    });

    return new NextResponse(toCsv(result), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${dataExportFilename(dataset, now)}"`,
        'Cache-Control': 'no-store',
        'X-Export-Truncated': truncated ? 'true' : 'false',
      },
    });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[data-export] failed', dataset, error);
    return NextResponse.json({ error: 'The download could not be prepared.' }, { status: 500 });
  }
}
