-- Phase 2.9: composite indexes aligned with tenant scopes, filters, ordering,
-- analytics aggregation, and bounded relation timelines. Existing indexes are
-- retained for backward-compatible query plans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Customer_ownerId_status_createdAt_idx" ON "Customer"("ownerId", "status", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Customer_createdAt_idx" ON "Customer"("createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Lead_assignedToId_status_createdAt_idx" ON "Lead"("assignedToId", "status", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Lead_source_createdAt_idx" ON "Lead"("source", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Deal_stageId_position_idx" ON "Deal"("stageId", "position");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Deal_ownerId_status_closedAt_idx" ON "Deal"("ownerId", "status", "closedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Deal_createdAt_idx" ON "Deal"("createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_assigneeId_status_dueDate_idx" ON "Task"("assigneeId", "status", "dueDate");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_customerId_createdAt_idx" ON "Task"("customerId", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Activity_customerId_createdAt_idx" ON "Activity"("customerId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Activity_leadId_createdAt_idx" ON "Activity"("leadId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Note_customerId_createdAt_idx" ON "Note"("customerId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "EmailLog_customerId_sentAt_idx" ON "EmailLog"("customerId", "sentAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Attachment_customerId_createdAt_idx" ON "Attachment"("customerId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AiInsight_customerId_createdAt_idx" ON "AiInsight"("customerId", "createdAt");
