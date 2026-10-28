import { z } from 'zod';

/**
 * Units and quantities. Each product has one unit it is counted and sold in,
 * and says whether it may be sold in fractions of that unit:
 *
 *   PIECE, PACK, BOX, BOTTLE, SACK, BAG   usually whole (a pack of noodles)
 *   KILOGRAM, GRAM, LITER, MILLILITER,    usually fractional (0.5 kg of rice,
 *   METER                                 1.5 m of wire)
 *
 * The unit only names what a quantity counts; stock is always stored as a
 * number of the product's own unit, so nothing is ever converted. Decimals
 * are kept to 3 places (0.001 kg = 1 g), the precision of every quantity
 * column. Whether a product allows them is its own setting, and the server
 * and the database both refuse a fraction on a product that does not
 * (migration 20261106090000). Existing products are PIECE, whole numbers.
 *
 * Pure, so the forms, the actions, the services and the tests share it.
 */

export type ProductUnit =
  | 'PIECE'
  | 'PACK'
  | 'BOX'
  | 'BOTTLE'
  | 'SACK'
  | 'BAG'
  | 'KILOGRAM'
  | 'GRAM'
  | 'LITER'
  | 'MILLILITER'
  | 'METER';

export interface UnitDefinition {
  /** Shown in pickers: "Kilogram (kg)". */
  label: string;
  singular: string;
  plural: string;
  /** Whether a new product in this unit allows fractions unless the owner says otherwise. */
  decimalsByDefault: boolean;
}

export const UNITS: Record<ProductUnit, UnitDefinition> = {
  PIECE: { label: 'Piece (pc)', singular: 'pc', plural: 'pcs', decimalsByDefault: false },
  PACK: { label: 'Pack', singular: 'pack', plural: 'packs', decimalsByDefault: false },
  BOX: { label: 'Box', singular: 'box', plural: 'boxes', decimalsByDefault: false },
  BOTTLE: { label: 'Bottle', singular: 'bottle', plural: 'bottles', decimalsByDefault: false },
  SACK: { label: 'Sack', singular: 'sack', plural: 'sacks', decimalsByDefault: false },
  BAG: { label: 'Plastic bag', singular: 'bag', plural: 'bags', decimalsByDefault: false },
  KILOGRAM: { label: 'Kilogram (kg)', singular: 'kg', plural: 'kg', decimalsByDefault: true },
  GRAM: { label: 'Gram (g)', singular: 'g', plural: 'g', decimalsByDefault: false },
  LITER: { label: 'Liter (L)', singular: 'L', plural: 'L', decimalsByDefault: true },
  MILLILITER: { label: 'Milliliter (mL)', singular: 'mL', plural: 'mL', decimalsByDefault: false },
  METER: { label: 'Meter (m)', singular: 'm', plural: 'm', decimalsByDefault: true },
};

export const UNIT_ORDER = Object.keys(UNITS) as ProductUnit[];

export function isProductUnit(value: unknown): value is ProductUnit {
  return typeof value === 'string' && value in UNITS;
}

/** Decimal places any quantity may carry. */
export const QUANTITY_DECIMALS = 3;

/** The smallest step a quantity can change by for a product. */
export function quantityStep(allowsDecimal: boolean): number {
  return allowsDecimal ? 1 / 10 ** QUANTITY_DECIMALS : 1;
}

/** Largest quantity accepted on a single line — far above any real shelf. */
export const MAX_LINE_QUANTITY = 1_000_000;

/** Kept for older callers: the piece unit's labels. */
export const PIECE = { singular: UNITS.PIECE.singular, plural: UNITS.PIECE.plural } as const;

export function isWholeQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** Decimal places in a number as written (1.5 → 1, 2 → 0, 0.125 → 3). */
export function decimalPlaces(value: number | string): number {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? value.toString() : '') : value.trim();
  if (/e/i.test(text)) {
    const n = Number(text);
    return Number.isFinite(n) ? decimalPlaces(n.toFixed(10).replace(/0+$/, '')) : Infinity;
  }
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * Why a quantity cannot be used for a product, or null when it can. `min`
 * is the smallest acceptable value (above zero for a sale line).
 */
export function quantityProblem(
  value: number | string,
  { allowsDecimal, unit = 'PIECE', positive = true }: { allowsDecimal: boolean; unit?: ProductUnit; positive?: boolean },
): string | null {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (typeof value === 'string' && value.trim() === '') return 'Enter a quantity.';
  if (!Number.isFinite(n)) return 'Enter a quantity.';
  if (positive ? n <= 0 : n < 0) return positive ? 'The quantity must be more than zero.' : 'The quantity cannot be negative.';
  if (Math.abs(n) > MAX_LINE_QUANTITY) return 'That quantity is unreasonably large.';
  if (!allowsDecimal && !Number.isInteger(n)) {
    return `This product is sold in whole ${UNITS[unit].plural} — no decimals.`;
  }
  if (decimalPlaces(value) > QUANTITY_DECIMALS) return `Use at most ${QUANTITY_DECIMALS} decimal places.`;
  return null;
}

/** "1 pc", "12 pcs", "1.5 m", "0.25 kg", "-3 pcs". Never rounds a fraction away. */
export function formatUnits(value: number, unit: ProductUnit = 'PIECE'): string {
  const definition = UNITS[unit] ?? UNITS.PIECE;
  const shown = Number(value.toFixed(QUANTITY_DECIMALS));
  const label = Math.abs(shown) === 1 ? definition.singular : definition.plural;
  return `${shown.toLocaleString('en-PH', { maximumFractionDigits: QUANTITY_DECIMALS })} ${label}`;
}

/** Older name for formatUnits; every caller without a unit means pieces. */
export function formatPieces(value: number, unit: ProductUnit = 'PIECE'): string {
  return formatUnits(value, unit);
}

const PRECISION_MESSAGE = `Use at most ${QUANTITY_DECIMALS} decimal places.`;
const precise = (n: number) => decimalPlaces(n) <= QUANTITY_DECIMALS;

/**
 * A sale, receipt or return line: more than zero, up to 3 decimals. Whether
 * this product may take a fraction is checked against the product itself on
 * the server, which the browser cannot change.
 */
export const lineQuantity = z
  .number({ invalid_type_error: 'Enter a quantity.' })
  .finite('Enter a quantity.')
  .gt(0, 'Enter a quantity above zero.')
  .max(MAX_LINE_QUANTITY, 'That quantity is unreasonably large.')
  .refine(precise, PRECISION_MESSAGE);

/** An adjustment delta: non-zero, positive or negative, up to 3 decimals. */
export const signedQuantity = z
  .number({ invalid_type_error: 'Enter a quantity.' })
  .finite('Enter a quantity.')
  .min(-MAX_LINE_QUANTITY, 'That quantity is unreasonably large.')
  .max(MAX_LINE_QUANTITY, 'That quantity is unreasonably large.')
  .refine(precise, PRECISION_MESSAGE);

/** A counted quantity or a threshold: zero or more, up to 3 decimals. */
export const countQuantity = z
  .number({ invalid_type_error: 'Enter a quantity.' })
  .finite('Enter a quantity.')
  .min(0, 'Quantity cannot be negative.')
  .max(MAX_LINE_QUANTITY, 'That quantity is unreasonably large.')
  .refine(precise, PRECISION_MESSAGE);
