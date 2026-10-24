-- Mandatory password change after an administrator-chosen password.
--
--   users."mustChangePassword": true while the account still uses a password
--   that someone else chose (a new store owner, or an owner password reset by
--   the platform administrator). The application then refuses every page,
--   server action and store query except changing that password.
--
-- Additive only. Every existing row gets false, so no existing owner, staff
-- member or administrator is asked to change their password, and no other
-- column or row changes.
--
-- Rollback:
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "mustChangePassword";

ALTER TABLE "users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
