-- Pieces only, step A of 2.
--
-- Every product is now counted and sold by the piece. This migration:
--   1. Stops at once, changing nothing, if any stored quantity is fractional,
--      so no stock, sale or return figure is ever rounded or converted.
--   2. Makes products."unitId" optional. The new code no longer writes it, and
--      the old code still can, so the app keeps working while it deploys.
--   3. Holds every quantity column to whole numbers with CHECK constraints,
--      and sale/return lines to at least one piece.
--   4. Removes the units.* permissions (their role grants go with them by
--      ON DELETE CASCADE).
--
-- No data is converted. Units never scaled stock: every unit's factor was 1,
-- and quantities were always stored as counts of the product's own unit, so
-- each stored number already is a number of pieces.
--
-- Step B (20261019100000_drop_units) drops the column and the units table. Apply
-- it only after the code from this release is live.

-- 1. Refuse to run against fractional data -----------------------------------
DO $$
DECLARE
  fractional bigint;
BEGIN
  SELECT
      (SELECT count(*) FROM "inventory" WHERE "quantity" <> trunc("quantity") OR "reserved" <> trunc("reserved"))
    + (SELECT count(*) FROM "inventory_transactions"
         WHERE "quantity" <> trunc("quantity")
            OR "balanceBefore" <> trunc("balanceBefore")
            OR "balanceAfter" <> trunc("balanceAfter"))
    + (SELECT count(*) FROM "sale_items" WHERE "quantity" <> trunc("quantity") OR "returnedQuantity" <> trunc("returnedQuantity"))
    + (SELECT count(*) FROM "return_items" WHERE "quantity" <> trunc("quantity"))
    + (SELECT count(*) FROM "products"
         WHERE "minStock" <> trunc("minStock")
            OR "maxStock" <> trunc("maxStock")
            OR "reorderLevel" <> trunc("reorderLevel")
            OR "reorderQty" <> trunc("reorderQty"))
  INTO fractional;

  IF fractional > 0 THEN
    RAISE EXCEPTION
      'pieces_only: % row(s) hold fractional quantities. Resolve them by hand before applying this migration; nothing was changed.',
      fractional;
  END IF;
END $$;

-- 2. unitId becomes optional ---------------------------------------------------
ALTER TABLE "products" ALTER COLUMN "unitId" DROP NOT NULL;

-- 3. Whole pieces only --------------------------------------------------------
ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_quantity_whole" CHECK ("quantity" = trunc("quantity")),
  ADD CONSTRAINT "inventory_reserved_whole" CHECK ("reserved" = trunc("reserved"));

ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_quantity_whole" CHECK ("quantity" = trunc("quantity")),
  ADD CONSTRAINT "inventory_transactions_balance_before_whole" CHECK ("balanceBefore" = trunc("balanceBefore")),
  ADD CONSTRAINT "inventory_transactions_balance_after_whole" CHECK ("balanceAfter" = trunc("balanceAfter"));

ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_quantity_whole" CHECK ("quantity" = trunc("quantity") AND "quantity" >= 1),
  ADD CONSTRAINT "sale_items_returned_quantity_whole" CHECK ("returnedQuantity" = trunc("returnedQuantity"));

ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_quantity_whole" CHECK ("quantity" = trunc("quantity") AND "quantity" >= 1);

ALTER TABLE "products"
  ADD CONSTRAINT "products_min_stock_whole" CHECK ("minStock" = trunc("minStock")),
  ADD CONSTRAINT "products_max_stock_whole" CHECK ("maxStock" = trunc("maxStock")),
  ADD CONSTRAINT "products_reorder_level_whole" CHECK ("reorderLevel" = trunc("reorderLevel")),
  ADD CONSTRAINT "products_reorder_qty_whole" CHECK ("reorderQty" = trunc("reorderQty"));

-- 4. Units are no longer a permission -----------------------------------------
DELETE FROM "permissions" WHERE "resource" = 'units';
