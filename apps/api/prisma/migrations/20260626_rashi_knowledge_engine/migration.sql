CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "SourceType" AS ENUM ('PDF', 'ARTICLE', 'LINK', 'VIDEO_TRANSCRIPT', 'NOTE');
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sourceType" "SourceType" NOT NULL,
  "sourceUrl" TEXT,
  "carrierName" TEXT,
  "stateContext" TEXT,
  "policyType" TEXT,
  "topicTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "summary" TEXT,
  "rawText" TEXT,
  "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentChunk" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" vector(192),
  "embeddingValues" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DocumentChunk_documentId_chunkIndex_key" ON "DocumentChunk"("documentId", "chunkIndex");
CREATE INDEX "KnowledgeDocument_carrierName_idx" ON "KnowledgeDocument"("carrierName");
CREATE INDEX "KnowledgeDocument_stateContext_idx" ON "KnowledgeDocument"("stateContext");
CREATE INDEX "KnowledgeDocument_policyType_idx" ON "KnowledgeDocument"("policyType");
CREATE INDEX "KnowledgeDocument_status_idx" ON "KnowledgeDocument"("status");
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");
CREATE INDEX "DocumentChunk_embedding_ivfflat_idx" ON "DocumentChunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);