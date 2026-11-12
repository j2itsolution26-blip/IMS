-- Offline-first POS: sales rung up without a connection and uploaded later.
--
--   1. sales: "origin" (ONLINE / OFFLINE), the uploading device, the PENDING
--      SYNC receipt number the customer was handed, and "receivedAt" (when
--      the server recorded the sale). For an offline sale "createdAt" is when
--      it happened, so every existing report files it on the right day.
--      Existing sales are ONLINE and were received when they were created.
--   2. pos_devices: browsers prepared for offline selling, which the owner can
--      revoke.
--   3. sync_issues: the owner's review queue for uploaded offline sales
--      (stock that ran short, a price that had changed, a shift that closed
--      first). The sale is always recorded; the issue sits beside it.
--
-- Additive only: nothing is deleted and no existing figure changes.
--
-- Rollback (in this order):
--   DROP TABLE IF EXISTS "sync_issues";
--   ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_offline_receipt_number";
--   ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_deviceId_fkey";
--   DROP TABLE IF EXISTS "pos_devices";
--   ALTER TABLE "sales" DROP COLUMN "deviceId", DROP COLUMN "localReceiptNumber",
--     DROP COLUMN "origin", DROP COLUMN "receivedAt";
--   DROP TYPE "SaleOrigin"; DROP TYPE "SyncIssueKind"; DROP TYPE "SyncIssueStatus";
--   re-create "sales_tenant_guard" as in migration 20261104090000;
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261120090000_offline_pos';

-- 1. Enums -------------------------------------------------------------------

CREATE TYPE "SaleOrigin" AS ENUM ('ONLINE', 'OFFLINE');
CREATE TYPE "SyncIssueKind" AS ENUM ('STOCK_SHORTFALL', 'PRICE_MISMATCH', 'TAX_RATE_MISMATCH', 'TOTAL_MISMATCH', 'PRODUCT_UNAVAILABLE', 'CLOSED_SHIFT', 'DEVICE_REVOKED');
CREATE TYPE "SyncIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- 2. Sales -------------------------------------------------------------------

ALTER TABLE "sales"
  ADD COLUMN "deviceId" TEXT,
  ADD COLUMN "localReceiptNumber" TEXT,
  ADD COLUMN "origin" "SaleOrigin" NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "receivedAt" TIMESTAMP(3);

-- Every existing sale reached the server the moment it was made.
UPDATE "sales" SET "receivedAt" = "createdAt" WHERE "receivedAt" IS NULL;
ALTER TABLE "sales" ALTER COLUMN "receivedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sales" ALTER COLUMN "receivedAt" SET NOT NULL;

-- An offline sale always carries the receipt number the customer holds.
ALTER TABLE "sales" ADD CONSTRAINT "sales_offline_receipt_number"
  CHECK ("origin" <> 'OFFLINE' OR ("localReceiptNumber" IS NOT NULL AND length("localReceiptNumber") BETWEEN 1 AND 40));

CREATE INDEX "sales_deviceId_idx" ON "sales"("deviceId");

-- 3. Devices -----------------------------------------------------------------

CREATE TABLE "pos_devices" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userAgent" TEXT,
    "registeredById" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_devices_pkey" PRIMARY KEY ("id"),
    -- Made on the device: a UUID, never a guessable sequence.
    CONSTRAINT "pos_devices_id_uuid" CHECK ("id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    CONSTRAINT "pos_devices_label_length" CHECK (length("label") BETWEEN 1 AND 80),
    CONSTRAINT "pos_devices_revoked_together" CHECK (("revokedAt" IS NULL) = ("revokedById" IS NULL))
);

CREATE INDEX "pos_devices_storeId_idx" ON "pos_devices"("storeId");
CREATE INDEX "pos_devices_warehouseId_idx" ON "pos_devices"("warehouseId");

ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "pos_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Sync issues -------------------------------------------------------------

CREATE TABLE "sync_issues" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "SyncIssueKind" NOT NULL,
    "status" "SyncIssueStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "saleId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT,
    "shiftId" TEXT,
    "deviceId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_issues_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sync_issues_resolved_together" CHECK (
      ("status" = 'RESOLVED') = ("resolvedAt" IS NOT NULL)
    )
);

CREATE INDEX "sync_issues_storeId_status_createdAt_idx" ON "sync_issues"("storeId", "status", "createdAt");
CREATE INDEX "sync_issues_saleId_idx" ON "sync_issues"("saleId");
CREATE INDEX "sync_issues_warehouseId_status_idx" ON "sync_issues"("warehouseId", "status");

ALTER TABLE "sync_issues" ADD CONSTRAINT "sync_issues_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_issues" ADD CONSTRAINT "sync_issues_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_issues" ADD CONSTRAINT "sync_issues_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_issues" ADD CONSTRAINT "sync_issues_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sync_issues" ADD CONSTRAINT "sync_issues_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cashier_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sync_issues" ADD CONSTRAINT "sync_issues_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "pos_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sync_issues" ADD CONSTRAINT "sync_issues_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Store isolation ---------------------------------------------------------

DROP TRIGGER IF EXISTS "sales_tenant_guard" ON "sales";
CREATE TRIGGER "sales_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "warehouseId", "userId", "shiftId", "voidedById", "deviceId" ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('warehouseId', 'warehouses', 'userId', 'users', 'shiftId', 'cashier_shifts', 'voidedById', 'users', 'deviceId', 'pos_devices');

CREATE TRIGGER "pos_devices_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "warehouseId", "registeredById", "revokedById" ON "pos_devices"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('warehouseId', 'warehouses', 'registeredById', 'users', 'revokedById', 'users');

CREATE TRIGGER "sync_issues_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "saleId", "warehouseId", "productId", "shiftId", "deviceId", "resolvedById" ON "sync_issues"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('saleId', 'sales', 'warehouseId', 'warehouses', 'productId', 'products', 'shiftId', 'cashier_shifts', 'deviceId', 'pos_devices', 'resolvedById', 'users');
