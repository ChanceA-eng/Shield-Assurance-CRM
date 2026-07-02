import { NextRequest, NextResponse } from 'next/server';
import { analyzeRashiDocument } from '../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ExtractAction = 'APPETITE' | 'ELIGIBILITY' | 'EXCLUSIONS' | 'DECISION';

function actionLabel(action: ExtractAction): string {
  if (action === 'APPETITE') return 'Appetite';
  if (action === 'ELIGIBILITY') return 'Eligibility';
  if (action === 'EXCLUSIONS') return 'Exclusions';
  return 'Summary';
}

function normalizeExtractionOutput(input: string): string {
  const compact = input.replace(/\r/g, '').trim();
  if (!compact) {
    return 'No actionable underwriting output returned.';
  }

  const lines = compact
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let next = line;

      // Remove whole-line markdown wrappers that make output noisy.
      next = next.replace(/^\*{1,2}\s*(.+?)\s*\*{1,2}$/u, '$1');
      next = next.replace(/^`{1,3}\s*(.+?)\s*`{1,3}$/u, '$1');

      // Keep targeted emphasis only on meaningful fragments.
      next = next.replace(/\*{3,}/g, '**');
      return next;
    });

  return lines.join('\n\n');
}

function normalizeActionType(actionType: string): ExtractAction | null {
  const normalized = actionType.trim().toUpperCase();

  if (normalized === 'APPETITE') return 'APPETITE';
  if (normalized === 'ELIGIBILITY') return 'ELIGIBILITY';
  if (normalized === 'EXCLUSIONS') return 'EXCLUSIONS';
  if (normalized === 'SUMMARY' || normalized === 'DECISION') return 'DECISION';

  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const documentId = typeof body.documentId === 'string' ? body.documentId.trim() : '';
    const actionTypeRaw = typeof body.actionType === 'string' ? body.actionType : '';
    const action = normalizeActionType(actionTypeRaw);

    if (!documentId) {
      return NextResponse.json({ message: 'documentId is required.' }, { status: 400 });
    }

    if (!action) {
      return NextResponse.json({ message: 'Invalid actionType.' }, { status: 400 });
    }

    const analysis = await analyzeRashiDocument(documentId, action);
    const formattedSummary = normalizeExtractionOutput(analysis.summary);

    return NextResponse.json(
      {
        success: true,
        documentId: analysis.documentId,
        documentTitle: analysis.documentTitle,
        action: analysis.action,
        currentActionLabel: actionLabel(action),
        summary: formattedSummary,
        citations: analysis.citations,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to run extraction.' },
      { status: 500 },
    );
  }
}
