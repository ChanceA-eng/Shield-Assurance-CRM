import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STARTER_TEAM_ROLES, TEAM_PERMISSIONS, TEAM_PERMISSION_DEPENDENCIES, resolveTeamAccess } from './team-access';

const owner = '11111111-1111-4111-8111-111111111111';
const admin = '22222222-2222-4222-8222-222222222222';
const producer = '33333333-3333-4333-8333-333333333333';
const invitee = '44444444-4444-4444-8444-444444444444';
const invitation = '55555555-5555-4555-8555-555555555555';
let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create table public.clients(id uuid primary key); create table public.leads(id uuid primary key);
    create table storage.objects(id uuid primary key,bucket_id text);
    alter table storage.objects enable row level security;
  `);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261102220000_agency_memberships.sql', import.meta.url), 'utf8'));
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values
    ($1,'owner@example.test',now()),($2,'admin@example.test',now()),($3,'producer@example.test',now())`, [owner, admin, producer]);
  await db.query(`insert into public.agency_members(user_id,email,role) values
    ($1,'owner@example.test','owner'),($2,'admin@example.test','admin'),($3,'producer@example.test','agent')`, [owner, admin, producer]);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261110120000_team_access_foundation.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261110121000_protect_agency_owner.sql', import.meta.url), 'utf8'));
  await db.exec(`
    alter table public.leads add column archived_at timestamptz;
    alter table public.leads enable row level security;
    grant select on public.leads to authenticated;
    create policy lead_reads on public.leads for select to authenticated using (true);
    create table public.tasks(id integer primary key,related_type text,related_id uuid,status text,due_date timestamptz);
    create table public.outreach_settings(id integer primary key,timezone text);
    create table public.notifications(id integer,type text,message text,href text,read boolean,created_at timestamptz);
    create function public.dispatch_due_reminders() returns void language plpgsql as $$ begin end; $$;
    create function public.unread_message_summary() returns jsonb language sql as $$ select '{}'::jsonb $$;
    create table public.social_intents(id integer primary key,approved_by uuid,publish_dispatched_at timestamptz);
    alter table public.clients add column full_name text;
    create table public.policies(id uuid primary key, client_id uuid references public.clients(id), carrier text, policy_number text);
    create function public.update_policy_record_atomic(p_id uuid,p_updates jsonb,p_actor text) returns jsonb
    language sql as $$ update public.policies set carrier=p_updates->>'carrier',policy_number=p_updates->>'policy_number'
      where id=p_id returning to_jsonb(policies) $$;
  `);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261119120000_active_task_workspace.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261119121000_team_request_authorization.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261119122000_team_dispatch_authorization.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261119123000_staff_policy_inbox.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261119231000_direct_team_access.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261119232000_team_setup_reauthorization.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261120010000_team_training_access.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261120020000_complete_team_permissions.sql', import.meta.url), 'utf8'));
  await db.exec(`
    create function public.intelligence_dossier_scope(p_actor uuid,p_type text,p_id uuid)
    returns jsonb language plpgsql security definer set search_path=public as $$
    declare member agency_members; client clients; lead leads;
    begin
      select * into member from agency_members where user_id=p_actor and active;
      if not found then raise exception 'Active agency access is required' using errcode='42501'; end if;
      if p_type='lead' then
        select * into lead from leads where id=p_id;
        if member.role='agent' and lead.agent_user_id is not null and lead.agent_user_id<>p_actor then
          raise exception 'This dossier is assigned to another agent.' using errcode='42501';
        end if;
      elsif p_type='client' then
        select * into client from clients where id=p_id;
        if member.role='agent' and client.agent_user_id is not null and client.agent_user_id<>p_actor then
          raise exception 'This dossier is assigned to another agent.' using errcode='42501';
        end if;
      end if;
      return '{}'::jsonb;
    end;
    $$;
    create function public.create_prospecting_nurture(p_actor uuid,p_lead uuid,p_due date)
    returns uuid language plpgsql security definer set search_path=public as $$
    declare member_row agency_members; lead_row leads;
    begin
      select * into member_row from agency_members where user_id=p_actor and active;
      select * into lead_row from leads where id=p_lead;
      if member_row.user_id is null or lead_row.id is null
        or (member_row.role='agent' and lead_row.agent_user_id is not null and lead_row.agent_user_id<>p_actor) then
        raise exception 'Lead not found or unavailable' using errcode='42501';
      end if;
      return null;
    end;
    $$;
  `);
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261120030000_apply_custom_team_permissions.sql', import.meta.url), 'utf8'));
}, 30000);
afterEach(async () => { await db.close(); });

const activate = async (): Promise<void> => { await db.exec('update public.team_access_rollout set enforcement_version=1,enabled=true'); };
const saveRole = (actor: string, id: string, grants: Record<string, string>, version: number | null = null) =>
  db.query('select public.save_team_role($1,$2,$2,$3,$4) as saved', [actor, id, grants, version]);
const changeMember = (actor: string, target: string, role: string | null, exceptions = {}, active = true, version = 1) =>
  db.query('select public.set_team_member_access($1,$2,$3,$4,$5,$6) as saved', [actor, target, role, exceptions, active, version]);
const invite = (actor = owner, email = 'writer@example.test') =>
  db.query('select public.create_team_invitation($1,$2,$3,$4,$5) as saved', [actor, invitation, email, 'content-writer', {}]);
const delivery = (version: number, user: string | null, error: string | null = null) =>
  db.query('select public.record_team_invitation_delivery($1,$2,$3,$4,$5) as saved', [owner, invitation, user, version, error]);
const accept = () => db.query('select public.accept_team_invitation($1,$2) as saved', [invitee, invitation]);

describe('Team access migration in isolated PostgreSQL', () => {
  it('enforces custom grants and record scopes in the SQL permission helper', async () => {
    await db.query(`update agency_members set direct_grants='{"automation.manage":"agency","leads.view":"assigned"}'::jsonb,
      setup_state='accepted' where user_id=$1`, [producer]);
    const result = await db.query(`select
      team_has_permission($1,'automation.manage','agency') as can_manage_automation,
      team_has_permission($1,'leads.view','assigned') as can_view_assigned_leads,
      team_has_permission($1,'leads.view','agency') as can_view_all_leads,
      team_has_permission($1,'team.manage','agency') as can_manage_team`, [producer]);
    expect(result.rows).toEqual([{
      can_manage_automation: true, can_view_assigned_leads: true,
      can_view_all_leads: false, can_manage_team: false,
    }]);
  });
  it('uses explicit campaign and record grants instead of membership titles in prospecting RPCs', async () => {
    const definition = (await db.query<{ definition: string }>(
      `select pg_get_functiondef('public.create_prospecting_nurture(uuid,uuid,date)'::regprocedure) as definition`,
    )).rows[0].definition;
    expect(definition).toContain(`team_has_permission(p_actor,'campaigns.send','agency')`);
    expect(definition).toContain(`team_has_permission(p_actor,'leads.view','assigned')`);
    expect(definition).not.toContain(`member_row.role='agent'`);

    await db.query(`insert into public.leads(id,agent_user_id) values($1,$2)`, [invitee, admin]);
    await db.query(`update agency_members set direct_grants='{"campaigns.send":"agency","leads.view":"agency"}'::jsonb,
      setup_state='accepted' where user_id=$1`, [producer]);
    await db.query('select public.create_prospecting_nurture($1,$2,current_date+1)', [producer, invitee]);
    await db.query(`update agency_members set direct_grants='{"leads.view":"agency"}'::jsonb where user_id=$1`, [producer]);
    await expect(db.query('select public.create_prospecting_nurture($1,$2,current_date+1)', [producer, invitee]))
      .rejects.toMatchObject({ code: '42501' });
  });
  it('lets explicit agency record grants cross legacy agent assignment fences in the dossier RPC', async () => {
    const definition = (await db.query<{ definition: string }>(
      `select pg_get_functiondef('public.intelligence_dossier_scope(uuid,text,uuid)'::regprocedure) as definition`,
    )).rows[0].definition;
    expect(definition).toContain(`team_has_permission(p_actor,'leads.view','agency')`);
    expect(definition).toContain(`team_has_permission(p_actor,'accounts.view','agency')`);
    expect(definition).not.toContain(`member.role='agent'`);

    await db.query(`insert into public.leads(id,agent_user_id) values($1,$2)`, [invitee, admin]);
    await db.query(`update agency_members set direct_grants='{"leads.view":"agency"}'::jsonb,
      setup_state='accepted' where user_id=$1`, [producer]);
    await db.query('select public.intelligence_dossier_scope($1,$2,$3)', [producer, 'lead', invitee]);
    await db.query(`update agency_members set direct_grants='{"leads.view":"assigned"}'::jsonb where user_id=$1`, [producer]);
    await expect(db.query('select public.intelligence_dossier_scope($1,$2,$3)', [producer, 'lead', invitee]))
      .rejects.toMatchObject({ code: '42501' });
  });
  it('allows profile managers to assign every catalog permission', async () => {
    await db.query(`select save_team_profile($1,$2,null,null,'Trainee','{"knowledge.view":"agency"}',true,1)`, [owner, producer]);
    expect((await db.query('select direct_grants from agency_members where user_id=$1', [producer])).rows)
      .toEqual([{ direct_grants: { 'knowledge.view': 'agency' } }]);
    const allPermissions = Object.fromEntries(Object.keys(TEAM_PERMISSIONS).map((permission) => [permission, 'agency']));
    await db.query('select save_team_profile($1,$2,null,null,$3,$4,true,2)', [owner, producer, 'Trainee', allPermissions]);
    const saved = await db.query<{ direct_grants: Record<string, unknown> }>(
      'select direct_grants from agency_members where user_id=$1', [producer],
    );
    expect(Object.keys(saved.rows[0].direct_grants))
      .toHaveLength(Object.keys(TEAM_PERMISSIONS).length);
  });
  it('scopes a custom-titled invitee independently of the rollout and never grants authority from the title', async () => {
    await db.query(`insert into auth.users(id,email) values ($1,'custom@example.test')`, [invitee]);
    const save = (actor: string, target: string, grants: Record<string, string>, version: number | null, active = false) =>
      db.query(`select save_team_profile($1,$2,'custom@example.test','Custom Member','Administrator',$3,$4,$5)`, [actor, target, grants, active, version]);
    const access = async () => (await db.query('select team_request_access() as access')).rows[0];
    await expect(save(producer, invitee, {}, null)).rejects.toMatchObject({ code: '42501' });
    await expect(save(admin, owner, {}, 1)).rejects.toMatchObject({ code: '42501' });
    await expect(save(owner, invitee, { 'messages.send': 'agency' }, null)).rejects.toMatchObject({ code: '22023' });
    await save(admin, invitee, { 'leads.view': 'assigned' }, null);
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [invitee]);
    await db.query('select record_team_setup_email($1,$2,false)', [admin, invitee]);
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [invitee]);
    await expect(db.query('select accept_team_profile($1)', [invitee])).rejects.toMatchObject({ code: '42501' });
    expect(await access()).toEqual({ access: { mode: 'restricted', grants: {}, policyAdmin: false } });
    await db.query('select record_team_setup_email($1,$2,true)', [admin, invitee]);
    await db.query('select accept_team_profile($1)', [invitee]);
    expect(await access()).toEqual({ access: { mode: 'restricted', grants: { 'leads.view': 'assigned' }, policyAdmin: false } });
    expect((await db.query('select team_legacy_database_access() as direct, team_record_dispatch_allowed($1,null,null) as dispatch, team_profile_manager($1) as manager', [invitee])).rows)
      .toEqual([{ direct: false, dispatch: false, manager: false }]);
    await save(admin, invitee, {}, 4, true);
    expect(await access()).toEqual({ access: { mode: 'restricted', grants: {}, policyAdmin: false } });
    await expect(save(admin, invitee, { 'leads.view': 'agency' }, 4, true)).rejects.toMatchObject({ code: 'PT409' });
    await save(admin, invitee, {}, 5);
    expect((await db.query('select agency_session_allowed() as allowed')).rows).toEqual([{ allowed: false }]);
  });
  it('lets delegated team administrators manage only members within their own selected grants', async () => {
    const set = (actor: string, target: string, grants: object, version = 1) =>
      db.query(`select save_team_profile($1,$2,null,null,'Office Coordinator',$3,true,$4)`, [actor, target, grants, version]);
    await set(owner, producer, { 'team.manage': 'agency', 'leads.view': 'assigned' });
    expect((await db.query('select team_profile_manager($1) as allowed', [producer])).rows).toEqual([{ allowed: true }]);
    await expect(set(producer, admin, {})).rejects.toMatchObject({ code: '42501' });
    await expect(set(producer, owner, {})).rejects.toMatchObject({ code: '42501' });
    await expect(set(producer, producer, { 'team.manage': 'agency', 'leads.view': 'agency' }, 2)).rejects.toMatchObject({ code: '42501' });
    await set(producer, producer, { 'leads.view': 'assigned' }, 2);
    expect((await db.query('select team_profile_manager($1) as allowed', [producer])).rows).toEqual([{ allowed: false }]);
  });
  it('does not activate revoked setup or an invite whose sender lost Team authority', async () => {
    await db.query(`select save_team_profile($1,$2,null,null,'Team Coordinator','{"team.manage":"agency"}',true,1)`, [owner, producer]);
    await db.query(`insert into auth.users(id,email) values($1,'pending@example.test')`, [invitee]);
    await db.query(`select save_team_profile($1,$2,'pending@example.test','Pending Member','Custom Title','{}',false,null)`, [producer, invitee]);
    await db.query(`select record_team_setup_email($1,$2,true)`, [producer, invitee]);
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [invitee]);
    await db.query(`select save_team_profile($1,$2,null,null,'Former Coordinator','{}',true,2)`, [owner, producer]);
    await expect(db.query('select accept_team_profile($1)', [invitee])).rejects.toMatchObject({ code: '42501' });
    await db.query('select revoke_team_profile($1,$2)', [owner, invitee]);
    await expect(db.query('select accept_team_profile($1)', [invitee])).rejects.toMatchObject({ code: '42501' });
  });
  it('allows a current manager to reauthorize setup after its original sender loses authority', async () => {
    await db.query(`insert into auth.users(id,email) values($1,'pending@example.test')`, [invitee]);
    await db.query(`select save_team_profile($1,$2,'pending@example.test','Pending Member','Custom Title','{}',false,null)`, [admin, invitee]);
    await db.query('select record_team_setup_email($1,$2,true)', [admin, invitee]);
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [invitee]);
    await db.query('update agency_members set active=false where user_id=$1', [admin]);
    await expect(db.query('select accept_team_profile($1)', [invitee])).rejects.toMatchObject({ code: '42501' });
    await db.query('select record_team_setup_email($1,$2,true)', [owner, invitee]);
    await db.query('select accept_team_profile($1)', [invitee]);
    expect((await db.query('select active,team_invited_by from agency_members where user_id=$1', [invitee])).rows)
      .toEqual([{ active: true, team_invited_by: owner }]);
  });
  it('routes scoped staff requests by urgency without changing policy, and restricts review and corrections to admins', async () => {
    await db.query(`insert into public.clients(id,agent_user_id,full_name) values ($1,$2,'Assigned'),($3,$4,'Other')`,
      [invitee, producer, invitation, admin]);
    await db.query(`insert into public.policies values($1,$1,'Carrier','A1'),($2,$2,'Carrier','B2')`, [invitee, invitation]);
    const submit = (actor: string, policyId: string, priority: number) => db.query<{ id: string }>(
      `select public.submit_staff_policy_request($1,$2,$3::smallint,'Review the policy') as id`, [actor, policyId, priority]);
    await expect(submit(producer, invitee, 1)).rejects.toMatchObject({ code: '42501' });
    await activate();
    await saveRole(owner, 'assigned-policy-service', {
      'accounts.view': 'assigned', 'policies.view': 'assigned', 'policies.edit': 'assigned',
    });
    await changeMember(owner, producer, 'assigned-policy-service');
    await expect(submit(producer, invitation, 3)).rejects.toMatchObject({ code: 'P0002' });
    const routine = (await submit(producer, invitee, 1)).rows[0].id;
    const urgent = (await submit(producer, invitee, 3)).rows[0].id;
    const list = (actor: string, closed = false) => db.query<{ row: { id: string; outcome: string } }>(
      'select public.list_staff_policy_requests($1,0,$2) as row', [actor, closed]);
    await expect(list(producer)).rejects.toMatchObject({ code: '42501' });
    expect((await list(admin)).rows.map(({ row }) => row.id)).toEqual([urgent, routine]);
    expect((await db.query('select policy_number from public.policies where id=$1', [invitee])).rows).toEqual([{ policy_number: 'A1' }]);
    const correct = (actor: string) => db.query(`select public.correct_staff_request_policy($1,$2,'New carrier','A2')`, [actor, urgent]);
    await expect(correct(producer)).rejects.toMatchObject({ code: '42501' });
    await correct(admin);
    expect((await db.query('select policy_number from public.policies where id=$1', [invitee])).rows).toEqual([{ policy_number: 'A2' }]);
    const resolve = (actor: string) => db.query(`select public.resolve_staff_policy_request($1,$2,'handled')`, [actor, urgent]);
    await expect(resolve(producer)).rejects.toMatchObject({ code: '42501' });
    await resolve(admin);
    await expect(resolve(admin)).rejects.toMatchObject({ code: 'PT409' });
    expect((await list(owner, true)).rows[0].row.outcome).toBe('handled');
    await changeMember(owner, producer, 'assigned-policy-service', { 'policies.edit': { effect: 'deny' } }, true, 2);
    await expect(submit(producer, invitee, 1)).rejects.toMatchObject({ code: '42501' });
  });
  it('authorizes scheduled and reviewed sends against current record assignment and scoped grants', async () => {
    await db.query('insert into public.leads(id,agent_user_id) values($1,$2),($3,$4)', [invitee, producer, invitation, admin]);
    await db.query('insert into public.clients(id,agent_user_id) values($1,$2)', [invitee, producer]);
    const allowed = async (actor: string | null, lead: string | null, client: string | null) =>
      (await db.query<{ allowed: boolean }>('select public.team_scheduled_dispatch_allowed($1,$2,$3) as allowed', [actor, lead, client])).rows[0].allowed;
    expect(await allowed(null, invitee, null)).toBe(true);
    await activate();
    expect(await allowed(null, invitee, null)).toBe(false);
    await saveRole(owner, 'assigned-sender', {
      'leads.view': 'assigned', 'accounts.view': 'assigned', 'messages.view': 'assigned', 'messages.send': 'assigned',
    });
    await changeMember(owner, producer, 'assigned-sender');
    expect(await allowed(producer, invitee, null)).toBe(true);
    expect(await allowed(producer, null, invitee)).toBe(true);
    expect(await allowed(producer, invitee, invitee)).toBe(true);
    expect(await allowed(producer, invitation, null)).toBe(false);
    expect(await allowed(producer, null, null)).toBe(false);
    await db.query('update public.leads set agent_user_id=$1 where id=$2', [admin, invitee]);
    expect(await allowed(producer, invitee, null)).toBe(false);
    expect(await allowed(producer, invitee, invitee)).toBe(false);
    expect(await allowed(owner, invitee, null)).toBe(true);
    await changeMember(owner, producer, 'assigned-sender', {}, false, 2);
    expect(await allowed(producer, null, invitee)).toBe(false);
  });

  it('requires both sending and record-view scopes, including agency scope for unmatched recipients', async () => {
    await db.query('insert into public.leads(id,agent_user_id) values($1,$2)', [invitee, admin]);
    await activate();
    await saveRole(owner, 'mixed-sender', {
      'leads.view': 'assigned', 'messages.view': 'agency', 'messages.send': 'agency',
    });
    await changeMember(owner, producer, 'mixed-sender');
    const allowed = async (lead: string | null) => (await db.query<{ allowed: boolean }>(
      'select public.team_record_dispatch_allowed($1,$2,null) as allowed', [producer, lead])).rows[0].allowed;
    expect(await allowed(invitee)).toBe(false);
    expect(await allowed(null)).toBe(false);
    await db.query('update public.leads set agent_user_id=$1 where id=$2', [producer, invitee]);
    expect(await allowed(invitee)).toBe(true);
    await db.query(`update public.agency_members set access_exceptions='{"messages.send":{"effect":"deny"}}' where user_id=$1`, [producer]);
    expect(await allowed(invitee)).toBe(false);
    await db.query(`update public.agency_members set access_exceptions='{}' where user_id=$1`, [producer]);
    await db.query(`update public.agency_members set access_exceptions='{"leads.view":{"effect":"allow","scope":"agency"},
      "accounts.view":{"effect":"allow","scope":"agency"}}' where user_id=$1`, [producer]);
    expect(await allowed(null)).toBe(true);
    await db.query(`update auth.users set banned_until=now()+interval '1 day' where id=$1`, [producer]);
    expect(await allowed(invitee)).toBe(false);
  });

  it('rejects dispatch after the approver loses publishing access', async () => {
    await activate();
    await db.query('insert into public.social_intents values(1,$1,null),(2,$2,null)', [admin, owner]);
    await changeMember(owner, admin, 'producer');
    await expect(db.query('update public.social_intents set publish_dispatched_at=now() where id=1'))
      .rejects.toMatchObject({ code: '42501' });
    await db.query('update public.social_intents set publish_dispatched_at=now() where id=2');
    expect((await db.query('select id from public.social_intents where publish_dispatched_at is not null')).rows).toEqual([{ id: 2 }]);
  });
  it('blocks direct customer table access for restricted members without removing the owner’s access', async () => {
    await db.query('insert into public.leads(id) values($1)', [producer]);
    await activate();
    await db.exec('set role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [producer]);
    expect((await db.query('select id from public.leads')).rows).toEqual([]);
    const access = await db.query<{ value: { mode: string } }>('select public.team_request_access() as value');
    expect(access.rows[0].value.mode).toBe('restricted');
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [owner]);
    expect((await db.query('select id from public.leads')).rows).toEqual([{ id: producer }]);
  });

  it('keeps archive-closed tasks in lead history but excludes them from general totals until restore', async () => {
    await db.query('insert into public.leads(id,archived_at) values($1,now()),($2,null)', [producer, admin]);
    await db.query(`insert into public.tasks(id,related_type,related_id,status) values
      (1,'lead',$1,'completed'), (2,'lead',$2,'completed'), (3,null,null,'open')`, [producer, admin]);
    const visible = () => db.query('select id from public.active_workspace_tasks order by id');
    expect((await visible()).rows).toEqual([{ id: 2 }, { id: 3 }]);
    expect((await db.query('select id from public.tasks where related_id=$1', [producer])).rows).toEqual([{ id: 1 }]);
    await db.query('update public.leads set archived_at=null where id=$1', [producer]);
    expect((await visible()).rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('uses the agency midnight for the tasks badge and skips archived leads', async () => {
    await db.query('insert into public.leads(id,archived_at) values($1,now())', [producer]);
    await db.exec(`insert into public.outreach_settings values(1,'America/New_York');
      insert into public.tasks(id,status,due_date)
      select 1,'open', (date_trunc('day',now() at time zone 'America/New_York')+interval '1 day') at time zone 'America/New_York'
      union all select 2,'open', (date_trunc('day',now() at time zone 'America/New_York')+interval '1 day') at time zone 'America/New_York' - interval '1 second';`);
    await db.query(`insert into public.tasks values(3,'lead',$1,'open',now()-interval '1 day')`, [producer]);
    const result = await db.query('select public.crm_shell_summary() as summary');
    expect(result.rows).toEqual([{ summary: { overdueCount: 0, dueTodayCount: 1, notifications: [], unreadCount: 0, unreadMessages: {} } }]);
  });
  it('backfills known memberships but leaves new admission and mutations disabled', async () => {
    const members = await db.query<{ role: string; team_role_id: string | null }>('select role,team_role_id from public.agency_members order by email');
    expect(members.rows).toEqual([
      { role: 'admin', team_role_id: 'admin' }, { role: 'owner', team_role_id: null }, { role: 'agent', team_role_id: 'producer' },
    ]);
    await expect(saveRole(owner, 'new-role', {})).rejects.toMatchObject({ code: '55000' });
  });

  it('keeps the database catalog, dependencies and seeded grants aligned with the shared contracts', async () => {
    const catalog = await db.query<{ permission: string; scopes: string[] }>('select permission,scopes from public.team_permission_catalog');
    expect(Object.fromEntries(catalog.rows.map((row) => [row.permission, row.scopes])))
      .toEqual(Object.fromEntries(Object.entries(TEAM_PERMISSIONS).map(([key, value]) => [key, [...value.scopes]])));
    const dependencies = await db.query<{ permission: string; dependency: string }>('select permission,dependency from public.team_permission_dependencies');
    expect(dependencies.rows.map((row) => `${row.permission}:${row.dependency}`).sort())
      .toEqual(Object.entries(TEAM_PERMISSION_DEPENDENCIES).flatMap(([permission, values]) => values.map((value) => `${permission}:${value}`)).sort());
    const roles = await db.query<{ id: string; grants: Record<string, string> }>('select id,grants from public.team_role_bundles');
    for (const role of STARTER_TEAM_ROLES) {
      expect(roles.rows.find((row) => row.id === role.id)?.grants).toEqual(resolveTeamAccess(role.grants));
    }
  });

  it('prevents escalation through a shared bundle, member exception or reactivation of a stronger member', async () => {
    await activate();
    await db.query(`update public.agency_members set team_role_id='content-writer',
      access_exceptions='{"team.manage":{"effect":"allow","scope":"agency"}}' where user_id=$1`, [admin]);
    await expect(saveRole(admin, 'content-writer', { 'social.view': 'agency', 'accounts.view': 'agency' }, 1))
      .rejects.toMatchObject({ code: '42501' });
    await expect(changeMember(admin, producer, 'producer')).rejects.toMatchObject({ code: '42501' });
    await expect(changeMember(admin, admin, 'content-writer', { 'social.publish': { effect: 'allow', scope: 'agency' } }))
      .rejects.toMatchObject({ code: '42501' });
    await expect(changeMember(admin, owner, null)).rejects.toMatchObject({ code: '42501' });
  });

  it('checks exceptions of every affected member before changing a shared bundle', async () => {
    await activate();
    await db.query(`update public.agency_members set team_role_id='content-writer',
      access_exceptions=case when user_id=$1 then '{"team.manage":{"effect":"allow","scope":"agency"}}'::jsonb
      else '{"accounts.view":{"effect":"allow","scope":"agency"}}'::jsonb end where user_id in ($1,$2)`, [admin, producer]);
    await expect(saveRole(admin, 'content-writer', { 'social.view': 'agency' }, 1)).rejects.toMatchObject({ code: '42501' });
  });

  it('audits valid edits and rejects stale versions without changing members or roles', async () => {
    await activate();
    await saveRole(admin, 'content-only', { 'social.view': 'agency' });
    await changeMember(owner, producer, 'content-only');
    await expect(changeMember(owner, producer, 'producer')).rejects.toMatchObject({ code: 'PT409' });
    await saveRole(admin, 'content-only', { 'social.view': 'agency', 'social.edit': 'agency' }, 1);
    await expect(saveRole(admin, 'content-only', {}, 1)).rejects.toMatchObject({ code: 'PT409' });
    const result = await db.query<{ access: Record<string, string>; access_version: number }>(
      'select public.team_effective_access(user_id) as access,access_version from public.agency_members where user_id=$1', [producer]);
    expect(result.rows[0]).toEqual({ access: { 'social.view': 'agency', 'social.edit': 'agency' }, access_version: 3 });
    const audit = await db.query<{ action: string }>('select action from public.agency_audit order by id');
    expect(audit.rows.map((row) => row.action)).toEqual(['team_role_saved', 'team_member_access_changed', 'team_role_saved']);
  });

  it('applies scoped exceptions and denies the same way as the shared evaluator', async () => {
    const role = STARTER_TEAM_ROLES.find((value) => value.id === 'producer')!;
    const exceptions = [{ permission: 'leads.edit', effect: 'deny' }, { permission: 'leads.prospect', effect: 'deny' }] as const;
    const result = await db.query<{ access: Record<string, string> }>('select public.team_apply_exceptions($1,$2) as access', [
      resolveTeamAccess(role.grants), { 'leads.edit': { effect: 'deny' }, 'leads.prospect': { effect: 'deny' } },
    ]);
    expect(result.rows[0].access).toEqual(resolveTeamAccess(role.grants, exceptions));
    await expect(db.query('select public.team_apply_exceptions($1,$2)', [{}, { 'accounts.view': { effect: 'deny', scope: 'agency' } }]))
      .rejects.toMatchObject({ code: '22023' });
    await expect(db.query('select public.team_validate_access($1)', [{ 'accounts.view': 'assigned', 'accounts.edit': 'agency' }]))
      .rejects.toMatchObject({ code: '22023' });
  });

  it('protects the last owner and returns no grants for suspended members', async () => {
    await activate();
    await expect(changeMember(owner, owner, null, {}, false)).rejects.toMatchObject({ code: '42501' });
    await changeMember(owner, producer, 'producer', {}, false);
    const result = await db.query<{ access: object }>('select public.team_effective_access($1) as access', [producer]);
    expect(result.rows[0].access).toEqual({});
    await expect(changeMember(producer, admin, 'producer')).rejects.toMatchObject({ code: '42501' });
  });

  it('protects every owner, including through the old management RPC, while allowing profile updates', async () => {
    await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'another@example.test',now());
    `, [invitee]);
    await db.query(`insert into public.agency_members(user_id,email,role) values($1,'another@example.test','owner')`, [invitee]);
    await activate();
    await expect(changeMember(owner, invitee, null)).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(`select public.manage_agency_member($1,$2,'agent',false)`, [owner, invitee])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(`delete from public.agency_members where user_id=$1`, [invitee])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(`update public.agency_members set role='owner',team_role_id=null where user_id=$1`, [producer])).rejects.toMatchObject({ code: '42501' });
    await db.query(`update public.agency_members set email='new-owner@example.test' where user_id=$1`, [owner]);
  });

  it('retains failed invitations and activates only a verified recipient, independently of mail transport configuration', async () => {
    await activate();
    await invite();
    await invite();
    await delivery(1, null, 'Invitation email could not be sent. Retry delivery.');
    await db.query('insert into auth.users(id,email) values($1,$2)', [invitee, 'writer@example.test']);
    await delivery(2, invitee);
    const pending = await db.query<{ active: boolean; access: object }>(
      'select active,public.team_effective_access(user_id) as access from public.agency_members where user_id=$1', [invitee]);
    expect(pending.rows[0]).toEqual({ active: false, access: {} });
    await expect(changeMember(owner, invitee, 'content-writer')).rejects.toMatchObject({ code: '22023' });
    await expect(accept()).rejects.toMatchObject({ code: '42501' });
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [invitee]);
    await accept();
    await accept();
    const active = await db.query<{ access: Record<string, string> }>('select public.team_effective_access($1) as access', [invitee]);
    expect(active.rows[0].access).toMatchObject({ 'social.edit': 'agency', 'tasks.view': 'self' });
    expect(active.rows[0].access).not.toHaveProperty('accounts.view');
    await changeMember(owner, invitee, 'content-writer', {}, false, 2);
    await expect(accept()).rejects.toMatchObject({ code: '42501' });
  });

  it('blocks revoked invitations and acceptance after the inviting administrator loses authority', async () => {
    await activate();
    await invite(admin);
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [invitee, 'writer@example.test']);
    await delivery(1, invitee);
    await changeMember(owner, admin, 'producer');
    await expect(accept()).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select public.revoke_team_invitation($1,$2,$3)', [owner, invitation, 1])).rejects.toMatchObject({ code: 'PT409' });
    await db.query('select public.revoke_team_invitation($1,$2,$3)', [owner, invitation, 2]);
    await expect(accept()).rejects.toMatchObject({ code: '42501' });
    await expect(delivery(2, invitee)).rejects.toMatchObject({ code: 'PT409' });
  });

  it('never overwrites existing membership when auth invitation creation and persistence race', async () => {
    await activate();
    await expect(invite(owner, 'producer@example.test')).rejects.toMatchObject({ code: 'PT409' });
    await invite();
    await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [invitee, 'writer@example.test']);
    await db.query(`insert into public.agency_members(user_id,email,role,team_role_id)
      values($1,$2,'admin','admin')`, [invitee, 'writer@example.test']);
    await expect(delivery(1, invitee)).rejects.toMatchObject({ code: 'PT409' });
    const result = await db.query<{ role: string; active: boolean; invitation_id: string | null }>(
      'select role,active,invitation_id from public.agency_members where user_id=$1', [invitee]);
    expect(result.rows[0]).toEqual({ role: 'admin', active: true, invitation_id: null });
  });

  it('does not expose new tables or management RPCs to authenticated or anonymous database clients', async () => {
    await activate();
    await db.exec('begin');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`savepoint grants; set local role ${role}`);
      await expect(db.query('select * from public.team_role_bundles')).rejects.toMatchObject({ code: '42501' });
      await db.exec('rollback to savepoint grants');
      await db.exec(`set local role ${role}`);
      await expect(saveRole(owner, 'forged-owner', {})).rejects.toMatchObject({ code: '42501' });
      await db.exec('rollback to savepoint grants; release savepoint grants');
    }
    await db.exec('rollback');
  });
});
