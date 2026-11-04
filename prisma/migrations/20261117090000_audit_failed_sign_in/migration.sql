-- Failed sign-ins in the store activity log.
--
-- Adds the LOGIN_FAILED audit action. A wrong password for an existing store
-- account is logged to that account's store, at most 5 entries per account
-- per 10 minutes (src/lib/sign-in-audit.ts); the password is never recorded,
-- and attempts at usernames that do not exist are not logged.
--
-- Only adds an enum value. No audit entry or other row changes.
--
-- Rollback: an enum value cannot be dropped while rows use it. With no
-- LOGIN_FAILED rows, recreate "AuditAction" without it (as migration
-- 20260902014842 does), then
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261117090000_audit_failed_sign_in';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LOGIN_FAILED';
