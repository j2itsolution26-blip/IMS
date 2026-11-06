-- The GCash reference on a cash-in / cash-out becomes optional.
--
-- Cashiers no longer have to type the 13-digit number during a rush. A
-- blank reference is stored as NULL, never made up. A typed one must still
-- look like a reference (6+ characters), and the existing unique index
-- "wallet_transactions_live_reference" still refuses the same typed
-- reference twice while live; NULLs never collide in it. A double submit of
-- one attempt is still refused by "clientRequestId". The append-only guard
-- compares rows with IS DISTINCT FROM, so a NULL reference stays fixed too.
--
-- No row is changed.
--
-- Rollback (only while no row has a NULL reference):
--   ALTER TABLE "wallet_transactions" DROP CONSTRAINT "wallet_transactions_reference_present";
--   ALTER TABLE "wallet_transactions" ALTER COLUMN "reference" SET NOT NULL;
--   ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_reference_present" CHECK (length(btrim("reference")) >= 6);
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261118090000_optional_gcash_reference';

ALTER TABLE "wallet_transactions" ALTER COLUMN "reference" DROP NOT NULL;
ALTER TABLE "wallet_transactions" DROP CONSTRAINT "wallet_transactions_reference_present";
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_reference_present"
  CHECK ("reference" IS NULL OR length(btrim("reference")) >= 6);
