// These GET handlers verify the session (and agency membership) themselves.
// Other methods and routes must retain the middleware authentication gate.
const SESSION_CHECKED_READS = new Set([
  '/api/shell',
  '/api/tasks',
  '/api/notifications',
  '/api/communication-log/unread',
  '/api/leads/attention',
  '/api/leads/stats',
  '/api/leads',
  '/api/clients',
  '/api/clients/directory',
  '/api/policies',
  '/api/metrics/home',
]);

export function authenticatesInReadHandler(pathname: string, method: string): boolean {
  return method === 'GET' && (SESSION_CHECKED_READS.has(pathname)
    || /^\/api\/clients\/[0-9a-f-]+\/workspace$/i.test(pathname));
}

export function isTeamActivationRequest(pathname: string, method: string, params: URLSearchParams): boolean {
  return pathname === '/api/agency' && (method === 'GET' || method === 'POST')
    && params.size === 1 && params.get('activation') === 'true';
}
