import type { DocumentInsight, KnowledgeDocument, SourceType } from '@prisma/client';
import pdf from 'pdf-parse';
import { RASHI_SOURCE_TYPES, buildDeterministicEmbedding, buildKnowledgeInsights, cosineSimilarity } from '@crm/shared';
import { prisma } from './prisma';

export interface RashiFilters {
  documentId?: string;
  carrierName?: string;
  stateContext?: string;
  policyType?: string;
  topic?: string;
}

export interface IngestRashiInput extends RashiFilters {
  title: string;
  sourceType: string;
  sourceUrl?: string;
  rawText?: string;
}

export interface AskRashiInput extends RashiFilters {
  question: string;
  topK?: number;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export type RashiAnalyzeAction = 'APPETITE' | 'ELIGIBILITY' | 'EXCLUSIONS' | 'DECISION';

interface QueryRow {
  id: string;
  content: string;
  insightIndex: number;
  similarity: number;
  embeddingValues: number[];
  documentId: string;
  title: string;
  sourceUrl: string | null;
  carrierName: string | null;
  stateContext: string | null;
  policyType: string | null;
  topic: string | null;
  sourceType: string;
}

type UnderwritingIntent =
  | 'ELIGIBILITY'
  | 'APPETITE'
  | 'EXCLUSION'
  | 'COVERAGE'
  | 'ENDORSEMENT'
  | 'REGULATORY'
  | 'DEFINITION'
  | 'GENERAL';

interface ParsedQuestionContext {
  carrierName?: string;
  stateContext?: string;
  policyType?: string;
  topic?: string;
  intent: UnderwritingIntent;
}

interface MetadataCatalog {
  carriers: string[];
  states: string[];
  policies: string[];
  topics: string[];
}

let metadataCatalogCache: { expiresAt: number; value: MetadataCatalog } | null = null;

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeOptional(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeState(value?: string | null): string | undefined {
  const trimmed = normalizeOptional(value);
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function normalizePolicyType(value?: string | null): string | undefined {
  const trimmed = normalizeOptional(value);
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function parseUnderwritingIntent(question: string): UnderwritingIntent {
  const normalized = question.toLowerCase();

  if (/\b(exclusion|excluded|decline|declination|ineligible|disqualif)/.test(normalized)) return 'EXCLUSION';
  if (/\b(eligible|eligibility|qualif|requirement|criteria)\b/.test(normalized)) return 'ELIGIBILITY';
  if (/\b(appetite|preferred risk|target risk|accept|acceptable)\b/.test(normalized)) return 'APPETITE';
  if (/\b(coverage|covered|limit|deductible|peril|liability)\b/.test(normalized)) return 'COVERAGE';
  if (/\b(endorsement|rider|form|iso form|form code)\b/.test(normalized)) return 'ENDORSEMENT';
  if (/\b(state rule|doi|regulation|statute|compliance|filing|admitted)\b/.test(normalized)) return 'REGULATORY';
  if (/\b(definition|means|defined as|term)\b/.test(normalized)) return 'DEFINITION';

  return 'GENERAL';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findBestMention(question: string, candidates: string[]): string | undefined {
  const normalizedQuestion = question.toLowerCase();
  const sorted = [...candidates].sort((left, right) => right.length - left.length);

  for (const candidate of sorted) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;

    const regex = new RegExp(`\\b${escapeRegExp(trimmed.toLowerCase())}\\b`, 'i');
    if (regex.test(normalizedQuestion) || normalizedQuestion.includes(trimmed.toLowerCase())) {
      return candidate;
    }
  }

  return undefined;
}

async function loadMetadataCatalog(): Promise<MetadataCatalog> {
  const now = Date.now();
  if (metadataCatalogCache && metadataCatalogCache.expiresAt > now) {
    return metadataCatalogCache.value;
  }

  const rows = await prisma.knowledgeDocument.findMany({
    where: { status: 'READY' },
    select: {
      carrierName: true,
      stateContext: true,
      policyType: true,
      topic: true,
      topicTags: true,
    },
    take: 2500,
  });

  const carriers = new Set<string>();
  const states = new Set<string>();
  const policies = new Set<string>();
  const topics = new Set<string>();

  for (const row of rows) {
    if (row.carrierName?.trim()) carriers.add(row.carrierName.trim());
    if (row.stateContext?.trim()) states.add(row.stateContext.trim().toUpperCase());
    if (row.policyType?.trim()) policies.add(row.policyType.trim().toUpperCase());
    if (row.topic?.trim()) topics.add(row.topic.trim());
    for (const tag of row.topicTags) {
      if (tag?.trim()) topics.add(tag.trim());
    }
  }

  const value: MetadataCatalog = {
    carriers: Array.from(carriers),
    states: Array.from(states),
    policies: Array.from(policies),
    topics: Array.from(topics),
  };

  metadataCatalogCache = {
    value,
    expiresAt: now + 5 * 60 * 1000,
  };

  return value;
}

async function parseQuestionContext(question: string, input: RashiFilters): Promise<ParsedQuestionContext> {
  const catalog = await loadMetadataCatalog();
  const explicitState = normalizeState(input.stateContext);
  const explicitPolicy = normalizePolicyType(input.policyType);

  const detectedCarrier = findBestMention(question, catalog.carriers);
  const detectedTopic = findBestMention(question, catalog.topics);
  const detectedPolicy = findBestMention(question, catalog.policies);
  const detectedStateByCatalog = findBestMention(question, catalog.states);

  const stateMatch = question.toUpperCase().match(/\b([A-Z]{2})\b/g) ?? [];
  const detectedStateByToken = stateMatch.find((token) => catalog.states.includes(token));

  return {
    carrierName: normalizeOptional(input.carrierName) ?? detectedCarrier,
    stateContext: explicitState ?? detectedStateByCatalog ?? detectedStateByToken,
    policyType: explicitPolicy ?? detectedPolicy,
    topic: normalizeOptional(input.topic) ?? detectedTopic,
    intent: parseUnderwritingIntent(question),
  };
}

function buildFallbackStages(filters: RashiFilters): RashiFilters[] {
  if (filters.documentId) {
    return [filters];
  }

  const full = {
    carrierName: normalizeOptional(filters.carrierName),
    stateContext: normalizeState(filters.stateContext),
    policyType: normalizePolicyType(filters.policyType),
    topic: normalizeOptional(filters.topic),
  };

  const stages: RashiFilters[] = [full];
  if (full.topic) stages.push({ ...full, topic: undefined });
  if (full.policyType) stages.push({ ...full, policyType: undefined, topic: undefined });
  if (full.stateContext) stages.push({ ...full, stateContext: undefined, policyType: undefined, topic: undefined });
  if (full.carrierName) stages.push({ ...full, carrierName: undefined, stateContext: undefined, policyType: undefined, topic: undefined });

  stages.push({});
  return stages;
}

function normalizeSourceType(sourceType: string): SourceType {
  const normalized = sourceType.trim().toUpperCase();
  if (!RASHI_SOURCE_TYPES.includes(normalized as SourceType)) {
    throw new Error(`Unsupported sourceType: ${sourceType}`);
  }

  return normalized as SourceType;
}

function summarize(rawText: string): string {
  return rawText.replace(/\s+/g, ' ').trim().slice(0, 320);
}

const ACTION_PROMPTS: Record<RashiAnalyzeAction, string> = {
  APPETITE: 'Extract underwriting appetite guidance and target-risk fit criteria.',
  ELIGIBILITY: 'Extract strict eligibility requirements and qualifying conditions.',
  EXCLUSIONS: 'Extract exclusions, ineligible classes, and declination triggers.',
  DECISION: 'Provide a concise underwriting decision posture with any conditions.',
};

interface GeneratedKeyPoint {
  topic: string;
  point: string;
  semanticText: string;
}

function inferTopicFromPoint(text: string, fallbackTopic?: string): string {
  const normalized = text.toLowerCase();
  if (/exclusion|ineligible|decline|declination|not eligible/.test(normalized)) return 'Exclusions';
  if (/eligib|qualif|requirement|criteria/.test(normalized)) return 'Eligibility';
  if (/appetite|target risk|preferred|acceptable/.test(normalized)) return 'Appetite';
  if (/coverage|limit|deductible|liability|property/.test(normalized)) return 'Coverage';
  if (/endorsement|rider|form/.test(normalized)) return 'Endorsements';
  if (/state|doi|regulation|compliance|filing/.test(normalized)) return 'Regulatory';
  if (/condition|subject to|must|required/.test(normalized)) return 'Conditions';
  return fallbackTopic || 'General';
}

function parseKeyPointsFromText(output: string, fallbackTopic?: string): GeneratedKeyPoint[] {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean);

  const parsed: GeneratedKeyPoint[] = [];

  for (const line of lines) {
    const separatorMatch = line.match(/^(?:topic\s*:\s*)?([^|:]{2,50})\s*(?:\||:)\s*(?:key\s*point\s*:\s*)?(.+)$/i);
    if (separatorMatch) {
      const topic = separatorMatch[1].trim();
      const point = separatorMatch[2].trim();
      if (point.length > 8) {
        parsed.push({
          topic: topic || inferTopicFromPoint(point, fallbackTopic),
          point,
          semanticText: `${topic || inferTopicFromPoint(point, fallbackTopic)} ${point}`,
        });
      }
      continue;
    }

    if (line.length > 8) {
      const topic = inferTopicFromPoint(line, fallbackTopic);
      parsed.push({ topic, point: line, semanticText: `${topic} ${line}` });
    }
  }

  return parsed;
}

function buildFallbackKeyPoints(rawText: string, fallbackTopic?: string): GeneratedKeyPoint[] {
  const insights = buildKnowledgeInsights(rawText).slice(0, 20);
  return insights.map((insight) => {
    const topic = inferTopicFromPoint(insight.content, fallbackTopic);
    return {
      topic,
      point: insight.content,
      semanticText: `${topic} ${insight.semanticText ?? insight.content}`,
    };
  });
}

async function generateTopicKeyPoints(rawText: string, fallbackTopic?: string): Promise<GeneratedKeyPoint[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildFallbackKeyPoints(rawText, fallbackTopic);
  }

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.RASHI_CHAT_MODEL ?? 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an underwriting intelligence parser. Convert source text into concise paraphrased key points grouped by topic. Do not quote long text. Output plain text lines only in this exact format: Topic | Key point. Keep each key point under 190 characters. Return 10 to 20 lines.',
          },
          {
            role: 'user',
            content: `Document topic hint: ${fallbackTopic ?? 'General'}\n\nSource text:\n${rawText.slice(0, 26000)}`,
          },
        ],
        temperature: 0.5,
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (error) {
    console.error('[Rashi KeyPoint Generation Error]', error);
    return buildFallbackKeyPoints(rawText, fallbackTopic);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error('[Rashi KeyPoint Generation HTTP Error]', response.status, errorText);
    return buildFallbackKeyPoints(rawText, fallbackTopic);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const output = payload.choices?.[0]?.message?.content?.trim();
  const parsed = parseKeyPointsFromText(output ?? '', fallbackTopic);
  if (parsed.length === 0) {
    return buildFallbackKeyPoints(rawText, fallbackTopic);
  }

  return parsed.slice(0, 24);
}

async function persistDocumentInsights(
  documentId: string,
  rawText: string,
  topicHint?: string,
): Promise<{ totalInsightsProcessed: number; topicTags: string[]; summary: string }> {
  const keyPoints = await generateTopicKeyPoints(rawText, topicHint);
  if (keyPoints.length === 0) {
    throw new Error('The supplied document did not contain readable text after normalization.');
  }

  await prisma.documentInsight.deleteMany({ where: { documentId } });

  for (const [index, keyPoint] of keyPoints.entries()) {
    const embedding = await createEmbedding(keyPoint.semanticText);
    const insightRecord = await prisma.documentInsight.create({
      data: {
        documentId,
        insightIndex: index,
        content: `Topic: ${keyPoint.topic} | Key Point: ${keyPoint.point}`,
        embeddingValues: embedding,
      },
    });

    const vectorLiteral = `[${embedding.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `UPDATE "DocumentInsight" SET "embedding" = '${vectorLiteral}'::vector WHERE "id" = '${insightRecord.id}'`,
    );
  }

  const topicTags = Array.from(new Set(keyPoints.map((keyPoint) => keyPoint.topic.trim()).filter(Boolean))).slice(0, 12);
  const summary = keyPoints.slice(0, 3).map((keyPoint) => keyPoint.point).join(' ').slice(0, 420);

  return {
    totalInsightsProcessed: keyPoints.length,
    topicTags,
    summary: summary || summarize(rawText),
  };
}

async function createEmbedding(input: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildDeterministicEmbedding(input);
  }

  let response: Response;

  try {
    response = await fetch('https://api.openai.com/v1/embeddings', {
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
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return buildDeterministicEmbedding(input);
  }

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

async function resolveSourceText(input: IngestRashiInput): Promise<string> {
  const directText = normalizeOptional(input.rawText);
  if (directText) {
    return directText;
  }

  if ((input.sourceType === 'ARTICLE' || input.sourceType === 'LINK') && input.sourceUrl) {
    const response = await fetch(input.sourceUrl);
    if (!response.ok) {
      throw new Error(`Unable to fetch source URL: ${response.status} ${response.statusText}`);
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
      throw new Error('Fetched source URL did not contain readable text.');
    }

    return text;
  }

  throw new Error('rawText or an extractable source is required.');
}

export async function extractTextFromUpload(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const payload = await pdf(buffer);
    return payload.text.trim();
  }

  return buffer.toString('utf-8').trim();
}

export async function ingestRashiDocument(input: IngestRashiInput): Promise<{
  success: true;
  documentId: string;
  totalInsightsProcessed: number;
}> {
  const title = normalizeOptional(input.title);
  if (!title) {
    throw new Error('title is required.');
  }

  const sourceType = normalizeSourceType(input.sourceType);
  const rawText = await resolveSourceText(input);
  const carrierName = normalizeOptional(input.carrierName);
  const stateContext = normalizeState(input.stateContext);
  const policyType = normalizePolicyType(input.policyType);
  const topic = normalizeOptional(input.topic);

  const document = await prisma.knowledgeDocument.create({
    data: {
      title,
      sourceType,
      sourceUrl: normalizeOptional(input.sourceUrl) ?? null,
      rawText,
      carrierName: carrierName ?? null,
      stateContext: stateContext ?? null,
      policyType: policyType ?? null,
      topic: topic ?? null,
      topicTags: topic ? [topic] : [],
      status: 'PROCESSING',
      summary: summarize(rawText),
    },
  });

  try {
    const persisted = await persistDocumentInsights(document.id, rawText, topic ?? undefined);
    const mergedTopicTags = Array.from(new Set([...(topic ? [topic] : []), ...persisted.topicTags]));

    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        status: 'READY',
        errorMessage: null,
        summary: persisted.summary,
        topicTags: mergedTopicTags,
      },
    });

    metadataCatalogCache = null;

    return { success: true, documentId: document.id, totalInsightsProcessed: persisted.totalInsightsProcessed };
  } catch (error) {
    await prisma.knowledgeDocument.update({
      where: { id: document.id },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown Rashi ingest failure',
      },
    });

    throw error;
  }
}

export async function listRashiDocuments(filters: RashiFilters): Promise<Array<KnowledgeDocument & { _count: { insights: number } }>> {
  return prisma.knowledgeDocument.findMany({
    where: {
      carrierName: normalizeOptional(filters.carrierName),
      stateContext: normalizeState(filters.stateContext),
      policyType: normalizePolicyType(filters.policyType),
      topic: normalizeOptional(filters.topic),
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

export async function getRashiDocument(documentId: string): Promise<KnowledgeDocument & { insights: DocumentInsight[] }> {
  const document = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    include: {
      insights: {
        orderBy: { insightIndex: 'asc' },
      },
    },
  });

  if (!document) {
    throw new Error(`Knowledge document not found: ${documentId}`);
  }

  return document;
}

export async function getRashiStats(filters: RashiFilters): Promise<{ documents: number; readyDocuments: number; totalInsights: number }> {
  const where = {
    carrierName: normalizeOptional(filters.carrierName),
    stateContext: normalizeState(filters.stateContext),
    policyType: normalizePolicyType(filters.policyType),
    topic: normalizeOptional(filters.topic),
  };

  const [documents, readyDocuments, totalInsights] = await Promise.all([
    prisma.knowledgeDocument.count({ where }),
    prisma.knowledgeDocument.count({ where: { ...where, status: 'READY' } }),
    prisma.documentInsight.count({ where: { document: where } }),
  ]);

  return { documents, readyDocuments, totalInsights };
}

async function findRelevantInsights(questionEmbedding: number[], filters: RashiFilters, topK: number): Promise<QueryRow[]> {
  const conditions = ['kd."status" = \'READY\''];

  if (filters.documentId) conditions.push(`kd."id" = '${escapeSqlLiteral(filters.documentId)}'`);
  if (filters.carrierName) conditions.push(`kd."carrierName" = '${escapeSqlLiteral(filters.carrierName)}'`);
  if (filters.stateContext) conditions.push(`kd."stateContext" = '${escapeSqlLiteral(normalizeState(filters.stateContext) ?? filters.stateContext)}'`);
  if (filters.policyType) conditions.push(`kd."policyType" = '${escapeSqlLiteral(normalizePolicyType(filters.policyType) ?? filters.policyType)}'`);
  if (filters.topic) conditions.push(`kd."topic" = '${escapeSqlLiteral(filters.topic)}'`);

  const vectorLiteral = `[${questionEmbedding.join(',')}]`;

  return prisma.$queryRawUnsafe<QueryRow[]>(`
    SELECT
      dc."id",
      dc."content",
      dc."insightIndex",
      dc."embeddingValues",
      dc."documentId",
      kd."title",
      kd."sourceUrl",
      kd."carrierName",
      kd."stateContext",
      kd."policyType",
      kd."topic",
      kd."sourceType",
      1 - (dc."embedding" <=> '${vectorLiteral}'::vector) AS similarity
    FROM "DocumentInsight" dc
    JOIN "KnowledgeDocument" kd ON kd."id" = dc."documentId"
    WHERE ${conditions.join(' AND ')}
    ORDER BY similarity DESC
    LIMIT ${topK};
  `);
}

function selectDiverseInsights(rows: QueryRow[], topK: number): QueryRow[] {
  if (rows.length <= topK) {
    return rows;
  }

  const lambda = 0.78;
  const selected: QueryRow[] = [];
  const remaining = [...rows];

  while (selected.length < topK && remaining.length > 0) {
    if (selected.length === 0) {
      selected.push(remaining.shift() as QueryRow);
      continue;
    }

    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidateVector = candidate.embeddingValues ?? [];

      const maxRedundancy = selected.reduce((maxValue, current) => {
        if (candidateVector.length === 0 || (current.embeddingValues ?? []).length === 0) {
          return maxValue;
        }

        return Math.max(maxValue, cosineSimilarity(candidateVector, current.embeddingValues ?? []));
      }, 0);

      const sameDocumentPenalty = selected.some((current) => current.documentId === candidate.documentId) ? 0.06 : 0;
      const sameCarrierPenalty = candidate.carrierName
        ? selected.some((current) => current.carrierName === candidate.carrierName)
          ? 0.04
          : 0
        : 0;
      const mmrScore = lambda * candidate.similarity - (1 - lambda) * maxRedundancy - sameDocumentPenalty - sameCarrierPenalty;

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIndex = index;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}

function buildFallbackAnswer(question: string, citations: QueryRow[]): string {
  if (citations.length === 0) {
    return `The provided key points do not address this question: "${question}".`;
  }

  const points = citations
    .slice(0, 3)
    .map((citation, index) => {
      const snippet = citation.content.replace(/\s+/g, ' ').trim().slice(0, 170);
      return `- [${index + 1}] ${citation.title}: ${snippet}${snippet.length >= 170 ? '...' : ''}`;
    })
    .join('\n');

  return `Based on retrieved key points, here are the closest matches for "${question}":\n${points}\n\nThe provided key points may not fully answer this question.`;
}

async function composeAnswer(
  question: string,
  citations: QueryRow[],
  intent: UnderwritingIntent,
  history: Array<{ role: 'user' | 'assistant'; text: string }> = [],
): Promise<string> {
  if (citations.length === 0) {
    return 'Rashi could not find any indexed material that matches this question yet. Upload and process underwriting guides, state bulletins, or notes first.';
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildFallbackAnswer(question, citations);
  }

  const evidence = citations
    .map(
      (citation, index) =>
        `Insight ${index + 1}\n` +
        `Document: ${citation.title}\n` +
        `Carrier: ${citation.carrierName ?? 'n/a'}\n` +
        `State: ${citation.stateContext ?? 'n/a'}\n` +
        `Policy: ${citation.policyType ?? 'n/a'}\n` +
        `Topic: ${citation.topic ?? 'n/a'}\n` +
        `Insight Index: ${citation.insightIndex + 1}\n` +
        `Text: ${citation.content}`,
    )
    .join('\n\n');

  const scopeValues = {
    carriers: Array.from(new Set(citations.map((citation) => citation.carrierName).filter((value): value is string => Boolean(value)))),
    states: Array.from(new Set(citations.map((citation) => citation.stateContext).filter((value): value is string => Boolean(value)))),
    policies: Array.from(new Set(citations.map((citation) => citation.policyType).filter((value): value is string => Boolean(value)))),
    topics: Array.from(new Set(citations.map((citation) => citation.topic).filter((value): value is string => Boolean(value)))),
  };
  const retrievalScope = `carriers=${scopeValues.carriers.join(', ') || 'n/a'} | states=${scopeValues.states.join(', ') || 'n/a'} | policies=${scopeValues.policies.join(', ') || 'n/a'} | topics=${scopeValues.topics.join(', ') || 'n/a'}`;
  const historyContext = history
    .slice(-8)
    .map((entry) => `${entry.role.toUpperCase()}: ${entry.text}`)
    .join('\n');

  const systemPrompt = `You are Rashi, the highly knowledgeable and conversational AI Underwriting Assistant for Shield Assurance. You are like a senior underwriting partner sitting beside the agent - confident, direct, and deeply familiar with carrier guidelines.

Your personality:
- Speak naturally and professionally, like an experienced colleague, not a search engine
- Give clear YES/NO/CONDITIONAL postures when the data supports it
- Be proactive: if a related exclusion or condition is relevant, mention it even if not directly asked
- Use friendly affirmations when an agent's instinct is right

FORMATTING RULES (STRICT):
1. NEVER output a wall of text.
2. Use Markdown headings or short section labels when useful.
3. Use bullet points for coverages, eligibility, limits, exclusions, or requirements.
4. Bold critical values using Markdown, such as **$1M/$1M**, **$0 deductible**, **Occurrence**.
5. Wrap key entities using these tokens when present in evidence:
   - [LIMIT: ...] for limits and monetary thresholds
   - [DEDUCTIBLE: ...] for deductibles
   - [FORM: ...] for form type
   - [STATUS: ...] for eligibility posture or underwriting status
6. Keep answers concise, readable, and scannable for an agent on a live phone call.

CRITICAL RULES:
1. Answer ONLY from the provided key points; never invent or assume rules.
2. Every factual underwriting statement must include a bracket citation [1], [2], etc.
3. Never treat any single carrier as the default source; focus on a carrier only if the question or scope explicitly names it.
4. If the conversation has prior history, maintain context and remember what the agent said before.
5. If key points do NOT directly address the user's specific question, respond exactly: "I cannot verify that criterion in the current carrier guidelines."
6. If the user asks about exclusions but the chunks only list eligible classes, explicitly state: "The document outlines eligible risks, but I don't see explicit exclusions listed."`;

  const userMessage = `Conversation history:\n${historyContext || 'No prior history.'}\n\nQuestion:\n${question}\n\nIntent:\n${intent}\n\nRetrieval scope:\n${retrievalScope}\n\nRetrieved key points:\n${evidence}\n\nUsing ONLY these key points, provide a concise underwriting-style answer. If relevant details exist, summarize the rules, exclusions, and conditions with citations. If the key points do not actually address the question, say you cannot verify it.`;

  let response: Response;

  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.RASHI_CHAT_MODEL ?? 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    console.error('[Rashi LLM Error]', error);
    return buildFallbackAnswer(question, citations.slice(0, Math.min(3, citations.length)));
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error('[Rashi LLM HTTP Error]', response.status, errorText);
    return buildFallbackAnswer(question, citations.slice(0, Math.min(3, citations.length)));
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const answer = payload.choices?.[0]?.message?.content?.trim();
  return answer || buildFallbackAnswer(question, citations.slice(0, Math.min(3, citations.length)));
}

export async function askRashi(input: AskRashiInput): Promise<{
  question: string;
  answer: string;
  citations: Array<{
    documentId: string;
    documentTitle: string;
    sourceUrl: string | null;
    sourceType: string;
    insightIndex: number;
    score: number;
    carrierName: string | null;
    stateContext: string | null;
    policyType: string | null;
    topic: string | null;
  }>;
}> {
  const question = normalizeOptional(input.question);
  if (!question) {
    throw new Error('question is required.');
  }

  const topK = Math.min(Math.max(input.topK ?? 5, 1), 8);
  const parsedContext = await parseQuestionContext(question, input);
  const retrievalFilters: RashiFilters = {
    documentId: normalizeOptional(input.documentId),
    carrierName: parsedContext.carrierName,
    stateContext: parsedContext.stateContext,
    policyType: parsedContext.policyType,
    topic: parsedContext.topic,
  };

  const queryEmbedding = await createEmbedding(question);

  let retrievalRows: QueryRow[] = [];
  const stages = buildFallbackStages(retrievalFilters);
  for (const stage of stages) {
    retrievalRows = await findRelevantInsights(queryEmbedding, stage, Math.max(topK * 6, 18));
    if (retrievalRows.length > 0) {
      break;
    }
  }

  const citations = selectDiverseInsights(retrievalRows, topK);

  return {
    question,
    answer: await composeAnswer(question, citations, parsedContext.intent, input.history ?? []),
    citations: citations.map((citation) => ({
      documentId: citation.documentId,
      documentTitle: citation.title,
      sourceUrl: citation.sourceUrl,
      sourceType: citation.sourceType,
      insightIndex: citation.insightIndex,
      score: Number(citation.similarity.toFixed(4)),
      carrierName: citation.carrierName,
      stateContext: citation.stateContext,
      policyType: citation.policyType,
      topic: citation.topic,
    })),
  };
}

export async function reingestRashiDocument(documentId: string): Promise<{ success: true; totalInsightsProcessed: number }> {
  const document = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      rawText: true,
      topic: true,
      topicTags: true,
    },
  });

  if (!document) {
    throw new Error(`Knowledge document not found: ${documentId}`);
  }

  const rawText = normalizeOptional(document.rawText);
  if (!rawText) {
    throw new Error('Document has no extracted text available for re-ingestion.');
  }

  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: {
      status: 'PROCESSING',
      errorMessage: null,
      summary: summarize(rawText),
    },
  });

  try {
    const persisted = await persistDocumentInsights(documentId, rawText, document.topic ?? undefined);
    const mergedTopicTags = Array.from(new Set([...(document.topicTags ?? []), ...persisted.topicTags]));
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: 'READY',
        errorMessage: null,
        summary: persisted.summary,
        topicTags: mergedTopicTags,
      },
    });

    metadataCatalogCache = null;

    return { success: true, totalInsightsProcessed: persisted.totalInsightsProcessed };
  } catch (error) {
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        status: 'FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown Rashi re-ingest failure',
      },
    });
    throw error;
  }
}

export async function analyzeRashiDocument(documentId: string, action: RashiAnalyzeAction): Promise<{
  documentId: string;
  documentTitle: string;
  action: RashiAnalyzeAction;
  summary: string;
  citations: Array<{
    documentId: string;
    documentTitle: string;
    sourceType: string;
    sourceUrl: string | null;
  }>;
}> {
  const document = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      title: true,
      sourceType: true,
      sourceUrl: true,
      rawText: true,
      insights: {
        orderBy: { insightIndex: 'asc' },
        take: 8,
        select: {
          content: true,
        },
      },
    },
  });

  if (!document) {
    throw new Error(`Knowledge document not found: ${documentId}`);
  }

  const backgroundText = normalizeOptional(document.rawText)
    ?? document.insights.map((insight) => insight.content).join('\n');

  if (!backgroundText) {
    throw new Error('No document text available for analysis.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  let summary: string;

  if (!apiKey) {
    const fallbackPoints = buildKnowledgeInsights(backgroundText)
      .slice(0, 4)
      .map((insight) => `- ${insight.content}`)
      .join('\n');
    summary = fallbackPoints || '- No actionable underwriting points found in this document.';
  } else {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.RASHI_CHAT_MODEL ?? 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an insurance underwriting analyst. Return 3-6 short bullet points with high-value decision criteria only. Do not quote long passages or dump raw text.',
            },
            {
              role: 'user',
              content: `Action: ${ACTION_PROMPTS[action]}\n\nDocument: ${document.title}\n\nSource text:\n${backgroundText.slice(0, 16000)}`,
            },
          ],
          temperature: 0.6,
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`OpenAI analysis failed: ${response.status} ${errorText}`);
      }

      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      summary = payload.choices?.[0]?.message?.content?.trim() || '- No actionable underwriting points returned.';
    } catch (error) {
      console.error('[Rashi Document Analysis Error]', error);
      throw error;
    }
  }

  return {
    documentId: document.id,
    documentTitle: document.title,
    action,
    summary,
    citations: [
      {
        documentId: document.id,
        documentTitle: document.title,
        sourceType: document.sourceType,
        sourceUrl: document.sourceUrl,
      },
    ],
  };
}