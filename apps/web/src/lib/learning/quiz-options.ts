import { Prisma } from '@prisma/client';

export interface QuizOption {
  text: string;
  explanation?: string;
}

export function normalizeQuizOptions(input: unknown): QuizOption[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalized: QuizOption[] = [];

  for (const item of input) {
    if (typeof item === 'string') {
      const text = item.trim();
      if (text) {
        normalized.push({ text });
      }
      continue;
    }

    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const textValue = typeof (item as { text?: unknown }).text === 'string'
        ? (item as { text: string }).text.trim()
        : '';
      if (!textValue) {
        continue;
      }

      const explanationValue = typeof (item as { explanation?: unknown }).explanation === 'string'
        ? (item as { explanation: string }).explanation.trim()
        : '';

      normalized.push({
        text: textValue,
        ...(explanationValue ? { explanation: explanationValue } : {}),
      });
    }
  }

  return normalized;
}

export function optionsToJsonPayload(input: unknown): QuizOption[] {
  const normalized = normalizeQuizOptions(input);
  return normalized;
}

export function optionsToInputJson(input: unknown): Prisma.InputJsonValue {
  return optionsToJsonPayload(input) as unknown as Prisma.InputJsonValue;
}
