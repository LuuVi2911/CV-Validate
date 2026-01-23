-- DropForeignKey
ALTER TABLE "Cv" DROP CONSTRAINT "fk_cv_user";

-- DropForeignKey
ALTER TABLE "CvChunk" DROP CONSTRAINT "fk_chunk_section";

-- DropForeignKey
ALTER TABLE "CvSection" DROP CONSTRAINT "fk_section_cv";

-- DropForeignKey
ALTER TABLE "EmailVerification" DROP CONSTRAINT "fk_email_ver_user";

-- DropIndex
DROP INDEX "cv_chunk_embedding_idx";

-- DropIndex
DROP INDEX "cvchunk_sectionid_order_key";

-- DropIndex
DROP INDEX "cvsection_cvid_order_key";

-- AlterTable
ALTER TABLE "Cv" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CvChunk" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CvSection" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EmailVerification" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "JobDescription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JDRule" (
    "id" TEXT NOT NULL,
    "jdId" TEXT NOT NULL,
    "ruleType" "RuleType" NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "JDRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JDRuleChunk" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,

    CONSTRAINT "JDRuleChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobDescription_userId_idx" ON "JobDescription"("userId");

-- CreateIndex
CREATE INDEX "JDRule_jdId_idx" ON "JDRule"("jdId");

-- CreateIndex
CREATE INDEX "JDRuleChunk_ruleId_idx" ON "JDRuleChunk"("ruleId");

-- CreateIndex
CREATE INDEX "Cv_userId_idx" ON "Cv"("userId");

-- CreateIndex
CREATE INDEX "CvChunk_sectionId_idx" ON "CvChunk"("sectionId");

-- CreateIndex
CREATE INDEX "CvSection_cvId_idx" ON "CvSection"("cvId");

-- CreateIndex
CREATE INDEX "EmailVerification_userId_idx" ON "EmailVerification"("userId");

-- CreateIndex
CREATE INDEX "EmailVerification_expiresAt_idx" ON "EmailVerification"("expiresAt");

-- CreateIndex
CREATE INDEX "EmailVerification_used_idx" ON "EmailVerification"("used");

-- CreateIndex
CREATE INDEX "EmailVerification_createdAt_idx" ON "EmailVerification"("createdAt");

-- CreateIndex
CREATE INDEX "EmailVerification_userId_used_expiresAt_idx" ON "EmailVerification"("userId", "used", "expiresAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- AddForeignKey
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cv" ADD CONSTRAINT "Cv_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvSection" ADD CONSTRAINT "CvSection_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "Cv"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvChunk" ADD CONSTRAINT "CvChunk_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CvSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDescription" ADD CONSTRAINT "JobDescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JDRule" ADD CONSTRAINT "JDRule_jdId_fkey" FOREIGN KEY ("jdId") REFERENCES "JobDescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JDRuleChunk" ADD CONSTRAINT "JDRuleChunk_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "JDRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
