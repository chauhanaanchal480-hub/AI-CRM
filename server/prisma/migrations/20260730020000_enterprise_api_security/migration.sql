CREATE TABLE "ApiRequestNonce" (
  "id" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiRequestNonce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiIdempotencyRecord" (
  "id" TEXT NOT NULL,
  "scopeHash" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "statusCode" INTEGER,
  "responseBody" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiRequestNonce_keyId_nonce_key" ON "ApiRequestNonce"("keyId", "nonce");
CREATE INDEX "ApiRequestNonce_expiresAt_idx" ON "ApiRequestNonce"("expiresAt");
CREATE UNIQUE INDEX "ApiIdempotencyRecord_scopeHash_key_key" ON "ApiIdempotencyRecord"("scopeHash", "key");
CREATE INDEX "ApiIdempotencyRecord_expiresAt_idx" ON "ApiIdempotencyRecord"("expiresAt");
CREATE INDEX "ApiIdempotencyRecord_state_createdAt_idx" ON "ApiIdempotencyRecord"("state", "createdAt");
