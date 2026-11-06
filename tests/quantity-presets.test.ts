import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_PRESETS,
  STANDARD_PRESETS,
  formatSaleQuantity,
  parsePresetText,
  presetLabel,
  presetText,
  presetsFor,
  presetsProblem,
  pricePer,
} from '@/lib/quantity-presets';

/** The server's line maths: price × quantity, rounded to centavos once. */
const line = (pricePerUnit: number, quantity: number) => Math.round(pricePerUnit * quantity * 100) / 100;

test('kilogram presets price correctly: ¼ ½ ¾ 1 1½ 3¼ kg of ₱60/kg rice', () => {
  const cases: [number, number][] = [
    [0.25, 15],
    [0.5, 30],
    [0.75, 45],
    [1, 60],
    [1.5, 90],
    [2, 120],
    [3.25, 195],
  ];
  for (const [kg, total] of cases) assert.equal(line(60, kg), total, `${kg} kg`);
  assert.deepEqual(
    [0.25, 0.5, 0.75, 1, 1.5, 2, 3.25].map((kg) => presetLabel(kg, 'KILOGRAM')),
    ['¼ kg', '½ kg', '¾ kg', '1 kg', '1½ kg', '2 kg', '3¼ kg'],
  );
});

test('grams on a kilogram product are exact fractions of a kilo, so stock and price never drift', () => {
  const grams: [number, number][] = [
    [1, 0.001],
    [10, 0.01],
    [25, 0.025],
    [50, 0.05],
    [100, 0.1],
    [250, 0.25],
    [500, 0.5],
    [750, 0.75],
    [1000, 1],
  ];
  for (const [g, kg] of grams) assert.equal(Math.round((g / 1000) * 1000) / 1000, kg, `${g} g`);
  // ₱60/kg: 50 g = ₱3, 100 g = ₱6, 250 g = ₱15.
  assert.deepEqual([0.05, 0.1, 0.25].map((kg) => line(60, kg)), [3, 6, 15]);
  // Ten 100 g sales take exactly 1 kg off the shelf, with no float residue.
  let stock = 5;
  for (let i = 0; i < 10; i++) stock = Math.round((stock - 0.1) * 1000) / 1000;
  assert.equal(stock, 4);
  // Below 1 kg a sale line reads in grams; stock screens keep kilograms.
  assert.equal(formatSaleQuantity(0.25, 'KILOGRAM'), '250 g');
  assert.equal(formatSaleQuantity(0.05, 'KILOGRAM'), '50 g');
  assert.equal(formatSaleQuantity(0.001, 'KILOGRAM'), '1 g');
  assert.equal(formatSaleQuantity(1.5, 'KILOGRAM'), '1.5 kg');
  assert.equal(presetLabel(0.05, 'KILOGRAM'), '50 g');
  assert.equal(presetLabel(0.1, 'KILOGRAM'), '100 g');
});

test('meter presets price correctly: 0.5 1 1.5 2 2.5 m of ₱40/m wire', () => {
  assert.deepEqual(STANDARD_PRESETS.METER, [0.5, 1, 1.5, 2, 2.5]);
  assert.deepEqual([0.5, 1, 1.5, 2, 2.5].map((m) => line(40, m)), [20, 40, 60, 80, 100]);
  assert.equal(formatSaleQuantity(2.5, 'METER'), '2.5 m');
  assert.equal(presetLabel(1.5, 'METER'), '1.5 m');
  assert.equal(pricePer('METER'), '/ m');
  assert.equal(pricePer('KILOGRAM'), '/ kg');
  assert.equal(pricePer(), '/ pc');
});

test('each product gets its own buttons, or its unit’s standard ones; whole-unit products never get fractions', () => {
  assert.deepEqual(presetsFor({ unit: 'KILOGRAM', allowsDecimal: true }), [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2]);
  assert.deepEqual(presetsFor({ unit: 'KILOGRAM', allowsDecimal: true, quantityPresets: [1, 0.25, 0.5, 0.5] }), [0.25, 0.5, 1]);
  assert.deepEqual(presetsFor({ unit: 'GRAM', allowsDecimal: false }), [50, 100, 250, 500]);
  // A kilogram product set to whole kilos only offers whole kilos.
  assert.deepEqual(presetsFor({ unit: 'KILOGRAM', allowsDecimal: false }), [1, 2]);
  // Pieces: no buttons unless the owner sets some.
  assert.deepEqual(presetsFor({ unit: 'PIECE', allowsDecimal: false }), []);
  assert.deepEqual(presetsFor({ unit: 'PIECE', allowsDecimal: false, quantityPresets: [6, 12] }), [6, 12]);
});

test('the owner’s list is read from plain text and checked against the product', () => {
  assert.deepEqual(parsePresetText('0.25, 0.5, 1'), { values: [0.25, 0.5, 1], problem: null });
  assert.deepEqual(parsePresetText('½ 1½ 1/4'), { values: [0.25, 0.5, 1.5], problem: null });
  assert.deepEqual(parsePresetText(''), { values: [], problem: null });
  assert.match(parsePresetText('half').problem ?? '', /not a quantity/);
  assert.equal(presetText([0.25, 0.5, 1]), '0.25, 0.5, 1');
  assert.equal(presetsProblem([0.25, 1], { unit: 'KILOGRAM', allowsDecimal: true }), null);
  assert.match(presetsProblem([0.5], { unit: 'PIECE', allowsDecimal: false }) ?? '', /whole/);
  assert.match(presetsProblem([0.0005], { unit: 'KILOGRAM', allowsDecimal: true }) ?? '', /decimal places/);
  assert.match(presetsProblem(Array.from({ length: MAX_PRESETS + 1 }, (_, i) => i + 1), { unit: 'PIECE', allowsDecimal: false }) ?? '', /at most/);
});

test('migrations: presets are optional per product, the GCash reference may be blank, nothing is rewritten', () => {
  const presets = readFileSync('prisma/migrations/20261119090000_product_quantity_presets/migration.sql', 'utf8');
  assert.match(presets, /ADD COLUMN "quantityPresets" DECIMAL\(18,3\)\[\] NOT NULL DEFAULT '\{\}'/);
  assert.match(presets, /cardinality\("quantityPresets"\) <= 8/);
  assert.doesNotMatch(presets, /\bUPDATE\b|\bDELETE FROM "products"/);
  const gcash = readFileSync('prisma/migrations/20261118090000_optional_gcash_reference/migration.sql', 'utf8');
  assert.match(gcash, /ALTER COLUMN "reference" DROP NOT NULL/);
  assert.match(gcash, /"reference" IS NULL OR length\(btrim\("reference"\)\) >= 6/);
  assert.doesNotMatch(gcash, /DROP INDEX|\bUPDATE\b/);
});

test('the till never sends a price, and the scanner’s Done brings the cashier to Charge without charging', () => {
  const action = readFileSync('src/features/pos/actions.ts', 'utf8');
  assert.doesNotMatch(action, /unitPrice: z\./);
  const terminal = readFileSync('src/features/pos/pos-terminal.tsx', 'utf8');
  assert.match(terminal, /onDone=\{goToCharge\}/);
  assert.match(terminal, /ref=\{chargeRef\}/);
  const goTo = terminal.slice(terminal.indexOf('const goToCharge'), terminal.indexOf('const setQuantity'));
  assert.match(goTo, /scrollIntoView/);
  assert.match(goTo, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(goTo, /openPayment|onCheckout|setTimeout/, 'no auto-charge and no guessed delays');
  const scanner = readFileSync('src/features/pos/pos-camera-scanner.tsx', 'utf8');
  assert.match(scanner, /onCloseAutoFocus/);
  assert.match(scanner, /lines\.length === 0\) return/);
});
