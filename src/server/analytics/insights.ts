import 'server-only';

import { prisma } from '@/lib/prisma';
import { percentChange } from '@/lib/decimal';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { resolveRange } from '@/server/analytics/date-range';
import { getSalesSummary, getReorderSuggestions } from '@/server/analytics/dashboard';
import { getMovementAnalysis } from '@/server/analytics/inventory-analytics';
import { getSettings, readNumber, readString } from '@/server/services/settings-service';

/**
 * Smart insights.
 *
 * Each generator runs a real query and returns nothing when the data does not
 * support a statement. That is deliberate: an insight panel that always has six
 * bullet points is decoration, whereas one that stays quiet until something is
 * genuinely worth saying is a tool. On a fresh install this returns an empty
 * list, and the UI says so.
 */

export type InsightTone = 'positive' | 'negative' | 'warning' | 'neutral';

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  href?: string;
  /** Higher sorts first. */
  priority: number;
}

/** Ignore swings on trivially small numbers — noise, not signal. */
const MATERIAL_REVENUE = 1;
const MATERIAL_CHANGE_PERCENT = 5;

async function revenueTrendInsight(currency: string): Promise<Insight[]> {
  const range = resolveRange('today');
  const [current, previous] = await Promise.all([
    getSalesSummary(range.from, range.to),
    getSalesSummary(range.previous.from, range.previous.to),
  ]);

  if (current.revenue < MATERIAL_REVENUE && previous.revenue < MATERIAL_REVENUE) return [];

  const insights: Insight[] = [];
  const revenueChange = percentChange(current.revenue, previous.revenue);

  if (revenueChange != null && Math.abs(revenueChange) >= MATERIAL_CHANGE_PERCENT) {
    const up = revenueChange > 0;
    insights.push({
      id: 'revenue-trend',
      tone: up ? 'positive' : 'negative',
      title: `Revenue ${up ? 'up' : 'down'} ${Math.abs(revenueChange).toFixed(1)}% today`,
      detail: `${formatCurrency(current.revenue, currency)} so far today versus ${formatCurrency(
        previous.revenue,
        currency,
      )} on the same period yesterday.`,
      href: '/analytics',
      priority: up ? 60 : 80,
    });
  }

  const profitChange = percentChange(current.netProfit, previous.netProfit);
  if (profitChange != null && Math.abs(profitChange) >= MATERIAL_CHANGE_PERCENT && Math.abs(current.netProfit) >= MATERIAL_REVENUE) {
    const up = profitChange > 0;
    insights.push({
      id: 'profit-trend',
      tone: up ? 'positive' : 'negative',
      title: `Net profit ${up ? 'up' : 'down'} ${Math.abs(profitChange).toFixed(1)}% today`,
      detail: `${formatCurrency(current.netProfit, currency)} today after cost of goods, returns, and expenses.`,
      href: '/reports/profit',
      priority: up ? 55 : 78,
    });
  }

  if (current.marginPercent > 0 && previous.marginPercent > 0) {
    const marginDelta = current.marginPercent - previous.marginPercent;
    if (Math.abs(marginDelta) >= 3) {
      insights.push({
        id: 'margin-shift',
        tone: marginDelta > 0 ? 'positive' : 'warning',
        title: `Margin ${marginDelta > 0 ? 'improved' : 'slipped'} ${Math.abs(marginDelta).toFixed(1)} points`,
        detail: `Gross margin is ${current.marginPercent.toFixed(1)}% today against ${previous.marginPercent.toFixed(
          1,
        )}% yesterday.`,
        href: '/reports/profit',
        priority: marginDelta > 0 ? 40 : 70,
      });
    }
  }

  return insights;
}

/** Projects when fast-selling lines will hit zero, based on real velocity. */
async function stockoutForecastInsights(): Promise<Insight[]> {
  const suggestions = await getReorderSuggestions(20);

  return suggestions
    .filter((s) => s.daysUntilStockout != null && s.daysUntilStockout <= 7)
    .sort((a, b) => (a.daysUntilStockout ?? 99) - (b.daysUntilStockout ?? 99))
    .slice(0, 3)
    .map((s) => {
      const days = s.daysUntilStockout ?? 0;
      const when = days <= 0 ? 'is out of stock now' : days === 1 ? 'will run out tomorrow' : `will run out in ${days} days`;
      return {
        id: `stockout-${s.productId}`,
        tone: (days <= 2 ? 'negative' : 'warning') as InsightTone,
        title: `${s.name} ${when}`,
        detail: `${formatQuantity(s.available)} left, selling ${formatQuantity(s.dailyVelocity)}/day. Order ${formatQuantity(
          s.suggestedQuantity,
        )}${s.supplierName ? ` from ${s.supplierName}` : ''}.`,
        href: `/products/${s.productId}`,
        priority: days <= 2 ? 95 : 85,
      };
    });
}

/** Capital tied up in stock that is not selling. */
async function deadStockInsight(currency: string): Promise<Insight[]> {
  const settings = await getSettings();
  const deadDays = readNumber(settings, 'inventory.deadStockDays') || 30;
  const dead = await getMovementAnalysis('DEAD', 5);

  if (dead.length === 0) return [];

  const totalValue = dead.reduce((acc, d) => acc + d.stockValue, 0);
  const worst = dead[0];

  return [
    {
      id: 'dead-stock',
      tone: 'warning',
      title: `${dead.length} product${dead.length === 1 ? '' : 's'} haven't sold in ${deadDays} days`,
      detail: `${formatCurrency(totalValue, currency)} of stock is sitting idle — ${worst.name} is the largest at ${formatCurrency(
        worst.stockValue,
        currency,
      )}${worst.daysSinceLastSale != null ? `, last sold ${worst.daysSinceLastSale} days ago` : ', never sold'}.`,
      href: '/reports/dead-stock',
      priority: 65,
    },
  ];
}

/** The single product contributing most revenue this month. */
async function topPerformerInsight(currency: string): Promise<Insight[]> {
  const range = resolveRange('month');
  const rows = await prisma.$queryRaw<{ name: string; productId: string; revenue: string; units: string }[]>`
    SELECT
      p.id                    AS "productId",
      p.name                  AS "name",
      SUM(si.total)::text     AS "revenue",
      SUM(si.quantity)::text  AS "units"
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN products p ON p.id = si."productId"
    WHERE s.status <> 'VOIDED' AND s."createdAt" >= ${range.from} AND s."createdAt" <= ${range.to}
    GROUP BY p.id, p.name
    ORDER BY SUM(si.total) DESC
    LIMIT 1
  `;

  const top = rows[0];
  if (!top || Number(top.revenue) < MATERIAL_REVENUE) return [];

  return [
    {
      id: 'top-performer',
      tone: 'positive',
      title: `${top.name} generated the most revenue this month`,
      detail: `${formatCurrency(Number(top.revenue), currency)} across ${formatQuantity(Number(top.units))} units sold.`,
      href: `/products/${top.productId}`,
      priority: 50,
    },
  ];
}

/** Products whose unit sales moved sharply week over week. */
async function movementShiftInsights(): Promise<Insight[]> {
  const rows = await prisma.$queryRaw<
    { productId: string; name: string; thisWeek: string; lastWeek: string }[]
  >`
    SELECT
      p.id    AS "productId",
      p.name  AS "name",
      COALESCE(SUM(si.quantity) FILTER (
        WHERE s."createdAt" >= now() - interval '7 days'
      ), 0)::text AS "thisWeek",
      COALESCE(SUM(si.quantity) FILTER (
        WHERE s."createdAt" >= now() - interval '14 days' AND s."createdAt" < now() - interval '7 days'
      ), 0)::text AS "lastWeek"
    FROM sale_items si
    JOIN sales s ON s.id = si."saleId"
    JOIN products p ON p.id = si."productId"
    WHERE s.status <> 'VOIDED' AND s."createdAt" >= now() - interval '14 days'
    GROUP BY p.id, p.name
    HAVING COALESCE(SUM(si.quantity) FILTER (WHERE s."createdAt" >= now() - interval '14 days'
                                               AND s."createdAt" < now() - interval '7 days'), 0) >= 3
    LIMIT 50
  `;

  return rows
    .map((r) => {
      const thisWeek = Number(r.thisWeek);
      const lastWeek = Number(r.lastWeek);
      const change = percentChange(thisWeek, lastWeek);
      return { ...r, thisWeek, lastWeek, change };
    })
    .filter((r) => r.change != null && Math.abs(r.change) >= 20)
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))
    .slice(0, 2)
    .map((r) => {
      const up = r.change! > 0;
      return {
        id: `movement-${r.productId}`,
        tone: (up ? 'positive' : 'warning') as InsightTone,
        title: `${r.name} sales ${up ? 'increased' : 'dropped'} ${Math.abs(r.change!).toFixed(0)}% this week`,
        detail: `${formatQuantity(r.thisWeek)} units in the last 7 days versus ${formatQuantity(
          r.lastWeek,
        )} the week before.`,
        href: `/products/${r.productId}`,
        priority: up ? 45 : 68,
      };
    });
}

/** Flags a return rate high enough to suggest a quality problem. */
async function returnRateInsight(): Promise<Insight[]> {
  const rows = await prisma.$queryRaw<{ name: string; productId: string; returned: string; sold: string }[]>`
    WITH sold AS (
      SELECT si."productId", SUM(si.quantity) AS units
      FROM sale_items si JOIN sales s ON s.id = si."saleId"
      WHERE s.status <> 'VOIDED' AND s."createdAt" >= now() - interval '30 days'
      GROUP BY si."productId"
    ),
    returned AS (
      SELECT ri."productId", SUM(ri.quantity) AS units
      FROM return_items ri JOIN returns r ON r.id = ri."returnId"
      WHERE r.type = 'SALE_RETURN' AND r.status = 'COMPLETED' AND r."createdAt" >= now() - interval '30 days'
      GROUP BY ri."productId"
    )
    SELECT p.id AS "productId", p.name AS "name", returned.units::text AS "returned", sold.units::text AS "sold"
    FROM returned
    JOIN sold ON sold."productId" = returned."productId"
    JOIN products p ON p.id = returned."productId"
    WHERE sold.units >= 5 AND (returned.units / sold.units) >= 0.1
    ORDER BY (returned.units / sold.units) DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) return [];

  const rate = (Number(row.returned) / Number(row.sold)) * 100;
  return [
    {
      id: `returns-${row.productId}`,
      tone: 'negative',
      title: `${row.name} has a ${rate.toFixed(0)}% return rate`,
      detail: `${formatQuantity(Number(row.returned))} of ${formatQuantity(
        Number(row.sold),
      )} units sold in the last 30 days came back. Worth checking quality or the product description.`,
      href: '/returns',
      priority: 75,
    },
  ];
}

/** Purchase orders that have blown past their promised delivery date. */
async function supplierDelayInsight(): Promise<Insight[]> {
  const late = await prisma.purchaseOrder.findMany({
    where: { status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] }, expectedDate: { lt: new Date() } },
    select: { id: true, orderNumber: true, expectedDate: true, supplier: { select: { name: true } } },
    orderBy: { expectedDate: 'asc' },
    take: 1,
  });

  const order = late[0];
  if (!order?.expectedDate) return [];

  const daysLate = Math.floor((Date.now() - order.expectedDate.getTime()) / 86_400_000);
  if (daysLate < 1) return [];

  return [
    {
      id: `supplier-delay-${order.id}`,
      tone: 'warning',
      title: `${order.supplier.name} is ${daysLate} day${daysLate === 1 ? '' : 's'} late`,
      detail: `Purchase order ${order.orderNumber} was expected on ${order.expectedDate.toLocaleDateString()} and has not been fully received.`,
      href: `/purchases/${order.id}`,
      priority: 72,
    },
  ];
}

/**
 * Runs every generator and returns the highest-priority findings.
 * A failure in one generator must not blank the whole panel.
 */
export async function generateInsights(limit = 6): Promise<Insight[]> {
  const settings = await getSettings();
  const currency = readString(settings, 'locale.currency') || 'PHP';

  const generators = [
    revenueTrendInsight(currency),
    stockoutForecastInsights(),
    deadStockInsight(currency),
    topPerformerInsight(currency),
    movementShiftInsights(),
    returnRateInsight(),
    supplierDelayInsight(),
  ];

  const settled = await Promise.allSettled(generators);
  const insights: Insight[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      insights.push(...result.value);
    } else {
      console.error('[insights] generator failed', result.reason);
    }
  }

  return insights.sort((a, b) => b.priority - a.priority).slice(0, limit);
}
