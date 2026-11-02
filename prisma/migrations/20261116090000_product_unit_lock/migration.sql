-- A product's unit is fixed once it has moved.
--
-- Stock, sale lines and return lines are numbers of the product's own unit,
-- and receipts read the unit from the product. Changing KILOGRAM to PIECE
-- on a product with stock or sales would turn 50 kg into "50 pcs" and
-- reprint past receipts in the wrong unit. The existing guard from
-- migration 20261106090000 ("products_unit_change_guard") now also refuses
-- a unit change once the product has any stock, stock movement, sale or
-- return. A product with none of these can still change its unit freely.
--
-- No row is changed.
--
-- Rollback: re-run section 2c of 20261106090000_product_units (it restores
-- the function and the trigger on "allowsDecimal" only), then
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261116090000_product_unit_lock';

CREATE OR REPLACE FUNCTION "products_unit_change_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."allowsDecimal" AND NOT NEW."allowsDecimal" AND (
    EXISTS (SELECT 1 FROM "inventory_transactions" WHERE "productId" = NEW."id" AND "quantity" <> trunc("quantity"))
    OR EXISTS (SELECT 1 FROM "inventory" WHERE "productId" = NEW."id" AND ("quantity" <> trunc("quantity") OR "reserved" <> trunc("reserved")))
  ) THEN
    RAISE EXCEPTION 'UNIT_PRECISION: this product has moved in fractions, so it must keep allowing decimals'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."unit" IS DISTINCT FROM OLD."unit" AND (
    EXISTS (SELECT 1 FROM "inventory_transactions" WHERE "productId" = NEW."id")
    OR EXISTS (SELECT 1 FROM "inventory" WHERE "productId" = NEW."id" AND ("quantity" <> 0 OR "reserved" <> 0))
    OR EXISTS (SELECT 1 FROM "sale_items" WHERE "productId" = NEW."id")
    OR EXISTS (SELECT 1 FROM "return_items" WHERE "productId" = NEW."id")
  ) THEN
    RAISE EXCEPTION 'UNIT_PRECISION: this product has stock or sales, so its unit cannot change'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "products_unit_change_guard" ON "products";
CREATE TRIGGER "products_unit_change_guard"
  BEFORE UPDATE OF "allowsDecimal", "unit" ON "products"
  FOR EACH ROW EXECUTE FUNCTION "products_unit_change_guard"();
