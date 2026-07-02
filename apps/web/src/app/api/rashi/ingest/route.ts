import { NextRequest, NextResponse } from 'next/server';
import { extractTextFromUpload, ingestRashiDocument } from '../../../../lib/rashi-server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const maxDuration = 60;

function sanitizeFileName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function saveUploadToPublic(file: File): Promise<string> {
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'rashi');
  await mkdir(uploadsDir, { recursive: true });

  const baseName = sanitizeFileName(file.name || 'asset-upload');
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName || 'asset-upload'}`;
  const absolutePath = path.join(uploadsDir, uniqueName);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, buffer);

  return `/uploads/rashi/${uniqueName}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    const isMultipart = contentType.includes('multipart/form-data');

    if (isMultipart) {
      const formData = await request.formData();
      const file = formData.get('file');
      const rawTextField = formData.get('rawText');
      const extractedText = file instanceof File ? await extractTextFromUpload(file) : '';
      const rawText = (typeof rawTextField === 'string' ? rawTextField : '') || extractedText;
      const generatedSourceUrl = file instanceof File ? await saveUploadToPublic(file) : undefined;
      const providedSourceUrl = String(formData.get('sourceUrl') ?? '') || undefined;

      const payload = await ingestRashiDocument({
        title: String(formData.get('title') ?? ''),
        sourceType: String(formData.get('sourceType') ?? 'NOTE'),
        sourceUrl: providedSourceUrl ?? generatedSourceUrl,
        rawText,
        carrierName: String(formData.get('carrierName') ?? '') || undefined,
        stateContext: String(formData.get('stateContext') ?? '') || undefined,
        policyType: String(formData.get('policyType') ?? '') || undefined,
        topic: String(formData.get('topic') ?? '') || undefined,
      });

      return NextResponse.json(payload, { status: 201 });
    }

    const body = await request.json();
    const payload = await ingestRashiDocument({
      title: body.title,
      rawText: body.rawText,
      sourceType: body.sourceType,
      sourceUrl: body.sourceUrl,
      carrierName: body.carrierName,
      stateContext: body.stateContext,
      policyType: body.policyType,
      topic: body.topic,
    });

    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to ingest into Rashi.' },
      { status: 500 },
    );
  }
}