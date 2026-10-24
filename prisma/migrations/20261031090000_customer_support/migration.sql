-- Customer support: tickets, their conversation and screenshots.
--
--   1. support_tickets: a concern sent to the platform administrators, by a
--      signed-in account (APP) or from the public Help page (PUBLIC). The
--      number (SUP-000001) comes from a sequence, so concurrent submissions
--      never share one; submissionKey is unique, so a retried submission is
--      stored once. The requester's store must be the ticket's store
--      (tenant_guard), and number, source, store, requester and creation time
--      never change (the requester may only become empty, when an account is
--      deleted).
--   2. support_messages: append-only conversation. INTERNAL rows are
--      administrator notes; the application never returns them to a
--      requester.
--   3. support_attachments: screenshots in a private bucket, append-only, and
--      always on a message of the same ticket.
--   4. NotificationType SUPPORT_REPLY, for an owner's bell.
--   5. support.create permission, granted to every built-in store role
--      (Owner, Cashier, Inventory Staff) of every store. Owners may remove it
--      from a role.
--
-- Additive: no existing row or column changes.
--
-- Rollback (in this order):
--   DELETE FROM "role_permissions" WHERE "permissionId" = 'perm_support_create';
--   DELETE FROM "permissions" WHERE "id" = 'perm_support_create';
--   DROP TABLE "support_attachments", "support_messages", "support_tickets";
--   DROP FUNCTION IF EXISTS "support_tickets_guard"(), "support_append_only"(), "support_attachments_guard"();
--   DROP SEQUENCE IF EXISTS "support_ticket_number_seq";
--   DROP TYPE "SupportSource", "SupportCategory", "SupportStatus", "SupportPriority",
--     "SupportAuthorKind", "SupportVisibility";
--   (the added NotificationType value cannot be removed; it goes unused after a rollback)

-- CreateSequence
CREATE SEQUENCE "support_ticket_number_seq" START 1;

-- CreateEnum
CREATE TYPE "SupportSource" AS ENUM ('PUBLIC', 'APP');

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('TECHNICAL_ISSUE', 'BUG_REPORT', 'FEATURE_REQUEST', 'BILLING', 'ACCOUNT_LOGIN', 'INSTALLATION', 'GENERAL');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportAuthorKind" AS ENUM ('REQUESTER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SupportVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_REPLY';

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL DEFAULT ('SUP-'::text || lpad((nextval('support_ticket_number_seq'::regclass))::text, 6, '0'::text)),
    "source" "SupportSource" NOT NULL,
    "requesterId" TEXT,
    "storeId" TEXT,
    "requesterName" TEXT NOT NULL,
    "replyEmail" TEXT,
    "category" "SupportCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'NEW',
    "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedToId" TEXT,
    "submissionKey" TEXT NOT NULL,
    "ipHash" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAdminReplyAt" TIMESTAMP(3),
    "lastRequesterReplyAt" TIMESTAMP(3),
    "requesterReadAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorKind" "SupportAuthorKind" NOT NULL,
    "visibility" "SupportVisibility" NOT NULL DEFAULT 'PUBLIC',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_attachments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_submissionKey_key" ON "support_tickets"("submissionKey");

-- CreateIndex
CREATE INDEX "support_tickets_status_lastActivityAt_idx" ON "support_tickets"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "support_tickets_category_idx" ON "support_tickets"("category");

-- CreateIndex
CREATE INDEX "support_tickets_storeId_idx" ON "support_tickets"("storeId");

-- CreateIndex
CREATE INDEX "support_tickets_requesterId_lastActivityAt_idx" ON "support_tickets"("requesterId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "support_tickets_assignedToId_idx" ON "support_tickets"("assignedToId");

-- CreateIndex
CREATE INDEX "support_tickets_createdAt_idx" ON "support_tickets"("createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_replyEmail_createdAt_idx" ON "support_tickets"("replyEmail", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_ipHash_createdAt_idx" ON "support_tickets"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "support_messages_ticketId_createdAt_idx" ON "support_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_attachments_storagePath_key" ON "support_attachments"("storagePath");

-- CreateIndex
CREATE INDEX "support_attachments_ticketId_idx" ON "support_attachments"("ticketId");

-- CreateIndex
CREATE INDEX "support_attachments_messageId_idx" ON "support_attachments"("messageId");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "support_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The sequence belongs to the column, so dropping the table drops it too.
ALTER SEQUENCE "support_ticket_number_seq" OWNED BY "support_tickets"."number";

ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_subject_length" CHECK (char_length("subject") BETWEEN 1 AND 200);
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_public_has_email"
  CHECK ("source" <> 'PUBLIC' OR "replyEmail" IS NOT NULL);
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_body_length" CHECK (char_length("body") BETWEEN 1 AND 10000);
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_size" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880);

-- A requester belongs to the ticket's store (a public ticket and a platform
-- account have none). Same guard as every other store-owned table.
CREATE TRIGGER "support_tickets_tenant_guard"
  BEFORE INSERT OR UPDATE OF "storeId", "requesterId" ON "support_tickets"
  FOR EACH ROW EXECUTE FUNCTION "tenant_guard"('requesterId', 'users');

-- Tickets are never deleted, and what identifies one never changes. Only an
-- account deletion may empty the requester. The assignee must be a platform
-- account.
CREATE OR REPLACE FUNCTION "support_tickets_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'support tickets cannot be deleted; close them instead'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."id", NEW."number", NEW."source", NEW."storeId", NEW."requesterName", NEW."replyEmail",
        NEW."submissionKey", NEW."ipHash", NEW."createdAt")
       IS DISTINCT FROM
       (OLD."id", OLD."number", OLD."source", OLD."storeId", OLD."requesterName", OLD."replyEmail",
        OLD."submissionKey", OLD."ipHash", OLD."createdAt") THEN
      RAISE EXCEPTION 'a support ticket''s identity cannot be changed'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."requesterId" IS DISTINCT FROM OLD."requesterId" AND NEW."requesterId" IS NOT NULL THEN
      RAISE EXCEPTION 'a support ticket cannot move to another requester'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF NEW."assignedToId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = NEW."assignedToId" AND u."storeId" IS NULL) THEN
    RAISE EXCEPTION 'support tickets can only be assigned to a platform administrator'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "support_tickets_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "support_tickets"
  FOR EACH ROW EXECUTE FUNCTION "support_tickets_guard"();

-- Messages and attachments are append-only. The one permitted change is the
-- author/uploader becoming empty when that account is deleted.
CREATE OR REPLACE FUNCTION "support_append_only"() RETURNS trigger AS $$
DECLARE
  person text := CASE TG_TABLE_NAME WHEN 'support_messages' THEN 'authorId' ELSE 'uploadedById' END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) ->> person) IS NOT NULL AND (to_jsonb(NEW) ->> person) IS DISTINCT FROM (to_jsonb(OLD) ->> person) THEN
    RAISE EXCEPTION '% rows cannot be edited', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - person) IS DISTINCT FROM (to_jsonb(OLD) - person) THEN
    RAISE EXCEPTION '% rows cannot be edited', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "support_messages_append_only"
  BEFORE UPDATE OR DELETE ON "support_messages"
  FOR EACH ROW EXECUTE FUNCTION "support_append_only"();

CREATE TRIGGER "support_attachments_append_only"
  BEFORE UPDATE OR DELETE ON "support_attachments"
  FOR EACH ROW EXECUTE FUNCTION "support_append_only"();

-- An attachment sits on a message of its own ticket.
CREATE OR REPLACE FUNCTION "support_attachments_guard"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "support_messages" m WHERE m."id" = NEW."messageId" AND m."ticketId" = NEW."ticketId") THEN
    RAISE EXCEPTION 'a support attachment must belong to a message of the same ticket'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "support_attachments_guard"
  BEFORE INSERT ON "support_attachments"
  FOR EACH ROW EXECUTE FUNCTION "support_attachments_guard"();

-- support.create: open and follow one's own support tickets. Every built-in
-- store role gets it; platform administrators use platform.* instead.
INSERT INTO "permissions" ("id", "key", "resource", "action", "description")
VALUES ('perm_support_create', 'support.create', 'support', 'create', 'Create — Contact support and follow your own tickets')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'support.create'
WHERE r."slug" IN ('owner', 'cashier', 'inventory-staff') AND r."storeId" IS NOT NULL
ON CONFLICT DO NOTHING;
