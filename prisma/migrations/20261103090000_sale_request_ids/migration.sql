-- Duplicate-checkout protection.
--
-- Adds "clientRequestId" to sales: one id per checkout attempt, made by the
-- till. Unique per store, so a retried or double-submitted checkout cannot
-- record the same sale twice; the server hands back the sale already saved.
--
-- Additive only. Existing sales keep an empty value, and empty values never
-- collide (NULLs are distinct in a unique index). No row is changed.
--
-- Rollback:
--   DROP INDEX IF EXISTS "sales_storeId_clientRequestId_key";
--   ALTER TABLE "sales" DROP COLUMN IF EXISTS "clientRequestId";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261103090000_sale_request_ids';

-- AlterTable
ALTER TABLE "sales" ADD COLUMN "clientRequestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_storeId_clientRequestId_key" ON "sales"("storeId", "clientRequestId");
