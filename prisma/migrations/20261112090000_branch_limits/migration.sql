-- Branch (location) limits.
--
--   1. Adds "branchLimit" to stores: the most ACTIVE locations (warehouses)
--      the plan allows (Basic 1, Business 3, Enterprise 5), copied from
--      src/lib/plans.ts like the other quotas. Empty = no cap.
--   2. A trigger on warehouses refuses a branch that would start counting
--      (created active, or reactivated, or moved into the store) once the
--      store already has "branchLimit" active branches
--      ("PLAN_LIMIT: branches 3"). It locks the store's row first, so two
--      requests at once take turns and cannot both pass the count.
--      Archived (inactive) branches never count; editing a name or address
--      never counts, so a store over a lowered limit keeps every branch.
--   3. The default branch (the store's first location) can never be archived
--      or stop being the default, so a store always has a working location.
--   4. A branch with history (stock movements or sales) can never be deleted,
--      since deleting it would cascade away its stock ledger. Archive it.
--   5. The branches.view and branches.manage permissions, granted to every
--      store's Owner role.
--
-- Nothing is deleted or switched off: every existing store has exactly one
-- branch, within every plan's limit.
--
-- Rollback (in this order):
--   DROP TRIGGER IF EXISTS "warehouses_branch_quota" ON "warehouses";
--   DROP TRIGGER IF EXISTS "warehouses_keep_default" ON "warehouses";
--   DROP TRIGGER IF EXISTS "warehouses_keep_history" ON "warehouses";
--   DROP FUNCTION IF EXISTS "enforce_branch_quota"();
--   DROP FUNCTION IF EXISTS "warehouses_keep_default"();
--   DROP FUNCTION IF EXISTS "warehouses_keep_history"();
--   DELETE FROM "role_permissions" WHERE "permissionId" IN ('perm_branches_view', 'perm_branches_manage');
--   DELETE FROM "permissions" WHERE "id" IN ('perm_branches_view', 'perm_branches_manage');
--   ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_branch_limit_positive";
--   ALTER TABLE "stores" DROP COLUMN IF EXISTS "branchLimit";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261112090000_branch_limits';

ALTER TABLE "stores" ADD COLUMN "branchLimit" INTEGER;

ALTER TABLE "stores" ADD CONSTRAINT "stores_branch_limit_positive"
  CHECK ("branchLimit" IS NULL OR "branchLimit" >= 1);

-- Backfill. Must match PLANS[*].limits.branches in src/lib/plans.ts (tests/plans.test.ts checks).
UPDATE "stores" SET
  "branchLimit" = CASE
    WHEN "plan" = 'BASIC' THEN 1
    WHEN "plan" = 'BUSINESS' THEN 3
    ELSE 5 END;
-- End backfill.

CREATE OR REPLACE FUNCTION "enforce_branch_quota"() RETURNS trigger AS $$
DECLARE
  quota integer;
  used integer;
BEGIN
  IF NOT NEW."isActive" THEN RETURN NEW; END IF;
  -- An active branch that stays active in the same store keeps its place.
  IF TG_OP = 'UPDATE' AND OLD."isActive" AND OLD."storeId" = NEW."storeId" THEN RETURN NEW; END IF;

  SELECT "branchLimit" INTO quota FROM "stores" WHERE "id" = NEW."storeId" FOR UPDATE;
  IF quota IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO used FROM "warehouses"
    WHERE "storeId" = NEW."storeId" AND "isActive" AND "id" <> NEW."id";
  IF used >= quota THEN
    RAISE EXCEPTION 'PLAN_LIMIT: branches %', quota USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "warehouses_branch_quota" ON "warehouses";
CREATE TRIGGER "warehouses_branch_quota"
  BEFORE INSERT OR UPDATE OF "isActive", "storeId" ON "warehouses"
  FOR EACH ROW EXECUTE FUNCTION "enforce_branch_quota"();

CREATE OR REPLACE FUNCTION "warehouses_keep_default"() RETURNS trigger AS $$
BEGIN
  IF OLD."isDefault" AND (NOT NEW."isDefault" OR NOT NEW."isActive") THEN
    RAISE EXCEPTION 'BRANCH_RULE: the main branch cannot be archived' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."isDefault" AND NOT OLD."isDefault" THEN
    RAISE EXCEPTION 'BRANCH_RULE: a store has one main branch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "warehouses_keep_default" ON "warehouses";
CREATE TRIGGER "warehouses_keep_default"
  BEFORE UPDATE OF "isDefault", "isActive" ON "warehouses"
  FOR EACH ROW EXECUTE FUNCTION "warehouses_keep_default"();

CREATE OR REPLACE FUNCTION "warehouses_keep_history"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inventory_transactions" WHERE "warehouseId" = OLD."id")
     OR EXISTS (SELECT 1 FROM "sales" WHERE "warehouseId" = OLD."id") THEN
    RAISE EXCEPTION 'BRANCH_RULE: a branch with sales or stock history cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "warehouses_keep_history" ON "warehouses";
CREATE TRIGGER "warehouses_keep_history"
  BEFORE DELETE ON "warehouses"
  FOR EACH ROW EXECUTE FUNCTION "warehouses_keep_history"();

-- At most one main branch per store.
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_one_default_per_store"
  ON "warehouses" ("storeId") WHERE "isDefault";

-- branches.view and branches.manage. Owners hold every store permission
-- ('ALL' in src/lib/permissions.ts), so every store's Owner role gets them;
-- no other role does until an owner grants branches.view. Managing branches
-- also requires the store's owner account (checked in the server action).
INSERT INTO "permissions" ("id", "key", "resource", "action", "description")
VALUES
  ('perm_branches_view', 'branches.view', 'branches', 'view', 'View — Store locations (branches)'),
  ('perm_branches_manage', 'branches.manage', 'branches', 'manage', 'Manage — Store locations (branches)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('branches.view', 'branches.manage')
WHERE r."slug" = 'owner' AND r."storeId" IS NOT NULL
ON CONFLICT DO NOTHING;
