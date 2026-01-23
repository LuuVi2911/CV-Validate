-- =================================
-- Extensions (MUST BE FIRST)
-- =================================
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =================================
-- ENUMS
-- =================================
CREATE TYPE "CvStatus" AS ENUM ('UPLOADED', 'PARSED', 'EVALUATED');
CREATE TYPE "CvSectionType" AS ENUM ('SUMMARY', 'EXPERIENCE', 'PROJECTS', 'SKILLS', 'EDUCATION', 'ACTIVITIES');
CREATE TYPE "RuleType" AS ENUM ('MUST_HAVE', 'NICE_TO_HAVE', 'BEST_PRACTICE');

-- =================================
-- TABLES
-- =================================
CREATE TABLE "User" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "EmailVerification" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Cv" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" TEXT NOT NULL,
  "status" "CvStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CvSection" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "cvId" TEXT NOT NULL,
  "type" "CvSectionType" NOT NULL,
  "order" INTEGER NOT NULL
);

CREATE UNIQUE INDEX CvSection_cvId_order_key
ON "CvSection"("cvId", "order");

CREATE TABLE "CvChunk" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "sectionId" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(768) NOT NULL
);

CREATE UNIQUE INDEX CvChunk_sectionId_order_key
ON "CvChunk"("sectionId", "order");

-- =================================
-- FOREIGN KEYS
-- =================================
ALTER TABLE "EmailVerification"
  ADD CONSTRAINT fk_email_ver_user
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "Cv"
  ADD CONSTRAINT fk_cv_user
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "CvSection"
  ADD CONSTRAINT fk_section_cv
  FOREIGN KEY ("cvId") REFERENCES "Cv"("id") ON DELETE CASCADE;

ALTER TABLE "CvChunk"
  ADD CONSTRAINT fk_chunk_section
  FOREIGN KEY ("sectionId") REFERENCES "CvSection"("id") ON DELETE CASCADE;

-- =================================
-- VECTOR INDEX
-- =================================
CREATE INDEX cv_chunk_embedding_idx
ON "CvChunk"
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
