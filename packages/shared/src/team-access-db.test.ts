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
  await db.exec(await readFile(new URL('../../../supabase/migrations/20261120046000_personnel_permission.sql', import.meta.url), 'utf8'));
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
  it('rechecks current document grants and account assignment before attaching a file', async () => {
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120055000_conversation_document_permissions.sql', import.meta.url), 'utf8'));
    await activate();
    await db.query('insert into clients(id,agent_user_id) values($1,$2),($3,$4)', [invitee, producer, invitation, admin]);
    const check = async (account: string): Promise<boolean> => {
      const result = await db.query<{ allowed: boolean }>('select public.team_account_document_allowed($1,$2) as allowed', [producer, account]);
      return result.rows[0]!.allowed;
    };
    const grants = async (documents: string | null, accounts = 'agency'): Promise<void> => {
      await db.query("update agency_members set direct_grants=$1,setup_state='accepted' where user_id=$2",
        [{ 'accounts.view': accounts, ...(documents ? { 'documents.view': documents } : {}) }, producer]);
    };
    await grants('assigned');
    expect(await check(invitee)).toBe(true);
    expect(await check(invitation)).toBe(false);
    await grants('agency');
    expect(await check(invitation)).toBe(true);
    await grants(null);
    expect(await check(invitee)).toBe(false);
    await grants('agency', 'assigned');
    expect(await check(invitee)).toBe(true);
    expect(await check(invitation)).toBe(false);
    await db.query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1', [producer]);
    expect(await check(invitee)).toBe(false);
  });

  it('requires content deletion access before archiving a reusable template', async () => {
    await db.exec(`
      create table public.sales_templates(id text primary key,name text,category text,subject text,email_body text,
        sms_body text,email_design jsonb,archived boolean,revision integer,updated_by uuid,updated_at timestamptz);
      create table public.sales_template_revisions(template_id text,revision integer,snapshot jsonb,actor_id uuid);
    `);
    const source = (await readFile(new URL('../../../supabase/migrations/20261112010000_branded_email_templates.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    const start = source.indexOf('create or replace function public.save_sales_template(');
    const end = source.indexOf('$$;', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const original = source.slice(start, end + 3);
    const legacyGuard = "not exists(select 1 from agency_members where user_id=p_actor and active and role in ('owner','admin'))";
    expect(original).toContain(legacyGuard);
    await db.exec(original.replace(legacyGuard, "not public.team_has_permission(p_actor,'content.edit','agency')"));
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120052000_template_archive_permission.sql', import.meta.url), 'utf8'));
    await activate();
    await db.query(`update agency_members set direct_grants='{"content.view":"agency","content.edit":"agency"}',
      setup_state='accepted' where user_id=$1`, [producer]);
    const values = { name: 'Test', category: 'First contact', subject: 'Subject', email_body: 'Email', sms_body: 'SMS', archived: false };
    const save = (actor: string, revision: number, archived: boolean) =>
      db.query('select save_sales_template($1,$2,$3,$4)', [actor, 'test', revision, { ...values, archived }]);
    await save(producer, 0, false);
    await expect(save(producer, 1, true)).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('select archived,revision from sales_templates where id=$1', ['test'])).rows)
      .toEqual([{ archived: false, revision: 1 }]);
    await save(owner, 1, true);
    await save(producer, 2, true);
    await save(producer, 3, false);
    await db.query(`update agency_members set direct_grants='{"content.view":"agency","content.edit":"agency","content.delete":"agency"}' where user_id=$1`, [producer]);
    await save(producer, 4, true);
    await db.query(`update agency_members set direct_grants='{"content.view":"agency","content.edit":"agency"}' where user_id=$1`, [producer]);
    await save(producer, 5, false);
    await expect(save(producer, 6, true)).rejects.toMatchObject({ code: '42501' });
    await db.query(`update auth.users set banned_until=now()+interval '1 day' where id=$1`, [producer]);
    await expect(save(producer, 6, false)).rejects.toMatchObject({ code: '42501' });
    await db.query(`update auth.users set banned_until=now()+interval '1 day' where id=$1`, [owner]);
    await expect(save(owner, 6, true)).rejects.toMatchObject({ code: '42501' });
  });
  it('rechecks social content permissions in the real draft and media functions', async () => {
    await db.exec(`
      create table public.social_posts(id uuid primary key,workspace_id uuid,title text,caption text,link_url text,
        media_ids uuid[] default '{}',created_by uuid,updated_by uuid,revision integer default 1,
        status text default 'draft',review_state text default 'not_submitted',updated_at timestamptz default now());
      create table public.social_post_revisions(workspace_id uuid,post_id uuid,revision integer,title text,caption text,
        link_url text,media_ids uuid[],action text,actor_id uuid,recorded_at timestamptz default now());
      create table public.social_review_events(workspace_id uuid,post_id uuid,revision integer,review_version integer,
        action text,actor_id uuid,reason text,recorded_at timestamptz);
      create table public.social_revision_media(workspace_id uuid,post_id uuid,revision integer,media_id uuid);
      create table public.social_media_assets(id uuid primary key default gen_random_uuid(),workspace_id uuid,
        file_name text,alt_text text,rights_reference text,created_by uuid,status text default 'processing',
        width integer,height integer,byte_size integer,error_message text,created_at timestamptz default now(),
        expires_at timestamptz default now()+interval '5 minutes');
      alter table storage.objects add column name text;
      create function public.social_marketing_workspace_for(p_actor uuid) returns uuid language plpgsql as $$
      begin
        perform 1 from public.agency_members where user_id=p_actor and active for share;
        if not found then raise exception 'Active agency membership is required' using errcode='42501'; end if;
        return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
      end;
      $$;
    `);
    for (const [file, names] of [
      ['20261109190000_social_marketing_publish_links.sql', ['list_social_drafts', 'save_social_draft']],
      ['20261105140000_social_marketing_media.sql', ['list_social_media', 'reserve_social_media', 'complete_social_media']],
    ] as const) {
      const source = (await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
      for (const name of names) {
        const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`));
        const end = source.indexOf('$$;', start);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        await db.exec(source.slice(start, end + 3));
      }
    }
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120051000_social_content_permissions.sql', import.meta.url), 'utf8'));
    await activate();
    await db.query(`update agency_members set direct_grants='{"social.view":"agency","social.edit":"agency"}',
      setup_state='accepted' where user_id=$1`, [producer]);
    await db.query(`update agency_members set role='agent',direct_grants='{"social.view":"agency"}',
      setup_state='accepted' where user_id=$1`, [admin]);
    const save = (actor: string, action: string, revision: number | null) => db.query(
      'select save_social_draft($1,$2,$3,$4,$5,$6,null,null)',
      [actor, invitation, action, action === 'archive' ? null : 'Draft', action === 'archive' ? null : 'Caption', revision]);
    await save(producer, 'create', null);
    await expect(save(admin, 'create', null)).rejects.toMatchObject({ code: '42501' });
    await expect(save(producer, 'archive', 1)).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select list_social_drafts($1,$2,0,null)', [admin, 'draft'])).resolves.toBeDefined();
    const reservation = await db.query<{ result: { id: string } }>(
      'select reserve_social_media($1,$2,$3,$4) as result', [producer, 'image.jpg', 'Alt', 'Owned']);
    const mediaId = reservation.rows[0].result.id;
    const prefix = `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/${mediaId}`;
    await db.query(`insert into storage.objects(id,bucket_id,name) values
      (gen_random_uuid(),'social-marketing-media',$1),(gen_random_uuid(),'social-marketing-media',$2)`,
    [`${prefix}/image.jpg`, `${prefix}/thumbnail.jpg`]);
    await db.query(`update agency_members set direct_grants='{"social.view":"agency"}' where user_id=$1`, [producer]);
    await expect(db.query('select complete_social_media($1,$2,1,1,1)', [producer, mediaId])).rejects.toMatchObject({ code: '42501' });
    await expect(save(producer, 'update', 1)).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select reserve_social_media($1,$2,$3,$4)', [admin, 'image.jpg', 'Alt', 'Owned']))
      .rejects.toMatchObject({ code: '42501' });
    await db.query(`update agency_members set direct_grants='{"social.view":"agency","social.edit":"agency","social.delete":"agency"}' where user_id=$1`, [producer]);
    await db.query('select complete_social_media($1,$2,1,1,1)', [producer, mediaId]);
    await save(producer, 'archive', 1);
    await db.query(`update agency_members set direct_grants='{}' where user_id=$1`, [admin]);
    await expect(db.query('select list_social_media($1,0,null)', [admin])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select list_social_drafts($1,$2,0,null)', [admin, 'draft'])).rejects.toMatchObject({ code: '42501' });
  });
  it('enforces action-specific social review permissions at the database', async () => {
    await db.exec(`
      create table public.social_posts(id uuid primary key,workspace_id uuid,revision integer,review_version integer,
        status text,review_state text,caption text,updated_by uuid,updated_at timestamptz);
      create table public.social_review_events(workspace_id uuid,post_id uuid,revision integer,review_version integer,
        action text,actor_id uuid,reason text);
      create function public.social_marketing_workspace_for(p_actor uuid) returns uuid language plpgsql as $$
      begin
        perform 1 from public.agency_members where user_id=p_actor and active for share;
        if not found then raise exception 'Active agency membership is required' using errcode='42501'; end if;
        return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
      end;
      $$;
    `);
    const source = (await readFile(new URL('../../../supabase/migrations/20261105170000_social_marketing_reviews.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
    const start = source.indexOf('create function public.review_social_draft(');
    const end = source.indexOf('$$;', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const original = source.slice(start, end + 3);
    const legacyGuard = "perform 1 from agency_members where user_id=p_actor and active and role in ('owner','admin') for share;\n    if not found then raise exception 'Only active owners and administrators can review social posts.' using errcode='42501'; end if;";
    expect(original).toContain(legacyGuard);
    await db.exec(original.replace(legacyGuard, "if not public.team_has_permission(p_actor,'social.approve','agency') then raise exception 'Social review permission is required' using errcode='42501'; end if;"));
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120049000_social_review_permissions.sql', import.meta.url), 'utf8'));
    await activate();
    await db.query(`update agency_members set direct_grants='{"social.view":"agency","social.edit":"agency"}',setup_state='accepted' where user_id=$1`, [producer]);
    await db.query(`update agency_members set role='agent',direct_grants='{"social.view":"agency","social.approve":"agency"}',setup_state='accepted' where user_id=$1`, [admin]);
    await db.query(`insert into social_posts values($1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,0,'draft','not_submitted','Caption',null,null)`, [invitation]);
    const review = (actor: string, action: string, version: number) =>
      db.query('select public.review_social_draft($1,$2,$3,1,$4,$5)', [actor, invitation, action, version, action === 'request_changes' ? 'Fix caption' : '']);
    await review(producer, 'submit', 0);
    await expect(review(producer, 'approve', 1)).rejects.toMatchObject({ code: '42501' });
    await expect(review(admin, 'withdraw', 1)).rejects.toMatchObject({ code: '42501' });
    await review(admin, 'request_changes', 1);
    await review(producer, 'submit', 2);
    await review(producer, 'withdraw', 3);
    await review(producer, 'submit', 4);
    await review(admin, 'approve', 5);
    await db.query(`update agency_members set direct_grants='{"social.view":"agency"}' where user_id=$1`, [producer]);
    await expect(review(producer, 'withdraw', 6)).rejects.toMatchObject({ code: '42501' });
    const invalid = await db.query('select public.team_can_review_social($1,$2) as allowed', [owner, 'invalid']);
    expect(invalid.rows).toEqual([{ allowed: false }]);
  });
  it('limits conversation histories to currently assigned records and linked accounts', async () => {
    await db.exec(`alter table leads add column account_id uuid;
      create table public.communication_log(id uuid primary key,direction text,read_at timestamptz);
      create table public.canonical_communications(id uuid primary key,conversation_key text,sent_at timestamptz,body text,
        canonical_account_id uuid,canonical_lead_id uuid);
      create table public.conversation_inbox(key text,kind text,client_id uuid,lead_id uuid,name text,email text,phone text,last_subject text,last_at timestamptz);`);
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120050000_assigned_conversation_reads.sql', import.meta.url), 'utf8'));
    await activate();
    await db.query(`update agency_members set direct_grants='{"messages.view":"assigned","leads.view":"assigned","accounts.view":"assigned"}',
      setup_state='accepted' where user_id=$1`, [producer]);
    await db.query(`insert into clients(id,agent_user_id) values($1,$2),($3,$4)`, [invitee, producer, invitation, admin]);
    await db.query(`insert into leads(id,agent_user_id,account_id) values($1,$2,$3),($4,$2,$5),($6,$2,null)`,
      [owner, producer, invitee, admin, invitation, producer]);
    await db.query(`insert into canonical_communications values
      ($1,'client:'||$2::uuid::text,now(),'assigned',$2,$1),($3,'client:'||$4::uuid::text,now(),'other',$4,$3),
      ($5,'lead:'||$6::uuid::text,now(),'lead',null,$6)`, [owner, invitee, admin, invitation, invitee, producer]);
    await db.query(`insert into communication_log values($1,'inbound',null),($2,'inbound',null),($3,'inbound',null)`, [owner, admin, invitee]);
    await db.query(`insert into conversation_inbox values
      ('client:'||$1::uuid::text,'client',$1,$2,'Assigned',null,null,'First',now()),
      ('client:'||$3::uuid::text,'client',$3,$4,'Other',null,null,'Second',now()),
      ('lead:'||$5::uuid::text,'lead',null,$5,'Lead',null,null,'Third',now()),
      ('unmatched:unknown','unmatched',null,null,'Unknown',null,null,'Unmatched',now())`,
      [invitee, owner, invitation, admin, producer]);
    const read = (type: string, id: string, actor = producer) => db.query<{ result: { items: Array<{ body: string }>; total: number } }>(
      'select team_conversation_thread($1,$2,$3,0,100) as result', [actor, type, id]);
    expect((await read('lead', owner)).rows[0].result).toMatchObject({ clientId: invitee, total: 1, items: [{ body: 'assigned' }] });
    expect((await read('lead', producer)).rows[0].result).toMatchObject({ clientId: null, total: 1, items: [{ body: 'lead' }] });
    const inbox = await db.query<{ result: { total: number; conversations: Array<{ name: string }> } }>(
      'select team_conversation_inbox($1,$2,0) as result', [producer, '']);
    expect(inbox.rows[0].result.total).toBe(2);
    expect(inbox.rows[0].result.conversations.map((item) => item.name).sort()).toEqual(['Assigned', 'Lead']);
    await expect(db.query('select team_mark_conversation_read($1,$2::uuid[])', [producer, [owner, admin]])).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('select read_at from communication_log where id=$1', [owner])).rows[0]).toEqual({ read_at: null });
    expect((await db.query('select team_mark_conversation_read($1,$2::uuid[]) as result', [producer, [owner]])).rows[0])
      .toEqual({ result: { updated: 1, ids: [owner] } });
    await expect(read('lead', admin)).rejects.toMatchObject({ code: '42501' });
    await expect(read('client', invitation)).rejects.toMatchObject({ code: '42501' });
    await db.query(`update agency_members set direct_grants='{"messages.view":"agency","leads.view":"assigned","accounts.view":"assigned"}' where user_id=$1`, [producer]);
    await expect(read('client', invitation)).rejects.toMatchObject({ code: '42501' });
    await db.query(`update clients set agent_user_id=$1 where id=$2`, [admin, invitee]);
    await expect(read('lead', owner)).rejects.toMatchObject({ code: '42501' });
    await db.query(`update auth.users set banned_until=now()+interval '1 day' where id=$1`, [producer]);
    await expect(read('lead', producer)).rejects.toMatchObject({ code: '42501' });
    await db.query(`update auth.users set banned_until=null where id=$1`, [producer]);
    await db.query(`update agency_members set active=false where user_id=$1`, [producer]);
    await expect(read('lead', producer)).rejects.toMatchObject({ code: '42501' });
  });
  it('rechecks the linked account and rejects inconsistent record pairs before dispatch', async () => {
    await db.exec('alter table leads add column account_id uuid');
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120054000_dispatch_record_links.sql', import.meta.url), 'utf8'));
    await activate();
    await db.query(`update agency_members set direct_grants='{"messages.view":"assigned","messages.send":"assigned",
      "leads.view":"assigned","accounts.view":"assigned"}',setup_state='accepted' where user_id=$1`, [producer]);
    await db.query('insert into clients(id,agent_user_id) values($1,$2),($3,$4)', [invitee, producer, invitation, admin]);
    await db.query('insert into leads(id,agent_user_id,account_id) values($1,$2,$3),($4,$2,null)',
      [owner, producer, invitee, producer]);
    const allowed = async (lead: string | null, client: string | null, actor = producer) =>
      (await db.query<{ allowed: boolean }>('select team_record_dispatch_allowed($1,$2,$3) as allowed', [actor, lead, client])).rows[0].allowed;
    expect(await allowed(owner, null)).toBe(true);
    expect(await allowed(owner, invitee)).toBe(true);
    expect(await allowed(owner, invitation)).toBe(false);
    expect(await allowed(producer, invitee)).toBe(false);
    expect(await allowed(admin, null, owner)).toBe(false);
    await db.query('update clients set agent_user_id=$1 where id=$2', [admin, invitee]);
    expect(await allowed(owner, null)).toBe(false);
    expect(await allowed(owner, invitee)).toBe(false);
    expect(await allowed(owner, invitee, owner)).toBe(true);
  });
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
  it('enforces expiry, replacement, verified recipient and single-use completion for Team setup', async () => {
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120040000_team_setup_challenges.sql', import.meta.url), 'utf8'));
    await db.query(`insert into auth.users(id,email) values($1,'pending@example.test')`, [invitee]);
    await db.query(`select save_team_profile($1,$2,'pending@example.test','Pending Member','Producer','{"leads.view":"assigned"}',false,null)`, [owner, invitee]);
    const first = 'a'.repeat(64), second = 'b'.repeat(64);
    await db.query('select begin_team_setup($1,$2,$3)', [owner, invitee, first]);
    await expect(db.query('select claim_team_setup($1,$2)', [invitee, first])).rejects.toMatchObject({ code: '42501' });
    await db.query('select finish_team_setup($1,$2,$3,true)', [owner, invitee, first]);
    expect((await db.query('select claim_team_setup($1,$2) as email', [invitee, first])).rows).toEqual([{ email: 'pending@example.test' }]);
    await expect(db.query('select claim_team_setup($1,$2)', [invitee, 'c'.repeat(64)])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select verify_team_setup($1,$2)', [invitee, first])).rejects.toMatchObject({ code: '42501' });
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [invitee]);
    await db.query('select verify_team_setup($1,$2)', [invitee, first]);
    await db.query('select begin_team_setup($1,$2,$3)', [owner, invitee, second]);
    await expect(db.query('select claim_team_setup($1,$2)', [invitee, first])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select verify_team_setup($1,$2)', [invitee, first])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select finish_team_setup($1,$2,$3,true)', [owner, invitee, first])).rejects.toMatchObject({ code: 'PT409' });
    await expect(db.query('select verify_team_setup($1,$2)', [invitee, second])).rejects.toMatchObject({ code: '42501' });
    await db.query('select finish_team_setup($1,$2,$3,true)', [owner, invitee, second]);
    await db.query(`update team_setup_challenges set expires_at=now()+interval '22 hours' where user_id=$1`, [invitee]);
    expect((await db.query('select claim_team_setup($1,$2) as email', [invitee, second])).rows).toEqual([{ email: 'pending@example.test' }]);
    await db.query(`update team_setup_challenges set expires_at=now()-interval '1 second' where user_id=$1`, [invitee]);
    await expect(db.query('select claim_team_setup($1,$2)', [invitee, second])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select complete_team_setup($1,$2,$3,$4)', [invitee, second, '520-555-0101', null])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select claim_team_setup($1,$2)', [invitee, second])).rejects.toMatchObject({ code: '42501' });
    await db.query(`update team_setup_challenges set expires_at=now()+interval '1 hour' where user_id=$1`, [invitee]);
    await expect(db.query('select complete_team_setup($1,$2,$3,$4)', [invitee, second, '', null])).rejects.toMatchObject({ code: '22023' });
    await db.query('select complete_team_setup($1,$2,$3,$4)', [invitee, second, '520-555-0101', 'Example address']);
    expect((await db.query('select active,setup_state,contact_phone,mailing_address from agency_members where user_id=$1', [invitee])).rows)
      .toEqual([{ active: true, setup_state: 'accepted', contact_phone: '520-555-0101', mailing_address: 'Example address' }]);
    await expect(db.query('select complete_team_setup($1,$2,$3,$4)', [invitee, second, '520-555-0101', null])).rejects.toMatchObject({ code: '42501' });
    expect((await db.query(`select has_function_privilege('service_role','public.accept_team_profile(uuid)','execute') as allowed`)).rows)
      .toEqual([{ allowed: false }]);
  });
  it('rejects empty custom grants for pending invitations at the database boundary', async () => {
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120040000_team_setup_challenges.sql', import.meta.url), 'utf8'));
    await db.query(`insert into auth.users(id,email) values($1,'pending@example.test')`, [invitee]);
    await expect(db.query(`select save_team_profile($1,$2,'pending@example.test','Pending','Other','{}',false,null)`,
      [owner, invitee])).rejects.toMatchObject({ code: '22023' });
    expect((await db.query('select user_id from agency_members where user_id=$1', [invitee])).rows).toEqual([]);
  });
  it('limits contact edits and password resets to authorized managers and current memberships', async () => {
    for (const migration of ['20261120040000_team_setup_challenges.sql', '20261120041000_team_member_profile.sql']) {
      await db.exec(await readFile(new URL(`../../../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
    }
    await db.query(`select save_team_profile($1,$2,null,null,'Manager','{"team.manage":"agency","leads.view":"assigned"}',true,1)`, [owner, producer]);
    await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'target@example.test',now())`, [invitee]);
    await db.query(`insert into agency_members(user_id,email,role,active,team_name,role_title,direct_grants,setup_state)
      values($1,'target@example.test','agent',true,'Target','Producer','{"leads.view":"assigned"}','accepted')`, [invitee]);
    await db.query(`select save_team_contact($1,$2,1,'New Name','555-0101','Example address')`, [producer, invitee]);
    expect((await db.query(`select team_name,contact_phone,mailing_address,access_version from agency_members where user_id=$1`, [invitee])).rows)
      .toEqual([{ team_name: 'New Name', contact_phone: '555-0101', mailing_address: 'Example address', access_version: 2 }]);
    expect((await db.query(`select read_team_contact($1,$2) as profile`, [producer, invitee])).rows)
      .toEqual([{ profile: { name: 'New Name', phone: '555-0101', address: 'Example address', version: 2 } }]);
    await expect(db.query(`select read_team_contact($1,$2)`, [invitee, producer])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(`select read_team_contact($1,$2)`, [producer, owner])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(`select save_team_contact($1,$2,1,'Stale','','')`, [producer, invitee])).rejects.toMatchObject({ code: 'PT409' });
    await expect(db.query(`select save_team_contact($1,$2,1,'Owner','','')`, [producer, owner])).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('select authorize_team_reset($1,$2) as email', [producer, invitee])).rows)
      .toEqual([{ email: 'target@example.test' }]);
    await db.query('select record_team_reset($1,$2,true)', [producer, invitee]);
    await db.query(`update agency_members set direct_grants='{"leads.view":"agency"}' where user_id=$1`, [invitee]);
    await expect(db.query('select read_team_contact($1,$2)', [producer, invitee])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select authorize_team_reset($1,$2)', [producer, invitee])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select record_team_reset($1,$2,true)', [producer, invitee])).rejects.toMatchObject({ code: '42501' });
    await db.query(`update agency_members set active=false where user_id=$1`, [invitee]);
    await expect(db.query('select authorize_team_reset($1,$2)', [owner, invitee])).rejects.toMatchObject({ code: '42501' });
  });
  it('lets an authorized new inviter replace a link after the original inviter loses authority', async () => {
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120040000_team_setup_challenges.sql', import.meta.url), 'utf8'));
    await db.query(`select save_team_profile($1,$2,null,null,'Manager','{"team.manage":"agency","leads.view":"assigned"}',true,1)`, [owner, producer]);
    await db.query(`insert into auth.users(id,email) values($1,'pending@example.test')`, [invitee]);
    await db.query(`select save_team_profile($1,$2,'pending@example.test','Pending','Producer','{"leads.view":"assigned"}',false,null)`, [producer, invitee]);
    const first = 'a'.repeat(64), second = 'b'.repeat(64);
    await db.query('select begin_team_setup($1,$2,$3)', [producer, invitee, first]);
    await db.query('select finish_team_setup($1,$2,$3,true)', [producer, invitee, first]);
    await db.query(`update agency_members set active=false where user_id=$1`, [producer]);
    await expect(db.query('select claim_team_setup($1,$2)', [invitee, first])).rejects.toMatchObject({ code: '42501' });
    await db.query('select begin_team_setup($1,$2,$3)', [owner, invitee, second]);
    await db.query('select finish_team_setup($1,$2,$3,true)', [owner, invitee, second]);
    expect((await db.query('select claim_team_setup($1,$2) as email', [invitee, second])).rows).toEqual([{ email: 'pending@example.test' }]);
  });
  it('scopes assigned task reads in PostgreSQL without truncating large assignments', async () => {
    await db.exec('alter table public.tasks add column account_id uuid');
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120042000_assigned_workspace_tasks.sql', import.meta.url), 'utf8'));
    await db.query(`update agency_members set direct_grants='{"tasks.view":"assigned"}',setup_state='accepted' where user_id=$1`, [producer]);
    await db.query(`insert into clients(id,agent_user_id) select
      ('00000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,$1 from generate_series(1,1101) n`, [producer]);
    await db.query(`insert into tasks(id,related_type,related_id,account_id,created_by_user_id)
      values (1,'client','00000000-0000-4000-8000-00000000044d','00000000-0000-4000-8000-00000000044d',$1),
        (2,null,null,null,$1),(3,null,null,null,$2)`, [producer, admin]);
    await db.query(`insert into clients(id,agent_user_id) values($1,$2)`, [invitation, admin]);
    await db.query(`insert into tasks(id,related_type,related_id,created_by_user_id) values
      (5,'client','00000000-0000-4000-8000-00000000044d',$1),(6,'client',$2,$1)`, [producer, invitation]);
    await db.query(`insert into leads(id,agent_user_id,archived_at) values($1,$2,now())`, [invitee, producer]);
    await db.query(`insert into tasks(id,related_type,related_id,created_by_user_id) values(4,'lead',$1,$2)`, [invitee, producer]);
    expect((await db.query('select id from team_assigned_workspace_tasks($1) order by id', [producer])).rows)
      .toEqual([{ id: 1 }, { id: 2 }, { id: 5 }]);
    expect((await db.query('select id from team_assigned_workspace_tasks($1,true) order by id', [producer])).rows)
      .toEqual([{ id: 1 }, { id: 2 }, { id: 4 }, { id: 5 }]);
    await expect(db.query('select * from team_assigned_workspace_tasks($1)', [admin]))
      .resolves.toBeDefined();
    await db.query(`update agency_members set direct_grants='{}',setup_state='accepted' where user_id=$1`, [producer]);
    await expect(db.query('select * from team_assigned_workspace_tasks($1)', [producer])).rejects.toMatchObject({ code: '42501' });
  });
  it('scopes calendar events and mutations to their owner and accessible linked records', async () => {
    await db.exec(`
      alter table leads add column account_id uuid;
      create table public.events(id uuid primary key,user_id uuid,related_type text,related_id uuid,client_id uuid);
      create function public.save_calendar_event(p_id uuid,p_changes jsonb,p_create boolean,p_actor text,p_user uuid)
      returns jsonb language plpgsql security definer set search_path=public as $$
      declare original events; saved events; account uuid; member_role text;
      begin
        select role into member_role from agency_members where user_id=p_user and active;
        select * into original from events where id=p_id;
        saved:=jsonb_populate_record(original,p_changes); account:=saved.client_id;
        saved.client_id:=account;
        return to_jsonb(saved);
      end $$;
      create function public.claim_appointment_sync(p_id uuid,p_user uuid,p_lock uuid) returns jsonb
      language plpgsql as $$ begin
        perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
        return '{}'::jsonb;
      end $$;
      create function public.claim_appointment_notification(p_id uuid,p_user uuid,p_revision integer,p_lock uuid) returns void
      language plpgsql as $$ begin
        perform pg_advisory_xact_lock(hashtextextended('calendar-owner:'||p_user::text,0));
      end $$;
    `);
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120048000_scoped_team_calendar.sql', import.meta.url), 'utf8'));
    await db.query(`update agency_members set direct_grants='{"calendar.view":"self","calendar.edit":"self","leads.view":"assigned","accounts.view":"assigned"}',setup_state='accepted' where user_id=$1`, [producer]);
    await db.query(`insert into clients(id,agent_user_id) values($1,$2),($3,$4)`, [invitee, producer, invitation, admin]);
    await db.query(`insert into leads(id,agent_user_id,account_id) values($1,$2,$3),($4,$2,$5)`, [owner, producer, invitee, admin, invitation]);
    await db.query(`insert into events(id,user_id,related_type,related_id,client_id) values
      ($1,$2,null,null,null),($3,$2,'client',$4,$4),($5,$2,'lead',$6,$7),($8,$9,null,null,null)`,
    [owner, producer, admin, invitee, invitation, admin, invitation, invitee, admin]);
    expect((await db.query('select id from team_calendar_events($1) order by id', [producer])).rows)
      .toEqual([{ id: owner }, { id: admin }]);
    await expect(db.query('select assert_team_calendar_access($1,$2,$3)', [producer, invitation, 'calendar.edit']))
      .rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select claim_appointment_sync($1,$2,$3)', [invitation, producer, owner]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select save_calendar_event($1,$2,true,$3,$4)', [invitee, { related_type: 'client', related_id: invitation, client_id: invitation }, 'test', producer]))
      .rejects.toMatchObject({ code: '42501' });
    await db.query(`update agency_members set direct_grants='{"calendar.view":"assigned","calendar.edit":"assigned","leads.view":"agency","accounts.view":"agency"}' where user_id=$1`, [producer]);
    expect((await db.query('select id from team_calendar_events($1) order by id', [producer])).rows)
      .toEqual([{ id: owner }, { id: admin }]);
    await db.query(`update agency_members set direct_grants='{"calendar.view":"self"}' where user_id=$1`, [producer]);
    await expect(db.query('select claim_appointment_sync($1,$2,$3)', [owner, producer, invitee]))
      .rejects.toMatchObject({ code: '42501' });
  });
  it('patches the real appointment function definitions without losing their existing behavior', async () => {
    await db.exec(`alter table leads add column account_id uuid;
      create table public.events(id uuid primary key,user_id uuid,related_type text,related_id uuid,client_id uuid);`);
    const calendar = await readFile(new URL('../../../supabase/migrations/20261109160000_google_calendar_appointments.sql', import.meta.url), 'utf8');
    const zoom = await readFile(new URL('../../../supabase/migrations/20261109180000_zoom_appointments.sql', import.meta.url), 'utf8');
    const definition = (source: string, start: string): string => {
      const index = source.indexOf(start);
      if (index < 0) throw new Error(`Missing function ${start}`);
      const end = source.indexOf('end $$;', index);
      if (end < 0) throw new Error(`Incomplete function ${start}`);
      return source.slice(index, end + 'end $$;'.length);
    };
    await db.exec(definition(calendar, 'create function public.save_calendar_event('));
    await db.exec(definition(zoom, 'create or replace function public.claim_appointment_sync('));
    await db.exec(definition(calendar, 'create function public.claim_appointment_notification('));
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120048000_scoped_team_calendar.sql', import.meta.url), 'utf8'));
    const result = await db.query<{ definition: string }>(`
      select pg_get_functiondef('public.save_calendar_event(uuid,jsonb,boolean,text,uuid)'::regprocedure) as definition`);
    expect(result.rows[0].definition).toContain('Calendar editing and linked record access are required.');
    expect(result.rows[0].definition).toContain('saved.client_id:=account;');
    expect(result.rows[0].definition).toContain('insert into notifications');
  });
  it('stores copy-only presets with delegation, dependencies and version checks', async () => {
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120045000_team_profile_presets.sql', import.meta.url), 'utf8'));
    await db.query(`update agency_members set direct_grants='{"team.manage":"agency","leads.view":"assigned"}',
      setup_state='accepted' where user_id=$1`, [producer]);
    await db.query(`select save_team_profile_preset($1,null,'Lead reader','{"leads.view":"assigned"}',true,null)`, [owner]);
    await db.query(`select save_team_profile_preset($1,null,'Agency reader','{"leads.view":"agency"}',true,null)`, [owner]);
    const listed = await db.query<{ id: string; name: string; version: number }>('select * from list_team_profile_presets($1)', [producer]);
    expect(listed.rows.map((row) => row.name)).toEqual(['Lead reader']);
    const id = listed.rows[0].id;
    await expect(db.query(`select save_team_profile_preset($1,$2,'Lead reader','{"leads.view":"agency"}',true,1)`, [producer, id]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(db.query(`select save_team_profile_preset($1,$2,'Lead reader','{"leads.edit":"assigned"}',true,1)`, [owner, id]))
      .rejects.toMatchObject({ code: '22023' });
    await db.query(`select save_team_profile_preset($1,$2,'Renamed','{"leads.view":"assigned"}',false,1)`, [producer, id]);
    await expect(db.query(`select save_team_profile_preset($1,$2,'Stale','{"leads.view":"assigned"}',true,1)`, [producer, id]))
      .rejects.toMatchObject({ code: 'PT409' });
    expect((await db.query('select name,active,version from list_team_profile_presets($1)', [producer])).rows)
      .toEqual([{ name: 'Renamed', active: false, version: 2 }]);
    await expect(db.query('select * from list_team_profile_presets($1)', [admin]))
      .resolves.toBeDefined();
    await db.query(`update agency_members set direct_grants='{}' where user_id=$1`, [producer]);
    await expect(db.query('select * from list_team_profile_presets($1)', [producer]))
      .rejects.toMatchObject({ code: '42501' });
    expect((await db.query(`select has_table_privilege('authenticated','public.team_profile_presets','select') as allowed`)).rows)
      .toEqual([{ allowed: false }]);
  });
  it('offers an editable Marketing starting preset without changing members or replacing customizations', async () => {
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120045000_team_profile_presets.sql', import.meta.url), 'utf8'));
    const seed = await readFile(new URL('../../../supabase/migrations/20261120053000_marketing_team_preset.sql', import.meta.url), 'utf8');
    const before = await db.query('select user_id,direct_grants from agency_members order by user_id');
    await db.exec(seed);
    const presets = await db.query<{ id: string; grants: Record<string, string>; version: number }>(
      `select id,grants,version from list_team_profile_presets($1) where name='Marketing'`, [owner]);
    expect(presets.rows).toHaveLength(1);
    expect(presets.rows[0].grants).toEqual({ 'dashboard.view': 'assigned', 'content.view': 'agency',
      'content.edit': 'agency', 'social.view': 'agency', 'social.edit': 'agency' });
    expect((await db.query('select user_id,direct_grants from agency_members order by user_id')).rows).toEqual(before.rows);
    const { id } = presets.rows[0];
    await db.query('select save_team_profile_preset($1,$2,$3,$4,true,1)', [owner, id, 'Marketing', { 'social.view': 'agency' }]);
    await db.exec(seed);
    expect((await db.query(`select grants,version from team_profile_presets where id=$1`, [id])).rows)
      .toEqual([{ grants: { 'social.view': 'agency' }, version: 2 }]);
  });
  it('isolates personnel files, requires explicit authority, and honors retention', async () => {
    await db.exec(`create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
      alter table storage.objects add column name text,add column metadata jsonb,add column created_at timestamptz default now();`);
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120047000_personnel_vault.sql', import.meta.url), 'utf8'));
    await db.query(`update agency_members set direct_grants='{"team.manage":"agency","documents.view":"agency"}',
      setup_state='accepted' where user_id=$1`, [producer]);
    expect((await db.query('select personnel_manager($1) as allowed', [producer])).rows).toEqual([{ allowed: false }]);
    await db.query(`update agency_members set direct_grants='{"personnel.manage":"agency"}' where user_id=$1`, [producer]);
    const path = `${admin}/${invitation}/document`;
    await db.query('select reserve_personnel_upload($1,$2,$3)', [producer, admin, invitation]);
    await db.query(`insert into storage.objects(id,bucket_id,name,metadata) values($1,'personnel-documents',$2,'{"size":12,"mimetype":"application/pdf"}')`, [invitation, path]);
    await db.query(`select save_personnel_document($1,$2,$3,'Agreement.pdf',$4,'application/pdf',12,current_date+1,false)`,
      [producer, invitation, admin, path]);
    expect((await db.query('select id from list_personnel_documents($1,$1)', [admin])).rows).toEqual([]);
    await expect(db.query('select * from list_personnel_documents($1,$2)', [admin, producer])).rejects.toMatchObject({ code: '42501' });
    await db.query(`select change_personnel_document($1,$2,1,'share')`, [producer, invitation]);
    expect((await db.query('select id from list_personnel_documents($1,$1)', [admin])).rows).toEqual([{ id: invitation }]);
    expect((await db.query('select * from read_personnel_document($1,$2)', [invitee, invitation])).rows).toEqual([]);
    expect((await db.query(`select * from read_personnel_document($1,$2)`, [admin, invitation])).rows).toHaveLength(1);
    expect((await db.query(`select actor_id,target_id from agency_audit where action='personnel_document_access_requested'`)).rows)
      .toEqual([{ actor_id: admin, target_id: admin }]);
    await expect(db.query(`select change_personnel_document($1,$2,2,'remove')`, [producer, invitation]))
      .rejects.toMatchObject({ code: 'PT409' });
    await db.query('update personnel_documents set retain_until=current_date-1 where id=$1', [invitation]);
    await expect(db.query(`select change_personnel_document($1,$2,2,'remove')`, [producer, invitation]))
      .rejects.toMatchObject({ code: 'PT409' });
    await db.query(`update personnel_uploads set expires_at=now()-interval '1 second' where id=$1`, [invitation]);
    expect((await db.query('select * from claim_expired_personnel_uploads()')).rows).toEqual([]);
    await db.query(`select change_personnel_document($1,$2,2,'remove')`, [producer, invitation]);
    expect((await db.query('select * from read_personnel_document($1,$2)', [admin, invitation])).rows).toEqual([]);
    await expect(db.query('select finish_personnel_document_removal($1,$2)', [producer, invitation]))
      .rejects.toMatchObject({ code: 'PT409' });
    await db.query('delete from storage.objects where id=$1', [invitation]);
    await db.query('select finish_personnel_document_removal($1,$2)', [producer, invitation]);
    expect((await db.query('select state from personnel_documents where id=$1', [invitation])).rows).toEqual([{ state: 'removed' }]);
    expect((await db.query(`select has_table_privilege('authenticated','public.personnel_documents','select') as allowed`)).rows)
      .toEqual([{ allowed: false }]);
  });
  it('cleans abandoned personnel uploads without deleting completed documents', async () => {
    await db.exec(`create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);
      alter table storage.objects add column name text,add column metadata jsonb,add column created_at timestamptz default now();`);
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120047000_personnel_vault.sql', import.meta.url), 'utf8'));
    await db.query('select reserve_personnel_upload($1,$2,$3)', [owner, admin, invitation]);
    const path = `${admin}/${invitation}/document`;
    await db.query(`insert into storage.objects(id,bucket_id,name,metadata) values($1,'personnel-documents',$2,'{"size":12,"mimetype":"application/pdf"}')`, [invitation, path]);
    expect((await db.query('select * from claim_expired_personnel_uploads()')).rows).toEqual([]);
    await db.query(`update personnel_uploads set expires_at=now()-interval '1 second' where id=$1`, [invitation]);
    expect((await db.query('select * from claim_expired_personnel_uploads()')).rows).toEqual([{ id: invitation, storage_path: path }]);
    await expect(db.query(`select save_personnel_document($1,$2,$3,'Agreement.pdf',$4,'application/pdf',12,current_date,false)`,
      [owner, invitation, admin, path])).rejects.toMatchObject({ code: 'PT409' });
    await expect(db.query('select finish_expired_personnel_upload($1)', [invitation])).rejects.toMatchObject({ code: 'PT409' });
    await db.query('delete from storage.objects where id=$1', [invitation]);
    await db.query('select finish_expired_personnel_upload($1)', [invitation]);
    expect((await db.query('select * from personnel_uploads')).rows).toEqual([]);
    await db.query(`insert into storage.objects(id,bucket_id,name,metadata,created_at)
      values($1,'personnel-documents',$2,'{"size":12,"mimetype":"application/pdf"}',now()-interval '25 hours')`, [invitation, path]);
    expect((await db.query('select * from claim_expired_personnel_uploads()')).rows).toEqual([{ id: invitation, storage_path: path }]);
    expect((await db.query(`select has_function_privilege('authenticated','public.claim_expired_personnel_uploads()','execute') as allowed`)).rows)
      .toEqual([{ allowed: false }]);
    expect((await db.query(`select has_table_privilege('authenticated','public.personnel_uploads','select') as allowed`)).rows)
      .toEqual([{ allowed: false }]);
  });
  it('limits policy, renewal and claim dashboard data to assigned accounts with both permissions', async () => {
    await db.exec(`alter table public.policies add column effective_date date, add column premium numeric;
      create table public.claims(id integer primary key,policy_id uuid,client_id uuid,status text);
      create view public.renewals as select id,client_id from public.policies;`);
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120043000_assigned_dashboard_policies.sql', import.meta.url), 'utf8'));
    await db.query(`update agency_members set direct_grants='{"accounts.view":"assigned","policies.view":"assigned"}',
      setup_state='accepted' where user_id=$1`, [producer]);
    await db.query(`insert into clients(id,agent_user_id) values ($1,$3),($2,$4)`, [invitee, invitation, producer, admin]);
    await db.query(`insert into policies(id,client_id,effective_date,premium) values
      ($1,$1,'2026-01-15',100),($2,$2,'2026-01-15',500)`, [invitee, invitation]);
    await db.query(`insert into claims(id,policy_id,client_id,status) values
      (1,$1,$1,'open'),(2,$2,$2,'open'),(3,$2,$1,'open')`, [invitee, invitation]);
    const summary = await db.query<{ summary: { total: number; months: { month: string; premium: number }[] } }>(
      `select team_assigned_premium_summary($1,'2026-01-01') as summary`, [producer]);
    expect(Number(summary.rows[0].summary.total)).toBe(100);
    expect(Number(summary.rows[0].summary.months[0].premium)).toBe(100);
    expect((await db.query('select id from team_assigned_dashboard_renewals($1)', [producer])).rows).toEqual([{ id: invitee }]);
    expect((await db.query('select id from team_assigned_dashboard_claims($1)', [producer])).rows).toEqual([{ id: 1 }]);
    await db.query(`update agency_members set direct_grants='{"policies.view":"assigned"}' where user_id=$1`, [producer]);
    await expect(db.query(`select team_assigned_premium_summary($1,'2026-01-01')`, [producer])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select * from team_assigned_dashboard_renewals($1)', [producer])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select * from team_assigned_dashboard_claims($1)', [producer])).rejects.toMatchObject({ code: '42501' });
  });
  it('scopes email approvals and rechecks the approving manager before an identity change', async () => {
    await db.exec('alter table auth.users add column email_change text');
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261105060000_account_security.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261120044000_team_email_approval_scope.sql', import.meta.url), 'utf8'));
    await db.query(`update agency_members set direct_grants='{"team.manage":"agency","leads.view":"assigned"}',
      setup_state='accepted' where user_id=$1`, [producer]);
    await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,'target@example.test',now())`, [invitee]);
    await db.query(`insert into agency_members(user_id,email,role,active,direct_grants,setup_state)
      values($1,'target@example.test','agent',true,'{"leads.view":"assigned"}','accepted')`, [invitee]);
    const request = await db.query<{ id: string }>(`select request_account_email($1,'new@example.test') as id`, [invitee]);
    const id = request.rows[0].id;
    await db.query(`insert into account_email_changes(user_id,old_email,new_email,status)
      values($1,'admin@example.test','other@example.test','pending')`, [admin]);
    const pending = await db.query<{ user_id: string }>('select * from team_pending_email_requests($1)', [producer]);
    expect(pending.rows.map((row) => row.user_id)).toEqual([invitee]);
    await expect(db.query(`select decide_account_email($1,(select id from account_email_changes where user_id=$2),true)`,
      [producer, admin])).rejects.toMatchObject({ code: '42501' });
    await db.query('select decide_account_email($1,$2,true)', [producer, id]);
    await expect(db.query(`update auth.users set email='new@example.test' where id=$1`, [invitee])).rejects.toMatchObject({ code: '42501' });
    await db.query('update account_email_changes set old_confirmed_at=now(),new_confirmed_at=now() where id=$1', [id]);
    await db.query('update account_email_changes set approved_by=null where id=$1', [id]);
    await expect(db.query(`update auth.users set email='new@example.test' where id=$1`, [invitee])).rejects.toMatchObject({ code: '42501' });
    await db.query('update account_email_changes set approved_by=$2 where id=$1', [id, producer]);
    await db.query(`update agency_members set direct_grants='{"leads.view":"agency"}' where user_id=$1`, [invitee]);
    await expect(db.query(`update auth.users set email='new@example.test' where id=$1`, [invitee])).rejects.toMatchObject({ code: '42501' });
    await db.query(`update agency_members set direct_grants='{"leads.view":"assigned"}' where user_id=$1`, [invitee]);
    await db.query(`update auth.users set email='new@example.test' where id=$1`, [invitee]);
    expect((await db.query('select email from agency_members where user_id=$1', [invitee])).rows).toEqual([{ email: 'new@example.test' }]);
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
