import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('saves and clears rich signatures atomically, expands template limits, and stamps Gmail history', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb,updated_at timestamptz);
      create table public.agency_members(user_id uuid,active boolean);
      create table public.sales_templates(id text,email_design jsonb constraint sales_templates_email_design_check
        check(octet_length(email_design::text)<=12000));
      create function public.save_sales_template(uuid,text,integer,jsonb) returns void language plpgsql as $$
      begin if octet_length($4::text)>12000 then raise exception 'Too large'; end if; end $$;
      create table public.scheduled_messages(id uuid);
      create table public.agent_email_attempts(id uuid,rfc_message_id text);
      create table public.communication_log(direction text,metadata jsonb);
    `);
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261119125000_rich_email_workspace.sql', import.meta.url), 'utf8'));
    const actor = '11111111-1111-4111-8111-111111111111';
    await db.query(`insert into auth.users values($1,'{"full_name":"Keep"}',now())`, [actor]);
    await db.query('insert into public.agency_members values($1,true)', [actor]);
    const document = { type: 'doc', content: [] };
    await db.query('select public.save_email_signature($1,$2,$3,null)', [actor, 'Jane', document]);
    expect((await db.query('select document from email_signature_designs')).rows).toEqual([{ document }]);
    await expect(db.query('select public.save_email_signature($1,$2,$3,null)', [actor, 'Changed', { invalid: 'x'.repeat(16000) }])).rejects.toThrow();
    expect((await db.query<{ raw_user_meta_data: { signature: string; full_name: string } }>('select raw_user_meta_data from auth.users')).rows[0]?.raw_user_meta_data)
      .toEqual({ signature: 'Jane', full_name: 'Keep' });
    await db.query('select public.save_email_signature($1,$2,null,null)', [actor, 'Plain']);
    expect((await db.query('select * from email_signature_designs')).rows).toHaveLength(0);
    await db.exec('update public.agency_members set active=false');
    await expect(db.query('select public.save_email_signature($1,$2,$3,null)', [actor, 'Blocked', document])).rejects.toThrow('Active membership');
    const large = { text: 'a'.repeat(13000) };
    await db.query('select public.save_sales_template($1,$2,1,$3)', [actor, 'template', large]);
    await db.query('insert into public.sales_templates values($1,$2)', ['template', large]);
    const formatting = { bodyDocument: document };
    await db.query('insert into public.agent_email_attempts values($1,$2,$3)', [actor, 'message', formatting]);
    await db.query(`insert into public.communication_log values('outbound',$1)`, [{ provider: 'gmail', rfc_message_id: 'message' }]);
    expect((await db.query<{ metadata: { email_formatting: unknown } }>('select metadata from public.communication_log')).rows[0]?.metadata.email_formatting).toEqual(formatting);
    await db.exec('set role authenticated');
    await expect(db.query('select * from public.email_signature_designs')).rejects.toThrow('permission denied');
  } finally { await db.close(); }
}, 30000);
