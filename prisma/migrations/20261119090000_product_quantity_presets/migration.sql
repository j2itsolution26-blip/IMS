-- Quick quantity buttons per product.
--
-- A product sold in fractions (rice by the kilo, wire by the meter) shows
-- the cashier one-tap quantities. "quantityPresets" holds the owner's own
-- list in the product's unit (e.g. {0.25,0.5,1} kg); empty means the unit's
-- standard buttons (src/lib/quantity-presets.ts). Up to 8 values, each above
-- zero, 3 decimals like every quantity column. Whether a fraction suits the
-- product is checked by the server against "allowsDecimal".
--
-- Existing products get an empty list: their standard buttons. No other row
-- changes.
--
-- Rollback:
--   ALTER TABLE "products" DROP COLUMN "quantityPresets";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261119090000_product_quantity_presets';

ALTER TABLE "products" ADD COLUMN "quantityPresets" DECIMAL(18,3)[] NOT NULL DEFAULT '{}';
ALTER TABLE "products" ADD CONSTRAINT "products_quantity_presets_valid"
  CHECK (cardinality("quantityPresets") <= 8 AND 0 < ALL ("quantityPresets") AND array_position("quantityPresets", NULL) IS NULL);
