ALTER TABLE "KnowledgeDocument"
ADD COLUMN "topic" TEXT;

UPDATE "KnowledgeDocument"
SET "topic" = NULLIF("topicTags"[1], '')
WHERE "topic" IS NULL AND cardinality("topicTags") > 0;

ALTER TABLE "DocumentChunk"
ALTER COLUMN "embedding" TYPE vector(1536);

DROP INDEX IF EXISTS "DocumentChunk_embedding_ivfflat_idx";
CREATE INDEX "DocumentChunk_embedding_ivfflat_idx"
ON "DocumentChunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS "KnowledgeDocument_topic_idx" ON "KnowledgeDocument"("topic");