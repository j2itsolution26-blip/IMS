import { formatUnits, quantityProblem, QUANTITY_DECIMALS, UNITS, type ProductUnit } from '@/lib/quantity';

/**
 * Quick quantity buttons for the till: ¼ kg, ½ kg, 1½ m, 250 g …
 *
 * Every value is in the product's own unit, the unit its stock and price are
 * kept in, so a button only sets the line's quantity and nothing is ever
 * converted at sale time. A kilogram product's "250 g" button is 0.25 kg:
 * stock goes down by 0.25 and the price is price-per-kg × 0.25, rounded to
 * centavos once, like every line.
 *
 * Each product may carry its own list (products.quantityPresets); an empty
 * list means its unit's standard buttons below. Pure, so the product form,
 * the till, the server and the tests share it.
 */

/** At most this many buttons per product (the database holds the same). */
export const MAX_PRESETS = 8;

/**
 * Standard buttons per unit. Kilograms lead with 50 g and 100 g for small
 * buys (spices, feeds, charcoal), then the quarter-kilo steps Filipino
 * stores sell in. 1 g and 5 g buttons are left out on purpose: a store scale
 * is rarely that exact, and at ₱60/kg a gram is ₱0.06. Any other amount is
 * typed, to the gram (0.001 kg).
 */
export const STANDARD_PRESETS: Partial<Record<ProductUnit, number[]>> = {
  KILOGRAM: [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2],
  GRAM: [50, 100, 250, 500],
  METER: [0.5, 1, 1.5, 2, 2.5],
  LITER: [0.25, 0.5, 1, 1.5, 2],
  MILLILITER: [100, 250, 500, 1000],
};

export interface PresetProduct {
  unit: ProductUnit;
  allowsDecimal: boolean;
  /** The product's own list; empty for the standard buttons. */
  quantityPresets?: readonly number[];
}

const round3 = (n: number) => Math.round(n * 10 ** QUANTITY_DECIMALS) / 10 ** QUANTITY_DECIMALS;

/**
 * The buttons to show for a product, smallest first. A product sold in whole
 * units only gets whole values, so a "½" can never be offered for a pack.
 */
export function presetsFor(product: PresetProduct): number[] {
  const own = product.quantityPresets?.length ? product.quantityPresets : (STANDARD_PRESETS[product.unit] ?? []);
  const values = own.map(round3).filter((n) => n > 0 && (product.allowsDecimal || Number.isInteger(n)));
  return [...new Set(values)].sort((a, b) => a - b).slice(0, MAX_PRESETS);
}

const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' };

/** A whole number and a quarter fraction as "1½", "3¼", "¾"; null otherwise. */
function vulgar(value: number): string | null {
  const whole = Math.floor(value);
  const part = round3(value - whole);
  if (part === 0) return null;
  const symbol = FRACTIONS[String(part)];
  return symbol ? `${whole > 0 ? whole : ''}${symbol}` : null;
}

const plain = (n: number) => round3(n).toLocaleString('en-PH', { maximumFractionDigits: QUANTITY_DECIMALS });

/**
 * A button's label: "¼ kg", "1½ kg", "100 g" (a kilogram value under ¼ kg
 * reads in grams), "2.5 m", "250 g".
 */
export function presetLabel(value: number, unit: ProductUnit): string {
  if (unit === 'KILOGRAM') {
    const fraction = vulgar(value);
    if (fraction) return `${fraction} kg`;
    if (value < 1) return `${plain(value * 1000)} g`;
    return `${plain(value)} kg`;
  }
  return formatUnits(value, unit);
}

/**
 * A sale line's quantity as the cashier and the customer read it: "250 g"
 * for a quarter-kilo bought by weight, "1.5 kg", "2.5 m", "3 pcs". Only how
 * it is shown; the stored quantity stays 0.25 kg.
 */
export function formatSaleQuantity(value: number, unit: ProductUnit = 'PIECE'): string {
  if (unit === 'KILOGRAM' && value > 0 && value < 1) return `${plain(value * 1000)} g`;
  return formatUnits(value, unit);
}

/** "/ kg", "/ m", "/ pc": what a product's price is per. */
export function pricePer(unit: ProductUnit = 'PIECE'): string {
  return `/ ${(UNITS[unit] ?? UNITS.PIECE).singular}`;
}

/** Why a product's own button list cannot be saved, or null. */
export function presetsProblem(values: readonly number[], product: { unit: ProductUnit; allowsDecimal: boolean }): string | null {
  if (values.length > MAX_PRESETS) return `Use at most ${MAX_PRESETS} quick quantities.`;
  for (const value of values) {
    const problem = quantityProblem(value, { allowsDecimal: product.allowsDecimal, unit: product.unit });
    if (problem) return `${plain(value)}: ${problem}`;
  }
  return null;
}

/**
 * Reads the product form's "0.25, 0.5, 1" box. Blank means the standard
 * buttons. Fractions written ¼ ½ ¾ or "1/4" are accepted.
 */
export function parsePresetText(text: string): { values: number[]; problem: string | null } {
  const parts = text
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const values: number[] = [];
  for (const part of parts) {
    const value = parseAmount(part);
    if (value === null) return { values: [], problem: `“${part}” is not a quantity. Use numbers like 0.25, 0.5, 1.` };
    values.push(value);
  }
  return { values: [...new Set(values.map(round3))].sort((a, b) => a - b), problem: null };
}

function parseAmount(text: string): number | null {
  const symbols: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };
  const symbol = /^(\d*)([¼½¾])$/.exec(text);
  if (symbol) return (symbol[1] ? Number(symbol[1]) : 0) + symbols[symbol[2]];
  const ratio = /^(\d+)\/(\d+)$/.exec(text);
  if (ratio) return Number(ratio[2]) > 0 ? Number(ratio[1]) / Number(ratio[2]) : null;
  if (!/^\d*\.?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The form box's text for a stored list. */
export function presetText(values: readonly number[]): string {
  return values.map((value) => String(round3(value))).join(', ');
}
