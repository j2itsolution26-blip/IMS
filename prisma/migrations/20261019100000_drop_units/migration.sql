-- Pieces only, step B of 2: drop the unused units table.
--
-- Apply only after the release containing 20261019090000 is live. That code
-- never reads or writes units, so dropping them here cannot break it. The old
-- code (before that release) does read them, which is why this is a separate
-- step instead of being part of step A.
--
-- Only the reference list goes. No product, stock, sale or receipt row is
-- touched: products lose a column that every row points at "Piece".

ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_unitId_fkey";
ALTER TABLE "products" DROP COLUMN IF EXISTS "unitId";
DROP TABLE IF EXISTS "units";
