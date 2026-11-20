begin;

create function public.team_has_permission(p_actor uuid,p_permission text,p_required_scope text default 'agency')
returns boolean language plpgsql stable security definer set search_path=public as $$
declare actor agency_members; rollout_enabled boolean; grants jsonb; actual_scope text; actual_rank integer; required_rank integer;
begin
  select * into actor from public.agency_members where user_id=p_actor;
  select coalesce((select enabled from public.team_access_rollout where singleton),false) into rollout_enabled;
  if actor.user_id is null or not actor.active then return false; end if;
  if actor.role='owner' then return true; end if;
  if rollout_enabled and not exists(select 1 from auth.users u where u.id=p_actor
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=now())) then return false; end if;
  if actor.direct_grants is not null then grants:=actor.direct_grants;
  elsif rollout_enabled then grants:=public.team_effective_access(p_actor);
  elsif actor.invitation_id is null then return true;
  else return false;
  end if;
  actual_scope:=grants->>p_permission;
  actual_rank:=case actual_scope when 'self' then 1 when 'assigned' then 2 when 'agency' then 3 else 0 end;
  required_rank:=case p_required_scope when 'self' then 1 when 'assigned' then 2 when 'agency' then 3 else 4 end;
  return actual_rank>=required_rank;
end;
$$;
revoke all on function public.team_has_permission(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.team_has_permission(uuid,text,text) to service_role;

do $migration$
declare patch record; target regprocedure; definition text;
begin
  for patch in
    select * from (values
      ('public.save_carrier_appetite(uuid,uuid,integer,text,jsonb)',
        'perform 1 from agency_members where user_id=p_actor and active and role=''owner'' for share;'||chr(10)||
          '  if not found then raise exception ''Only an active owner can manage carrier appetite'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''knowledge.edit'',''agency'') then raise exception ''Knowledge management is required'' using errcode=''42501''; end if;'),
      ('public.save_sales_template(uuid,text,integer,jsonb)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin''))',
        'not public.team_has_permission(p_actor,''content.edit'',''agency'')'),
      ('public.save_agency_outreach_settings_versioned(uuid,jsonb,integer,boolean)',
        'not exists(select 1 from public.agency_members where user_id=p_actor and active and role=''owner'')',
        'not (public.team_has_permission(p_actor,''automation.manage'',''agency'') or public.team_has_permission(p_actor,''agency.manage'',''agency''))'),
      ('public.save_agency_outreach_settings_internal(uuid,jsonb,boolean)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not (public.team_has_permission(p_actor,''automation.manage'',''agency'') or public.team_has_permission(p_actor,''agency.manage'',''agency''))'),
      ('public.save_agency_automation_settings(uuid,jsonb,integer)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.configure_crm_scheduler(uuid,boolean)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.save_business_research_settings(uuid,integer,jsonb,jsonb)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.retry_business_research_job(uuid,uuid)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.retry_business_research_partition(uuid,text,text)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.save_workflow_rule(uuid,uuid,integer,jsonb)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.apply_workflow_backlog(uuid,uuid,integer,bigint,text)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.release_workflow_backlog(uuid)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.save_agency_outreach_settings(uuid,jsonb,boolean)',
        'not exists(select 1 from public.agency_members where user_id=p_actor and active and role=''owner'')',
        'not (public.team_has_permission(p_actor,''automation.manage'',''agency'') or public.team_has_permission(p_actor,''agency.manage'',''agency''))'),
      ('public.configure_personal_gmail_scheduler(uuid,boolean)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''integrations.manage'',''agency'')'),
      ('public.begin_social_oauth(uuid,text,text,text)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'  if not found then raise exception ''Only an active owner or administrator can connect social accounts.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.connections'',''agency'') then raise exception ''Social connection management is required'' using errcode=''42501''; end if;'),
      ('public.consume_social_oauth_state(uuid,text,text)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'  if not found then raise exception ''Only an active owner or administrator can connect social accounts.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.connections'',''agency'') then raise exception ''Social connection management is required'' using errcode=''42501''; end if;'),
      ('public.store_social_oauth_grant(uuid,uuid,text,text,text,text[],timestamp with time zone)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'  if not found then raise exception ''Only an active owner or administrator can connect social accounts.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.connections'',''agency'') then raise exception ''Social connection management is required'' using errcode=''42501''; end if;'),
      ('public.finish_social_oauth_grant(uuid,uuid)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'  if not found then raise exception ''Only an active owner or administrator can connect social accounts.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.connections'',''agency'') then raise exception ''Social connection management is required'' using errcode=''42501''; end if;'),
      ('public.load_social_oauth_grant(uuid,uuid)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'  if not found then raise exception ''Only an active owner or administrator can connect social accounts.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.connections'',''agency'') then raise exception ''Social connection management is required'' using errcode=''42501''; end if;'),
      ('public.save_social_provider_accounts(uuid,uuid,jsonb)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'  if not found then raise exception ''Only an active owner or administrator can connect social accounts.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.connections'',''agency'') then raise exception ''Social connection management is required'' using errcode=''42501''; end if;'),
      ('public.disconnect_social_provider_account(uuid,uuid)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'  if not found then raise exception ''Only an active owner or administrator can disconnect social accounts.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.connections'',''agency'') then raise exception ''Social connection management is required'' using errcode=''42501''; end if;'),
      ('public.load_social_provider_revoke(uuid,uuid)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'  if not found then raise exception ''Only an active owner or administrator can revoke Meta authorization.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.connections'',''agency'') then raise exception ''Social connection management is required'' using errcode=''42501''; end if;'),
      ('public.finish_social_provider_revoke(uuid,uuid,boolean,text)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'  if not found then raise exception ''Only an active owner or administrator can revoke Meta authorization.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.connections'',''agency'') then raise exception ''Social connection management is required'' using errcode=''42501''; end if;'),
      ('public.review_social_draft(uuid,uuid,text,integer,integer,text)',
        'perform 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'') for share;'||chr(10)||'    if not found then raise exception ''Only active owners and administrators can review social posts.'' using errcode=''42501''; end if;',
        'if not public.team_has_permission(p_actor,''social.approve'',''agency'') then raise exception ''Social review permission is required'' using errcode=''42501''; end if;'),
      ('public.list_social_drafts(uuid,text,integer,uuid)',
        'exists(select 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin''))',
        'public.team_has_permission(p_actor,''social.approve'',''agency'')'),
      ('public.list_social_engine(uuid)',
        'exists(select 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin''))',
        'public.team_has_permission(p_actor,''social.publish'',''agency'')'),
      ('public.list_social_provider_connections(uuid)',
        'exists(select 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin''))',
        'public.team_has_permission(p_actor,''social.connections'',''agency'')'),
      ('public.command_social_engine(uuid,jsonb)',
        'if not found then raise exception ''An active owner or administrator must manage publishing.'' using errcode=''42501''; end if;',
        'if action=''approve'' and not public.team_has_permission(p_actor,''social.approve'',''agency'') then raise exception ''Social review permission is required.'' using errcode=''42501''; elsif action in (''schedule'',''retry'',''confirm'',''pause'') and not public.team_has_permission(p_actor,''social.publish'',''agency'') then raise exception ''Social publishing permission is required.'' using errcode=''42501''; end if;'),
      ('public.save_opportunity_settings(uuid,integer,jsonb)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.save_discovery_source_core(uuid,jsonb,uuid,timestamptz)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.claim_email_setup_check(uuid,uuid,text)',
        'select * into member from agency_members where user_id=p_actor and active and role=''owner'';',
        'select * into member from agency_members where user_id=p_actor and active;'),
      ('public.claim_email_setup_check(uuid,uuid,text)',
        'if member.user_id is null then raise exception ''Only the owner can test agency email'' using errcode=''42501''; end if;',
        'if member.user_id is null or not public.team_has_permission(p_actor,''integrations.manage'',''agency'') then raise exception ''Integration management is required'' using errcode=''42501''; end if;'),
      ('public.review_policy_knowledge_candidate(uuid,uuid,integer,boolean)',
        'perform 1 from agency_members where user_id=p_actor and active and role=''owner'' for share;',
        'if not public.team_has_permission(p_actor,''knowledge.edit'',''agency'') then raise exception ''Knowledge management is required'' using errcode=''42501''; end if;'),
      ('public.save_policy_knowledge_candidate(uuid,uuid,integer,jsonb)',
        'select role=''owner'' into owner_actor from agency_members where user_id=p_actor;',
        'select public.team_has_permission(p_actor,''knowledge.edit'',''agency'') into owner_actor;'),
      ('public.request_account_email(uuid,text)',
        'member.role in (''owner'',''admin'')',
        'public.team_has_permission(p_actor,''team.manage'',''agency'')'),
      ('public.guard_account_email()',
        '(member.role in (''owner'',''admin'') and item.approved_by=old.id)',
        '(public.team_has_permission(old.id,''team.manage'',''agency'') and item.approved_by=old.id)'),
      ('public.guard_account_email()',
        'exists(select 1 from agency_members where user_id=item.approved_by and active and role=''owner'')',
        'public.team_has_permission(item.approved_by,''team.manage'',''agency'')'),
      ('public.decide_account_email(uuid,uuid,boolean)',
        'not exists(select 1 from agency_members where user_id=p_actor and active and role=''owner'')',
        'not public.team_has_permission(p_actor,''team.manage'',''agency'')'),
      ('public.intelligence_dossier_scope(uuid,text,uuid)',
        'if member.role=''agent'' and lead.agent_user_id is not null and lead.agent_user_id<>p_actor then',
        'if not public.team_has_permission(p_actor,''leads.view'',''agency'') and lead.agent_user_id is distinct from p_actor then'),
      ('public.intelligence_dossier_scope(uuid,text,uuid)',
        'if member.role=''agent'' and client.agent_user_id is not null and client.agent_user_id<>p_actor then',
        'if not public.team_has_permission(p_actor,''accounts.view'',''agency'') and client.agent_user_id is distinct from p_actor then'),
      ('public.get_intelligence_dossier(uuid,text,uuid,integer)',
        'and (l.agent_user_id is null or l.agent_user_id=p_actor or exists(select 1 from agency_members where user_id=p_actor and role in (''owner'',''admin'') and active))',
        'and (public.team_has_permission(p_actor,''leads.view'',''agency'') or l.agent_user_id=p_actor)'),
      ('public.set_record_contact_preference(uuid,text,uuid,boolean,text)',
        'if v_member.role = ''agent'' and assigned_agent is not null and assigned_agent <> p_actor then',
        'if (p_type=''lead'' and not public.team_has_permission(p_actor,''leads.edit'',''assigned'')) or (p_type=''client'' and not public.team_has_permission(p_actor,''accounts.edit'',''assigned'')) or assigned_agent is distinct from p_actor then'),
      ('public.create_prospecting_cadence(uuid,uuid,uuid,jsonb,jsonb)',
        'if v_member.role=''agent'' and lead_row.agent_user_id is not null and lead_row.agent_user_id<>p_actor then',
        'if not public.team_has_permission(p_actor,''campaigns.send'',''agency'') or not public.team_has_permission(p_actor,''leads.view'',''assigned'') or (not public.team_has_permission(p_actor,''leads.view'',''agency'') and lead_row.agent_user_id is distinct from p_actor) then'),
      ('public.create_prospecting_nurture(uuid,uuid,date)',
        'or (member_row.role=''agent'' and lead_row.agent_user_id is not null and lead_row.agent_user_id<>p_actor) then',
        'or not public.team_has_permission(p_actor,''campaigns.send'',''agency'') or not public.team_has_permission(p_actor,''leads.view'',''assigned'') or (not public.team_has_permission(p_actor,''leads.view'',''agency'') and lead_row.agent_user_id is distinct from p_actor) then'),
      ('public.complete_prospecting_call_touch(uuid,uuid,text)',
        'if cadence.id is null or cadence.status<>''active'' or cadence.agent_user_id is distinct from p_actor',
        'if cadence.id is null or cadence.status<>''active'' or (cadence.agent_user_id is distinct from p_actor and not public.team_has_permission(p_actor,''campaigns.send'',''agency''))'),
      ('public.create_opportunity_task(uuid,text,uuid,text,uuid,timestamp with time zone,uuid)',
        'member.role=''agent'' and p_assignee<>p_actor',
        'p_assignee<>p_actor and not public.team_has_permission(p_actor,''tasks.assign'',''agency'')'),
      ('public.enroll_sales_sequence(uuid,uuid,jsonb,integer)',
        'and exists(select 1 from agency_members where user_id=p_actor and role=''agent'')',
        'and (not public.team_has_permission(p_actor,''automation.manage'',''agency'') or not public.team_has_permission(p_actor,''leads.view'',''agency''))'),
      ('public.create_prospecting_nurture(uuid,uuid,date)',
        'if member_row.user_id is null or lead_row.id is null',
        'if member_row.user_id is null or not public.team_has_permission(p_actor,''campaigns.send'',''agency'') or lead_row.id is null'),
      ('public.opportunity_queue(uuid,integer)',
        'member.role<>''agent'' or l.agent_user_id is null or l.agent_user_id=p_actor',
        'public.team_has_permission(p_actor,''leads.view'',''agency'') or l.agent_user_id=p_actor'),
      ('public.opportunity_queue(uuid,integer)',
        'member.role<>''agent'' or c.agent_user_id is null or c.agent_user_id=p_actor',
        'public.team_has_permission(p_actor,''accounts.view'',''agency'') or c.agent_user_id=p_actor'),
      ('public.get_business_research(uuid,uuid)',
        'member.role<>''agent'' or' || chr(10) || '    (lead.agent_user_id is null or lead.agent_user_id=p_actor) and (client.agent_user_id is null or client.agent_user_id=p_actor)',
        '(lead.id is null or public.team_has_permission(p_actor,''leads.view'',''agency'') or lead.agent_user_id=p_actor)' || chr(10) ||
        '    and (client.id is null or public.team_has_permission(p_actor,''accounts.view'',''agency'') or client.agent_user_id=p_actor)'),
      ('public.get_record_business_research(uuid,text,uuid)',
        'and (lead.agent_user_id is null or lead.agent_user_id=p_actor or exists(select 1 from agency_members where user_id=p_actor and active and role in (''owner'',''admin'')))',
        'and (public.team_has_permission(p_actor,''leads.view'',''agency'') or lead.agent_user_id=p_actor)'),
      ('public.get_opportunity_dashboard(uuid)',
        'member.role<>''agent'' or coalesce(c.agent_user_id,l.agent_user_id) is null or coalesce(c.agent_user_id,l.agent_user_id)=p_actor',
        '(public.team_has_permission(p_actor,''leads.view'',''agency'') or l.agent_user_id=p_actor) and (c.id is null or public.team_has_permission(p_actor,''accounts.view'',''agency'') or c.agent_user_id=p_actor)'),
      ('public.get_opportunity_dashboard(uuid)',
        'member.role=''owner''',
        'public.team_has_permission(p_actor,''automation.manage'',''agency'')'),
      ('public.build_opportunity_digests()',
        'member.role<>''agent'' or coalesce(c.agent_user_id,l.agent_user_id) is null or coalesce(c.agent_user_id,l.agent_user_id)=member.user_id',
        '(l.id is null or public.team_has_permission(member.user_id,''leads.view'',''agency'') or l.agent_user_id=member.user_id) and (c.id is null or public.team_has_permission(member.user_id,''accounts.view'',''agency'') or c.agent_user_id=member.user_id)'),
      ('public.save_calendar_event(uuid,jsonb,boolean,text,uuid)',
        'if saved.related_type=''client'' then' || chr(10) ||
        '    perform 1 from clients where id=saved.related_id and (member_role<>''agent'' or agent_user_id is null or agent_user_id=p_user);',
        'if saved.related_type=''client'' then' || chr(10) ||
        '    perform 1 from clients where id=saved.related_id and (public.team_has_permission(p_user,''accounts.view'',''agency'') or (agent_user_id=p_user and public.team_has_permission(p_user,''accounts.view'',''assigned'')));'),
      ('public.save_calendar_event(uuid,jsonb,boolean,text,uuid)',
        'select account_id into account from leads where id=saved.related_id and archived_at is null' || chr(10) ||
        '      and (member_role<>''agent'' or agent_user_id is null or agent_user_id=p_user);',
        'select account_id into account from leads where id=saved.related_id and archived_at is null' || chr(10) ||
        '      and (public.team_has_permission(p_user,''leads.view'',''agency'') or (agent_user_id=p_user and public.team_has_permission(p_user,''leads.view'',''assigned'')));'),
      ('public.save_calendar_event(uuid,jsonb,boolean,text,uuid)',
        'if account is not null then' || chr(10) ||
        '    perform 1 from clients where id=account and (member_role<>''agent'' or agent_user_id is null or agent_user_id=p_user);',
        'if account is not null then' || chr(10) ||
        '    perform 1 from clients where id=account and (public.team_has_permission(p_user,''accounts.view'',''agency'') or (agent_user_id=p_user and public.team_has_permission(p_user,''accounts.view'',''assigned'')));')
    ) as replacements(signature,old_text,new_text)
  loop
    target:=to_regprocedure(patch.signature);
    if target is null then continue; end if;
    definition:=replace(pg_get_functiondef(target),chr(13)||chr(10),chr(10));
    if strpos(definition,patch.old_text)=0 then
      raise exception 'Authorization source changed unexpectedly in %',patch.signature;
    end if;
    execute replace(definition,patch.old_text,patch.new_text);
  end loop;
end;
$migration$;

notify pgrst,'reload schema';
commit;
