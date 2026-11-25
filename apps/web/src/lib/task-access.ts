import type { RequestAccess } from './team-request-access';

export type TaskScope = 'agency' | 'assigned' | 'self';

export function taskScope(access: RequestAccess | undefined, permission: 'tasks.view' | 'tasks.edit'): TaskScope | null {
  if (access?.mode === 'legacy') return 'agency';
  const scope = access?.mode === 'restricted' ? access.grants[permission] : null;
  return scope === 'agency' || scope === 'assigned' || scope === 'self' ? scope : null;
}
