-- Multi-store foundation.
--
-- Turns the single-store schema into a multi-store one without losing or
-- rewriting any record:
--
--   1. Creates `stores` and one default store ("store_default") that every
--      existing row is moved into. It is named after the current
--      `company.name` setting, owned by the existing owner, and starts on the
--      ENTERPRISE plan as ACTIVE so no feature is lost once plans exist.
--   2. Adds `storeId` to every store-owned table. NOT NULL columns are added
--      with a constant DEFAULT, which fills existing rows without an UPDATE
--      (so the append-only and closed-shift triggers never fire), and the
--      default is dropped straight after: from then on the application must
--      say which store a row belongs to, and a row it forgets is rejected.
--   3. Replaces platform-wide unique keys (SKU, barcode, invoice number,
--      setting key, ...) with per-store ones.
--   4. Adds "tenant_guard" triggers so a row can never reference a row of
--      another store, and can never move to another store.
--
-- Platform rows stay outside any store: the System Administrator role, its
-- users, and audit entries they wrote keep a NULL storeId.
--
-- Deploy note: the application released with this migration sets storeId on
-- every insert. Code from before it does not, so run this migration and
-- deploy the new code together, outside opening hours.

-- 1. Stores ----------------------------------------------------------------

-- CreateEnum
CREATE TYPE "StorePlan" AS ENUM ('BASIC', 'BUSINESS', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerId" TEXT,
    "plan" "StorePlan" NOT NULL DEFAULT 'BASIC',
    "status" "StoreStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

INSERT INTO "stores" ("id", "name", "slug", "plan", "status", "createdAt", "updatedAt")
VALUES (
  'store_default',
  COALESCE(
    (SELECT NULLIF(btrim("value"), '') FROM "settings" WHERE "key" = 'company.name'),
    'My Store'
  ),
  'main',
  'ENTERPRISE',
  'ACTIVE',
  now(),
  now()
);

-- 2. storeId columns --------------------------------------------------------

-- Platform-wide unique keys become per-store keys (recreated in step 3).

-- DropIndex
DROP INDEX "roles_name_key";

-- DropIndex
DROP INDEX "roles_slug_key";

-- DropIndex
DROP INDEX "categories_name_key";

-- DropIndex
DROP INDEX "categories_slug_key";

-- DropIndex
DROP INDEX "products_sku_key";

-- DropIndex
DROP INDEX "products_barcode_key";

-- DropIndex
DROP INDEX "warehouses_code_key";

-- DropIndex
DROP INDEX "notifications_dedupeKey_key";

-- DropIndex
DROP INDEX "sales_invoiceNumber_key";

-- DropIndex
DROP INDEX "payments_paymentNumber_key";

-- DropIndex
DROP INDEX "returns_returnNumber_key";

-- DropIndex
DROP INDEX "settings_key_key";

ALTER TABLE "categories" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "categories" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "products" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "products" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "price_history" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "price_history" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "warehouses" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "warehouses" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "inventory" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "inventory" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "inventory_transactions" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "inventory_transactions" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "cashier_shifts" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "cashier_shifts" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "shift_adjustments" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "shift_adjustments" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "notifications" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "notifications" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "cash_movements" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "cash_movements" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "sales" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "sales" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "sale_items" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "sale_items" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "payments" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "payments" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "returns" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "returns" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "return_items" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "return_items" ALTER COLUMN "storeId" DROP DEFAULT;

ALTER TABLE "settings" ADD COLUMN "storeId" TEXT NOT NULL DEFAULT 'store_default';
ALTER TABLE "settings" ALTER COLUMN "storeId" DROP DEFAULT;

-- Users, roles and audit entries: everything except the platform's own.
ALTER TABLE "roles" ADD COLUMN "storeId" TEXT;
UPDATE "roles" SET "storeId" = 'store_default' WHERE "slug" <> 'system-admin';

ALTER TABLE "users" ADD COLUMN "storeId" TEXT;
UPDATE "users" u SET "storeId" = r."storeId" FROM "roles" r WHERE r."id" = u."roleId";

-- The audit trail's own guard allows this: storeId is not one of the columns
-- it freezes, and no existing entry's content changes.
ALTER TABLE "audit_logs" ADD COLUMN "storeId" TEXT;
UPDATE "audit_logs" a SET "storeId" = 'store_default'
WHERE a."userId" IS NULL
   OR EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."userId" AND u."storeId" IS NOT NULL);

-- The existing owner owns the default store.
UPDATE "stores" SET "ownerId" = (
  SELECT u."id" FROM "users" u JOIN "roles" r ON r."id" = u."roleId"
  WHERE r."slug" = 'owner' AND u."storeId" = 'store_default'
  ORDER BY u."createdAt", u."id" LIMIT 1
)
WHERE "id" = 'store_default';

-- 3. Keys and indexes -------------------------------------------------------

-- CreateIndex
CREATE UNIQUE INDEX "stores_slug_key" ON "stores"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "stores_ownerId_key" ON "stores"("ownerId");

-- CreateIndex
CREATE INDEX "stores_status_idx" ON "stores"("status");

-- CreateIndex
CREATE INDEX "users_storeId_idx" ON "users"("storeId");

-- CreateIndex
CREATE INDEX "roles_storeId_idx" ON "roles"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_storeId_slug_key" ON "roles"("storeId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "roles_storeId_name_key" ON "roles"("storeId", "name");

-- CreateIndex
CREATE INDEX "categories_storeId_idx" ON "categories"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_storeId_name_key" ON "categories"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_storeId_slug_key" ON "categories"("storeId", "slug");

-- CreateIndex
CREATE INDEX "products_storeId_idx" ON "products"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "products_storeId_sku_key" ON "products"("storeId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_storeId_barcode_key" ON "products"("storeId", "barcode");

-- CreateIndex
CREATE INDEX "price_history_storeId_idx" ON "price_history"("storeId");

-- CreateIndex
CREATE INDEX "warehouses_storeId_idx" ON "warehouses"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_storeId_code_key" ON "warehouses"("storeId", "code");

-- CreateIndex
CREATE INDEX "inventory_storeId_idx" ON "inventory"("storeId");

-- CreateIndex
CREATE INDEX "inventory_transactions_storeId_createdAt_idx" ON "inventory_transactions"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "cashier_shifts_storeId_status_idx" ON "cashier_shifts"("storeId", "status");

-- CreateIndex
CREATE INDEX "shift_adjustments_storeId_idx" ON "shift_adjustments"("storeId");

-- CreateIndex
CREATE INDEX "notifications_storeId_createdAt_idx" ON "notifications"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_storeId_dedupeKey_key" ON "notifications"("storeId", "dedupeKey");

-- CreateIndex
CREATE INDEX "cash_movements_storeId_idx" ON "cash_movements"("storeId");

-- CreateIndex
CREATE INDEX "sales_storeId_createdAt_idx" ON "sales"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sales_storeId_invoiceNumber_key" ON "sales"("storeId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "sale_items_storeId_idx" ON "sale_items"("storeId");

-- CreateIndex
CREATE INDEX "payments_storeId_createdAt_idx" ON "payments"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_storeId_paymentNumber_key" ON "payments"("storeId", "paymentNumber");

-- CreateIndex
CREATE INDEX "returns_storeId_createdAt_idx" ON "returns"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "returns_storeId_returnNumber_key" ON "returns"("storeId", "returnNumber");

-- CreateIndex
CREATE INDEX "return_items_storeId_idx" ON "return_items"("storeId");

-- CreateIndex
CREATE INDEX "audit_logs_storeId_createdAt_idx" ON "audit_logs"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "settings_storeId_idx" ON "settings"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "settings_storeId_key_key" ON "settings"("storeId", "key");

-- The System Administrator role has no store. NULLs never collide in a
-- unique index, so the global role gets its own.
CREATE UNIQUE INDEX "roles_global_slug_key" ON "roles"("slug") WHERE "storeId" IS NULL;
CREATE UNIQUE INDEX "roles_global_name_key" ON "roles"("name") WHERE "storeId" IS NULL;

-- Only the System Administrator role lives outside a store. Together with the
-- users guard below (a user's store must match their role's), this means the
-- only accounts without a store are system administrators.
ALTER TABLE "roles" ADD CONSTRAINT "roles_store_or_platform"
  CHECK ("storeId" IS NOT NULL OR "slug" = 'system-admin');

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_adjustments" ADD CONSTRAINT "shift_adjustments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Store isolation guards -------------------------------------------------

-- Refuses any row that points at a row of another store, and any change of a
-- row's store. Arguments are (column, referenced table) pairs. A reference
-- to a row that does not exist is left to the foreign key to report.
-- A NULL store matches a NULL store, so platform users keep the platform role.
CREATE FUNCTION "tenant_guard"() RETURNS trigger AS $$
DECLARE
  i integer;
  ref_id text;
  ref_store text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."storeId" IS DISTINCT FROM OLD."storeId" THEN
    RAISE EXCEPTION '% rows cannot move to another store', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  FOR i IN 0 .. (TG_NARGS / 2) - 1 LOOP
    EXECUTE format('SELECT ($1).%I::text', TG_ARGV[i * 2]) INTO ref_id USING NEW;
    CONTINUE WHEN ref_id IS NULL;
    EXECUTE format('SELECT "storeId" FROM %I WHERE "id" = $1', TG_ARGV[i * 2 + 1])
      INTO ref_store USING ref_id;
    IF FOUND AND ref_store IS DISTINCT FROM NEW."storeId" THEN
      RAISE EXCEPTION '%.% refers to a row of another store', TG_TABLE_NAME, TG_ARGV[i * 2]
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "users_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "roleId" ON "users"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('roleId', 'roles');

CREATE TRIGGER "roles_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId" ON "roles"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"();

CREATE TRIGGER "categories_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "parentId" ON "categories"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('parentId', 'categories');

CREATE TRIGGER "products_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "categoryId" ON "products"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('categoryId', 'categories');

CREATE TRIGGER "price_history_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "productId" ON "price_history"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('productId', 'products');

CREATE TRIGGER "warehouses_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId" ON "warehouses"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"();

CREATE TRIGGER "inventory_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "productId", "warehouseId" ON "inventory"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('productId', 'products', 'warehouseId', 'warehouses');

CREATE TRIGGER "inventory_transactions_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "productId", "warehouseId", "userId" ON "inventory_transactions"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('productId', 'products', 'warehouseId', 'warehouses', 'userId', 'users');

CREATE TRIGGER "cashier_shifts_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "userId", "closedById", "reviewedById" ON "cashier_shifts"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('userId', 'users', 'closedById', 'users', 'reviewedById', 'users');

CREATE TRIGGER "shift_adjustments_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "shiftId", "userId" ON "shift_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('shiftId', 'cashier_shifts', 'userId', 'users');

CREATE TRIGGER "notifications_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "shiftId", "readById" ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('shiftId', 'cashier_shifts', 'readById', 'users');

CREATE TRIGGER "cash_movements_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "shiftId", "userId" ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('shiftId', 'cashier_shifts', 'userId', 'users');

CREATE TRIGGER "sales_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "warehouseId", "userId", "shiftId" ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('warehouseId', 'warehouses', 'userId', 'users', 'shiftId', 'cashier_shifts');

CREATE TRIGGER "sale_items_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "saleId", "productId" ON "sale_items"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('saleId', 'sales', 'productId', 'products');

CREATE TRIGGER "payments_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "saleId", "returnId", "userId", "shiftId" ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('saleId', 'sales', 'returnId', 'returns', 'userId', 'users', 'shiftId', 'cashier_shifts');

CREATE TRIGGER "returns_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "saleId", "userId" ON "returns"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('saleId', 'sales', 'userId', 'users');

CREATE TRIGGER "return_items_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "returnId", "productId", "saleItemId" ON "return_items"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('returnId', 'returns', 'productId', 'products', 'saleItemId', 'sale_items');

CREATE TRIGGER "audit_logs_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "userId" ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('userId', 'users');

CREATE TRIGGER "settings_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId" ON "settings"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"();

-- ---------------------------------------------------------------------------
-- Rollback (manual; run only to undo this migration, after restoring the
-- previous application code, and only while a single store exists):
--
--   DROP TRIGGER IF EXISTS "users_tenant_guard" ON "users";
--   DROP TRIGGER IF EXISTS "roles_tenant_guard" ON "roles";
--   DROP TRIGGER IF EXISTS "categories_tenant_guard" ON "categories";
--   DROP TRIGGER IF EXISTS "products_tenant_guard" ON "products";
--   DROP TRIGGER IF EXISTS "price_history_tenant_guard" ON "price_history";
--   DROP TRIGGER IF EXISTS "warehouses_tenant_guard" ON "warehouses";
--   DROP TRIGGER IF EXISTS "inventory_tenant_guard" ON "inventory";
--   DROP TRIGGER IF EXISTS "inventory_transactions_tenant_guard" ON "inventory_transactions";
--   DROP TRIGGER IF EXISTS "cashier_shifts_tenant_guard" ON "cashier_shifts";
--   DROP TRIGGER IF EXISTS "shift_adjustments_tenant_guard" ON "shift_adjustments";
--   DROP TRIGGER IF EXISTS "notifications_tenant_guard" ON "notifications";
--   DROP TRIGGER IF EXISTS "cash_movements_tenant_guard" ON "cash_movements";
--   DROP TRIGGER IF EXISTS "sales_tenant_guard" ON "sales";
--   DROP TRIGGER IF EXISTS "sale_items_tenant_guard" ON "sale_items";
--   DROP TRIGGER IF EXISTS "payments_tenant_guard" ON "payments";
--   DROP TRIGGER IF EXISTS "returns_tenant_guard" ON "returns";
--   DROP TRIGGER IF EXISTS "return_items_tenant_guard" ON "return_items";
--   DROP TRIGGER IF EXISTS "audit_logs_tenant_guard" ON "audit_logs";
--   DROP TRIGGER IF EXISTS "settings_tenant_guard" ON "settings";
--   DROP FUNCTION IF EXISTS "tenant_guard"();
--   DROP INDEX IF EXISTS "roles_global_slug_key";
--   DROP INDEX IF EXISTS "roles_global_name_key";
--   ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_store_or_platform";
--   ALTER TABLE "users" DROP COLUMN "storeId";
--   ALTER TABLE "roles" DROP COLUMN "storeId";
--   ALTER TABLE "categories" DROP COLUMN "storeId";
--   ALTER TABLE "products" DROP COLUMN "storeId";
--   ALTER TABLE "price_history" DROP COLUMN "storeId";
--   ALTER TABLE "warehouses" DROP COLUMN "storeId";
--   ALTER TABLE "inventory" DROP COLUMN "storeId";
--   ALTER TABLE "inventory_transactions" DROP COLUMN "storeId";
--   ALTER TABLE "cashier_shifts" DROP COLUMN "storeId";
--   ALTER TABLE "shift_adjustments" DROP COLUMN "storeId";
--   ALTER TABLE "notifications" DROP COLUMN "storeId";
--   ALTER TABLE "cash_movements" DROP COLUMN "storeId";
--   ALTER TABLE "sales" DROP COLUMN "storeId";
--   ALTER TABLE "sale_items" DROP COLUMN "storeId";
--   ALTER TABLE "payments" DROP COLUMN "storeId";
--   ALTER TABLE "returns" DROP COLUMN "storeId";
--   ALTER TABLE "return_items" DROP COLUMN "storeId";
--   ALTER TABLE "audit_logs" DROP COLUMN "storeId";
--   ALTER TABLE "settings" DROP COLUMN "storeId";
--   DROP TABLE "stores";
--   DROP TYPE "StoreStatus";
--   DROP TYPE "StorePlan";
--   Then recreate the single-column unique indexes dropped in step 2:
--     roles_name_key
--     roles_slug_key
--     categories_name_key
--     categories_slug_key
--     products_sku_key
--     products_barcode_key
--     warehouses_code_key
--     notifications_dedupeKey_key
--     sales_invoiceNumber_key
--     payments_paymentNumber_key
--     returns_returnNumber_key
--     settings_key_key
