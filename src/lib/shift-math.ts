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

/* -------------------------------------------------------------------------- */
/* Drawer breakdown                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Every kind of money a shift handled, whether or not it touched the drawer.
 * The cash parts are the ones `drawerTotals` adds up; the electronic parts
 * are listed beside them at ₱0 so the owner and cashier can see why money
 * received by GCash is not in the drawer.
 */
export interface BreakdownParts {
  openingCash: number;
  /** Cash kept from sales: tendered less change. */
  cashSales: number;
  /** Paid by GCash for products — sales, but not drawer cash. */
  gcashSales: number;
  /** Paid by card or other non-cash methods. */
  otherNonCashSales: number;
  /** GCash cash-in / load: cash the customer handed over for e-money (fee excluded). */
  walletCashIn: number;
  /** GCash cash-out: cash handed to customers before the fee is kept. */
  walletCashOut: number;
  /** GCash service fees, collected in cash. */
  walletFees: number;
  /** Drawer cash in (change fund, owner top-up). */
  cashIn: number;
  /** Drawer cash out (petty cash, supplier payments). */
  cashOut: number;
  cashRefunds: number;
  /** Refunds paid back by GCash or another non-cash method. */
  nonCashRefunds: number;
}

export type MovementKind =
  | 'OPENING'
  | 'CASH_COLLECTION'
  | 'ELECTRONIC_PAYMENT'
  | 'FEE_COLLECTION'
  | 'CASH_INFLOW'
  | 'CASH_OUTFLOW'
  | 'REFUND_OUTFLOW'
  | 'ELECTRONIC_REFUND';

export const MOVEMENT_KIND_LABEL: Record<MovementKind, string> = {
  OPENING: 'Opening cash',
  CASH_COLLECTION: 'Cash collection',
  ELECTRONIC_PAYMENT: 'Electronic payment',
  FEE_COLLECTION: 'Fee collection',
  CASH_INFLOW: 'Cash inflow',
  CASH_OUTFLOW: 'Cash outflow',
  REFUND_OUTFLOW: 'Refund outflow',
  ELECTRONIC_REFUND: 'Electronic refund',
};

export interface BreakdownRow {
  key: string;
  item: string;
  kind: MovementKind;
  /** Signed effect on the physical drawer; 0 for electronic money. */
  drawerImpact: number;
  /** For electronic rows: the amount received or paid, shown for reference. */
  recorded?: number;
}

export interface DrawerBreakdown {
  rows: BreakdownRow[];
  expectedCash: number;
}

/**
 * The drawer, line by line, in the format the owner and cashier share:
 * expected = starting cash + cash collections + fees + cash inflows
 *            − cash outflows − cash refunds.
 * Electronic payments and refunds are listed at ₱0.
 */
export function drawerBreakdown(parts: BreakdownParts): DrawerBreakdown {
  const rows: BreakdownRow[] = [
    { key: 'opening', item: 'Starting cash (base float)', kind: 'OPENING', drawerImpact: parts.openingCash },
    { key: 'cashSales', item: 'Cash sales (after change)', kind: 'CASH_COLLECTION', drawerImpact: parts.cashSales },
    { key: 'gcashSales', item: 'GCash sales (customer paid electronically)', kind: 'ELECTRONIC_PAYMENT', drawerImpact: 0, recorded: parts.gcashSales },
  ];
  if (parts.otherNonCashSales) {
    rows.push({ key: 'otherSales', item: 'Card and other non-cash sales', kind: 'ELECTRONIC_PAYMENT', drawerImpact: 0, recorded: parts.otherNonCashSales });
  }
  rows.push(
    { key: 'walletIn', item: 'GCash cash-in / load (customer paid cash)', kind: 'CASH_COLLECTION', drawerImpact: parts.walletCashIn },
    { key: 'walletOut', item: 'GCash cash-out (cash given to customer)', kind: 'CASH_OUTFLOW', drawerImpact: -parts.walletCashOut },
    { key: 'walletFees', item: 'GCash service fees (paid in cash)', kind: 'FEE_COLLECTION', drawerImpact: parts.walletFees },
    { key: 'cashIn', item: 'Drawer cash in (change fund, top-up)', kind: 'CASH_INFLOW', drawerImpact: parts.cashIn },
    { key: 'cashOut', item: 'Drawer cash out (petty cash, expenses)', kind: 'CASH_OUTFLOW', drawerImpact: -parts.cashOut },
    { key: 'cashRefunds', item: 'Cash refunds', kind: 'REFUND_OUTFLOW', drawerImpact: -parts.cashRefunds },
  );
  if (parts.nonCashRefunds) {
    rows.push({ key: 'otherRefunds', item: 'GCash and other non-cash refunds', kind: 'ELECTRONIC_REFUND', drawerImpact: 0, recorded: parts.nonCashRefunds });
  }
  const expected = rows.reduce((sum, row) => sum.plus(D(row.drawerImpact)), D(0));
  return { rows: rows.map((row) => ({ ...row, drawerImpact: toNum(money(row.drawerImpact)) })), expectedCash: toNum(money(expected)) };
}
