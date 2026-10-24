-- Per-administrator read state for platform notifications.
--
--   platform_notification_reads: one row per (notification, administrator)
--   who has read it. Every administrator is a recipient of every platform
--   notification; an unread count is the notifications without a row for
--   that administrator. Rows are only ever written for the signed-in
--   administrator, so one cannot change another's read state.
--
--   Existing state carries over: a notification already marked read keeps
--   that for the administrator who read it. The old shared readAt/readById
--   columns stay (unused) so nothing is lost.
--
-- Additive: no existing row or column changes.
--
-- Rollback:
--   DROP TABLE IF EXISTS "platform_notification_reads";
--   DROP INDEX IF EXISTS "platform_notifications_createdAt_idx";

-- CreateTable
CREATE TABLE "platform_notification_reads" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_notification_reads_pkey" PRIMARY KEY ("notificationId","userId")
);

-- CreateIndex
CREATE INDEX "platform_notification_reads_userId_idx" ON "platform_notification_reads"("userId");

-- CreateIndex
CREATE INDEX "platform_notifications_createdAt_idx" ON "platform_notifications"("createdAt");

-- AddForeignKey
ALTER TABLE "platform_notification_reads" ADD CONSTRAINT "platform_notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "platform_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_notification_reads" ADD CONSTRAINT "platform_notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over reads recorded under the old shared columns.
INSERT INTO "platform_notification_reads" ("notificationId", "userId", "readAt")
SELECT n."id", n."readById", COALESCE(n."readAt", CURRENT_TIMESTAMP)
FROM "platform_notifications" n
JOIN "users" u ON u."id" = n."readById"
WHERE n."readById" IS NOT NULL
ON CONFLICT DO NOTHING;
