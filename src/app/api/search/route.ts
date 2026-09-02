import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/session';
import { toNum } from '@/lib/decimal';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { RateLimitError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

interface SearchHit {
  id: string;
  type: 'product' | 'sale';
  title: string;
  subtitle: string;
  href: string;
  meta?: number;
}

/**
 * Cross-entity search for the header bar.
 *
 * Each entity is only searched when the caller holds the matching view
 * permission, so results never leak data a role cannot open.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    checkRateLimit(`search:${user.id}`, RATE_LIMITS.read);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }

  const term = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (term.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const contains = { contains: term, mode: 'insensitive' as const };
  const results: SearchHit[] = [];

  const tasks: Promise<void>[] = [];

  if (user.permissions.has('products.view')) {
    tasks.push(
      prisma.product
        .findMany({
          where: {
            OR: [{ name: contains }, { sku: contains }, { barcode: contains }],
          },
          select: { id: true, name: true, sku: true, sellingPrice: true },
          take: 5,
          orderBy: { name: 'asc' },
        })
        .then((rows: { id: string; name: string; sku: string; sellingPrice: unknown }[]) => {
          for (const row of rows) {
            results.push({
              id: row.id,
              type: 'product',
              title: row.name,
              subtitle: `SKU ${row.sku}`,
              href: `/products/${row.id}`,
              meta: toNum(row.sellingPrice as never),
            });
          }
        }),
    );
  }

  if (user.permissions.has('sales.view')) {
    tasks.push(
      prisma.sale
        .findMany({
          where: { invoiceNumber: contains },
          select: { id: true, invoiceNumber: true, total: true, createdAt: true },
          take: 4,
          orderBy: { createdAt: 'desc' },
        })
        .then((rows: { id: string; invoiceNumber: string; total: unknown; createdAt: Date }[]) => {
          for (const row of rows) {
            results.push({
              id: row.id,
              type: 'sale',
              title: row.invoiceNumber,
              subtitle: `Sale · ${row.createdAt.toLocaleDateString()}`,
              href: `/sales/${row.id}`,
              meta: toNum(row.total as never),
            });
          }
        }),
    );
  }

  await Promise.all(tasks);

  return NextResponse.json({ results: results.slice(0, 12) });
}
