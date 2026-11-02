export interface TaskLinkInput {
  related_type?: string | null;
  related_id?: string | null;
  account_id?: string | null;
  action_href?: string | null;
}

export function taskRecordHref(task: TaskLinkInput): string | null {
  if (task.action_href?.startsWith('/') && !task.action_href.startsWith('//')) return task.action_href;
  const id = task.related_id;
  if (task.related_type === 'lead' && id) return `/leads?lead=${encodeURIComponent(id)}`;
  if (task.related_type === 'event' && id) return `/scheduler?event=${encodeURIComponent(id)}`;
  const accountId = task.related_type === 'client' ? id : task.account_id;
  if (accountId && id && ['claim', 'endorsement', 'certificate', 'policy', 'renewal_pipeline'].includes(task.related_type ?? '')) {
    const context = task.related_type === 'renewal_pipeline' ? 'policy' : task.related_type;
    return `/clients/${encodeURIComponent(accountId)}?tab=policies&context_type=${context}&context_id=${encodeURIComponent(id)}`;
  }
  if (accountId) return `/clients/${encodeURIComponent(accountId)}?tab=${task.related_type === 'policy' || task.related_type === 'renewal_pipeline' ? 'policies' : 'tasks'}`;
  return null;
}
