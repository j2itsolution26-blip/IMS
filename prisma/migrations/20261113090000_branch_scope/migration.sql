-- Branch scope for shifts and staff.
--
--   1. users."warehouseId": the branch a staff account works at. Null for the
--      owner (every branch) and for platform accounts. Existing staff are
--      assigned to their store's main branch.
--   2. cashier_shifts."warehouseId": the branch a drawer belongs to. Existing
--      shifts are filed under their store's main branch — the only location
--      any store had — then the column becomes required and can never change.
--      Cash movements, GCash services, shift adjustments, payments and refunds
--      already belong to a shift or a sale, so their branch is the shift's or
--      the sale's; they need no column of their own.
--   3. Rules, so a bug cannot break them:
--        * a branch reference must be of the same store (tenant_guard);
--        * a shift opens only at an active branch, and a staff member with a
--          branch only at that branch;
--        * a sale on a shift is filed under the shift's branch, at an active
--          branch;
--        * a staff account can only be assigned to an active branch;
--        * a branch with an open shift or active staff cannot be archived.
--
-- Nothing is deleted. No sale, stock or closed-shift figure changes: only the
-- new branch columns are filled in.
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS "warehouses_archive_guard" ON "warehouses";
--   DROP TRIGGER IF EXISTS "users_branch_guard" ON "users";
--   DROP TRIGGER IF EXISTS "sales_branch_guard" ON "sales";
--   DROP TRIGGER IF EXISTS "cashier_shifts_branch_guard" ON "cashier_shifts";
--   DROP FUNCTION IF EXISTS "warehouses_archive_guard"(), "users_branch_guard"(),
--     "sales_branch_guard"(), "cashier_shifts_branch_guard"();
--   re-create "users_tenant_guard" and "cashier_shifts_tenant_guard" as in
--   migration 20261023090000;
--   ALTER TABLE "cashier_shifts" DROP COLUMN "warehouseId";
--   ALTER TABLE "users" DROP COLUMN "warehouseId";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261113090000_branch_scope';

-- 0. Every store has a main branch ------------------------------------------
-- Stores are always created with one ("MAIN"); this only covers a store
-- that somehow has no location at all, so nothing below is left without one.

INSERT INTO "warehouses" ("id", "storeId", "code", "name", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT 'wh_' || md5(s."id" || clock_timestamp()::text), s."id", 'MAIN', 'Main Store', true, true, now(), now()
FROM "stores" s
WHERE NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."storeId" = s."id");

-- 1. Staff branch ------------------------------------------------------------

ALTER TABLE "users" ADD COLUMN "warehouseId" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "users_warehouseId_idx" ON "users"("warehouseId");

UPDATE "users" u SET "warehouseId" = w."id"
FROM "warehouses" w, "stores" s, "roles" r
WHERE w."storeId" = u."storeId" AND w."isDefault"
  AND s."id" = u."storeId"
  AND r."id" = u."roleId"
  AND u."id" IS DISTINCT FROM s."ownerId"
  AND r."slug" <> 'owner';

-- 2. Shift branch ------------------------------------------------------------

ALTER TABLE "cashier_shifts" ADD COLUMN "warehouseId" TEXT;

UPDATE "cashier_shifts" c SET "warehouseId" = w."id"
FROM "warehouses" w
WHERE w."storeId" = c."storeId" AND w."isDefault";

-- A store without a main branch (none should exist) uses its oldest one.
UPDATE "cashier_shifts" c SET "warehouseId" = (
  SELECT w."id" FROM "warehouses" w WHERE w."storeId" = c."storeId" ORDER BY w."createdAt" LIMIT 1
)
WHERE c."warehouseId" IS NULL;

ALTER TABLE "cashier_shifts" ALTER COLUMN "warehouseId" SET NOT NULL;
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "cashier_shifts_warehouseId_status_idx" ON "cashier_shifts"("warehouseId", "status");
CREATE INDEX "sales_warehouseId_createdAt_idx" ON "sales"("warehouseId", "createdAt");

-- 3. Store isolation for the new columns -------------------------------------

DROP TRIGGER IF EXISTS "users_tenant_guard" ON "users";
CREATE TRIGGER "users_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "roleId", "warehouseId" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('roleId', 'roles', 'warehouseId', 'warehouses');

DROP TRIGGER IF EXISTS "cashier_shifts_tenant_guard" ON "cashier_shifts";
CREATE TRIGGER "cashier_shifts_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "userId", "closedById", "reviewedById", "warehouseId" ON "cashier_shifts"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('userId', 'users', 'closedById', 'users', 'reviewedById', 'users', 'warehouseId', 'warehouses');

-- 4. Branch rules ------------------------------------------------------------

CREATE OR REPLACE FUNCTION "cashier_shifts_branch_guard"() RETURNS trigger AS $$
DECLARE
  active boolean;
  assigned text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."warehouseId" IS DISTINCT FROM OLD."warehouseId" THEN
      RAISE EXCEPTION 'BRANCH_RULE: a shift stays at the branch where it was opened' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "isActive" INTO active FROM "warehouses" WHERE "id" = NEW."warehouseId";
  IF NOT COALESCE(active, false) THEN
    RAISE EXCEPTION 'BRANCH_RULE: this branch is archived, so no shift can be opened there' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "warehouseId" INTO assigned FROM "users" WHERE "id" = NEW."userId";
  IF assigned IS NOT NULL AND assigned <> NEW."warehouseId" THEN
    RAISE EXCEPTION 'BRANCH_RULE: this account works at another branch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cashier_shifts_branch_guard"
  BEFORE INSERT OR UPDATE OF "warehouseId" ON "cashier_shifts"
  FOR EACH ROW EXECUTE FUNCTION "cashier_shifts_branch_guard"();

CREATE OR REPLACE FUNCTION "sales_branch_guard"() RETURNS trigger AS $$
DECLARE
  shift_branch text;
  active boolean;
BEGIN
  IF NEW."shiftId" IS NOT NULL THEN
    SELECT "warehouseId" INTO shift_branch FROM "cashier_shifts" WHERE "id" = NEW."shiftId";
    IF FOUND AND shift_branch <> NEW."warehouseId" THEN
      RAISE EXCEPTION 'BRANCH_RULE: a sale belongs to its shift''s branch' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "isActive" INTO active FROM "warehouses" WHERE "id" = NEW."warehouseId";
    IF NOT COALESCE(active, false) THEN
      RAISE EXCEPTION 'BRANCH_RULE: this branch is archived, so it cannot take new sales' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sales_branch_guard"
  BEFORE INSERT OR UPDATE OF "warehouseId", "shiftId" ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "sales_branch_guard"();

CREATE OR REPLACE FUNCTION "users_branch_guard"() RETURNS trigger AS $$
DECLARE
  active boolean;
BEGIN
  IF NEW."warehouseId" IS NULL OR NOT NEW."isActive" THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW."warehouseId" = OLD."warehouseId" AND OLD."isActive" THEN RETURN NEW; END IF;
  SELECT "isActive" INTO active FROM "warehouses" WHERE "id" = NEW."warehouseId";
  IF NOT COALESCE(active, false) THEN
    RAISE EXCEPTION 'BRANCH_RULE: staff can only be assigned to an active branch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_branch_guard"
  BEFORE INSERT OR UPDATE OF "warehouseId", "isActive" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "users_branch_guard"();

CREATE OR REPLACE FUNCTION "warehouses_archive_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."isActive" AND NOT NEW."isActive" THEN
    IF EXISTS (SELECT 1 FROM "cashier_shifts" WHERE "warehouseId" = OLD."id" AND "status" = 'OPEN') THEN
      RAISE EXCEPTION 'BRANCH_RULE: close the open shifts at this branch before archiving it' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "users" WHERE "warehouseId" = OLD."id" AND "isActive") THEN
      RAISE EXCEPTION 'BRANCH_RULE: move or deactivate the staff at this branch before archiving it' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "warehouses_archive_guard"
  BEFORE UPDATE OF "isActive" ON "warehouses"
  FOR EACH ROW EXECUTE FUNCTION "warehouses_archive_guard"();
