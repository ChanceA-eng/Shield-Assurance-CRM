import { databaseError } from './workspace-api';
import { WorkspaceError } from './record-scope';

export function socialDatabaseError(error: { message: string; code?: string }): WorkspaceError {
  if (error.code === 'PT429') return new WorkspaceError(error.message, 429);
  if (['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code ?? '')) {
    console.error('[social-marketing/schema]', error);
    return new WorkspaceError('Social Marketing schema is behind. Apply the approved Social Marketing migrations for drafts (20261105120000), media (20261105140000), reviews (20261105170000), engine (20261105220000), Meta connections (20261106040000), link posts (20261109190000), and live publishing (20261109200000), then reload the database schema.', 503);
  }
  return databaseError(error);
}
