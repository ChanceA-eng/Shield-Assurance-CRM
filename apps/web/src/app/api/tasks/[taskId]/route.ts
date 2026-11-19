import { NextRequest, NextResponse } from 'next/server';
import { PATCH as updateTask } from '../route';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';

export async function PATCH(request: NextRequest, context: { params: Promise<{ taskId: string }> }): Promise<NextResponse> {
  try {
    const body = await workspaceBody(request), { taskId } = await context.params;
    return updateTask(new NextRequest(request.url, {
      method: 'PATCH', headers: request.headers, body: JSON.stringify({ ...body, id: taskId }),
    }));
  } catch (error) { return workspaceApiError(error, 'tasks/patch'); }
}
