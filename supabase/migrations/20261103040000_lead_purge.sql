begin;
-- Permanently erases archived leads and everything that belongs only to them.
-- Records shared with a linked client account (account notes, files, activity, messages) and issued
-- policies and quotes (which always belong to an account) stay with that account; their link to the erased lead is cleared.
create or replace function public.purge_leads(p_ids uuid[],p_actor text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  target uuid; lead public.leads%rowtype; results jsonb:='[]'::jsonb;
  task_ids uuid[]; intake_ids uuid[]; message_ids uuid[]; removed integer;
begin
  if coalesce(cardinality(p_ids),0)=0 or array_position(p_ids,null) is not null or nullif(trim(p_actor),'') is null then
    raise exception 'Choose at least one archived lead to delete.' using errcode='22023';
  end if;
  if cardinality(p_ids)>200 then raise exception 'Delete up to 200 leads at a time.' using errcode='22023'; end if;
  perform 1 from public.leads where id=any(p_ids) order by id for update;
  for target in select distinct id from unnest(p_ids) as ids(id) order by 1 loop
    select * into lead from public.leads where id=target;
    if not found then results:=results||jsonb_build_object('id',target,'outcome','missing'); continue; end if;
    if lead.archived_at is null then
      results:=results||jsonb_build_object('id',target,'outcome','not_archived','name',lead.full_name); continue;
    end if;

    select coalesce(array_agg(id),'{}') into task_ids from public.tasks where related_type='lead' and related_id=target;
    select coalesce(array_agg(id),'{}') into intake_ids from public.lead_intake_events where lead_id=target;
    select coalesce(array_agg(id),'{}') into message_ids from public.communication_log
      where client_id is null and metadata->>'lead_id'=target::text;

    delete from public.notifications where task_id=any(task_ids) or intake_event_id=any(intake_ids)
      or message_log_id=any(message_ids) or href like '%lead='||target::text||'%';
    delete from public.events where (related_type='lead' and related_id=target)
      or id in (select event_id from public.tasks where id=any(task_ids) and event_id is not null);
    delete from public.tasks where id=any(task_ids);

    delete from public.agent_email_attempts where lead_id=target or communication_id=any(message_ids);
    delete from public.gmail_message_links where communication_id=any(message_ids);
    delete from public.gmail_thread_links where lead_id=target;
    delete from public.communication_log where id=any(message_ids);

    delete from public.interactions where lead_id=target and client_id is null;
    delete from public.client_assets where lead_id=target and client_id is null;
    if lead.account_id is null then
      -- Shared records without a linked account would otherwise block the delete.
      update public.interactions set lead_id=null where lead_id=target;
      update public.client_assets set lead_id=null where lead_id=target;
    end if;
    delete from public.client_activities where lead_id=target and client_id is null;

    -- Intake events, outreach drafts, sequences, applicants and marketing profiles cascade with the lead.
    delete from public.leads where id=target;
    get diagnostics removed=row_count;
    if removed<>1 then raise exception 'The lead could not be deleted. Refresh and try again.' using errcode='PT409'; end if;
    delete from public.client_activities where lead_id is null and client_id is null
      and metadata->>'record_table' in ('tasks','interactions','client_assets')
      and (metadata->'after'->>'related_id'=target::text or metadata->'after'->>'lead_id'=target::text);
    results:=results||jsonb_build_object('id',target,'outcome','deleted','name',lead.full_name);
  end loop;
  return results;
end;
$$;
revoke all on function public.purge_leads(uuid[],text) from public,anon,authenticated;
grant execute on function public.purge_leads(uuid[],text) to service_role;
notify pgrst,'reload schema';
commit;
