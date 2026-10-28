-- Product units and decimal quantities.
--
--   1. products gets "unit" (PIECE, KILOGRAM, METER, …) and "allowsDecimal".
--      Every existing product becomes PIECE with allowsDecimal = false, so it
--      behaves exactly as before: whole pieces only. Nothing is converted —
--      stock was always a count of the product's own unit.
--   2. The whole-number CHECKs from migration 20261019090000 are replaced by
--      a per-product rule:
--        * a trigger on inventory, inventory_transactions, sale_items and
--          return_items refuses a fractional quantity for a product that
--          does not allow decimals;
--        * a CHECK keeps a whole-unit product's stock thresholds whole;
--        * a trigger on products refuses switching a product back to whole
--          units once it has moved in fractions (so its past fractional
--          sales stay refundable and restockable).
--      Sale and return lines must still be above zero.
--   3. Quantities keep their Decimal(18,3) columns: at most 3 decimals.
--
-- No row is changed except the two new product columns taking their defaults.
--
-- Rollback (only while every quantity is still whole), in this order:
--   DROP TRIGGER IF EXISTS "products_unit_change_guard" ON "products";
--   DROP TRIGGER IF EXISTS "inventory_unit_precision" ON "inventory";
--   DROP TRIGGER IF EXISTS "inventory_transactions_unit_precision" ON "inventory_transactions";
--   DROP TRIGGER IF EXISTS "sale_items_unit_precision" ON "sale_items";
--   DROP TRIGGER IF EXISTS "return_items_unit_precision" ON "return_items";
--   DROP FUNCTION IF EXISTS "products_unit_change_guard"();
--   DROP FUNCTION IF EXISTS "enforce_unit_precision"();
--   ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_thresholds_follow_unit";
--   ALTER TABLE "sale_items" DROP CONSTRAINT IF EXISTS "sale_items_quantity_positive";
--   ALTER TABLE "return_items" DROP CONSTRAINT IF EXISTS "return_items_quantity_positive";
--   then re-add the *_whole CHECKs from migration 20261019090000,
--   ALTER TABLE "products" DROP COLUMN "unit", DROP COLUMN "allowsDecimal"; DROP TYPE "ProductUnit";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261106090000_product_units';

-- 1. Unit columns ------------------------------------------------------------------

CREATE TYPE "ProductUnit" AS ENUM (
  'PIECE', 'PACK', 'BOX', 'BOTTLE', 'SACK', 'BAG', 'KILOGRAM', 'GRAM', 'LITER', 'MILLILITER', 'METER'
);

ALTER TABLE "products"
  ADD COLUMN "unit" "ProductUnit" NOT NULL DEFAULT 'PIECE',
  ADD COLUMN "allowsDecimal" BOOLEAN NOT NULL DEFAULT false;

-- 2a. Per-product precision on every quantity column --------------------------------

CREATE OR REPLACE FUNCTION "enforce_unit_precision"() RETURNS trigger AS $$
DECLARE
  decimals_ok boolean;
  col text;
  val numeric;
BEGIN
  SELECT "allowsDecimal" INTO decimals_ok FROM "products" WHERE "id" = NEW."productId";
  -- A missing product is left to the foreign key; a decimal product needs no check.
  IF decimals_ok IS NULL OR decimals_ok THEN
    RETURN NEW;
  END IF;
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I::numeric', col) INTO val USING NEW;
    IF val IS NOT NULL AND val <> trunc(val) THEN
      RAISE EXCEPTION 'UNIT_PRECISION: %.% must be a whole number for this product', TG_TABLE_NAME, col
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "inventory"
  DROP CONSTRAINT IF EXISTS "inventory_quantity_whole",
  DROP CONSTRAINT IF EXISTS "inventory_reserved_whole";
CREATE TRIGGER "inventory_unit_precision"
  BEFORE INSERT OR UPDATE OF "quantity", "reserved", "productId" ON "inventory"
  FOR EACH ROW EXECUTE FUNCTION "enforce_unit_precision"('quantity', 'reserved');

ALTER TABLE "inventory_transactions"
  DROP CONSTRAINT IF EXISTS "inventory_transactions_quantity_whole",
  DROP CONSTRAINT IF EXISTS "inventory_transactions_balance_before_whole",
  DROP CONSTRAINT IF EXISTS "inventory_transactions_balance_after_whole";
CREATE TRIGGER "inventory_transactions_unit_precision"
  BEFORE INSERT ON "inventory_transactions"
  FOR EACH ROW EXECUTE FUNCTION "enforce_unit_precision"('quantity', 'balanceBefore', 'balanceAfter');

ALTER TABLE "sale_items"
  DROP CONSTRAINT IF EXISTS "sale_items_quantity_whole",
  DROP CONSTRAINT IF EXISTS "sale_items_returned_quantity_whole";
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_quantity_positive" CHECK ("quantity" > 0);
CREATE TRIGGER "sale_items_unit_precision"
  BEFORE INSERT OR UPDATE OF "quantity", "returnedQuantity", "productId" ON "sale_items"
  FOR EACH ROW EXECUTE FUNCTION "enforce_unit_precision"('quantity', 'returnedQuantity');

ALTER TABLE "return_items" DROP CONSTRAINT IF EXISTS "return_items_quantity_whole";
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_quantity_positive" CHECK ("quantity" > 0);
CREATE TRIGGER "return_items_unit_precision"
  BEFORE INSERT OR UPDATE OF "quantity", "productId" ON "return_items"
  FOR EACH ROW EXECUTE FUNCTION "enforce_unit_precision"('quantity');

-- 2b. Thresholds follow the product's unit ------------------------------------------

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_min_stock_whole",
  DROP CONSTRAINT IF EXISTS "products_max_stock_whole",
  DROP CONSTRAINT IF EXISTS "products_reorder_level_whole",
  DROP CONSTRAINT IF EXISTS "products_reorder_qty_whole";
ALTER TABLE "products" ADD CONSTRAINT "products_thresholds_follow_unit" CHECK (
  "allowsDecimal" OR (
    "minStock" = trunc("minStock") AND "maxStock" = trunc("maxStock")
    AND "reorderLevel" = trunc("reorderLevel") AND "reorderQty" = trunc("reorderQty")
  )
);

-- 2c. No switch to whole units while stock has a fraction ---------------------------

-- Every stock change is in the ledger, so a fraction there means stock, a sale
-- or a refund of this product was fractional. Such a product stays a decimal
-- product: its past fractional sales must remain refundable and restockable.
CREATE OR REPLACE FUNCTION "products_unit_change_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."allowsDecimal" AND NOT NEW."allowsDecimal" AND (
    EXISTS (SELECT 1 FROM "inventory_transactions" WHERE "productId" = NEW."id" AND "quantity" <> trunc("quantity"))
    OR EXISTS (SELECT 1 FROM "inventory" WHERE "productId" = NEW."id" AND ("quantity" <> trunc("quantity") OR "reserved" <> trunc("reserved")))
  ) THEN
    RAISE EXCEPTION 'UNIT_PRECISION: this product has moved in fractions, so it must keep allowing decimals'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "products_unit_change_guard"
  BEFORE UPDATE OF "allowsDecimal" ON "products"
  FOR EACH ROW EXECUTE FUNCTION "products_unit_change_guard"();
