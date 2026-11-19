export type SocialReviewState = 'not_submitted' | 'awaiting_review' | 'approved' | 'changes_requested';
export const SOCIAL_REVIEW_LABELS: Record<SocialReviewState, string> = {
  not_submitted: 'Not submitted', awaiting_review: 'Awaiting review', approved: 'Content approved', changes_requested: 'Changes requested',
};
export interface SocialReviewEvent {
  revision: number;
  review_version: number;
  action: 'submit' | 'withdraw' | 'approve' | 'request_changes' | 'invalidated';
  actor_id: string;
  reason: string;
  recorded_at: string;
}
export interface SocialReviewCommand {
  id: string;
  action: 'submit' | 'withdraw' | 'approve' | 'request_changes';
  expected_revision: number;
  expected_review_version: number;
  reason: string;
}
export function validateSocialReviewCommand(value: unknown):
  { command: SocialReviewCommand; error: null } | { command: null; error: string } {
  const invalid = (error: string): { command: null; error: string } => ({ command: null, error });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Send a JSON review object.');
  const body: Record<string, unknown> = { ...value };
  if (Object.keys(body).some((key) => !['id','action','expected_revision','expected_review_version','reason'].includes(key))) {
    return invalid('An unsupported review field was supplied.');
  }
  const { id, action, expected_revision, expected_review_version } = body;
  const reason = body.reason ?? '';
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    || (action !== 'submit' && action !== 'withdraw' && action !== 'approve' && action !== 'request_changes')
    || typeof expected_revision !== 'number' || !Number.isInteger(expected_revision) || expected_revision < 1 || expected_revision >= 2147483647
    || typeof expected_review_version !== 'number' || !Number.isInteger(expected_review_version) || expected_review_version < 0 || expected_review_version >= 2147483647) {
    return invalid('Choose a valid review action and current versions.');
  }
  if (typeof reason !== 'string' || [...reason.trim()].length > 1000 || reason.includes('\u0000')
    || (action === 'request_changes' && !reason.trim()) || (['submit','withdraw'].includes(action) && reason !== '')) {
    return invalid('Explain requested changes in up to 1000 characters. Submit and withdraw do not accept notes.');
  }
  return { command: { id, action, expected_revision, expected_review_version, reason: reason.trim() }, error: null };
}
