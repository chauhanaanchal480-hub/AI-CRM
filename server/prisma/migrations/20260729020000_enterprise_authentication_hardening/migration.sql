ALTER TABLE "User"
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecretEncrypted" TEXT,
  ADD COLUMN "mfaEnabledAt" TIMESTAMP(3);

ALTER TABLE "Session"
  ADD COLUMN "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
  ADD COLUMN "riskReasons" JSONB,
  ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "stepUpVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "trustedDeviceId" TEXT;

CREATE TABLE "PasswordHistory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MfaChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "deviceFingerprint" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "riskReasons" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrustedDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "deviceFingerprint" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key" ON "MfaRecoveryCode"("codeHash");
CREATE UNIQUE INDEX "MfaChallenge_tokenHash_key" ON "MfaChallenge"("tokenHash");
CREATE UNIQUE INDEX "TrustedDevice_tokenHash_key" ON "TrustedDevice"("tokenHash");
CREATE INDEX "Session_trustedDeviceId_idx" ON "Session"("trustedDeviceId");
CREATE INDEX "PasswordHistory_userId_createdAt_idx" ON "PasswordHistory"("userId", "createdAt");
CREATE INDEX "MfaRecoveryCode_userId_usedAt_idx" ON "MfaRecoveryCode"("userId", "usedAt");
CREATE INDEX "MfaChallenge_userId_expiresAt_idx" ON "MfaChallenge"("userId", "expiresAt");
CREATE INDEX "MfaChallenge_expiresAt_consumedAt_idx" ON "MfaChallenge"("expiresAt", "consumedAt");
CREATE INDEX "TrustedDevice_userId_revokedAt_idx" ON "TrustedDevice"("userId", "revokedAt");
CREATE INDEX "TrustedDevice_expiresAt_idx" ON "TrustedDevice"("expiresAt");
CREATE INDEX "TrustedDevice_deviceFingerprint_idx" ON "TrustedDevice"("deviceFingerprint");

ALTER TABLE "PasswordHistory" ADD CONSTRAINT "PasswordHistory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MfaChallenge" ADD CONSTRAINT "MfaChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_trustedDeviceId_fkey"
  FOREIGN KEY ("trustedDeviceId") REFERENCES "TrustedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
