-- Store activity log (Settings -> Activity Log).
--
--   1. The audit.view permission, granted to every store's Owner role here,
--      so bootstrap does not have to run (it resets the built-in roles'
--      permissions to their defaults). No other role gets it; an owner on a
--      plan with permission editing may grant it to a custom role.
--
-- Only adds rows. No audit entry, role, account or subscription changes, and
-- nothing is deleted: the plan's audit history window limits what the page
-- shows, never what is kept (audit_logs stays append-only).
--
-- Rollback (in this order):
--   DELETE FROM "role_permissions" WHERE "permissionId" = (SELECT "id" FROM "permissions" WHERE "key" = 'audit.view');
--   DELETE FROM "permissions" WHERE "key" = 'audit.view';
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261110090000_store_audit_view';

INSERT INTO "permissions" ("id", "key", "resource", "action", "description")
VALUES ('perm_audit_view', 'audit.view', 'audit', 'view', 'View — Store activity log, as far back as the plan audit history allows')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'audit.view'
WHERE r."slug" = 'owner' AND r."storeId" IS NOT NULL
ON CONFLICT DO NOTHING;
