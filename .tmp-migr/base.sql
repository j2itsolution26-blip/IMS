-- CreateEnum
CREATE TYPE "StorePlan" AS ENUM ('BASIC', 'BUSINESS', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');

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

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "price_history" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "inventory" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cashier_shifts" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "shift_adjustments" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "return_items" ADD COLUMN     "storeId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "storeId" TEXT NOT NULL;

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

