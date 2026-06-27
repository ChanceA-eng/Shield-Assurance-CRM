CREATE EXTENSION IF NOT EXISTS vector;

ALTER TYPE "KnowledgeDocumentStatus" RENAME TO "DocumentStatus";

ALTER TABLE "DocumentChunk" RENAME TO "DocumentInsight";
ALTER TABLE "DocumentInsight" RENAME COLUMN "chunkIndex" TO "insightIndex";

ALTER TABLE "DocumentInsight" RENAME CONSTRAINT "DocumentChunk_pkey" TO "DocumentInsight_pkey";
ALTER TABLE "DocumentInsight" RENAME CONSTRAINT "DocumentChunk_documentId_fkey" TO "DocumentInsight_documentId_fkey";

ALTER INDEX "DocumentChunk_documentId_chunkIndex_key" RENAME TO "DocumentInsight_documentId_insightIndex_key";
ALTER INDEX "DocumentChunk_documentId_idx" RENAME TO "DocumentInsight_documentId_idx";
ALTER INDEX "DocumentChunk_embedding_ivfflat_idx" RENAME TO "DocumentInsight_embedding_ivfflat_idx";
