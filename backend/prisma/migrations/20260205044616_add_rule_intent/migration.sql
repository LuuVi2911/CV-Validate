-- CreateEnum
CREATE TYPE "JDParagraphType" AS ENUM ('REQUIREMENTS', 'RESPONSIBILITIES', 'NICE_TO_HAVE', 'BENEFITS', 'COMPANY', 'PROCESS', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RuleIntent" AS ENUM ('REQUIREMENT', 'RESPONSIBILITY', 'QUALIFICATION', 'INFORMATIONAL', 'PREFERENCE');

-- CreateEnum
CREATE TYPE "RuleStrategy" AS ENUM ('STRUCTURAL', 'SEMANTIC', 'HYBRID');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('critical', 'warning', 'info');

-- AlterTable
ALTER TABLE "CvChunk" ALTER COLUMN "embedding" DROP NOT NULL;

-- AlterTable
ALTER TABLE "JDRule" ADD COLUMN     "ignored" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "intent" "RuleIntent",
ADD COLUMN     "paragraphType" "JDParagraphType" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "JDRuleChunk" ADD COLUMN     "chunkKey" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "embedding" DROP NOT NULL;

-- CreateTable
CREATE TABLE "RuleSet" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sourcePdf" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "embeddingProvider" TEXT NOT NULL DEFAULT 'gemini',
    "embeddingModel" TEXT NOT NULL DEFAULT 'text-embedding-004',
    "embeddingDimension" INTEGER NOT NULL DEFAULT 768,
    "vectorOperator" TEXT NOT NULL DEFAULT '<=>',
    "similarityTransform" TEXT NOT NULL DEFAULT '1 - distance',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CvQualityRule" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "category" "RuleType" NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "strategy" "RuleStrategy" NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "appliesToSections" JSONB,
    "structuralCheckKey" TEXT,
    "params" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CvQualityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CvQualityRuleChunk" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "chunkKey" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(768),

    CONSTRAINT "CvQualityRuleChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceRule" (
    "id" TEXT NOT NULL,
    "category" "RuleType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "examples" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedding" vector(768),

    CONSTRAINT "ReferenceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cvId" TEXT NOT NULL,
    "jdId" TEXT,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RuleSet_key_key" ON "RuleSet"("key");

-- CreateIndex
CREATE INDEX "RuleSet_key_idx" ON "RuleSet"("key");

-- CreateIndex
CREATE INDEX "RuleSet_createdAt_idx" ON "RuleSet"("createdAt");

-- CreateIndex
CREATE INDEX "CvQualityRule_ruleSetId_idx" ON "CvQualityRule"("ruleSetId");

-- CreateIndex
CREATE INDEX "CvQualityRule_ruleKey_idx" ON "CvQualityRule"("ruleKey");

-- CreateIndex
CREATE INDEX "CvQualityRule_category_idx" ON "CvQualityRule"("category");

-- CreateIndex
CREATE INDEX "CvQualityRule_strategy_idx" ON "CvQualityRule"("strategy");

-- CreateIndex
CREATE UNIQUE INDEX "CvQualityRule_ruleSetId_ruleKey_key" ON "CvQualityRule"("ruleSetId", "ruleKey");

-- CreateIndex
CREATE INDEX "CvQualityRuleChunk_ruleId_idx" ON "CvQualityRuleChunk"("ruleId");

-- CreateIndex
CREATE INDEX "CvQualityRuleChunk_chunkKey_idx" ON "CvQualityRuleChunk"("chunkKey");

-- CreateIndex
CREATE UNIQUE INDEX "CvQualityRuleChunk_ruleId_chunkKey_key" ON "CvQualityRuleChunk"("ruleId", "chunkKey");

-- CreateIndex
CREATE INDEX "ReferenceRule_category_idx" ON "ReferenceRule"("category");

-- CreateIndex
CREATE INDEX "Evaluation_userId_idx" ON "Evaluation"("userId");

-- CreateIndex
CREATE INDEX "Evaluation_cvId_idx" ON "Evaluation"("cvId");

-- CreateIndex
CREATE INDEX "Evaluation_jdId_idx" ON "Evaluation"("jdId");

-- CreateIndex
CREATE INDEX "Evaluation_createdAt_idx" ON "Evaluation"("createdAt");

-- CreateIndex
CREATE INDEX "JDRule_paragraphType_idx" ON "JDRule"("paragraphType");

-- CreateIndex
CREATE INDEX "JDRule_ignored_idx" ON "JDRule"("ignored");

-- CreateIndex
CREATE INDEX "JDRule_intent_idx" ON "JDRule"("intent");

-- CreateIndex
CREATE INDEX "JDRuleChunk_chunkKey_idx" ON "JDRuleChunk"("chunkKey");

-- AddForeignKey
ALTER TABLE "CvQualityRule" ADD CONSTRAINT "CvQualityRule_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "RuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CvQualityRuleChunk" ADD CONSTRAINT "CvQualityRuleChunk_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CvQualityRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_cvId_fkey" FOREIGN KEY ("cvId") REFERENCES "Cv"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_jdId_fkey" FOREIGN KEY ("jdId") REFERENCES "JobDescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
