-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_brandId_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_userId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_items" DROP CONSTRAINT "purchase_items_purchaseOrderId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_items" DROP CONSTRAINT "purchase_items_productId_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_customerId_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_purchaseOrderId_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_userId_fkey";

-- DropForeignKey
ALTER TABLE "returns" DROP CONSTRAINT "returns_customerId_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_userId_fkey";

-- DropIndex
DROP INDEX "products_brandId_idx";

-- DropIndex
DROP INDEX "products_supplierId_idx";

-- DropIndex
DROP INDEX "sales_customerId_createdAt_idx";

-- DropIndex
DROP INDEX "payments_purchaseOrderId_idx";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "brandId",
DROP COLUMN "supplierId",
DROP COLUMN "taxRate";

-- AlterTable
ALTER TABLE "sales" DROP COLUMN "customerId",
ADD COLUMN     "shiftId" TEXT;

-- AlterTable
ALTER TABLE "sale_items" DROP COLUMN "taxRate";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "purchaseOrderId";

-- AlterTable
ALTER TABLE "returns" DROP COLUMN "customerId",
DROP COLUMN "taxAmount",
DROP COLUMN "type";

-- DropTable
DROP TABLE "brands";

-- DropTable
DROP TABLE "suppliers";

-- DropTable
DROP TABLE "customers";

-- DropTable
DROP TABLE "purchase_orders";

-- DropTable
DROP TABLE "purchase_items";

-- DropTable
DROP TABLE "expenses";

-- DropTable
DROP TABLE "notifications";

-- DropEnum
DROP TYPE "PurchaseOrderStatus";

-- DropEnum
DROP TYPE "ReturnType";

-- DropEnum
DROP TYPE "NotificationType";

-- DropEnum
DROP TYPE "NotificationSeverity";

-- AlterEnum
-- All tables referencing PaymentMethod (payments, expenses) must already be
-- migrated or dropped before the old type is dropped below, so this block
-- runs after "expenses" is gone rather than before, as generated.
BEGIN;
CREATE TYPE "ProductStatus_new" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
ALTER TABLE "products" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "status" TYPE "ProductStatus_new" USING ("status"::text::"ProductStatus_new");
ALTER TYPE "ProductStatus" RENAME TO "ProductStatus_old";
ALTER TYPE "ProductStatus_new" RENAME TO "ProductStatus";
DROP TYPE "ProductStatus_old";
ALTER TABLE "products" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "InventoryTransactionType_new" AS ENUM ('STOCK_IN', 'SALE', 'SALE_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'OPENING_BALANCE');
ALTER TABLE "inventory_transactions" ALTER COLUMN "type" TYPE "InventoryTransactionType_new" USING ("type"::text::"InventoryTransactionType_new");
ALTER TYPE "InventoryTransactionType" RENAME TO "InventoryTransactionType_old";
ALTER TYPE "InventoryTransactionType_new" RENAME TO "InventoryTransactionType";
DROP TYPE "InventoryTransactionType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ReferenceType_new" AS ENUM ('SALE', 'RETURN', 'ADJUSTMENT');
ALTER TABLE "inventory_transactions" ALTER COLUMN "referenceType" TYPE "ReferenceType_new" USING ("referenceType"::text::"ReferenceType_new");
ALTER TYPE "ReferenceType" RENAME TO "ReferenceType_old";
ALTER TYPE "ReferenceType_new" RENAME TO "ReferenceType";
DROP TYPE "ReferenceType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "SaleStatus_new" AS ENUM ('COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED', 'VOIDED');
ALTER TABLE "sales" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "sales" ALTER COLUMN "status" TYPE "SaleStatus_new" USING ("status"::text::"SaleStatus_new");
ALTER TYPE "SaleStatus" RENAME TO "SaleStatus_old";
ALTER TYPE "SaleStatus_new" RENAME TO "SaleStatus";
DROP TYPE "SaleStatus_old";
ALTER TABLE "sales" ALTER COLUMN "status" SET DEFAULT 'COMPLETED';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "SaleChannel_new" AS ENUM ('POS', 'MANUAL');
ALTER TABLE "sales" ALTER COLUMN "channel" DROP DEFAULT;
ALTER TABLE "sales" ALTER COLUMN "channel" TYPE "SaleChannel_new" USING ("channel"::text::"SaleChannel_new");
ALTER TYPE "SaleChannel" RENAME TO "SaleChannel_old";
ALTER TYPE "SaleChannel_new" RENAME TO "SaleChannel";
DROP TYPE "SaleChannel_old";
ALTER TABLE "sales" ALTER COLUMN "channel" SET DEFAULT 'POS';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethod_new" AS ENUM ('CASH', 'GCASH', 'CARD', 'OTHER');
ALTER TABLE "payments" ALTER COLUMN "method" TYPE "PaymentMethod_new" USING ("method"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "PaymentMethod_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "AuditAction_new" AS ENUM ('LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'INVENTORY_CHANGE', 'PRICE_CHANGE', 'SALE', 'RETURN', 'SETTINGS_CHANGE', 'EXPORT');
ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE "AuditAction_new" USING ("action"::text::"AuditAction_new");
ALTER TYPE "AuditAction" RENAME TO "AuditAction_old";
ALTER TYPE "AuditAction_new" RENAME TO "AuditAction";
DROP TYPE "AuditAction_old";
COMMIT;

-- CreateTable
CREATE TABLE "cashier_shifts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingCash" DECIMAL(18,4) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "expectedCash" DECIMAL(18,4),
    "actualCash" DECIMAL(18,4),
    "difference" DECIMAL(18,4),
    "totalSales" DECIMAL(18,4),
    "transactionCount" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashier_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cashier_shifts_userId_status_idx" ON "cashier_shifts"("userId", "status");

-- CreateIndex
CREATE INDEX "cashier_shifts_status_idx" ON "cashier_shifts"("status");

-- CreateIndex
CREATE INDEX "sales_shiftId_idx" ON "sales"("shiftId");

-- AddForeignKey
ALTER TABLE "cashier_shifts" ADD CONSTRAINT "cashier_shifts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "cashier_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
