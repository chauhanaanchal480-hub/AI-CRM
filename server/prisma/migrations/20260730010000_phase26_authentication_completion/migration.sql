ALTER TABLE "MfaChallenge"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lockedAt" TIMESTAMP(3);

CREATE INDEX "MfaChallenge_lockedAt_expiresAt_idx"
  ON "MfaChallenge"("lockedAt", "expiresAt");
