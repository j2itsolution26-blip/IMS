import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/session';
import { can } from '@/lib/permissions';
import { manilaTodayRange, parseManilaDate, toDateInput } from '@/lib/dates';
import { fmtDateTime, peso } from '@/lib/format';
import { ActionForm } from '@/components/action-form';
import { Badge, Card, Empty, Field, PageHeader } from '@/components/ui';
import { cancelReceipt, createReceipt } from './actions';

export const metadata = { title: 'Receipts' };

export default async function Receipts({ searchParams }: { searchParams: Promise<{ date?: string; q?: string }> }) {
  const user = await requirePermission('receipts.view');
  const sp = await searchParams;
  const day = (sp.date && parseManilaDate(sp.date)) || manilaTodayRange().start;
  const end = new Date(day.getTime() + 86_400_000);
  const q = (sp.q ?? '').trim().slice(0, 50);
  const where: Prisma.ReceiptWhereInput = q ? { orNumber: { contains: q, mode: 'insensitive' } } : { paidAt: { gte: day, lt: end } };

  const receipts = await prisma.receipt.findMany({
    where,
    orderBy: { paidAt: 'desc' },
    take: 300,
    include: { collectedBy: { select: { fullName: true } } },
  });
  const total = receipts.filter((r) => r.status === 'PAID').reduce((s, r) => s + Number(r.amount), 0);
  const canCancel = can(user.role, 'receipts.cancel');

  return (
    <>
      <PageHeader title="Official receipts" description="Collections recorded against the barangay's official receipt booklets." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <form className="flex flex-wrap gap-2">
            <input type="date" name="date" defaultValue={toDateInput(day)} className="input w-auto" />
            <input name="q" defaultValue={q} placeholder="or find an OR number" className="input w-auto flex-1" />
            <button className="btn-secondary">Show</button>
          </form>
          <p className="text-sm text-slate-600">
            {q ? `Receipts matching “${q}”` : `Collections on ${toDateInput(day)}`}: <strong>{peso(total)}</strong> from{' '}
            {receipts.filter((r) => r.status === 'PAID').length} paid receipts
          </p>
          {receipts.length === 0 ? (
            <Empty>No receipts.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="table">
                <thead>
                  <tr>
                    <th>OR no.</th>
                    <th>Time</th>
                    <th>Payor</th>
                    <th>For</th>
                    <th className="text-right">Amount</th>
                    <th>Collected by</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.orNumber}</td>
                      <td className="whitespace-nowrap">{fmtDateTime(r.paidAt)}</td>
                      <td>{r.payorName}</td>
                      <td>{r.description}</td>
                      <td className="text-right tabular-nums">{peso(r.amount)}</td>
                      <td>{r.collectedBy.fullName}</td>
                      <td>
                        {r.status === 'PAID' ? (
                          canCancel ? (
                            <details>
                              <summary className="cursor-pointer">
                                <Badge tone="green">Paid</Badge>
                              </summary>
                              <ActionForm
                                action={cancelReceipt}
                                submitLabel="Cancel OR"
                                submitClassName="btn-danger mt-1 px-2 py-1 text-xs"
                                className="mt-2 w-48 space-y-2"
                                confirm={`Cancel OR ${r.orNumber}?`}
                              >
                                <input type="hidden" name="id" value={r.id} />
                                <input name="reason" placeholder="Reason" className="input" required />
                              </ActionForm>
                            </details>
                          ) : (
                            <Badge tone="green">Paid</Badge>
                          )
                        ) : (
                          <span title={r.cancelReason}>
                            <Badge tone="red">Cancelled</Badge>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {can(user.role, 'receipts.create') && (
          <Card title="Record a collection">
            <p className="mb-3 text-xs text-slate-500">Certificate fees are recorded automatically when the certificate is issued. Use this for other collections.</p>
            <ActionForm action={createReceipt} submitLabel="Record receipt" resetOnSuccess>
              <Field label="OR number">
                <input name="orNumber" className="input" required />
              </Field>
              <Field label="Payor">
                <input name="payorName" className="input" required />
              </Field>
              <Field label="Nature of collection" hint="e.g. hall rental, permit fee">
                <input name="description" className="input" required />
              </Field>
              <Field label="Amount (₱)">
                <input name="amount" className="input" inputMode="decimal" required />
              </Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
