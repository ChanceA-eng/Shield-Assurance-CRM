import type { TeamPermission } from '@crm/shared';

export type TeamRoutePolicy =
  | { kind: 'permission'; permissions: readonly TeamPermission[]; recordScoped: boolean }
  | { kind: 'handler'; handler: 'personal' | 'shell' | 'tasks' | 'calendar' | 'agency' | 'social' | 'templates' | 'records' }
  | { kind: 'external'; authorization: string };

type Methods = Readonly<Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS', TeamRoutePolicy>>>;
interface RoutePolicy { route: string; methods: Methods }
const registry: RoutePolicy[] = [];
const permission = (value: TeamPermission, recordScoped = true): TeamRoutePolicy => ({ kind: 'permission', permissions: [value], recordScoped });
const handler = (value: Extract<TeamRoutePolicy, { kind: 'handler' }>['handler']): TeamRoutePolicy => ({ kind: 'handler', handler: value });
const external = (authorization: string): TeamRoutePolicy => ({ kind: 'external', authorization });
function routes(paths: readonly string[], methods: Methods): void {
  for (const route of paths) {
    if (registry.some((entry) => entry.route === route)) throw new Error(`Duplicate team route policy: ${route}`);
    registry.push({ route, methods });
  }
}

routes(['/account'], { GET: handler('personal'), PATCH: handler('personal') });
routes(['/account/email', '/account/password'], { POST: handler('personal') });
routes(['/agency'], { GET: handler('agency'), POST: handler('agency'), PUT: handler('agency'), PATCH: handler('agency') });
routes(['/agency/assignment', '/agency/sender', '/agency/time-zone'], { GET: handler('agency') });
routes(['/agency/outreach'], { GET: permission('agency.manage', false), POST: permission('agency.manage', false) });
routes(['/ai/draft-message'], { POST: permission('messages.send') });
routes(['/ai/extract-flags', '/ai/summarize'], { POST: handler('records') });
routes(['/ai/generate-tasks'], { POST: handler('tasks') });
routes(['/appointments'], { GET: handler('calendar') });
routes(['/assets/list'], { GET: handler('records') });
routes(['/assets/create'], { POST: handler('records') });
routes(['/automation/email-test'], { POST: permission('automation.manage', false) });
routes(['/automation/health'], { GET: permission('automation.view', false) });
routes(['/automation/run'], { GET: permission('automation.view', false), POST: permission('automation.manage', false) });
routes(['/billing-records', '/certificates', '/claims', '/endorsements', '/policies', '/policy-change-requests'], {
  GET: permission('policies.view'), POST: permission('policies.edit'), PATCH: permission('policies.edit'), DELETE: permission('policies.delete'),
});
routes(['/briefing', '/metrics/home', '/recent'], { GET: permission('dashboard.view') });
routes(['/carrier-appetite'], { GET: permission('knowledge.view', false), POST: permission('knowledge.edit', false) });
routes(['/clients'], { GET: permission('accounts.view'), POST: permission('accounts.edit'), PATCH: permission('accounts.edit'), DELETE: permission('accounts.delete') });
routes(['/clients/directory', '/clients/[clientId]', '/clients/[clientId]/context', '/clients/[clientId]/workspace'], { GET: permission('accounts.view') });
routes(['/clients/[clientId]/activities'], { GET: permission('accounts.view'), POST: permission('accounts.edit') });
routes(['/clients/[clientId]/assets'], { GET: permission('accounts.view'), POST: permission('accounts.edit'), PATCH: permission('accounts.edit'), DELETE: permission('accounts.edit') });
routes(['/clients/[clientId]/client-tasks'], { GET: handler('tasks'), POST: handler('tasks'), PATCH: handler('tasks'), DELETE: handler('tasks') });
routes(['/clients/[clientId]/files'], { GET: permission('documents.view'), POST: permission('documents.edit'), PATCH: permission('documents.edit'), DELETE: permission('documents.delete') });
routes(['/clients/[clientId]/files/upload', '/clients/[clientId]/files/upload/complete'], { POST: permission('documents.edit') });
routes(['/clients/[clientId]/files/[fileId]/download'], { GET: permission('documents.view') });
routes(['/clients/[clientId]/tags'], { GET: permission('accounts.view'), POST: permission('accounts.edit'), DELETE: permission('accounts.edit') });
routes(['/communication/inbox', '/communication-log/delivery', '/communication-log/unread', '/communication-log/unread-by-lead'], { GET: permission('messages.view') });
routes(['/communication-log/mark-read'], { POST: permission('messages.view') });
routes(['/communication-log'], { GET: permission('messages.view'), POST: permission('messages.send'), PATCH: permission('messages.view') });
routes(['/communication/scheduled', '/leads/[id]/scheduled-messages'], {
  GET: permission('messages.view', false), POST: permission('messages.send', false), DELETE: permission('messages.send', false),
});
routes(['/scheduled-messages'], { GET: permission('messages.view'), POST: permission('messages.send'), PATCH: permission('messages.send'), DELETE: permission('messages.send') });
routes(['/email/consent'], { POST: permission('campaigns.send', false) });
routes(['/events'], { GET: handler('calendar'), POST: handler('calendar'), PATCH: handler('calendar') });
routes(['/events/[eventId]/confirmation', '/events/[eventId]/sync'], { POST: handler('calendar') });
routes(['/gmail'], { GET: handler('personal'), DELETE: handler('personal') });
routes(['/gmail/connect', '/gmail/sync'], { POST: { kind: 'permission', permissions: ['messages.view', 'integrations.manage'], recordScoped: true } });
routes(['/gmail/callback'], { GET: handler('personal') });
routes(['/gmail/threads'], { GET: permission('messages.view'), POST: permission('messages.view') });
routes(['/google-calendar', '/zoom'], { GET: handler('personal'), DELETE: handler('personal') });
routes(['/google-calendar/connect', '/google-calendar/freebusy', '/zoom/connect'], { POST: handler('calendar') });
routes(['/import'], { GET: permission('leads.import', false), POST: permission('leads.import', false) });
routes(['/import/repair', '/import/[batchId]/commit'], { POST: permission('leads.import', false) });
routes(['/import/[batchId]'], { GET: permission('leads.import', false), PATCH: permission('leads.import', false), DELETE: permission('leads.import', false) });
routes(['/instantly/campaigns'], { GET: permission('campaigns.view', false), POST: permission('campaigns.send', false) });
routes(['/instantly/campaigns/[id]'], { POST: permission('campaigns.send', false) });
routes(['/intelligence/acquire', '/intelligence/business-search', '/intelligence/capture'], { POST: permission('leads.prospect', false) });
routes(['/intelligence/business-search-options', '/intelligence/map-tiles/[z]/[x]/[y]'], { GET: permission('leads.prospect', false) });
routes(['/intelligence/business-research', '/intelligence/dossier', '/intelligence/opportunities', '/intelligence/public-records'], { GET: handler('records'), POST: handler('records') });
routes(['/intelligence/business-research/google', '/intelligence/questionnaire'], { POST: handler('records') });
routes(['/intelligence/business-research-settings', '/intelligence/operations', '/intelligence/sources'], { GET: permission('automation.view', false), POST: permission('automation.manage', false) });
routes(['/intelligence/candidates'], { GET: permission('leads.prospect', false), PATCH: permission('leads.prospect', false) });
routes(['/intelligence/opportunities/send'], { POST: permission('campaigns.send', false) });
routes(['/intelligence/searches'], { GET: permission('leads.prospect', false), POST: permission('leads.prospect', false), DELETE: permission('leads.prospect', false) });
routes(['/interactions'], { GET: handler('records'), POST: handler('records'), PATCH: handler('records') });
routes(['/leads'], { GET: permission('leads.view'), POST: external('Website intake or authenticated lead creation'), PATCH: permission('leads.edit'), DELETE: permission('leads.delete'), OPTIONS: external('Website intake CORS') });
routes(['/leads/create'], { POST: external('Website intake or authenticated lead creation'), OPTIONS: external('Website intake CORS') });
routes(['/leads/archive', '/leads/merge'], { POST: permission('leads.delete') });
routes(['/leads/attention'], { GET: permission('leads.view'), PATCH: permission('leads.edit') });
routes(['/leads/duplicates', '/leads/stats', '/leads/[id]'], { GET: permission('leads.view') });
routes(['/leads/intake'], { GET: permission('leads.view'), POST: permission('leads.edit') });
routes(['/leads/upload'], { POST: permission('leads.import', false) });
routes(['/leads/[id]/conversation'], { GET: permission('messages.view') });
routes(['/leads/[id]/draft-outreach'], { POST: permission('messages.send') });
routes(['/leads/[id]/enrich'], { POST: permission('leads.edit') });
routes(['/leads/[id]/prospecting-cadence'], { GET: permission('campaigns.view'), POST: permission('campaigns.send'), PATCH: permission('campaigns.send') });
routes(['/leads/[id]/status'], { PATCH: permission('leads.edit') });
routes(['/leads/[id]/workspace'], { GET: permission('leads.view'), POST: handler('records') });
routes(['/learning/blocks/create', '/learning/blocks/delete', '/learning/blocks/update',
  '/learning/courses/create', '/learning/courses/delete', '/learning/courses/import/contractor-liability-master', '/learning/courses/update',
  '/learning/lessons/create', '/learning/lessons/delete', '/learning/lessons/duplicate', '/learning/lessons/update',
  '/learning/modules/create', '/learning/modules/delete', '/learning/modules/duplicate', '/learning/modules/update',
  '/learning/quizzes/create', '/learning/quizzes/delete', '/learning/quizzes/update',
  '/learning/snapshots/create', '/learning/snapshots/restore'], { POST: permission('knowledge.edit', false) });
routes(['/learning/courses/list', '/learning/lessons/get', '/learning/progress/get'], { GET: permission('knowledge.view', false) });
routes(['/learning/snapshots/list'], { GET: permission('knowledge.edit', false) });
routes(['/learning/progress/update', '/learning/quizzes/submit'], { POST: permission('knowledge.view', false) });
routes(['/learning/static-assessments/[moduleNumber]'], { GET: permission('knowledge.view', false), POST: permission('knowledge.view', false) });
routes(['/metrics/tasks'], { GET: handler('tasks') });
routes(['/notifications'], { GET: handler('shell'), PATCH: handler('shell'), POST: handler('shell') });
routes(['/outreach/enroll'], { GET: permission('campaigns.view'), POST: permission('campaigns.send') });
routes(['/outreach/enrollments/[id]', '/outreach/outbox/[id]'], { PATCH: permission('campaigns.send') });
routes(['/outreach/outbox/[id]/rewrite', '/outreach/run'], { POST: permission('campaigns.send') });
routes(['/outreach/profile'], { GET: handler('records'), PUT: handler('records') });
const outreachSettingsPolicy: TeamRoutePolicy = { kind: 'permission', permissions: ['automation.manage', 'agency.manage'], recordScoped: false };
routes(['/outreach'], { GET: permission('campaigns.view'), PATCH: outreachSettingsPolicy });
routes(['/placement-documents', '/policy-change-requests/documents'], { GET: permission('documents.view'), POST: permission('documents.edit') });
routes(['/policies/history', '/policies/identity', '/policies/insured-assets', '/policies/prefill', '/renewals'], { GET: permission('policies.view') });
routes(['/policy-knowledge'], { GET: permission('knowledge.view'), POST: permission('knowledge.edit'), PATCH: permission('knowledge.edit') });
routes(['/questionnaires/files/[fileId]'], { GET: handler('records') });
routes(['/questionnaires'], { GET: permission('intake.manage'), POST: permission('intake.manage') });
routes(['/quote-options'], { GET: permission('policies.view'), POST: permission('policies.edit'), PATCH: permission('policies.edit') });
routes(['/rashi/analyze', '/rashi/chat', '/rashi/extract', '/rashi/query'], { POST: handler('records') });
routes(['/rashi/documents'], { GET: permission('knowledge.view', false), POST: permission('knowledge.edit', false) });
routes(['/rashi/documents/[documentId]/reingest', '/rashi/ingest', '/rashi/learn'], { POST: permission('knowledge.edit', false) });
routes(['/rashi/documents/[documentId]', '/rashi/documents/[documentId]/view', '/rashi/stats'], { GET: permission('knowledge.view', false) });
routes(['/rashi/documents/[documentId]/source-file'], { PATCH: permission('knowledge.edit', false) });
routes(['/rashi/sheets'], { GET: permission('knowledge.view', false), POST: permission('knowledge.edit', false) });
routes(['/rashi/sheets/[sheetId]'], { GET: permission('knowledge.view', false), PUT: permission('knowledge.edit', false) });
routes(['/record-activity'], { GET: handler('records') });
routes(['/staff-records'], { GET: handler('records') });
routes(['/staff-policy-requests'], { GET: handler('records'), POST: handler('records'), PATCH: handler('records') });
routes(['/record-assets'], { GET: handler('records'), POST: handler('records'), PATCH: handler('records') });
routes(['/record-contact-preference'], { GET: handler('records'), PUT: handler('records') });
routes(['/renewals/reviews'], { POST: permission('policies.edit'), PATCH: permission('policies.edit') });
routes(['/reports', '/reports/[reportSlug]'], { GET: handler('records') });
routes(['/sales-sequences'], { GET: permission('campaigns.view', false), POST: permission('automation.manage', false), PATCH: permission('automation.manage', false) });
routes(['/sales-templates'], { GET: handler('templates'), PATCH: handler('templates'), POST: handler('templates') });
routes(['/sales-templates/banner'], { POST: handler('templates') });
routes(['/account/signature-image'], { POST: handler('personal') });
routes(['/settings/account-email'], { GET: permission('team.manage', false), POST: permission('team.manage', false) });
routes(['/settings/automation', '/settings/automation/scheduler'], { GET: permission('automation.view', false), PATCH: permission('automation.manage', false) });
routes(['/settings/automation/rules', '/settings/automation/rules/backlog'], { GET: permission('automation.view', false), POST: permission('automation.manage', false) });
routes(['/settings/email'], { GET: permission('integrations.manage', false), POST: permission('integrations.manage', false) });
routes(['/settings/integrations'], { GET: permission('integrations.manage', false) });
routes(['/settings/outreach'], { GET: permission('agency.manage', false), PATCH: outreachSettingsPolicy });
routes(['/shell'], { GET: handler('shell') });
routes(['/social-marketing/captions', '/social-marketing/connections', '/social-marketing/drafts', '/social-marketing/engine', '/social-marketing/media'], { GET: handler('social'), POST: handler('social') });
routes(['/social-marketing/connections/callback'], { GET: handler('social') });
routes(['/social-marketing/connections/oauth', '/social-marketing/reviews'], { POST: handler('social') });
routes(['/tasks'], { GET: handler('tasks'), POST: handler('tasks'), PATCH: handler('tasks') });
routes(['/tasks/[taskId]', '/tasks/bulk-reschedule'], { PATCH: handler('tasks') });
routes(['/vehicles'], { GET: handler('records') });
routes(['/workday'], { GET: handler('tasks'), PATCH: handler('tasks') });
routes(['/workers-comp'], { GET: handler('records'), PUT: handler('records'), DELETE: handler('records'), POST: handler('records') });

routes(['/appointments/manage/[token]', '/questionnaire/[token]', '/intelligence/questionnaire/[token]'], { GET: external('Verified recipient token and session'), POST: external('Verified recipient token and session') });
routes(['/auth/confirm', '/auth/recovery'], { POST: external('Account recovery or confirmation challenge') });
routes(['/cron/heartbeat', '/cron/intelligence', '/gmail/sync/worker'], { POST: external('Scheduler bearer secret') });
routes(['/cron/outreach', '/cron/sync-leads', '/messages/process-scheduled'], { GET: external('Scheduler bearer secret') });
routes(['/email/resend'], { POST: external('Signed email-provider webhook') });
routes(['/email/unsubscribe'], { GET: external('Signed unsubscribe token'), POST: external('Signed unsubscribe token') });
routes(['/gmail/push'], { POST: external('Verified Pub/Sub identity') });
routes(['/google-calendar/callback', '/zoom/callback'], { GET: external('Single-use OAuth state bound to initiating user') });
routes(['/instantly/webhook', '/messages/sms-webhook', '/messages/webhook'], { POST: external('Verified provider webhook') });

export const TEAM_API_ROUTE_POLICIES: readonly RoutePolicy[] = registry;
const matchers = registry.map((entry) => ({
  ...entry,
  pattern: new RegExp(`^/api${entry.route.split('/').map((part) => part.startsWith('[') && part.endsWith(']')
    ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')}/?$`),
})).sort((left, right) => left.route.split('[').length - right.route.split('[').length);

export function teamApiRoutePolicy(pathname: string, method: string): TeamRoutePolicy | null {
  const entry = matchers.find((candidate) => candidate.pattern.test(pathname));
  if (!entry) return null;
  const verb = method === 'HEAD' ? 'GET' : method;
  return entry.methods[verb as keyof Methods] ?? null;
}
