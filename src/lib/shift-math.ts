import { D, money, toNum, type Numeric } from '@/lib/decimal';

/**
 * The drawer arithmetic, in exact decimals.
 *
 *   expected = starting cash + cash from sales + cash in − cash refunds − cash out
 *              + GCash services (cash-in amount + fee, less cash-out paid out)
 *   variance = counted − expected   (0 balanced, + overage, − shortage)
 *
 * "Cash from sales" is the cash customers handed over less the change given
 * back, on sales that were not voided — a cash payment is stored at the amount
 * tendered, so counting it alone would overstate the drawer by every peso of
 * change.
 */

export interface DrawerParts {
  openingCash: Numeric;
  cashTendered: Numeric;
  changeGiven: Numeric;
  cashIn: Numeric;
  cashRefunds: Numeric;
  cashOut: Numeric;
  /** Net drawer cash from GCash cash-in / cash-out services; 0 when none. */
  walletCash?: Numeric;
}

export interface DrawerTotals {
  openingCash: number;
  cashSales: number;
  cashIn: number;
  cashRefunds: number;
  cashOut: number;
  walletCash: number;
  expectedCash: number;
}

export function drawerTotals(parts: DrawerParts): DrawerTotals {
  const cashSales = money(D(parts.cashTendered).minus(D(parts.changeGiven)));
  const expected = money(
    D(parts.openingCash)
      .plus(cashSales)
      .plus(D(parts.cashIn))
      .minus(D(parts.cashRefunds))
      .minus(D(parts.cashOut))
      .plus(D(parts.walletCash ?? 0)),
  );
  return {
    openingCash: toNum(money(parts.openingCash)),
    cashSales: toNum(cashSales),
    cashIn: toNum(money(parts.cashIn)),
    cashRefunds: toNum(money(parts.cashRefunds)),
    cashOut: toNum(money(parts.cashOut)),
    walletCash: toNum(money(parts.walletCash ?? 0)),
    expectedCash: toNum(expected),
  };
}

export type VarianceKind = 'BALANCED' | 'OVERAGE' | 'SHORTAGE';

export function cashVariance(counted: Numeric, expected: Numeric): { difference: number; kind: VarianceKind } {
  const difference = money(D(counted).minus(D(expected)));
  const kind: VarianceKind = difference.isZero() ? 'BALANCED' : difference.greaterThan(0) ? 'OVERAGE' : 'SHORTAGE';
  return { difference: toNum(difference), kind };
}
