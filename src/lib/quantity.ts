import { z } from 'zod';

/**
 * Every product in the store is counted and sold by the piece. There are no
 * other units and no fractional quantities, so a quantity is always a whole
 * number. These rules are shared by the forms, the server actions and the
 * services; the database enforces the same thing with CHECK constraints.
 */

export const PIECE = { singular: 'pc', plural: 'pcs' } as const;

/** Largest quantity accepted on a single line — far above any real shelf. */
export const MAX_LINE_QUANTITY = 1_000_000;

export function isWholeQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** "1 pc", "12 pcs", "-3 pcs". */
export function formatPieces(value: number): string {
  const n = Math.round(value);
  const label = Math.abs(n) === 1 ? PIECE.singular : PIECE.plural;
  return `${n.toLocaleString('en-PH')} ${label}`;
}

const WHOLE_MESSAGE = 'Quantities are whole pieces — no decimals.';

/** A sale, receipt or return line: at least one whole piece. */
export const pieceQuantity = z
  .number({ invalid_type_error: 'Enter a quantity.' })
  .int(WHOLE_MESSAGE)
  .min(1, 'Enter at least 1 piece.')
  .max(MAX_LINE_QUANTITY, 'That quantity is unreasonably large.');

/** An adjustment delta: a non-zero whole number, positive or negative. */
export const signedPieceQuantity = z
  .number({ invalid_type_error: 'Enter a quantity.' })
  .int(WHOLE_MESSAGE)
  .min(-MAX_LINE_QUANTITY, 'That quantity is unreasonably large.')
  .max(MAX_LINE_QUANTITY, 'That quantity is unreasonably large.');

/** A counted quantity or a threshold: zero or more whole pieces. */
export const countQuantity = z
  .number({ invalid_type_error: 'Enter a quantity.' })
  .int(WHOLE_MESSAGE)
  .min(0, 'Quantity cannot be negative.')
  .max(MAX_LINE_QUANTITY, 'That quantity is unreasonably large.');
