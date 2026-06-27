import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  RASHI_JOB_NAMES,
  RASHI_QUEUE_NAMES,
  RASHI_SOURCE_TYPES,
  buildDeterministicEmbedding,
  type RashiSourceType,
} from '@crm/shared';
import { PrismaService } from '../../common/prisma.service.js';

interface KnowledgeFilters {
  documentId?: string;
  carrierName?: string;
  stateContext?: string;
  policyType?: string;
  topic?: string;
  topicTags?: string[] | string;
}

interface CreateKnowledgeDocumentInput extends KnowledgeFilters {
  title?: string;
  sourceType?: string;
  sourceUrl?: string;
  rawText?: string;
}

interface AskRashiInput extends KnowledgeFilters {
  question?: string;
  limit?: number;
}

interface QueryRow {
  id: string;
  content: string;
  insightIndex: number;
  similarity: number;
  documentId: string;
  title: string;
  carrierName: string | null;
  stateContext: string | null;
  policyType: string | null;
  topic: string | null;
  sourceType: string;
}

@Injectable()
export class KnowledgeService implements OnModuleDestroy {
  private readonly knowledgeQueue = new Queue(RASHI_QUEUE_NAMES.KNOWLEDGE_INGEST, {
    connection: {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listDocuments(filters: KnowledgeFilters) {
    const topicTags = this.normalizeTopicTags(filters.topicTags);

    return this.prisma.knowledgeDocument.findMany({
      where: {
        carrierName: filters.carrierName?.trim() || undefined,
        stateContext: filters.stateContext?.trim().toUpperCase() || undefined,
        policyType: filters.policyType?.trim().toUpperCase() || undefined,
        topic: filters.topic?.trim() || undefined,
        topicTags: topicTags.length > 0 ? { hasSome: topicTags } : undefined,
      },
      include: {
        _count: {
          select: { insights: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  async getStats(filters: KnowledgeFilters) {
    const where = {
      carrierName: filters.carrierName?.trim() || undefined,
      stateContext: filters.stateContext?.trim().toUpperCase() || undefined,
      policyType: filters.policyType?.trim().toUpperCase() || undefined,
      topic: filters.topic?.trim() || undefined,
    };

    const [documents, readyDocuments, totalInsights] = await Promise.all([
      this.prisma.knowledgeDocument.count({ where }),
      this.prisma.knowledgeDocument.count({ where: { ...where, status: 'READY' } }),
      this.prisma.documentInsight.count({
        where: {
          document: where,
        },
      }),
    ]);

    return { documents, readyDocuments, totalInsights };
  }

  async getDocument(documentId: string) {
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      include: {
        insights: {
          orderBy: { insightIndex: 'asc' },
          select: {
            id: true,
            insightIndex: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    if (!document) {
      throw new NotFoundException(`Knowledge document not found: ${documentId}`);
    }

    return document;
  }

  async createDocument(input: CreateKnowledgeDocumentInput) {
    const sourceType = this.normalizeSourceType(input.sourceType);
    const title = input.title?.trim();

    if (!title) {
      throw new BadRequestException('title is required.');
    }

    const rawText = await this.resolveSourceText({
      rawText: input.rawText,
      sourceType,
      sourceUrl: input.sourceUrl,
    });

    const topicTags = this.normalizeTopicTags(input.topicTags);
    const normalizedTopic = input.topic?.trim() || topicTags[0] || null;

    const document = await this.prisma.knowledgeDocument.create({
      data: {
        title,
        sourceType,
        sourceUrl: input.sourceUrl?.trim() || null,
        rawText,
        carrierName: input.carrierName?.trim() || null,
        stateContext: input.stateContext?.trim().toUpperCase() || null,
        policyType: input.policyType?.trim().toUpperCase() || null,
        topic: normalizedTopic,
        topicTags,
        status: 'PENDING',
      },
    });

    await this.knowledgeQueue.add(RASHI_JOB_NAMES.INGEST_DOCUMENT, {
      documentId: document.id,
      rawText,
    });

    return document;
  }

  async askRashi(input: AskRashiInput) {
    const question = input.question?.trim();
    if (!question) {
      throw new BadRequestException('question is required.');
    }

    const limit = Math.min(Math.max(input.limit ?? 3, 1), 6);
    const queryEmbedding = await this.createEmbedding(question);
    const citations = await this.findRelevantInsights(queryEmbedding, input, limit);

    return {
      question,
      answer: await this.composeAnswer(question, citations),
      citations: citations.map((citation) => ({
        documentId: citation.documentId,
        documentTitle: citation.title,
        sourceType: citation.sourceType,
        insightIndex: citation.insightIndex,
        score: Number(citation.similarity.toFixed(4)),
        carrierName: citation.carrierName,
        stateContext: citation.stateContext,
        policyType: citation.policyType,
        topic: citation.topic,
        excerpt: citation.content,
      })),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.knowledgeQueue.close();
  }

  private normalizeSourceType(sourceType?: string): RashiSourceType {
    if (!sourceType) {
      throw new BadRequestException('sourceType is required.');
    }

    const normalized = sourceType.trim().toUpperCase();
    if (!RASHI_SOURCE_TYPES.includes(normalized as RashiSourceType)) {
      throw new BadRequestException(`Unsupported sourceType: ${sourceType}`);
    }

    return normalized as RashiSourceType;
  }

  private normalizeTopicTags(topicTags?: string[] | string): string[] {
    const raw = Array.isArray(topicTags) ? topicTags : topicTags?.split(',') ?? [];
    return Array.from(new Set(raw.map((value) => value.trim()).filter(Boolean)));
  }

  private async resolveSourceText(input: { rawText?: string; sourceType: RashiSourceType; sourceUrl?: string }): Promise<string> {
    const directText = input.rawText?.trim();
    if (directText) {
      return directText;
    }

    if ((input.sourceType === 'ARTICLE' || input.sourceType === 'LINK') && input.sourceUrl) {
      const response = await fetch(input.sourceUrl);
      if (!response.ok) {
        throw new BadRequestException(`Unable to fetch source URL: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) {
        throw new BadRequestException('Fetched source URL did not contain readable text.');
      }

      return text;
    }

    throw new BadRequestException('rawText is required for this source type until PDF and media extraction adapters are configured.');
  }

  private async createEmbedding(input: string): Promise<number[]> {
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
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      return buildDeterministicEmbedding(input);
    }

    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const embedding = payload.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      return buildDeterministicEmbedding(input);
    }

    return embedding;
  }

  private async findRelevantInsights(queryEmbedding: number[], filters: KnowledgeFilters, limit: number): Promise<QueryRow[]> {
    const topicTags = this.normalizeTopicTags(filters.topicTags);

    const conditions = ['kd."status" = \'READY\''];
    if (filters.documentId?.trim()) {
      conditions.push(`kd."id" = '${filters.documentId.trim().replace(/'/g, "''")}'`);
    }
    if (filters.carrierName?.trim()) {
      conditions.push(`kd."carrierName" = '${filters.carrierName.trim().replace(/'/g, "''")}'`);
    }
    if (filters.stateContext?.trim()) {
      conditions.push(`kd."stateContext" = '${filters.stateContext.trim().toUpperCase().replace(/'/g, "''")}'`);
    }
    if (filters.policyType?.trim()) {
      conditions.push(`kd."policyType" = '${filters.policyType.trim().toUpperCase().replace(/'/g, "''")}'`);
    }
    if (filters.topic?.trim()) {
      conditions.push(`kd."topic" = '${filters.topic.trim().replace(/'/g, "''")}'`);
    }
    if (topicTags.length > 0) {
      const quotedTags = topicTags.map((tag) => `'${tag.replace(/'/g, "''")}'`).join(', ');
      conditions.push(`kd."topicTags" && ARRAY[${quotedTags}]::text[]`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    return this.prisma.$queryRawUnsafe<QueryRow[]>(`
      SELECT
        dc."id",
        dc."content",
        dc."insightIndex",
        dc."documentId",
        kd."title",
        kd."carrierName",
        kd."stateContext",
        kd."policyType",
        kd."topic",
        kd."sourceType",
        1 - (dc."embedding" <=> '${vectorLiteral}'::vector) AS similarity
      FROM "DocumentInsight" dc
      JOIN "KnowledgeDocument" kd ON kd."id" = dc."documentId"
      ${whereClause}
      ORDER BY similarity DESC
      LIMIT ${limit};
    `);
  }

  private async composeAnswer(question: string, citations: QueryRow[]): Promise<string> {
    if (citations.length === 0) {
      return 'Rashi could not find any indexed material that matches this question yet. Upload and process underwriting guides, state bulletins, or notes first.';
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const summary = citations
        .map((citation, index) => {
          const scope = [citation.carrierName, citation.stateContext, citation.policyType, citation.topic]
            .filter(Boolean)
            .join(' / ');
          return `${index + 1}. ${citation.title}${scope ? ` (${scope})` : ''}: ${citation.content.slice(0, 220).trim()}`;
        })
        .join('\n');

      return `Question: ${question}\n\nTop matching guidance:\n${summary}`;
    }

    const evidence = citations
      .map(
        (citation, index) =>
          `[${index + 1}] ${citation.title} | carrier=${citation.carrierName ?? 'n/a'} | state=${citation.stateContext ?? 'n/a'} | policy=${citation.policyType ?? 'n/a'} | topic=${citation.topic ?? 'n/a'}\n${citation.content}`,
      )
      .join('\n\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.RASHI_CHAT_MODEL ?? 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: 'You are Rashi, an insurance underwriting knowledge assistant. Answer only from the provided evidence. Cite supporting snippets by bracket number like [1]. If evidence is insufficient, say so plainly.',
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Question: ${question}\n\nEvidence:\n${evidence}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      return this.composeAnswer(question, citations.slice(0, Math.min(citations.length, 3)));
    }

    const payload = (await response.json()) as { output_text?: string };
    return payload.output_text?.trim() || this.composeAnswer(question, citations.slice(0, Math.min(citations.length, 3)));
  }
}