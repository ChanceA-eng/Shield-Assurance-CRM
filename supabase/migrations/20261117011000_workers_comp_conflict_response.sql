begin;

create or replace function public.workers_comp_workspace(p_actor uuid,p_type text,p_id uuid,
  p_entry uuid default null,p_expected integer default null,p_evidence jsonb default null,p_remove boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  scope jsonb;
  current_entry workers_comp_evidence;
  rows jsonb;
  employer text;
  address text;
begin
  scope:=intelligence_dossier_scope(p_actor,p_type,p_id);
  if p_type='lead' then
    select coalesce(nullif(to_jsonb(l)->>'business',''),l.full_name),
      concat_ws(', ',nullif(to_jsonb(l)->>'address',''),nullif(to_jsonb(l)->>'city',''),
        nullif(to_jsonb(l)->>'state',''),nullif(to_jsonb(l)->>'zip',''))
      into employer,address from leads l where l.id=p_id;
  else
    select c.full_name,concat_ws(', ',nullif(to_jsonb(c)->>'address',''),nullif(to_jsonb(c)->>'city',''),
      nullif(to_jsonb(c)->>'state',''),nullif(to_jsonb(c)->>'zip',''))
      into employer,address from clients c where c.id=p_id;
  end if;
  if p_entry is not null then
    perform pg_advisory_xact_lock(hashtextextended('workers-comp:'||p_type||':'||p_id,0));
    if p_expected is null or p_expected<0 then
      raise exception 'Reload the document review before saving.' using errcode='22023';
    end if;
    select * into current_entry from workers_comp_evidence where id=p_entry for update;
    if current_entry.id is not null and
      (case when p_type='lead' then current_entry.lead_id is distinct from p_id else current_entry.client_id is distinct from p_id end) then
      raise exception 'Document not found on this record.' using errcode='P0002';
    end if;
    -- Logical edit conflicts must not trigger the gateway's serialization retry.
    if coalesce(current_entry.revision,0)<>p_expected then
      raise sqlstate 'PT409' using message='This document changed. Reload before saving your review.';
    end if;
    if p_remove then
      if current_entry.id is null then raise exception 'Document not found.' using errcode='P0002'; end if;
      delete from workers_comp_evidence where id=p_entry;
    else
      if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or octet_length(p_evidence::text)>12000
        or p_evidence->>'kind' not in ('policy','mod','payroll','loss_run','self_insured') then
        raise exception 'Choose a valid employer-level document review.' using errcode='22023';
      end if;
      if current_entry.id is null and (select count(*) from workers_comp_evidence
        where (p_type='lead' and lead_id=p_id) or (p_type='client' and client_id=p_id))>=100 then
        raise exception 'Remove an unused source before adding another.' using errcode='22023';
      end if;
      insert into workers_comp_evidence(id,lead_id,client_id,evidence,updated_by)
        values(p_entry,case when p_type='lead' then p_id end,case when p_type='client' then p_id end,p_evidence,p_actor)
        on conflict(id) do update set evidence=excluded.evidence,revision=workers_comp_evidence.revision+1,
          updated_at=clock_timestamp(),updated_by=p_actor;
    end if;
    insert into agency_audit(actor_id,target_id,action,details)
      values(p_actor,p_id,case when p_remove then 'workers_comp_source_removed' else 'workers_comp_source_reviewed' end,
        jsonb_build_object('record_type',p_type,'source_id',p_entry,'revision',p_expected+1));
  else
    insert into agency_audit(actor_id,target_id,action,details)
      values(p_actor,p_id,'workers_comp_viewed',jsonb_build_object('record_type',p_type));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'revision',e.revision,'evidence',e.evidence,'updated_at',e.updated_at)
    order by e.updated_at desc,e.id),'[]') into rows from workers_comp_evidence e
    where (p_type='lead' and e.lead_id=p_id) or (p_type='client' and e.client_id=p_id);
  return jsonb_build_object('entries',rows,'record_name',employer,'record_address',coalesce(address,''));
end;
$$;
notify pgrst,'reload schema';
commit;
