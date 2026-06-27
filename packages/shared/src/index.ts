export type DealStage = 'LEAD' | 'QUOTING' | 'PRESENTED' | 'BOUND' | 'LOST';

export const WORKFLOW_EVENTS = {
  DEAL_BOUND: 'deal.bound',
} as const;

export const RASHI_QUEUE_NAMES = {
  KNOWLEDGE_INGEST: 'rashi-knowledge',
} as const;

export const RASHI_JOB_NAMES = {
  INGEST_DOCUMENT: 'knowledge.document.ingest',
} as const;

export const RASHI_SOURCE_TYPES = ['PDF', 'ARTICLE', 'LINK', 'VIDEO_TRANSCRIPT', 'NOTE'] as const;

export const RASHI_DOCUMENT_STATUSES = ['PENDING', 'PROCESSING', 'READY', 'FAILED'] as const;

export const RASHI_EMBEDDING_DIMENSION = 1536;

export type WorkflowEventName = (typeof WORKFLOW_EVENTS)[keyof typeof WORKFLOW_EVENTS];
export type RashiSourceType = (typeof RASHI_SOURCE_TYPES)[number];
export type RashiDocumentStatus = (typeof RASHI_DOCUMENT_STATUSES)[number];

export interface DealBoundEventPayload {
  dealId: string;
  accountId: string;
  triggeredBy: string;
  occurredAt: string;
}

export interface KnowledgeIngestJobPayload {
  documentId: string;
  rawText: string;
}

export interface RashiInsight {
  index: number;
  content: string;
  semanticText?: string;
}

const UNDERWRITING_KEYWORDS = [
  'eligible',
  'ineligible',
  'exclude',
  'exclusion',
  'appetite',
  'risk',
  'decline',
  'declination',
  'coverage',
  'limit',
  'deductible',
  'endorsement',
  'state',
  'carrier',
  'requirement',
  'criteria',
  'must',
  'not eligible',
  'prohibited',
  'allowed',
];

function normalizeText(rawText: string): string {
  return rawText
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[ \u00a0]+$/gm, '')
    .trim();
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(#{1,6}\s+|\d+\.|[A-Z]\.|[IVXLCDM]+\.|section\s+\d+|chapter\s+\d+)/i.test(trimmed)) {
    return true;
  }

  // Common guideline heading formats: short all-caps lines or title-like labels ending with ':'
  if ((trimmed.length <= 90 && /^[A-Z0-9\s\-\/&,()]+$/.test(trimmed) && /[A-Z]/.test(trimmed)) || /:$/.test(trimmed)) {
    return true;
  }

  return false;
}

function isBulletLine(line: string): boolean {
  return /^\s*(?:[-*•]|\d+[.)]|[a-z][.)])\s+/.test(line);
}

function splitSemanticBlocks(normalized: string): string[] {
  const lines = normalized.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];

  const pushCurrent = () => {
    const block = current.join('\n').trim();
    if (block) {
      blocks.push(block);
    }
    current = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const blank = trimmed.length === 0;

    if (blank) {
      if (current.length > 0) {
        pushCurrent();
      }
      continue;
    }

    if (isHeadingLine(line)) {
      if (current.length > 0) {
        pushCurrent();
      }
      current.push(trimmed);
      continue;
    }

    if (isBulletLine(line)) {
      if (current.length > 0 && !isBulletLine(current[current.length - 1] ?? '')) {
        pushCurrent();
      }

      current.push(trimmed);
      continue;
    }

    current.push(trimmed);
  }

  pushCurrent();
  return blocks;
}

function splitOversizedBlock(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) {
    return [block];
  }

  const sentenceParts = block
    .split(/(?<=[.!?;:])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentenceParts.length === 0) {
    return [block.slice(0, maxChars), block.slice(maxChars)].filter(Boolean);
  }

  const segments: string[] = [];
  let buffer = '';

  for (const sentence of sentenceParts) {
    if (!buffer) {
      buffer = sentence;
      continue;
    }

    if (`${buffer} ${sentence}`.length <= maxChars) {
      buffer = `${buffer} ${sentence}`;
      continue;
    }

    segments.push(buffer.trim());
    buffer = sentence;
  }

  if (buffer.trim()) {
    segments.push(buffer.trim());
  }

  return segments;
}

function scoreSentence(sentence: string): number {
  const normalized = sentence.toLowerCase();
  let score = 0;

  for (const keyword of UNDERWRITING_KEYWORDS) {
    if (normalized.includes(keyword)) {
      score += 2;
    }
  }

  if (/\b(shall|must|cannot|may not|only if|unless)\b/.test(normalized)) {
    score += 2;
  }

  if (/\b\d+\b/.test(normalized)) {
    score += 1;
  }

  return score;
}

function distillInsight(block: string): string {
  const sentences = block
    .split(/(?<=[.!?;:])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length === 0) {
    return block.slice(0, 340).trim();
  }

  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: scoreSentence(sentence) }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    });

  const picked = ranked.slice(0, Math.min(2, ranked.length)).sort((left, right) => left.index - right.index);
  const summary = picked.map((entry) => entry.sentence).join(' ').replace(/\s+/g, ' ').trim();

  if (summary.length <= 340) {
    return summary;
  }

  return `${summary.slice(0, 337).trimEnd()}...`;
}

export function buildKnowledgeInsights(rawText: string, insightSize = 450, overlap = 0): RashiInsight[] {
  const normalized = normalizeText(rawText);
  if (!normalized) {
    return [];
  }

  const minInsightSize = 150;
  const maxInsightSize = Math.max(insightSize, 220);
  const overlapSize = Math.max(0, overlap);
  const blocks = splitSemanticBlocks(normalized);

  const collected: string[] = [];
  let carry = '';

  for (const block of blocks) {
    const parts = splitOversizedBlock(block, maxInsightSize);

    for (const part of parts) {
      const cleanPart = part.replace(/\s+/g, ' ').trim();
      if (!cleanPart) {
        continue;
      }

      if (!carry) {
        carry = cleanPart;
        continue;
      }

      if (carry.length < minInsightSize && `${carry} ${cleanPart}`.length <= maxInsightSize) {
        carry = `${carry} ${cleanPart}`;
        continue;
      }

      collected.push(carry.trim());

      if (overlapSize > 0) {
        const overlapText = carry.slice(Math.max(0, carry.length - overlapSize)).trim();
        carry = overlapText ? `${overlapText} ${cleanPart}`.trim() : cleanPart;
      } else {
        carry = cleanPart;
      }
    }
  }

  if (carry.trim()) {
    if (collected.length > 0 && carry.length < 110 && `${collected[collected.length - 1]} ${carry}`.length <= maxInsightSize) {
      collected[collected.length - 1] = `${collected[collected.length - 1]} ${carry}`.trim();
    } else {
      collected.push(carry.trim());
    }
  }

  const insights: RashiInsight[] = [];
  let index = 0;

  for (const entry of collected) {
    if (!entry) {
      continue;
    }

    const concise = distillInsight(entry);
    insights.push({ index, content: concise, semanticText: entry });
    index += 1;
  }

  return insights;
}

export function buildDeterministicEmbedding(input: string, dimension = RASHI_EMBEDDING_DIMENSION): number[] {
  const vector = Array.from({ length: dimension }, () => 0);
  const tokens = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    const slot = Math.abs(hash) % dimension;
    vector[slot] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return vector;
  }

  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const dimension = Math.min(left.length, right.length);
  if (dimension === 0) {
    return 0;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < dimension; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
