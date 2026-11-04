import { CATEGORY_LABEL } from '@/lib/cash-movements';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { drawerBreakdown } from '@/lib/shift-math';
import { PAYMENT_KIND_LABEL, shiftTimeline, type TimelineEventType } from '@/lib/shift-detail';
import type { ShiftDetail } from '@/server/services/shift-service';

const METHOD: Record<string, string> = { CASH: 'Cash', GCASH: 'GCash', CARD: 'Card', OTHER: 'Other' };
const EVENT_LABEL: Record<TimelineEventType, string> = {
  OPENED: 'Shift opened',
  CLOSED: 'Shift closed',
  ADJUSTMENT: 'Adjustment recorded',
  REVIEWED: 'Reviewed',
};

/**
 * The shift report as it reaches the printer: hidden on screen (`print-only`),
 * and the only thing printed, because the page wraps everything else in
 * `no-print`. Plain black-on-white tables; every figure comes from the same
 * ShiftDetail the screen uses.
 */
export function ShiftPrintReport({
  shift,
  currency,
  storeName,
  storeAddress,
  printedAt,
}: {
  shift: ShiftDetail;
  currency: string;
  storeName: string;
  storeAddress: string;
  printedAt: Date;
}) {
  const money = (value: number) => formatCurrency(value, currency);
  const signed = (value: number) => `${value < 0 ? '−' : '+'}${money(Math.abs(value))}`;
  const breakdown = drawerBreakdown(shift.breakdown);
  const timeline = shiftTimeline(shift);
  const adjustmentsTotal = shift.adjustments.reduce((sum, a) => sum + a.amount, 0);
  const variance =
    shift.difference == null ? '—' : shift.difference === 0 ? 'Balanced' : `${shift.difference > 0 ? 'Overage' : 'Shortage'} ${money(Math.abs(shift.difference))}`;

  return (
    <div className="print-only shift-print text-[11px] leading-snug text-black">
      <header className="mb-3 flex items-start justify-between border-b-2 border-black pb-2">
        <div>
          <p className="text-base font-bold">{storeName || 'Store'}</p>
          {storeAddress && <p>{storeAddress}</p>}
          {shift.branchName && <p>Branch: {shift.branchName}</p>}
        </div>
        <div className="text-right">
          <p className="text-base font-bold">Shift report · {shift.reference}</p>
          <p>Status: {shift.status === 'OPEN' ? 'Open (figures live at print time)' : 'Closed'}</p>
          <p>Printed {formatDateTime(printedAt)}</p>
        </div>
      </header>

      <Section title="Shift details">
        <Grid
          rows={[
            ['Cashier', shift.cashierName],
            ['Shift no.', shift.reference],
            ['Opened', formatDateTime(shift.openedAt)],
            ['Starting cash', money(shift.openingCash)],
            ['Opening notes', shift.openingNotes || '—'],
            ['Closed', shift.closedAt ? formatDateTime(shift.closedAt) : 'Still open'],
            ['Closed by', shift.closedByName ?? '—'],
            ['Closing notes', shift.closingNotes || '—'],
          ]}
        />
      </Section>

      <Section title="Sales summary">
        <Table
          rows={[
            ['Completed sales', String(shift.sales.completedCount)],
            ['Gross sales (before discounts)', money(shift.sales.grossSales)],
            ['Discounts', shift.sales.discounts ? `−${money(shift.sales.discounts)}` : money(0)],
            ...(shift.sales.tax > 0 ? ([['Tax', money(shift.sales.tax)]] as [string, string][]) : []),
            ['Net sales', money(shift.sales.netSales)],
            ...shift.received.map((r): [string, string] => [`Received — ${METHOD[r.method] ?? r.method}${r.method === 'CASH' ? ' (tendered)' : ''}`, money(r.amount)]),
            ['Change given (cash)', shift.changeGiven ? `−${money(shift.changeGiven)}` : money(0)],
            ['Cash received (kept)', money(shift.cashSales)],
            ['Voided sales (excluded above)', shift.sales.voidedCount ? `${shift.sales.voidedCount} · ${money(shift.sales.voidedTotal)}` : 'None'],
          ]}
          strong={['Net sales', 'Cash received (kept)']}
        />
      </Section>

      <Section title="Cash drawer reconciliation">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 font-semibold">Item</th>
              <th className="py-1 text-right font-semibold">Drawer impact</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.rows.map((row) => (
              <tr key={row.key} className="border-b border-neutral-300">
                <td className="py-1">
                  {row.item}
                  {row.recorded ? ` (${money(row.recorded)} electronic, not in drawer)` : ''}
                </td>
                <td className="py-1 text-right tabular-nums">{row.key === 'opening' ? money(row.drawerImpact) : signed(row.drawerImpact)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-black font-bold">
              <td className="py-1">Expected physical cash</td>
              <td className="py-1 text-right tabular-nums">{money(shift.expectedCash)}</td>
            </tr>
            <tr>
              <td className="py-1">Actual counted cash</td>
              <td className="py-1 text-right tabular-nums">{shift.actualCash == null ? 'Not counted yet' : money(shift.actualCash)}</td>
            </tr>
            <tr className="font-bold">
              <td className="py-1">Variance</td>
              <td className="py-1 text-right tabular-nums">{variance}</td>
            </tr>
            {shift.adjustments.length > 0 && (
              <>
                <tr>
                  <td className="py-1">Owner adjustments</td>
                  <td className="py-1 text-right tabular-nums">{signed(adjustmentsTotal)}</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-1">Variance after adjustments</td>
                  <td className="py-1 text-right tabular-nums">
                    {shift.adjustedDifference === 0 ? 'Balanced' : signed(shift.adjustedDifference ?? 0)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Refunds and cash movements">
        {shift.refunds.length === 0 && shift.movements.length === 0 ? (
          <p>No refunds and no cash put in or taken out.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1 font-semibold">Reference</th>
                <th className="py-1 font-semibold">Details</th>
                <th className="py-1 font-semibold">By / when</th>
                <th className="py-1 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {shift.refunds.map((r) => (
                <tr key={r.method} className="border-b border-neutral-300">
                  <td className="py-1">Refunds</td>
                  <td className="py-1">
                    {METHOD[r.method] ?? r.method} · {r.count} refund{r.count === 1 ? '' : 's'}
                  </td>
                  <td className="py-1">—</td>
                  <td className="py-1 text-right tabular-nums">−{money(r.amount)}</td>
                </tr>
              ))}
              {shift.movements.map((m) => (
                <tr key={m.id} className="border-b border-neutral-300">
                  <td className="py-1">{m.reference}</td>
                  <td className="py-1">
                    {CATEGORY_LABEL[m.category]}: {m.reason}
                    {m.notes ? ` · ${m.notes}` : ''}
                  </td>
                  <td className="py-1">
                    {m.userName}, {formatDateTime(m.createdAt)}
                  </td>
                  <td className="py-1 text-right tabular-nums">{signed(m.type === 'CASH_IN' ? m.amount : -m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Review and history">
        <table className="w-full border-collapse">
          <tbody>
            {timeline.map((event) => (
              <tr key={event.key} className="border-b border-neutral-300 align-top">
                <td className="w-40 py-1 font-semibold">
                  {EVENT_LABEL[event.type]}
                  {event.amount != null ? ` ${signed(event.amount)}` : ''}
                </td>
                <td className="py-1">
                  {event.actor ?? 'Not recorded'}, {formatDateTime(event.at)}
                  {event.note ? <span className="block">{event.type === 'REVIEWED' ? 'Resolution: ' : event.type === 'ADJUSTMENT' ? 'Reason: ' : 'Notes: '}{event.note}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1">
          Review status:{' '}
          {shift.reviewStatus === 'REVIEWED' ? 'Reviewed' : shift.reviewStatus === 'PENDING' ? 'Waiting for the owner' : 'Not required'}
        </p>
      </Section>

      <Section title={`Transactions (${shift.transactions.length + shift.refundRows.length})`} allowBreak>
        {shift.transactions.length === 0 && shift.refundRows.length === 0 ? (
          <p>No sales on this shift.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1 font-semibold">Receipt</th>
                <th className="py-1 font-semibold">Time</th>
                <th className="py-1 font-semibold">Payment</th>
                <th className="py-1 font-semibold">Status</th>
                <th className="py-1 text-right font-semibold">Total</th>
                <th className="py-1 text-right font-semibold">Cash kept</th>
                <th className="py-1 text-right font-semibold">Non-cash</th>
              </tr>
            </thead>
            <tbody>
              {shift.transactions.map((t) => (
                <tr key={t.id} className="border-b border-neutral-300">
                  <td className="py-1">{t.invoiceNumber}</td>
                  <td className="py-1">{formatDateTime(t.createdAt)}</td>
                  <td className="py-1">{PAYMENT_KIND_LABEL[t.payment]}</td>
                  <td className="py-1">{t.status === 'VOIDED' ? 'Voided' : 'Completed'}</td>
                  <td className="py-1 text-right tabular-nums">{money(t.total)}</td>
                  <td className="py-1 text-right tabular-nums">{t.cash ? money(t.cash) : '—'}</td>
                  <td className="py-1 text-right tabular-nums">{t.other ? money(t.other) : '—'}</td>
                </tr>
              ))}
              {shift.refundRows.map((r) => (
                <tr key={r.id} className="border-b border-neutral-300">
                  <td className="py-1">{r.returnNumber ?? '—'}</td>
                  <td className="py-1">{formatDateTime(r.createdAt)}</td>
                  <td className="py-1">{METHOD[r.method] ?? r.method}</td>
                  <td className="py-1">Refund</td>
                  <td className="py-1 text-right tabular-nums">−{money(r.amount)}</td>
                  <td className="py-1 text-right tabular-nums">{r.method === 'CASH' ? `−${money(r.amount)}` : '—'}</td>
                  <td className="py-1 text-right tabular-nums">{r.method !== 'CASH' ? `−${money(r.amount)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {shift.transactionsTruncated && <p className="mt-1">Only the first 500 sales are listed.</p>}
      </Section>

      <footer className="mt-6 grid grid-cols-2 gap-10 pt-6 [break-inside:avoid]">
        <p className="border-t border-black pt-1">Cashier signature</p>
        <p className="border-t border-black pt-1">Owner / reviewer signature</p>
      </footer>
    </div>
  );
}

function Section({ title, children, allowBreak }: { title: string; children: React.ReactNode; allowBreak?: boolean }) {
  return (
    <section className={allowBreak ? 'mb-3' : 'mb-3 [break-inside:avoid]'}>
      <h2 className="mb-1 border-b border-black pb-0.5 text-[12px] font-bold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

function Grid({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6">
      {rows.map(([label, value]) => (
        <div key={label} className="flex gap-2 border-b border-neutral-300 py-1">
          <dt className="w-28 shrink-0 font-semibold">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ rows, strong = [] }: { rows: [string, string][]; strong?: string[] }) {
  return (
    <table className="w-full border-collapse">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className={strong.includes(label) ? 'border-b border-neutral-300 font-bold' : 'border-b border-neutral-300'}>
            <td className="py-1">{label}</td>
            <td className="py-1 text-right tabular-nums">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
