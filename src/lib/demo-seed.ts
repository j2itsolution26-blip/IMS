import type { ProductUnit } from './quantity';

/**
 * The sample catalogue a demo store starts with, and returns to on reset.
 * Pure data, so tests can check it fits the unit rules. Never written to a
 * real store: only the demo service uses it, and only for stores whose
 * "isDemo" flag the database keeps fixed.
 */

export interface DemoProduct {
  sku: string;
  name: string;
  category: string;
  unit: ProductUnit;
  allowsDecimal: boolean;
  costPrice: number;
  sellingPrice: number;
  stock: number;
  reorderLevel: number;
}

export const DEMO_CATEGORIES = [
  'Beverages',
  'Snacks',
  'Canned Goods',
  'Rice and Grains',
  'Cooking Oil',
  'Charcoal and Fuel',
  'Hardware and Wire',
  'Personal Care',
] as const;

export const DEMO_PRODUCTS: DemoProduct[] = [
  { sku: 'DEMO-COLA-1L', name: 'Cola 1L', category: 'Beverages', unit: 'BOTTLE', allowsDecimal: false, costPrice: 48, sellingPrice: 60, stock: 24, reorderLevel: 6 },
  { sku: 'DEMO-WATER-500', name: 'Mineral Water 500ml', category: 'Beverages', unit: 'BOTTLE', allowsDecimal: false, costPrice: 12, sellingPrice: 18, stock: 48, reorderLevel: 12 },
  { sku: 'DEMO-CHIPS', name: 'Potato Chips 60g', category: 'Snacks', unit: 'PACK', allowsDecimal: false, costPrice: 22, sellingPrice: 30, stock: 30, reorderLevel: 10 },
  { sku: 'DEMO-BISCUIT', name: 'Cream Biscuits', category: 'Snacks', unit: 'PACK', allowsDecimal: false, costPrice: 8, sellingPrice: 12, stock: 4, reorderLevel: 10 },
  { sku: 'DEMO-SARDINES', name: 'Sardines 155g', category: 'Canned Goods', unit: 'PIECE', allowsDecimal: false, costPrice: 21, sellingPrice: 28, stock: 36, reorderLevel: 12 },
  { sku: 'DEMO-RICE-KG', name: 'Well-milled Rice', category: 'Rice and Grains', unit: 'KILOGRAM', allowsDecimal: true, costPrice: 45, sellingPrice: 52, stock: 50, reorderLevel: 10 },
  { sku: 'DEMO-OIL-L', name: 'Cooking Oil (per liter)', category: 'Cooking Oil', unit: 'LITER', allowsDecimal: true, costPrice: 90, sellingPrice: 110, stock: 20, reorderLevel: 5 },
  { sku: 'DEMO-CHARCOAL', name: 'Charcoal', category: 'Charcoal and Fuel', unit: 'BAG', allowsDecimal: false, costPrice: 25, sellingPrice: 35, stock: 0, reorderLevel: 5 },
  { sku: 'DEMO-WIRE-M', name: 'Electrical Wire #14', category: 'Hardware and Wire', unit: 'METER', allowsDecimal: true, costPrice: 12, sellingPrice: 18, stock: 100, reorderLevel: 20 },
  { sku: 'DEMO-SOAP', name: 'Bath Soap 90g', category: 'Personal Care', unit: 'PIECE', allowsDecimal: false, costPrice: 28, sellingPrice: 38, stock: 18, reorderLevel: 6 },
];

/** Shown wherever a demo store appears. */
export const DEMO_LABEL = 'DEMO';
