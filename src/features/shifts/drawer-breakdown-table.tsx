import { MOVEMENT_KIND_LABEL, cashVariance, drawerBreakdown, type BreakdownParts } from '@/lib/shift-math';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { VarianceText } from '@/features/shifts/shift-status-badge';

/**
 * The drawer, line by line: the one format the owner (Shift Management) and
 * the cashier (Current shift, Close shift) both see. Every row comes from the
 * shift's records through drawerBreakdown; electronic money is listed at ₱0
 * with the amount received beside it, so a GCash sale is visible but never
 * counted as drawer cash.
 */
export function DrawerBreakdownTable({
  parts,
  expectedCash,
  actualCash,
  currency,
  className,
}: {
  parts: BreakdownParts;
  /** The reconciled expected cash (frozen at close); defaults to the breakdown's own total. */
  expectedCash?: number;
  /** Counted cash, or null before the count. */
  actualCash: number | null;
  currency: string;
  className?: string;
}) {
  const breakdown = drawerBreakdown(parts);
  const expected = expectedCash ?? breakdown.expectedCash;
  const variance = actualCash == null ? null : cashVariance(actualCash, expected);
  const signed = (value: number) => `${value < 0 ? '−' : '+'}${formatCurrency(Math.abs(value), currency)}`;

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full min-w-[22rem] text-sm">
        <caption className="sr-only">Drawer breakdown: every movement and its effect on the physical cash in the drawer</caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">
              Transaction item
            </th>
            <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
              Movement type
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Drawer impact
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {breakdown.rows.map((row) => {
            const electronic = row.kind === 'ELECTRONIC_PAYMENT' || row.kind === 'ELECTRONIC_REFUND';
            return (
              <tr key={row.key} className={cn(electronic && 'text-muted-foreground')}>
                <td className="py-2 pr-3">
                  {row.item}
                  <span className="block text-xs text-muted-foreground sm:hidden">{MOVEMENT_KIND_LABEL[row.kind]}</span>
                  {electronic && row.recorded ? (
                    <span className="block text-xs">
                      {formatCurrency(row.recorded, currency)} {row.kind === 'ELECTRONIC_REFUND' ? 'refunded' : 'received'} electronically, not in the drawer
                    </span>
                  ) : null}
                </td>
                <td className="hidden py-2 pr-3 text-muted-foreground sm:table-cell">{MOVEMENT_KIND_LABEL[row.kind]}</td>
                <td className="tabular py-2 text-right font-medium">{row.key === 'opening' ? formatCurrency(row.drawerImpact, currency) : signed(row.drawerImpact)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2">
          <tr className="bg-primary/5">
            <th scope="row" className="py-2.5 pr-3 text-left font-semibold" colSpan={1}>
              Expected physical cash in drawer
            </th>
            <td className="hidden sm:table-cell" />
            <td className="tabular py-2.5 text-right text-base font-bold">{formatCurrency(expected, currency)}</td>
          </tr>
          <tr className="border-t">
            <th scope="row" className="py-2 pr-3 text-left font-medium">
              Actual counted cash
            </th>
            <td className="hidden sm:table-cell" />
            <td className="tabular py-2 text-right font-medium">{actualCash == null ? <span className="text-muted-foreground">Not counted yet</span> : formatCurrency(actualCash, currency)}</td>
          </tr>
          <tr className="border-t">
            <th scope="row" className="py-2 pr-3 text-left font-medium">
              Variance (over / short)
            </th>
            <td className="hidden sm:table-cell" />
            <td className="py-2 text-right">
              <VarianceText difference={variance?.difference ?? null} kind={variance?.kind ?? null} currency={currency} className="font-semibold" />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
