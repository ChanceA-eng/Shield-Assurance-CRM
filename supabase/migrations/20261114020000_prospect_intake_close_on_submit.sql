begin;

-- Keep the legacy timestamp column for existing readers; open links have no deadline.
alter table public.prospect_questionnaire_requests alter column expires_at set default 'infinity'::timestamptz;
update public.prospect_questionnaire_requests set expires_at='infinity' where state='open';
update public.prospect_questionnaire_challenges c set session_expires_at='infinity'
  from public.prospect_questionnaire_requests r
  where r.id=c.request_id and r.state='open' and c.session_hash is not null;

create or replace function public.prospect_questionnaire_staff(p_actor uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare member agency_members; template prospect_questionnaire_templates; source prospect_questionnaire_templates;
  req prospect_questionnaire_requests; submission prospect_questionnaire_submissions; item record;
  result jsonb; current_values jsonb; changes jsonb:='{}'; question jsonb; value text; row_id uuid;
begin
  select * into member from agency_members where user_id=p_actor and active;
  if not found then raise exception 'Active agency access is required.' using errcode='42501'; end if;
  if p_action='templates' then
    return coalesce((select jsonb_agg(to_jsonb(t) order by t.updated_at desc) from prospect_questionnaire_templates t
      where owner_id is null or owner_id=p_actor),'[]');
  elsif p_action='context' then
    perform intelligence_dossier_scope(p_actor,p_data->>'target_type',(p_data->>'target_id')::uuid);
    if p_data->>'target_type'='lead' then
      return (select jsonb_build_object('name',full_name,'email',email) from leads where id=(p_data->>'target_id')::uuid);
    end if;
    return (select jsonb_build_object('name',full_name,'email',email) from clients where id=(p_data->>'target_id')::uuid);
  elsif p_action='save_template' then
    select * into template from prospect_questionnaire_templates where id=(p_data->>'id')::uuid for update;
    if found then
      if template.owner_id is distinct from p_actor then raise exception 'Customize this template as your own copy.' using errcode='42501'; end if;
      if template.revision=(p_data->>'expected')::integer+1 and template.design=p_data->'design' then return to_jsonb(template); end if;
      if template.revision<>(p_data->>'expected')::integer then raise exception 'This template changed. Reload before saving.' using errcode='PT409'; end if;
      update prospect_questionnaire_templates set design=p_data->'design',revision=revision+1,updated_at=clock_timestamp()
        where id=template.id returning * into template;
    else
      if p_data->>'source_id' is not null then
        select * into source from prospect_questionnaire_templates where id=(p_data->>'source_id')::uuid;
        if not found or (source.owner_id is not null and source.owner_id<>p_actor) then
          raise exception 'Template not found.' using errcode='42501'; end if;
      end if;
      insert into prospect_questionnaire_templates(id,owner_id,source_id,source_revision,design)
        values((p_data->>'id')::uuid,p_actor,source.id,source.revision,p_data->'design') returning * into template;
    end if;
    return to_jsonb(template);
  elsif p_action='requests' then
    result:='[]';
    for req in select * from prospect_questionnaire_requests r where
      (p_data->>'target_id' is null and (actor_id=p_actor or member.role in ('owner','admin')))
      or (target_id=(p_data->>'target_id')::uuid and target_type=p_data->>'target_type')
      or (target_type='lead' and p_data->>'target_type'='client' and target_id in
        (select id from leads where account_id=(p_data->>'target_id')::uuid))
      order by created_at desc limit 100 loop
      if req.target_id is not null then
        begin perform intelligence_dossier_scope(p_actor,req.target_type,req.target_id);
        exception when insufficient_privilege then continue; end;
      end if;
      result:=result||jsonb_build_array((to_jsonb(req)-'token_hash')||jsonb_build_object(
        'can_reopen',member.role in ('owner','admin'),
        'submissions',(select coalesce(jsonb_agg(to_jsonb(s) order by revision desc),'[]') from prospect_questionnaire_submissions s where request_id=req.id),
        'files',(select coalesce(jsonb_agg((to_jsonb(f)-'storage_path'-'digest'-'lease'-'cleanup_lease')||jsonb_build_object(
          'expires_at',s.created_at+interval '24 hours',
          'state',case when f.purged_at is not null then 'deleted'
            when s.created_at+interval '24 hours'<=clock_timestamp() then 'expired' else f.state end)),'[]')
          from prospect_questionnaire_files f left join prospect_questionnaire_submissions s on s.request_id=f.request_id and s.revision=f.revision
          where f.request_id=req.id and f.state<>'removed'),
        'current_values',case when req.target_type='lead' then (select jsonb_build_object('full_name',full_name,'phone',phone,'address',address,'line_of_business',line_of_business) from leads where id=req.target_id)
          when req.target_type='client' then (select jsonb_build_object('full_name',full_name,'phone',phone,'address',address) from clients where id=req.target_id) else '{}'::jsonb end));
    end loop;
    return result;
  elsif p_action='create_request' then
    select * into template from prospect_questionnaire_templates where id=(p_data->>'template_id')::uuid;
    if not found or (template.owner_id is not null and template.owner_id<>p_actor) then
      raise exception 'Template not found.' using errcode='42501'; end if;
    if p_data->>'target_id' is not null then
      perform intelligence_dossier_scope(p_actor,p_data->>'target_type',(p_data->>'target_id')::uuid);
    elsif exists(select 1 from leads where lower(trim(email))=lower(p_data->>'recipient'))
      or exists(select 1 from clients where lower(trim(email))=lower(p_data->>'recipient')) then
      raise exception 'A record already uses that email. Open the saved record and create its questionnaire there.' using errcode='PT409';
    end if;
    insert into prospect_questionnaire_requests(id,actor_id,template_id,design,recipient,recipient_name,target_type,target_id,token_hash)
      values((p_data->>'id')::uuid,p_actor,template.id,p_data->'design',p_data->>'recipient',p_data->>'recipient_name',
        p_data->>'target_type',(p_data->>'target_id')::uuid,p_data->>'token_hash') returning * into req;
  else
    select * into req from prospect_questionnaire_requests where id=(p_data->>'id')::uuid for update;
    if not found then raise exception 'Request not found.' using errcode='P0002'; end if;
    if req.target_id is not null then perform intelligence_dossier_scope(p_actor,req.target_type,req.target_id);
    elsif req.actor_id<>p_actor and member.role not in ('owner','admin') then raise exception 'Request not found.' using errcode='42501'; end if;
    if p_action='invitation' then
      if req.state<>'open' or req.token_hash is distinct from p_data->>'token_hash' then
        raise exception 'This link is closed or replaced. Generate a current link before sending.' using errcode='PT409'; end if;
      return to_jsonb(req)-'token_hash';
    elsif p_action='file' then
      select f.* into item from prospect_questionnaire_files f where f.id=(p_data->>'file_id')::uuid and f.request_id=req.id and f.state='clean'
        and f.purged_at is null and exists(select 1 from prospect_questionnaire_submissions s where s.request_id=f.request_id and s.revision=f.revision
          and s.created_at+interval '24 hours'>clock_timestamp());
      if not found then raise exception 'This file is unavailable, expired or still awaiting its safety check.' using errcode='42501'; end if;
      insert into prospect_questionnaire_events(request_id,actor_id,action,details)
        values(req.id,p_actor,'file_access',jsonb_build_object('file_id',item.id));
      return to_jsonb(item);
    elsif p_action='rotate' then
      if req.state<>'open' then
        raise exception 'Choose an open request.' using errcode='22023'; end if;
      update prospect_questionnaire_requests set token_hash=p_data->>'token_hash',expires_at='infinity'
        where id=req.id returning * into req;
      delete from prospect_questionnaire_challenges where request_id=req.id;
    elsif p_action='reopen' then
      if member.role not in ('owner','admin') then raise exception 'Only administrators can reopen a submitted request.' using errcode='42501'; end if;
      if req.state<>'submitted' then
        raise exception 'Choose a submitted request.' using errcode='22023'; end if;
      update prospect_questionnaire_requests set revision=revision+1,state='open',token_hash=p_data->>'token_hash',
        expires_at='infinity' where id=req.id returning * into req;
      delete from prospect_questionnaire_challenges where request_id=req.id;
    elsif p_action='revoke' then
      if req.state<>'open' then raise exception 'Only an open request can be revoked.' using errcode='22023'; end if;
      update prospect_questionnaire_requests set state='revoked' where id=req.id returning * into req;
      delete from prospect_questionnaire_challenges where request_id=req.id;
    elsif p_action='review' then
      select * into submission from prospect_questionnaire_submissions
        where request_id=req.id and id=(p_data->>'submission_id')::uuid for update;
      if not found or submission.state<>'needs_review' then raise exception 'This submission was already reviewed.' using errcode='PT409'; end if;
      if p_data->>'decision' not in ('accepted','rejected') then raise exception 'Choose a review decision.' using errcode='22023'; end if;
      if req.target_type='lead' then
        select jsonb_build_object('full_name',full_name,'phone',phone,'address',address,'line_of_business',line_of_business)
          into current_values from leads where id=req.target_id for update;
      else
        select jsonb_build_object('full_name',full_name,'phone',phone,'address',address)
          into current_values from clients where id=req.target_id for update;
      end if;
      if current_values is distinct from p_data->'expected_values' then raise exception 'Record details changed. Reload before reviewing.' using errcode='PT409'; end if;
      if jsonb_typeof(p_data->'fields') is distinct from 'array' then raise exception 'Choose fields to apply.' using errcode='22023'; end if;
      if p_data->>'decision'='accepted' then
        for question in select jsonb_array_elements(submission.design->'questions') loop
          if question->>'field' in ('full_name','phone','address','line_of_business')
            and p_data->'fields' ? (question->>'field') then
            value:=nullif(submission.answers->>(question->>'id'),'');
            if value is not null then changes:=changes||jsonb_build_object(question->>'field',value); end if;
          end if;
        end loop;
        if req.target_type='lead' then
          update leads set full_name=coalesce(changes->>'full_name',full_name),phone=coalesce(changes->>'phone',phone),
            address=coalesce(changes->>'address',address),line_of_business=coalesce(changes->>'line_of_business',line_of_business)
            where id=req.target_id;
        else
          update clients set full_name=coalesce(changes->>'full_name',full_name),phone=coalesce(changes->>'phone',phone),
            address=coalesce(changes->>'address',address) where id=req.target_id;
        end if;
      end if;
      update prospect_questionnaire_submissions set state=p_data->>'decision',reviewed_by=p_actor,reviewed_at=clock_timestamp() where id=submission.id;
      if req.target_type='lead' then
        update leads set form_payload=jsonb_set(form_payload,'{questionnaire_review}',to_jsonb(p_data->>'decision'))
          where id=req.target_id and form_payload->>'questionnaire_request'=req.id::text;
      end if;
    else raise exception 'Unsupported request action.' using errcode='22023'; end if;
  end if;
  insert into prospect_questionnaire_events(request_id,actor_id,action,details)
    values(req.id,p_actor,p_action,jsonb_build_object('revision',req.revision,'submission_id',submission.id,'applied_fields',changes));
  return to_jsonb(req)-'token_hash';
end $$;

create or replace function public.prospect_questionnaire_public(p_hash text,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare req prospect_questionnaire_requests; challenge prospect_questionnaire_challenges; file prospect_questionnaire_files;
  saved prospect_questionnaire_submissions; bucket prospect_questionnaire_limits; limiter_key text; question jsonb; files_count integer; bytes bigint;
  lead_id uuid; initial_name text;
begin
  select * into req from prospect_questionnaire_requests where token_hash=p_hash for update;
  if found and req.state='submitted' and p_action in ('form','submit') and exists(
    select 1 from prospect_questionnaire_challenges where request_id=req.id and session_hash=p_data->>'session_hash'
      and session_expires_at>clock_timestamp()) then return jsonb_build_object('submitted',true); end if;
  if not found or req.state<>'open'
    or not exists(select 1 from agency_members where user_id=req.actor_id and active) then
    return jsonb_build_object('error','This link is closed or unavailable. Ask your agent for help.','status',410); end if;
  if req.target_id is not null then
    begin perform intelligence_dossier_scope(req.actor_id,req.target_type,req.target_id);
    exception when insufficient_privilege or no_data_found then
      return jsonb_build_object('error','This request is unavailable. Contact your agent.','status',410);
    end;
  end if;
  if p_action='challenge' then
    foreach limiter_key in array array['request:'||req.id, 'email:'||md5(req.recipient), 'network:'||(p_data->>'network')] loop
      insert into prospect_questionnaire_limits(key) values(limiter_key) on conflict do nothing;
      select * into bucket from prospect_questionnaire_limits l where l.key=limiter_key for update;
      if bucket.window_at<clock_timestamp()-interval '1 hour' then
        update prospect_questionnaire_limits l set count=0,window_at=clock_timestamp() where l.key=limiter_key;
        bucket.count:=0;
      end if;
      if bucket.count >= (case when limiter_key like 'network:%' then 30 else 6 end) then
        return jsonb_build_object('error','Too many code requests. Try again later.','status',429); end if;
      update prospect_questionnaire_limits l set count=count+1 where l.key=limiter_key;
    end loop;
    select * into challenge from prospect_questionnaire_challenges where request_id=req.id;
    if found and challenge.sent_at>clock_timestamp()-interval '1 minute' then
      return jsonb_build_object('error','Wait one minute before requesting another code.','status',429); end if;
    insert into prospect_questionnaire_challenges(request_id,code_hash,expires_at,contact)
      values(req.id,p_data->>'code_hash',clock_timestamp()+interval '10 minutes',coalesce(p_data->'contact','{}'))
      on conflict(request_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,
        contact=excluded.contact,sent_at=clock_timestamp(),attempts=0,session_hash=null,session_expires_at=null;
    return jsonb_build_object('recipient',req.recipient,'id',req.id);
  elsif p_action='verify' then
    select * into challenge from prospect_questionnaire_challenges where request_id=req.id for update;
    if not found or challenge.expires_at<=clock_timestamp() or challenge.attempts>=5 or challenge.session_hash is not null then
      return jsonb_build_object('error','Request a new code.','status',403); end if;
    update prospect_questionnaire_challenges set attempts=attempts+1 where request_id=req.id;
    if challenge.code_hash is distinct from p_data->>'code_hash' then
      return jsonb_build_object('error','The code is incorrect.','status',403); end if;
    update prospect_questionnaire_challenges set session_hash=p_data->>'new_session',
      session_expires_at='infinity' where request_id=req.id;
    insert into prospect_questionnaire_events(request_id,action) values(req.id,'email_verified');
    return jsonb_build_object('verified',true);
  end if;
  select * into challenge from prospect_questionnaire_challenges where request_id=req.id;
  if not found or challenge.session_hash is null or challenge.session_hash is distinct from p_data->>'session_hash'
    or challenge.session_expires_at<=clock_timestamp() then
    return jsonb_build_object('error','Verify your email to continue.','status',401); end if;
  if p_action='form' then
    return jsonb_build_object('design',req.design,'recipient_name',req.recipient_name,'revision',req.revision,
      'contact',challenge.contact,
      'files',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'question_id',question_id,'state',state)),'[]')
        from prospect_questionnaire_files where request_id=req.id and revision=req.revision and state<>'removed'));
  elsif p_action='upload' then
    if not exists(select 1 from jsonb_array_elements(req.design->'questions') q where q->>'id'=p_data->>'question_id' and q->>'type'='file') then
      raise exception 'Choose a document question.' using errcode='22023'; end if;
    if not exists(select 1 from prospect_questionnaire_scanner where id=1 and seen_at>clock_timestamp()-interval '5 minutes') then
      raise exception 'Document safety checks are unavailable. Try again later.' using errcode='22023'; end if;
    if not exists(select 1 from prospect_questionnaire_cleanup where id=1 and seen_at>clock_timestamp()-interval '5 minutes') then
      raise exception 'Document cleanup is unavailable. Try again later.' using errcode='22023'; end if;
    if (select count(*) from prospect_questionnaire_files where request_id=req.id and revision=req.revision)>=30 then
      raise exception 'Too many upload attempts. Ask your agent for a new request.' using errcode='22023'; end if;
    select count(*),coalesce(sum(size),0) into files_count,bytes from prospect_questionnaire_files
      where request_id=req.id and revision=req.revision and state<>'removed';
    if files_count>=10 or bytes+(p_data->>'size')::integer>52428800 then raise exception 'Upload limit reached: 10 files and 50 MB total.' using errcode='22023'; end if;
    insert into prospect_questionnaire_files(id,request_id,revision,question_id,name,size,content_type,storage_path)
      values((p_data->>'id')::uuid,req.id,req.revision,(p_data->>'question_id')::uuid,p_data->>'name',
        (p_data->>'size')::integer,p_data->>'type',req.id||'/'||req.revision||'/'||(p_data->>'id')) returning * into file;
    return to_jsonb(file);
  elsif p_action='remove_file' then
    select * into file from prospect_questionnaire_files where id=(p_data->>'id')::uuid and request_id=req.id and revision=req.revision for update;
    if not found then raise exception 'File not found.' using errcode='P0002'; end if;
    update prospect_questionnaire_files set state='removed',lease=null,lease_until=null where id=file.id;
    return jsonb_build_object('storage_path',file.storage_path);
  elsif p_action='submit' then
    if jsonb_typeof(p_data->'answers') is distinct from 'object' or p_data->'consent' is distinct from 'true'::jsonb then
      raise exception 'Review and confirm your submission.' using errcode='22023'; end if;
    for question in select jsonb_array_elements(req.design->'questions') loop
      if question->>'type'='file' and question->'required'='true'::jsonb and not exists(
        select 1 from prospect_questionnaire_files f join storage.objects o on o.bucket_id='prospect-documents' and o.name=f.storage_path
        where f.request_id=req.id and f.revision=req.revision and f.state<>'removed' and f.question_id=(question->>'id')::uuid
          and (o.metadata->>'size')::bigint=f.size) then
        raise exception 'Upload each required document before submitting.' using errcode='22023'; end if;
    end loop;
    if exists(select 1 from prospect_questionnaire_files f left join storage.objects o
      on o.bucket_id='prospect-documents' and o.name=f.storage_path
      where f.request_id=req.id and f.revision=req.revision and f.state<>'removed'
        and (o.id is null or (o.metadata->>'size')::bigint is distinct from f.size)) then
      raise exception 'An upload is unfinished. Retry or remove it before submitting.' using errcode='22023'; end if;
    if req.target_id is null then
      perform pg_advisory_xact_lock(hashtextextended('prospect-questionnaire:'||req.recipient,0));
      if exists(select 1 from leads where lower(trim(email))=req.recipient)
        or exists(select 1 from clients where lower(trim(email))=req.recipient) then
        raise exception 'A matching record was added after this request. Ask your agent to send a request from that record.' using errcode='PT409'; end if;
      initial_name:=req.recipient_name;
      insert into leads(full_name,email,status,source,agent_user_id,form_payload)
        values(initial_name,req.recipient,'new','prospect_questionnaire',req.actor_id,
          jsonb_build_object('questionnaire_review','needs_review','questionnaire_request',req.id))
        returning id into lead_id;
      update prospect_questionnaire_requests set target_type='lead',target_id=lead_id where id=req.id returning * into req;
    end if;
    insert into prospect_questionnaire_submissions(request_id,revision,answers,design,contact)
      values(req.id,req.revision,p_data->'answers',req.design,challenge.contact) returning * into saved;
    update prospect_questionnaire_requests set state='submitted' where id=req.id;
    -- Allow a lost-response retry without leaving submitted-document sessions open indefinitely.
    update prospect_questionnaire_challenges set session_expires_at=clock_timestamp()+interval '24 hours' where request_id=req.id;
    insert into prospect_questionnaire_events(request_id,action,details) values(req.id,'submitted',jsonb_build_object('submission_id',saved.id,'revision',req.revision));
    insert into tasks(subject,description,status,priority,related_type,related_id,assignee,action_href)
      values('Review questionnaire: '||req.recipient_name,'Review submitted answers and private documents.','open','high',req.target_type,req.target_id,
        (select email from agency_members where user_id=req.actor_id),
        '/questionnaires?type='||req.target_type||'&id='||req.target_id);
    return jsonb_build_object('submitted',true);
  end if;
  raise exception 'Unsupported questionnaire action.' using errcode='22023';
end $$;

commit;
