/**
 * Suggested categories for a sari-sari or general merchandise store. Never
 * seeded automatically: the owner adds them from Categories in one step, and
 * any whose name the store already has (ignoring case and spacing, and a few
 * common spellings) is skipped, so nothing is duplicated. Pure, so the
 * matching is unit-tested.
 */

export interface CategoryTemplate {
  name: string;
  description: string;
  /** Other names an owner may already use for the same group. */
  aliases?: string[];
}

export const CATEGORY_TEMPLATES: CategoryTemplate[] = [
  { name: 'General Merchandise', description: 'Everyday household items.', aliases: ['General', 'Household'] },
  { name: 'Over-the-Counter Medicines', description: 'Non-prescription medicines.', aliases: ['OTC Medicines', 'Medicines', 'Gamot'] },
  { name: 'Stationery', description: 'Paper, pens and school supplies.', aliases: ['School Supplies'] },
  { name: 'Cigarettes and Tobacco', description: 'Sold to adults only.', aliases: ['Cigarettes', 'Tobacco', 'Sigarilyo'] },
  { name: 'Rice and Grains', description: 'Usually sold per kilogram.', aliases: ['Rice', 'Bigas', 'Grains'] },
  { name: 'Animal Feeds', description: 'Sold per kilogram or per sack.', aliases: ['Feeds', 'Pet Food'] },
  { name: 'Charcoal and Fuel', description: 'Charcoal by the bag or sack, kerosene and LPG.', aliases: ['Charcoal', 'Uling', 'Fuel'] },
  { name: 'Cooking Oil', description: 'Bottled or sold by volume.', aliases: ['Oil', 'Mantika'] },
  { name: 'Beverages', description: 'Soft drinks, juices and water.', aliases: ['Drinks', 'Softdrinks'] },
  { name: 'Snacks', description: 'Chips, biscuits and sweets.', aliases: ['Chichirya', 'Junk Food'] },
  { name: 'Canned Goods', description: 'Sardines, corned beef and other canned food.', aliases: ['Canned'] },
  { name: 'Condiments', description: 'Soy sauce, vinegar, salt and seasonings.', aliases: ['Seasonings', 'Sauces'] },
  { name: 'Personal Care', description: 'Soap, shampoo and toiletries.', aliases: ['Toiletries'] },
  { name: 'Hardware and Wire', description: 'Wire, rope and fittings, often sold by the meter.', aliases: ['Hardware'] },
];

/** "  Rice &  Grains " and "rice and grains" are the same name. */
export function normalizeCategoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The templates the store does not have yet, by name or alias. */
export function missingTemplates(existingNames: string[], templates: CategoryTemplate[] = CATEGORY_TEMPLATES): CategoryTemplate[] {
  const existing = new Set(existingNames.map(normalizeCategoryName));
  return templates.filter(
    (template) => ![template.name, ...(template.aliases ?? [])].some((name) => existing.has(normalizeCategoryName(name))),
  );
}
