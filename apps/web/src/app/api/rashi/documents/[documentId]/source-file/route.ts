import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { uploadRashiSourceFile } from '../../../../../../lib/rashi-storage';
import { assertRegularRashiSource } from '../../../../../../lib/rashi-server';
import { workspaceApiError } from '../../../../../../lib/workspace-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  try {
    const { documentId } = await context.params;
    await assertRegularRashiSource(documentId);
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
    return workspaceApiError(error, 'rashi/source-file');
  }
}
