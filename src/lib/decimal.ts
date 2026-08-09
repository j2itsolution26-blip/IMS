import { Prisma } from '@prisma/client';

export type Numeric = Prisma.Decimal | number | string;

export const D = (value: Numeric = 0): Prisma.Decimal => new Prisma.Decimal(value ?? 0);

/**
 * Prisma returns Decimal objects, which do not survive the server -> client
 * boundary. Every value crossing into a client component goes through here.
 */
export const toNum = (value: Numeric | null | undefined): number =>
  value == null ? 0 : Number(value.toString());

export const sum = (values: Numeric[]): Prisma.Decimal =>
  values.reduce<Prisma.Decimal>((acc, v) => acc.plus(D(v)), D(0));

/** Round money to 2dp for anything user-facing or persisted as a total. */
export const money = (value: Numeric): Prisma.Decimal => D(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Quantities keep 3dp so fractional units (0.250 kg) stay exact. */
export const qty = (value: Numeric): Prisma.Decimal => D(value).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);

export const isZero = (value: Numeric): boolean => D(value).isZero();
export const gt = (a: Numeric, b: Numeric): boolean => D(a).greaterThan(D(b));
export const gte = (a: Numeric, b: Numeric): boolean => D(a).greaterThanOrEqualTo(D(b));
export const lt = (a: Numeric, b: Numeric): boolean => D(a).lessThan(D(b));
export const lte = (a: Numeric, b: Numeric): boolean => D(a).lessThanOrEqualTo(D(b));

/** Percentage change guarding against a zero baseline. */
export function percentChange(current: Numeric, previous: Numeric): number | null {
  const prev = D(previous);
  if (prev.isZero()) return null;
  return Number(D(current).minus(prev).dividedBy(prev).times(100).toDecimalPlaces(2).toString());
}

/** Margin as a percentage of revenue. */
export function marginPercent(revenue: Numeric, cost: Numeric): number {
  const rev = D(revenue);
  if (rev.isZero()) return 0;
  return Number(rev.minus(D(cost)).dividedBy(rev).times(100).toDecimalPlaces(2).toString());
}
