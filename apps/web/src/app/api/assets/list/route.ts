import { NextResponse } from 'next/server';
import { listRashiDocuments } from '../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface KnowledgeAssetResponse {
  id: string;
  title: string;
  type: string;
  category: string;
  url: string | null;
  indexed: boolean;
  internal: boolean;
  updatedAt: string;
}

function mapType(sourceType: string): string {
  if (sourceType === 'PDF') return 'pdf';
  if (sourceType === 'VIDEO_TRANSCRIPT') return 'video';
  if (sourceType === 'LINK' || sourceType === 'ARTICLE') return 'doc';
  if (sourceType === 'NOTE') return 'manual';
  return 'doc';
}

function mapCategory(document: {
  sourceType: string;
  carrierName: string | null;
  stateContext: string | null;
  topic: string | null;
}): string {
  const topic = (document.topic ?? '').toLowerCase();
  if (document.sourceType === 'VIDEO_TRANSCRIPT' || topic.includes('training') || topic.includes('walkthrough')) {
    return 'training_video';
  }

  if (document.stateContext || topic.includes('state') || topic.includes('regulation')) {
    return 'state_manual';
  }

  if (document.carrierName || topic.includes('appetite') || topic.includes('carrier')) {
    return 'carrier_appetite';
  }

  return 'reference';
}

export async function GET(): Promise<NextResponse> {
  try {
    const documents = await listRashiDocuments({});

    const assets: KnowledgeAssetResponse[] = documents.map((document) => ({
      id: document.id,
      title: document.title,
      type: mapType(document.sourceType),
      category: mapCategory(document),
      url: document.sourceUrl,
      indexed: document.status === 'READY',
      internal: true,
      updatedAt: document.updatedAt.toISOString(),
    }));

    return NextResponse.json({ assets }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to list knowledge assets.' },
      { status: 500 },
    );
  }
}
