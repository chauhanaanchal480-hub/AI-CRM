ALTER TABLE "User"
  ADD COLUMN "currentLoginAt" TIMESTAMP(3),
  ADD COLUMN "previousLoginAt" TIMESTAMP(3),
  ADD COLUMN "lastFailedLoginAt" TIMESTAMP(3);

CREATE TABLE "Session" (
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
  "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT NOT NULL,
  "userAgent" TEXT NOT NULL,
  "deviceFingerprint" TEXT NOT NULL,
  "browser" TEXT NOT NULL,
  "operatingSystem" TEXT NOT NULL,
  "deviceType" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "Session_pkey" PRIMARY KEY ("sessionId")
);

CREATE TABLE "LoginHistory" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "emailHash" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT NOT NULL,
  "userAgent" TEXT NOT NULL,
  "deviceFingerprint" TEXT NOT NULL,
  "browser" TEXT NOT NULL,
  "operatingSystem" TEXT NOT NULL,
  "deviceType" TEXT NOT NULL,
  "sessionId" TEXT,
  CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RefreshToken" ADD COLUMN "sessionId" TEXT;

CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Session_absoluteExpiresAt_idx" ON "Session"("absoluteExpiresAt");
CREATE INDEX "Session_deviceFingerprint_idx" ON "Session"("deviceFingerprint");
CREATE INDEX "LoginHistory_userId_timestamp_idx" ON "LoginHistory"("userId", "timestamp");
CREATE INDEX "LoginHistory_emailHash_timestamp_idx" ON "LoginHistory"("emailHash", "timestamp");
CREATE INDEX "LoginHistory_sessionId_idx" ON "LoginHistory"("sessionId");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoginHistory"
  ADD CONSTRAINT "LoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoginHistory"
  ADD CONSTRAINT "LoginHistory_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("sessionId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("sessionId") ON DELETE CASCADE ON UPDATE CASCADE;
