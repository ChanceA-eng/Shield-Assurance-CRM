import { test as base, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { WorkspaceAsset, WorkspaceNote, WorkspaceTask } from '@crm/shared';
import { isRecord, isUuid } from '../src/lib/workspace-validation';
import { namedTaskSubject } from '../src/lib/record-scope';
import { directoryRows, type DirectoryFilter } from '../src/lib/client-directory';

const root = path.resolve(__dirname, '..', '..', '..');
const dotenv: { config: (options: { path: string }) => void } = require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] }));
dotenv.config({ path: path.join(root, 'apps', 'web', '.env.local') });

export const leadId = 'f4a2328d-48d3-4be9-9896-81e69d8ea4f6';
const firstClientId = 'd0b0cd9e-31fb-4a1e-99ab-cd33220adca5';
interface TestAccount { id: string; full_name: string; email: null; phone: string; address: string; source: string; created_at: string }
interface Arrival {
  intake_id: string; id: string; full_name: string; line_of_business: string; business_name: string; industry: string;
  arrived_at: string; time_basis: string; request_kind: string;
}

export class WorkspaceData {
  account: TestAccount = { id: firstClientId, full_name: 'Leo Example', email: null, phone: '+15205550100', address: '123 Test Street', source: 'website', created_at: new Date().toISOString() };
  linked = false;
  notes: WorkspaceNote[] = [];
  assets: WorkspaceAsset[] = [];
  policies: Array<Record<string, unknown>> = [];
  tasks: WorkspaceTask[] = [];
  arrivals: Arrival[] = [];
  failNoteAfterCommit = false;
  noteSaveIds: unknown[] = [];
  unexpected: string[] = [];
  requests: string[] = [];
  intakeBodies: Array<Record<string, unknown>> = [];
  unreadMessages: { total: number; byClient: Record<string, number>; byLead: Record<string, number> } = { total: 0, byClient: {}, byLead: {} };
  private counter = 0;
  lead = {
    id: leadId, full_name: 'Leo Example', email: 'leo@example.invalid', phone: '+15205550100', address: '123 Test Street',
    source: 'website', line_of_business: 'Commercial', status: 'new', industry: 'retail', business: 'Example Shop',
    created_at: new Date().toISOString(), stage_changed_at: new Date().toISOString(), last_viewed_at: null,
    last_activity_at: new Date().toISOString(), estimated_premium: null, account_id: null as string | null,
    form_payload: { message: 'Business: Example Shop\nIndustry: Retail\nVehicles: Three trucks\nContact method: Phone', submitted_at: '2026-10-31T16:30:00Z', metadata: { businessName: 'Example Shop', businessReview: { industry: 'retail' } } },
  };

  constructor() {
    this.tasks.push({
      id: randomUUID(), subject: 'Leo Example: respond to website request', description: 'Review submitted answers and contact using the requested method.',
      due_date: new Date(Date.now() + 86400000).toISOString(), status: 'open', priority: 'high', kind: 'task',
      related_type: 'lead', related_id: leadId, related_name: 'Leo Example', account_id: null, note_id: null,
      completed_at: null, created_at: this.stamp(), updated_at: this.stamp(),
    });
  }
  stamp(): string { return new Date(Date.now() + ++this.counter).toISOString(); }
  addArrivals(count: number): void {
    this.arrivals = Array.from({ length: count }, (_, index) => ({
      intake_id: randomUUID(), id: index === 0 ? leadId : randomUUID(),
      full_name: index === 0 ? 'Leo Example' : `Unworked request ${index}`,
      line_of_business: 'Commercial', business_name: `Example shop ${index}`, industry: 'retail',
      arrived_at: new Date(Date.now() - index * 86400000).toISOString(), time_basis: 'submitted', request_kind: 'Website request',
    }));
  }
  private scoped(row: { lead_id?: string | null; client_id?: string | null; related_type?: string | null; related_id?: string | null; account_id?: string | null }, url: URL): boolean {
    const type = url.searchParams.get('record_type') ?? url.searchParams.get('related_type');
    const id = url.searchParams.get('record_id') ?? url.searchParams.get('related_id');
    if (!id) return type ? row.related_type === type : true;
    if (type === 'client') return row.client_id === id || row.account_id === id || row.related_type === 'client' && row.related_id === id;
    return row.lead_id === id || row.related_type === 'lead' && row.related_id === id
      || this.linked && id === leadId && (row.client_id === this.account.id || row.account_id === this.account.id);
  }
  private taskRows(url: URL): WorkspaceTask[] {
    const status = url.searchParams.get('status');
    return this.tasks.filter((task) => this.scoped(task, url) && (
      status === 'overdue' ? task.status === 'open' && task.due_date !== null && new Date(task.due_date).getTime() < Date.now()
        : !status || status === 'all' || task.status === status
    ));
  }
  handle(url: URL, method: string, body: Record<string, unknown>): { status?: number; json: unknown } {
    const key = `${method} ${url.pathname}`;
    this.requests.push(key);
    if (url.pathname === '/api/leads/attention') {
      if (method === 'GET') return { json: { leads: this.arrivals, total: this.arrivals.length } };
      const ids = Array.isArray(body.ids) ? body.ids : [body.id];
      this.arrivals = this.arrivals.filter((arrival) => !ids.includes(arrival.intake_id));
      return { json: { ok: true } };
    }
    if (url.pathname === '/api/notifications') return { json: url.searchParams.get('count') === 'true' ? { count: 0 } : method === 'GET' ? [] : { ok: true } };
    if (url.pathname === '/api/communication-log/unread') return { json: this.unreadMessages };
    if (url.pathname === '/api/communication-log/mark-read') {
      this.unreadMessages = { total: 0, byClient: {}, byLead: {} };
      return { json: { ok: true } };
    }
    if (url.pathname === '/api/tasks') {
      if (method === 'GET') {
        const rows = this.taskRows(url);
        const offset = Number(url.searchParams.get('offset') ?? '0');
        return { json: url.searchParams.get('count') === 'true' ? { count: rows.length } : rows.slice(offset, offset + Number(url.searchParams.get('limit') ?? '20')) };
      }
      if (method === 'PATCH') {
        const task = this.tasks.find((item) => item.id === body.id);
        if (!task) return { status: 404, json: { message: 'Task not found.' } };
        if (body.expected_updated_at && body.expected_updated_at !== task.updated_at) return { status: 409, json: { message: 'This task changed.' } };
        if (typeof body.status === 'string') { task.status = body.status; task.completed_at = body.status === 'completed' ? this.stamp() : null; }
        if (typeof body.due_date === 'string') task.due_date = body.due_date;
        if (typeof body.subject === 'string') task.subject = namedTaskSubject(this.lead.full_name, body.subject);
        task.updated_at = this.stamp();
        return { json: task };
      }
      const task = this.createTask(body);
      this.tasks.push(task);
      return { status: 201, json: task };
    }
    if (url.pathname === '/api/interactions') {
      if (method === 'GET') return { json: this.notes.filter((note) => this.scoped(note, url)).slice(Number(url.searchParams.get('page') ?? '0') * 100, (Number(url.searchParams.get('page') ?? '0') + 1) * 100) };
      if (method === 'PATCH') {
        const note = this.notes.find((item) => item.id === body.id);
        if (!note) return { status: 404, json: { message: 'Note not found.' } };
        if (body.expected_updated_at !== note.updated_at) return { status: 409, json: { message: 'This note changed.' } };
        if (typeof body.content === 'string') note.content = body.content;
        if (typeof body.pinned === 'boolean') note.pinned = body.pinned;
        note.updated_at = this.stamp();
        return { json: note };
      }
      this.noteSaveIds.push(body.id);
      let note = this.notes.find((item) => item.id === body.id);
      if (!note) {
        const created = this.stamp();
        note = {
          id: typeof body.id === 'string' ? body.id : randomUUID(), lead_id: typeof body.lead_id === 'string' ? body.lead_id : null,
          client_id: typeof body.client_id === 'string' ? body.client_id : this.linked ? this.account.id : null,
          content: String(body.content), note_type: 'call', pinned: false, author_name: 'Verification agent', updated_by: null, created_at: created, updated_at: created,
        };
        this.notes.push(note);
        if (isRecord(body.reminder)) this.tasks.push({ ...this.createTask({
          ...body.reminder, id: note.id, kind: 'reminder', description: note.content,
          related_type: note.lead_id ? 'lead' : 'client', related_id: note.lead_id ?? note.client_id,
        }), note_id: note.id });
      }
      if (this.failNoteAfterCommit) { this.failNoteAfterCommit = false; return { status: 503, json: { message: 'Temporary response failure. Retry your unchanged save.' } }; }
      return { status: 201, json: { ...note, reminder: this.tasks.find((task) => task.note_id === note.id) ?? null } };
    }
    if (url.pathname === '/api/record-assets') {
      if (method === 'GET') return { json: this.assets.filter((asset) => this.scoped(asset, url) && Boolean(asset.archived_at) === (url.searchParams.get('archived') === 'true')) };
      if (method === 'PATCH') {
        const asset = this.assets.find((item) => item.id === body.id);
        if (!asset) return { status: 404, json: { message: 'Asset not found.' } };
        if (body.expected_updated_at !== asset.updated_at) return { status: 409, json: { message: 'This asset changed.' } };
        if (body.action) asset.archived_at = body.action === 'archive' ? this.stamp() : null;
        else { asset.title = String(body.title); asset.metadata = { details: body.details, source: body.source }; }
        asset.updated_at = this.stamp();
        return { json: asset };
      }
      const asset: WorkspaceAsset = {
        id: typeof body.id === 'string' ? body.id : randomUUID(), title: String(body.title), asset_type: String(body.asset_type),
        lead_id: url.searchParams.get('record_type') === 'lead' ? leadId : null,
        client_id: url.searchParams.get('record_type') === 'client' ? this.account.id : this.linked ? this.account.id : null,
        value: null, metadata: { details: body.details, source: body.source, source_reference: body.source_reference },
        archived_at: null, created_at: this.stamp(), updated_at: this.stamp(), created_by: 'Verification agent', updated_by: null,
      };
      this.assets.push(asset);
      return { status: 201, json: asset };
    }
    if (url.pathname === '/api/record-activity') return { json: [] };
    if (url.pathname === '/api/clients') return { json: [this.account] };
    if (url.pathname === '/api/clients/directory') {
      const accounts = Array.from({ length: 30 }, (_, index) => ({ ...this.account, id: index === 0 ? this.account.id : `account-${index}`,
        full_name: index === 0 ? this.account.full_name : `Test Account ${String(index).padStart(2, '0')}`,
        assigned_producer: null, account_type: null }));
      const rows = directoryRows(accounts, [], [], new Map(), url.searchParams.get('q') ?? '', (url.searchParams.get('filter') ?? 'all') as DirectoryFilter);
      const page = Number(url.searchParams.get('page') ?? '0');
      return { json: { items: rows.slice(page * 25, page * 25 + 25), total: rows.length, page, page_size: 25 } };
    }
    if (url.pathname === `/api/leads/${leadId}/conversation` && method === 'GET') {
      return { json: { clientId: this.linked ? this.account.id : null, items: [] } };
    }
    if (url.pathname === `/api/leads/${leadId}/workspace`) {
      if (method === 'POST') {
        if (body.create) this.account = { ...this.account, id: randomUUID(), full_name: this.lead.full_name };
        this.linked = true;
        this.lead.account_id = this.account.id;
        this.notes.forEach((note) => { note.client_id = this.account.id; note.updated_at = this.stamp(); });
        this.assets.forEach((asset) => { asset.client_id = this.account.id; asset.updated_at = this.stamp(); });
        this.tasks.forEach((task) => { task.account_id = this.account.id; task.updated_at = this.stamp(); });
      }
      return { json: { clientId: this.linked ? this.account.id : null, clientName: this.linked ? this.account.full_name : null } };
    }
    if (url.pathname.endsWith('/workspace') && url.pathname.startsWith('/api/clients/')) return { json: {
      client: this.account, policies: this.policies, leads: this.linked ? [this.lead] : [],
      communications: [], scheduledMessages: [], notifications: [], timelineTasks: this.tasks,
      events: [], claims: [], endorsements: [], certificates: [], applications: [], campaigns: [],
      assets: this.assets, clientTasks: this.tasks, files: [], tags: [], activities: [],
    } };
    if (url.pathname === '/api/leads/intake') {
      if (method === 'GET') {
        const email = url.searchParams.get('email')?.toLowerCase();
        return { json: { matches: email && email === this.lead.email ? [{ type: 'lead', id: leadId, full_name: this.lead.full_name, business: null, email: this.lead.email, phone: this.lead.phone, address: this.lead.address, state: 'AZ', zip: null, status: 'new', line_of_business: 'personal', match: ['email'] }] : [] } };
      }
      this.intakeBodies.push(body);
      return { status: 201, json: { id: leadId } };
    }
    if (url.pathname === `/api/leads/${leadId}`) return { json: { ...this.lead, intake_event_ids: this.arrivals.filter((arrival) => arrival.id === leadId).map((arrival) => arrival.intake_id) } };
    if (url.pathname === '/api/leads') return { json: method === 'GET' ? [this.lead] : this.lead };
    if (url.pathname === '/api/leads/stats') return { json: { active: 1, won: 0, lost: 0, inactive: 0 } };
    if (url.pathname === '/api/outreach/enroll' && method === 'GET') return { json: { enrollment: null, outbox: [] } };
    if (url.pathname === '/api/communication-log/unread-by-lead') return { json: {} };
    if (url.pathname === '/api/communication-log/delivery' || url.pathname === '/api/policies' || url.pathname === '/api/recent') return { json: [] };
    if (url.pathname === '/api/renewals') return { json: { items: [], counts: { '30': 0, '60': 0, '90': 0, overdue: 0 } } };
    if (url.pathname === '/api/metrics/home') return { json: { total_written_premium: 0, active_leads: 1, lead_conversion_rate: 0, renewals_30_days: 0, open_claims: 0 } };
    if (url.pathname === '/api/briefing') return { json: { overdue_tasks: 0, today_tasks: [], today_tasks_count: 12, unread_messages: 0, pending_approvals: 0, new_leads_24h: 1, recent_replies: [], stalled_leads: 0, active_sequences: 0, summary: 'Review the current website request.' } };
    this.unexpected.push(key);
    return { status: 501, json: { message: `Unexpected browser fixture request: ${key}` } };
  }
  private createTask(body: Record<string, unknown>): WorkspaceTask {
    return {
      id: typeof body.id === 'string' ? body.id : randomUUID(), subject: namedTaskSubject(this.lead.full_name, String(body.subject)),
      description: typeof body.description === 'string' ? body.description : null,
      due_date: typeof body.due_date === 'string' ? body.due_date : null, status: 'open',
      priority: typeof body.priority === 'string' ? body.priority : 'medium', kind: body.kind === 'reminder' ? 'reminder' : 'task',
      related_type: typeof body.related_type === 'string' ? body.related_type : null, related_id: typeof body.related_id === 'string' ? body.related_id : null,
      related_name: body.related_id ? this.lead.full_name : null, account_id: this.linked || body.related_type === 'client' ? this.account.id : null,
      note_id: null, completed_at: null, created_at: this.stamp(), updated_at: this.stamp(),
    };
  }
}

export const test = base.extend<{ data: WorkspaceData }, { authCookies: Array<{ name: string; value: string }> }>({
  authCookies: [async ({}, use) => {
    if (process.env.CRM_BROWSER_QA_ALLOWED !== '1') throw new Error('Set CRM_BROWSER_QA_ALLOWED=1 to allow creating and removing a temporary browser-verification auth user.');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anon || !key) throw new Error('The local Supabase auth configuration is required for browser verification.');
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `crm-browser-${randomUUID()}@example.invalid`;
    const password = `${randomUUID()}${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Workspace verification', crm_browser_qa: true } });
    if (created.error || !created.data.user) throw new Error('Unable to create the temporary browser verification account.');
    const cookies: Array<{ name: string; value: string }> = [];
    try {
      const auth = createServerClient(url, anon, { cookies: {
        getAll: () => cookies,
        setAll: (values) => { for (const cookie of values) { const previous = cookies.findIndex((item) => item.name === cookie.name); if (previous >= 0) cookies.splice(previous, 1); cookies.push({ name: cookie.name, value: cookie.value }); } },
      } });
      const signedIn = await auth.auth.signInWithPassword({ email, password });
      if (signedIn.error || !signedIn.data.user || !cookies.length) throw new Error('Temporary verification sign-in failed.');
      await use(cookies);
    } finally {
      const removed = await admin.auth.admin.deleteUser(created.data.user.id);
      if (removed.error) throw new Error('Unable to remove the newly created browser-verification auth user.');
    }
  }, { scope: 'worker' }],
  context: async ({ browser, authCookies, baseURL }, use) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, timezoneId: 'Pacific/Honolulu' });
    await context.addCookies(authCookies.map((cookie) => ({ ...cookie, domain: new URL(baseURL ?? 'http://127.0.0.1:3000').hostname, path: '/', httpOnly: false, secure: false, sameSite: 'Lax' })));
    try {
      const [smoke, intake, clients, directory] = await Promise.all([
        context.request.get('/api/tasks?status=open&count=true'),
        context.request.get('/api/leads/attention'),
        context.request.get('/api/clients'),
        context.request.get('/api/clients/directory?q=&filter=all&page=0'),
      ]);
      expect(smoke.status(), 'Authenticated, read-only task API smoke check').toBe(200);
      const taskCount: unknown = await smoke.json();
      expect(isRecord(taskCount) && typeof taskCount.count === 'number', 'Task count response contract').toBe(true);
      expect(intake.status(), 'Authenticated, read-only intake queue smoke check').toBe(200);
      const queue: unknown = await intake.json();
      expect(isRecord(queue) && Array.isArray(queue.leads) && typeof queue.total === 'number', 'Intake queue response contract').toBe(true);
      if (isRecord(queue) && Array.isArray(queue.leads)) {
        const arrivals = queue.leads.map((item: unknown) => isRecord(item) && typeof item.arrived_at === 'string' ? Date.parse(item.arrived_at) : NaN);
        expect(arrivals.every((timestamp, index) => {
          const previous = arrivals[index - 1];
          return Number.isFinite(timestamp) && (index === 0 || typeof previous === 'number' && previous >= timestamp);
        }), 'The real intake API returns every arrival newest first').toBe(true);
      }
      expect(clients.status(), 'Authenticated, read-only account list smoke check').toBe(200);
      expect(directory.status(), 'Authenticated, read-only directory smoke check').toBe(200);
      const directoryData: unknown = await directory.json();
      expect(isRecord(directoryData) && Array.isArray(directoryData.items) && typeof directoryData.total === 'number', 'Directory pagination contract').toBe(true);
      const accounts: unknown = await clients.json();
      expect(Array.isArray(accounts), 'Account list response contract').toBe(true);
      const account: unknown = Array.isArray(accounts) ? accounts.find((item: unknown) => isRecord(item) && isUuid(item.id)) : undefined;
      if (!isRecord(account) || !isUuid(account.id)) throw new Error('The read-only workspace smoke check requires an existing account.');
      const workspace = await context.request.get(`/api/clients/${account.id}/workspace`);
      expect(workspace.status(), 'Authenticated, read-only account workspace smoke check').toBe(200);
      const accountWorkspace: unknown = await workspace.json();
      expect(isRecord(accountWorkspace) && isRecord(accountWorkspace.client) && Array.isArray(accountWorkspace.timelineTasks), 'Account workspace response contract').toBe(true);
      await use(context);
    } finally { await context.close(); }
  },
  data: async ({ context }, use) => {
    const data = new WorkspaceData();
    await context.route('**/api/**', async (route) => {
      const raw: unknown = route.request().method() === 'GET' ? {} : route.request().postDataJSON();
      const result = data.handle(new URL(route.request().url()), route.request().method(), isRecord(raw) ? raw : {});
      await route.fulfill({ status: result.status ?? 200, json: result.json });
    });
    await use(data);
    expect(data.unexpected, 'Every browser API request must have an explicit fixture, including accidental AI requests').toEqual([]);
  },
});
export { expect };
