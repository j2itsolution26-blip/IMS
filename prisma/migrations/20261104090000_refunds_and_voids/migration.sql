-- Refunds and voids keep a complete, consistent record.
--
--   1. sales: "voidedAt", "voidedById", "voidReason" — who voided a sale,
--      when and why. Sales voided before this migration are backfilled from
--      their audit-log entry ("Voided sale INV-…: reason"); the void time
--      falls back to the sale's last update when no entry exists.
--   2. A CHECK keeps those fields set exactly when a sale is VOIDED, and a
--      trigger makes a void final: a voided sale's status and void fields
--      can never change again.
--   3. returns: "clientRequestId", unique per store, so a doubled refund
--      submit refunds once.
--   4. sale_items: the returned quantity stays between 0 and the quantity
--      sold. Added NOT VALID (enforced for every new write at once) and
--      validated only if no existing row breaks it, so the migration cannot
--      fail on old data; any such row is reported by the query in step 4.
--   5. The sales tenant guard also checks "voidedById" belongs to the store.
--
-- No row is deleted. Existing refunds keep their amounts.
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS "sales_void_is_final" ON "sales";
--   DROP FUNCTION IF EXISTS "sales_void_is_final"();
--   DROP TRIGGER IF EXISTS "sales_tenant_guard" ON "sales";
--   CREATE TRIGGER "sales_tenant_guard" BEFORE INSERT OR UPDATE OF "storeId", "warehouseId", "userId", "shiftId" ON "sales"
--     FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('warehouseId', 'warehouses', 'userId', 'users', 'shiftId', 'cashier_shifts');
--   ALTER TABLE "sale_items" DROP CONSTRAINT IF EXISTS "sale_items_returned_within_sold";
--   DROP INDEX IF EXISTS "returns_storeId_clientRequestId_key";
--   ALTER TABLE "returns" DROP COLUMN IF EXISTS "clientRequestId";
--   ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_void_fields";
--   ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_voidedById_fkey";
--   ALTER TABLE "sales" DROP COLUMN IF EXISTS "voidedAt", DROP COLUMN IF EXISTS "voidedById", DROP COLUMN IF EXISTS "voidReason";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261104090000_refunds_and_voids';

-- 1. Void details --------------------------------------------------------------

ALTER TABLE "sales"
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedById" TEXT,
  ADD COLUMN "voidReason" TEXT;

ALTER TABLE "sales" ADD CONSTRAINT "sales_voidedById_fkey"
  FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill from the most recent "Voided sale" audit entry of each voided sale.
UPDATE "sales" s SET
  "voidedAt" = a."createdAt",
  "voidedById" = a."userId",
  "voidReason" = NULLIF(btrim(substring(a."summary" FROM ': (.*)$')), '')
FROM (
  SELECT DISTINCT ON ("entityId") "entityId", "createdAt", "userId", "summary"
  FROM "audit_logs"
  WHERE "entity" = 'Sale' AND "summary" LIKE 'Voided sale %'
  ORDER BY "entityId", "createdAt" DESC
) a
WHERE s."id" = a."entityId" AND s."status" = 'VOIDED';

UPDATE "sales" SET
  "voidedAt" = COALESCE("voidedAt", "updatedAt"),
  "voidReason" = COALESCE("voidReason", 'Voided before void details were recorded')
WHERE "status" = 'VOIDED' AND ("voidedAt" IS NULL OR "voidReason" IS NULL);

-- 2. Void fields set exactly when voided; a void is final ----------------------

ALTER TABLE "sales" ADD CONSTRAINT "sales_void_fields" CHECK (
  ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL)
  OR ("status" <> 'VOIDED' AND "voidedAt" IS NULL AND "voidedById" IS NULL AND "voidReason" IS NULL)
);

CREATE OR REPLACE FUNCTION "sales_void_is_final"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'VOIDED' AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt"
    OR NEW."voidedById" IS DISTINCT FROM OLD."voidedById"
    OR NEW."voidReason" IS DISTINCT FROM OLD."voidReason"
  ) THEN
    RAISE EXCEPTION 'A voided sale cannot be changed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_void_is_final"
  BEFORE UPDATE OF "status", "voidedAt", "voidedById", "voidReason" ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "sales_void_is_final"();

-- 3. Refund request ids -------------------------------------------------------

ALTER TABLE "returns" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "returns_storeId_clientRequestId_key" ON "returns"("storeId", "clientRequestId");

-- 4. Returned quantity within what was sold -----------------------------------
--    Rows that would break it (expected: none):
--    SELECT id, quantity, "returnedQuantity" FROM sale_items
--      WHERE "returnedQuantity" < 0 OR "returnedQuantity" > quantity;

ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_returned_within_sold"
  CHECK ("returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity") NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "sale_items" WHERE "returnedQuantity" < 0 OR "returnedQuantity" > "quantity"
  ) THEN
    ALTER TABLE "sale_items" VALIDATE CONSTRAINT "sale_items_returned_within_sold";
  END IF;
END $$;

-- 5. Tenant guard covers the voiding user ----------------------------------------

DROP TRIGGER IF EXISTS "sales_tenant_guard" ON "sales";
CREATE TRIGGER "sales_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "warehouseId", "userId", "shiftId", "voidedById" ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('warehouseId', 'warehouses', 'userId', 'users', 'shiftId', 'cashier_shifts', 'voidedById', 'users');
