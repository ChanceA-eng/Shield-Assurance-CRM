import { NextRequest } from 'next/server';

export function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}

export async function parseJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {};
  }

  return body as Record<string, unknown>;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

export function coercePercent(value: unknown): number {
  const parsed = asInteger(value);
  if (parsed === null) {
    return 0;
  }

  return Math.max(0, Math.min(100, parsed));
}
