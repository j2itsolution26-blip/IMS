import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { toNum } from '@/lib/decimal';
import { getCurrency } from '@/server/services/settings-service';
import { resolveRange, parsePeriod } from '@/server/analytics/date-range';
import { formatCurrency } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { PeriodPicker } from '@/components/period-picker';
import { Card } from '@/components/ui/card';
import { ExpensesManager, type ExpenseRow } from '@/features/expenses/expenses-manager';

export const metadata: Metadata = { title: 'Expenses' };
export const dynamic = 'force-dynamic';

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requirePermission('expenses.view');
  const params = await searchParams;

  const period = parsePeriod(params.period, 'month');
  const range = resolveRange(period);
  const currency = await getCurrency();

  const expenses = await prisma.expense.findMany({
    where: { incurredAt: { gte: range.from, lte: range.to } },
    orderBy: { incurredAt: 'desc' },
    take: 500,
    select: {
      id: true,
      reference: true,
      category: true,
      description: true,
      amount: true,
      method: true,
      incurredAt: true,
      user: { select: { name: true } },
    },
  });

  const rows: ExpenseRow[] = expenses.map((expense) => ({
    id: expense.id,
    reference: expense.reference,
    category: expense.category,
    description: expense.description,
    amount: toNum(expense.amount),
    method: expense.method,
    incurredAt: expense.incurredAt.toISOString(),
    recordedBy: expense.user.name,
  }));

  const total = rows.reduce((acc, row) => acc + row.amount, 0);

  // Largest category first — the one worth questioning.
  const byCategory = [...rows.reduce((map, row) => {
    map.set(row.category, (map.get(row.category) ?? 0) + row.amount);
    return map;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Expenses"
        description={`Operating costs for ${range.label.toLowerCase()}. These are deducted from gross profit to give net profit.`}
        actions={<PeriodPicker current={period} />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total spend</p>
          <p className="mt-1 text-xl font-semibold">{formatCurrency(total, currency)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Entries</p>
          <p className="mt-1 text-xl font-semibold">{rows.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Largest category</p>
          <p className="mt-1 truncate text-xl font-semibold">
            {byCategory[0] ? byCategory[0][0] : '—'}
          </p>
          {byCategory[0] && (
            <p className="text-xs text-muted-foreground">{formatCurrency(byCategory[0][1], currency)}</p>
          )}
        </Card>
      </div>

      <ExpensesManager
        rows={rows}
        currency={currency}
        permissions={{
          canCreate: userCan(user, 'expenses.create'),
          canUpdate: userCan(user, 'expenses.update'),
          canDelete: userCan(user, 'expenses.delete'),
        }}
      />
    </>
  );
}
