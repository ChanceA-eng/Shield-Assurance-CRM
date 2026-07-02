import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { uploadRashiSourceFile } from '../../../../../../lib/rashi-storage';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

    const sourceUrl = (await uploadRashiSourceFile(file, 'source-files')).publicUrl;

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
