-- CreateEnum
CREATE TYPE "VerificationCodeType" AS ENUM ('EMAIL_VERIFICATION', 'FORGOT_PASSWORD');

-- AlterTable: Add column as nullable first
ALTER TABLE "EmailVerification" ADD COLUMN "type" "VerificationCodeType";

-- Update existing records to have EMAIL_VERIFICATION as default type
UPDATE "EmailVerification" SET "type" = 'EMAIL_VERIFICATION' WHERE "type" IS NULL;

-- AlterTable: Make column NOT NULL
ALTER TABLE "EmailVerification" ALTER COLUMN "type" SET NOT NULL;

-- CreateIndex
CREATE INDEX "EmailVerification_type_idx" ON "EmailVerification"("type");

-- CreateIndex
CREATE INDEX "EmailVerification_userId_type_used_expiresAt_idx" ON "EmailVerification"("userId", "type", "used", "expiresAt");
