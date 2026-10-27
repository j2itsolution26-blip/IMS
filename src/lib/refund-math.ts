import type { Prisma } from '@prisma/client';
import { D, money, sum, type Numeric } from './decimal';

/**
 * How much a refund gives back. Pure, so every rounding case is unit-tested.
 *
 * A sale's lines are priced after their line discounts. The order discount
 * and the tax apply to the whole sale, so each returned piece carries its
 * share of both:
 *
 *   sale.total    = subtotal + tax - orderDiscount     (what the customer paid)
 *   ex-tax total  = subtotal - orderDiscount           (revenue excluding tax)
 *
 *   refund (cash) = line price paid x total / subtotal
 *   refund ex-tax = line price paid x (subtotal - orderDiscount) / subtotal
 *
 * The cash figure is what is handed back and goes into the drawer; the ex-tax
 * figure is what reports subtract from revenue excluding tax. Together the
 * refunds on one sale can never exceed what was paid for it.
 */

export interface RefundSale {
  subtotal: Numeric;
  discount: Numeric;
  total: Numeric;
}

export interface RefundSaleItem {
  id: string;
  quantity: Numeric;
  returnedQuantity: Numeric;
  /** The line total after its line discount, before tax and order discount. */
  total: Numeric;
}

export interface RefundRequestLine {
  saleItemId: string;
  quantity: Numeric;
}

export interface RefundLine {
  saleItemId: string;
  quantity: Prisma.Decimal;
  /** Ex-tax refund per piece, after the order discount share. */
  unitPrice: Prisma.Decimal;
  /** Ex-tax refund for the line. */
  exTax: Prisma.Decimal;
}

export interface RefundAmounts {
  lines: RefundLine[];
  /** Ex-tax: subtracted from revenue excluding tax in reports. */
  subtotal: Prisma.Decimal;
  /** Handed back to the customer. */
  total: Prisma.Decimal;
  /** True when this refund returns every remaining piece of the sale. */
  closesSale: boolean;
}

export class RefundError extends Error {}

/** Rounding left after sharing out the totals; absorbed when the last pieces come back. */
const ROUNDING_TOLERANCE = D('0.05');

export function refundAmounts(input: {
  sale: RefundSale;
  items: RefundSaleItem[];
  request: RefundRequestLine[];
  /** Completed refunds already given on this sale. */
  previous: { subtotal: Numeric; total: Numeric };
}): RefundAmounts {
  const subtotal = D(input.sale.subtotal);
  const exTaxSale = subtotal.minus(D(input.sale.discount));
  const cashFactor = subtotal.isZero() ? D(0) : D(input.sale.total).dividedBy(subtotal);
  const exTaxFactor = subtotal.isZero() ? D(0) : exTaxSale.dividedBy(subtotal);

  const items = new Map(input.items.map((item) => [item.id, item]));
  const requested = new Map<string, Prisma.Decimal>();
  for (const line of input.request) {
    const quantity = D(line.quantity);
    if (quantity.isNaN() || quantity.lessThan(0)) throw new RefundError('A returned quantity cannot be negative.');
    if (quantity.isZero()) continue;
    if (!items.has(line.saleItemId)) throw new RefundError('That line is not on this sale.');
    requested.set(line.saleItemId, (requested.get(line.saleItemId) ?? D(0)).plus(quantity));
  }
  if (requested.size === 0) throw new RefundError('Enter a quantity for at least one line to return.');

  const lines: RefundLine[] = [];
  let cash = D(0);
  for (const [saleItemId, quantity] of requested) {
    const item = items.get(saleItemId)!;
    const sold = D(item.quantity);
    const returnable = sold.minus(D(item.returnedQuantity));
    if (quantity.greaterThan(returnable)) {
      throw new RefundError(`Only ${returnable.toString()} of that line remains returnable.`);
    }
    const paidForLine = sold.isZero() ? D(0) : D(item.total).times(quantity).dividedBy(sold);
    const exTax = money(paidForLine.times(exTaxFactor));
    lines.push({ saleItemId, quantity, unitPrice: money(exTax.dividedBy(quantity)), exTax });
    cash = cash.plus(paidForLine.times(cashFactor));
  }

  let total = money(cash);
  let exTaxTotal = money(sum(lines.map((line) => line.exTax)));

  const remainingCash = money(D(input.sale.total).minus(D(input.previous.total)));
  const remainingExTax = money(exTaxSale.minus(D(input.previous.subtotal)));
  const closesSale = input.items.every((item) =>
    D(item.returnedQuantity).plus(requested.get(item.id) ?? 0).greaterThanOrEqualTo(D(item.quantity)),
  );

  // The last pieces back take whatever rounding is left, so the refunds on a
  // sale add up to exactly what it cost, never a centavo more.
  if (closesSale && remainingCash.minus(total).abs().lessThanOrEqualTo(ROUNDING_TOLERANCE)) total = remainingCash;
  if (closesSale && remainingExTax.minus(exTaxTotal).abs().lessThanOrEqualTo(ROUNDING_TOLERANCE)) {
    const last = lines[lines.length - 1];
    last.exTax = money(last.exTax.plus(remainingExTax.minus(exTaxTotal)));
    last.unitPrice = money(last.exTax.dividedBy(last.quantity));
    exTaxTotal = remainingExTax;
  }

  if (total.greaterThan(remainingCash)) total = remainingCash.lessThan(0) ? D(0) : remainingCash;
  if (exTaxTotal.greaterThan(total)) exTaxTotal = total;

  return { lines, subtotal: exTaxTotal, total, closesSale };
}
