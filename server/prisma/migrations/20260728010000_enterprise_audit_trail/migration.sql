CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "sessionId" TEXT,
  "requestId" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "userAgent" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resource" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetId" TEXT,
  "success" BOOLEAN NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");
CREATE INDEX "AuditLog_userId_timestamp_idx" ON "AuditLog"("userId", "timestamp");
CREATE INDEX "AuditLog_sessionId_timestamp_idx" ON "AuditLog"("sessionId", "timestamp");
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");
CREATE INDEX "AuditLog_resource_action_timestamp_idx" ON "AuditLog"("resource", "action", "timestamp");
CREATE INDEX "AuditLog_success_timestamp_idx" ON "AuditLog"("success", "timestamp");
CREATE INDEX "AuditLog_targetId_idx" ON "AuditLog"("targetId");
