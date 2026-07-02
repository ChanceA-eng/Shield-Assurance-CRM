import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../../../../../lib/prisma';

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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  try {
    const { documentId } = await context.params;
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ message: 'A file is required.' }, { status: 400 });
    }

    const sourceUrl = await saveUploadToPublic(file);

    const updated = await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: {
        sourceUrl,
      },
      select: {
        id: true,
        sourceUrl: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to attach source file.' },
      { status: 500 },
    );
  }
}
