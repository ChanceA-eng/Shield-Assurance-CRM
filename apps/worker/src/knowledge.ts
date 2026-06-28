import { PrismaClient } from '@prisma/client';
import { RASHI_EMBEDDING_DIMENSION, buildDeterministicEmbedding, buildKnowledgeInsights } from '@crm/shared';

const RASHI_EMBEDDING_VECTOR_SIZE = Number(process.env.RASHI_EMBEDDING_DIMENSION ?? RASHI_EMBEDDING_DIMENSION);

function truncateSummary(rawText: string): string {
  return rawText.replace(/\s+/g, ' ').trim().slice(0, 320);
}

async function createEmbedding(input: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildDeterministicEmbedding(input);
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.RASHI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
      input,
      dimensions: RASHI_EMBEDDING_VECTOR_SIZE,
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    return buildDeterministicEmbedding(input);
  }

  const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  return payload.data?.[0]?.embedding?.length ? payload.data[0].embedding : buildDeterministicEmbedding(input);
}

export async function processKnowledgeDocument(prisma: PrismaClient, input: { documentId: string; rawText: string }): Promise<void> {
  await prisma.knowledgeDocument.update({
    where: { id: input.documentId },
    data: {
      status: 'PROCESSING',
      errorMessage: null,
    },
  });

  try {
    const insights = buildKnowledgeInsights(input.rawText);
    if (insights.length === 0) {
      throw new Error('The supplied document did not contain readable text after normalization.');
    }

    await prisma.documentInsight.deleteMany({ where: { documentId: input.documentId } });

    for (const insight of insights) {
      const embedding = await createEmbedding(insight.semanticText ?? insight.content);
      const insightRecord = await prisma.documentInsight.create({
        data: {
          documentId: input.documentId,
          insightIndex: insight.index,
          content: insight.content,
          embeddingValues: embedding,
        },
      });

      const vectorLiteral = `[${embedding.join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE "DocumentInsight" SET "embedding" = '${vectorLiteral}'::vector WHERE "id" = '${insightRecord.id}'`,
      );
    }

    await prisma.knowledgeDocument.update({
      where: { id: input.documentId },
      data: {
        status: 'READY',
        summary: truncateSummary(input.rawText),
        topic: undefined,
      },
    });
  } catch (error) {
    await prisma.knowledgeDocument.update({
      where: { id: input.documentId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown knowledge ingestion failure',
      },
    });

    throw error;
  }
}