BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE "Customer"
  ADD COLUMN "emailSearchTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Lead"
  ADD COLUMN "contactEmailSearchTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Deal"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Task"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Activity"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Note"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

ALTER TABLE "EmailLog"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Attachment"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Notification"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

ALTER TABLE "AiInsight"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT;

CREATE TABLE "DataRetentionRun" (
  "id" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "deletedCounts" JSONB,
  "errorCode" TEXT,
  CONSTRAINT "DataRetentionRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Customer_deletedAt_idx" ON "Customer"("deletedAt");
CREATE INDEX "Customer_emailSearchTokens_idx" ON "Customer" USING GIN ("emailSearchTokens");
CREATE INDEX "Lead_deletedAt_idx" ON "Lead"("deletedAt");
CREATE INDEX "Lead_contactEmailSearchTokens_idx" ON "Lead" USING GIN ("contactEmailSearchTokens");
CREATE INDEX "Deal_deletedAt_idx" ON "Deal"("deletedAt");
CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");
CREATE INDEX "Activity_deletedAt_idx" ON "Activity"("deletedAt");
CREATE INDEX "Note_deletedAt_idx" ON "Note"("deletedAt");
CREATE INDEX "EmailLog_deletedAt_idx" ON "EmailLog"("deletedAt");
CREATE INDEX "Attachment_deletedAt_idx" ON "Attachment"("deletedAt");
CREATE INDEX "Notification_deletedAt_idx" ON "Notification"("deletedAt");
CREATE INDEX "AiInsight_deletedAt_idx" ON "AiInsight"("deletedAt");
CREATE INDEX "DataRetentionRun_startedAt_idx" ON "DataRetentionRun"("startedAt");
CREATE INDEX "DataRetentionRun_status_startedAt_idx" ON "DataRetentionRun"("status", "startedAt");

COMMIT;
