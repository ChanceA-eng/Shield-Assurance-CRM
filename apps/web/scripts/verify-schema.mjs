import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  if (process.env.VERCEL) {
    throw new Error('Schema verification requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  console.log('Skipping schema verification outside Vercel because Supabase credentials are not configured.');
  process.exit(0);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const checks = [
  supabase.from('email_signature_designs').select('user_id,document,rows').limit(0),
  supabase.from('scheduled_messages').select('body_document').limit(0),
  supabase.from('agent_email_attempts').select('email_formatting').limit(0),
  supabase.from('active_workspace_tasks').select('id,related_type,related_id,status').limit(0),
  supabase.from('workers_comp_evidence').select('id,lead_id,client_id,revision,evidence,updated_at,updated_by', { head: true }),
  supabase.from('record_contact_preferences').select('lead_id,client_id,do_not_contact,reason,updated_at,updated_by', { head: true }),
  supabase.rpc('lead_contact_restrictions', { p_leads: [] }),
  supabase.from('prospecting_cadences').select('id,lead_id,agent_user_id,status,context', { head: true }),
  supabase.from('prospecting_cadence_touches').select('id,cadence_id,touch_number,channel,due_at,status,outbox_id', { head: true }),
  supabase.from('outreach_outbox').select('prospecting_touch_id', { head: true }),
  ...(process.env.CRM_PROSPECT_REQUESTS_ENABLED === 'true' ? [
    supabase.from('prospect_questionnaire_templates').select('id,owner_id,source_id,source_revision,revision,design', { head: true }),
    supabase.from('prospect_questionnaire_requests').select('id,actor_id,design,recipient,target_type,target_id,revision,state,expires_at', { head: true }),
    supabase.from('prospect_questionnaire_submissions').select('id,request_id,revision,answers,contact,state,reviewed_by', { head: true }),
    supabase.from('prospect_questionnaire_challenges').select('request_id,contact,session_expires_at', { head: true }),
    supabase.from('prospect_questionnaire_files').select('id,request_id,revision,question_id,storage_path,state,digest,lease,lease_until,ticket_expires_at,cleanup_lease,purged_at', { head: true }),
    supabase.from('prospect_questionnaire_scanner').select('seen_at,version', { head: true }),
    supabase.from('prospect_questionnaire_cleanup').select('seen_at', { head: true }),
  ] : []),
  supabase.from('business_research_sources').select('provider,enabled,retained_rights,revision', { head: true }),
  supabase.from('business_research_entities').select('id,identity_key,name,updated_at', { head: true }),
  supabase.from('business_research_observations').select('business_id,provider,record_id,observation,fetched_at', { head: true }),
  supabase.from('business_research_links').select('business_id,lead_id,client_id,actor_id', { head: true }),
  supabase.from('business_research_jobs').select('business_id,state,lease,lease_until,attempts,result,due_at', { head: true }),
  supabase.from('business_research_settings').select('enabled,tasks_enabled,task_capacity,task_due_days,refresh_days,revision', { head: true }),
  supabase.from('business_research_task_receipts').select('business_id,scope_key,kind,task_id,assignee_id,created_at', { head: true }),
  supabase.from('business_research_partitions').select('provider,state,active_version,building_version,cursor,status,lease,lease_until', { head: true }),
  supabase.from('business_research_directory_records').select('provider,state,version,record_id,business_code,latitude,longitude,observation', { head: true }),
  supabase.from('instantly_campaigns').select('id,created_by,status,provider_campaign_id,provider_webhook_id,sender_accounts,daily_limit,last_error', { head: true }),
  supabase.from('instantly_campaign_leads').select('campaign_id,lead_id,email,draft_subject,draft_body,cited_signals,status', { head: true }),
  supabase.from('instantly_webhook_events').select('event_key,campaign_id,lead_id,event_type', { head: true }),
  supabase.from('gmail_connections').select('id,sync_enabled', { head: true }),
  supabase.from('gmail_oauth_states').select('state_hash,scope_mode', { head: true }),
  supabase.from('KnowledgeDocument').select('id,sourcePublishedAt', { head: true }),
  supabase.from('policy_knowledge_candidates').select('id,account_id,revision,state,approved_revision,document_id', { head: true }),
  supabase.from('policy_knowledge_review_events').select('candidate_id,actor_id,action,revision', { head: true }),
  supabase.from('carrier_appetite_documents').select('id,revision,state,values,pages,storage_path,approved_by,approved_at', { head: true }),
  supabase.from('carrier_appetite_revisions').select('document_id,revision,actor_id,snapshot', { head: true }),
  supabase.from('carrier_appetite_ai_readings').select('source_hash,reader_version,state,reading,updated_at', { head: true }),
  supabase.rpc('carrier_appetite_source_overlaps'),
  supabase.from('opportunity_profiles').select('scope_key,revision,profile,updated_by', { head: true }),
  supabase.from('opportunity_profile_history').select('scope_key,revision,actor_id,profile', { head: true }),
  supabase.from('opportunity_drafts').select('id,scope_key,actor_id,revision,state,evidence_token,request_id,subject,body', { head: true }),
  supabase.from('opportunity_action_events').select('draft_id,scope_key,actor_id,action,snapshot', { head: true }),
  supabase.from('opportunity_settings').select('id,revision,config', { head: true }),
  supabase.from('opportunity_operation_events').select('id,entity_id,scope_key,actor_id,kind,payload', { head: true }),
  supabase.from('opportunity_watches').select('id,actor_id,target_type,target_id,scope_key,lease_token,lease_until,attempts,next_due_at,error', { head: true }),
  supabase.from('opportunity_job_history').select('watch_id,lease_token,state,started_at,finished_at', { head: true }),
  supabase.from('opportunity_digests').select('actor_id,local_day,items', { head: true }),
  supabase.from('sales_templates').select('id,name,category,subject,email_body,sms_body,email_design,revision,archived', { head: true }),
  supabase.from('sales_template_revisions').select('template_id,revision,snapshot,actor_id', { head: true }),
  supabase.from('sequence_enrollments').select('sales_plan', { head: true }),
  supabase.from('outreach_outbox').select('sales_template', { head: true }),
  supabase.from('agent_email_attempts').select('sales_template', { head: true }),
  supabase.from('scheduled_messages').select('sales_template', { head: true }),
  supabase.from('scheduled_messages').select('id,lead_id,agent_user_id,approved_recipient,send_at,status,last_error', { head: true }),
  supabase.from('intelligence_dossiers').select('scope_key,version,findings', { head: true }),
  supabase.from('intelligence_dossier_confirmations').select('id,scope_key,version,actor_id,reference,source_as_of', { head: true }),
  supabase.from('social_marketing_workspaces').select('id,singleton').limit(0),
  supabase.from('social_posts').select('review_state,review_version').limit(0),
  supabase.from('social_review_events').select('post_id,revision,review_version,action,actor_id,reason').limit(0),
  supabase.from('social_intents').select('id,post_id,revision,destination,connection_id,state,version,scheduled_at,approved_by,container_id,remote_id,permalink,publish_dispatched_at').limit(0),
  supabase.from('social_engine_controls').select('workspace_id,paused,worker_seen_at,worker_test_enabled,worker_real_enabled').limit(0),
  supabase.from('social_attempts').select('lease_id,intent_id,attempt,outcome').limit(0),
  supabase.from('social_outbox').select('intent_id,version,due_at').limit(0),
  supabase.from('social_oauth_states').select('state_hash,browser_hash,workspace_id,actor_id,expires_at').limit(0),
  supabase.from('social_oauth_grants').select('id,workspace_id,actor_id,encrypted_user_token,granted_scopes,expires_at').limit(0),
  supabase.from('social_provider_grants').select('id,workspace_id,provider,encrypted_user_token,state,authorized_by,granted_scopes,token_expires_at').limit(0),
  supabase.from('social_provider_connections').select('id,workspace_id,grant_id,platform,external_account_id,encrypted_page_token,state,can_publish,capability_reason').limit(0),
  supabase.from('social_media_assets').select('id,workspace_id,status,alt_text,rights_reference,width,height,byte_size').limit(0),
  supabase.from('social_revision_media').select('post_id,revision,media_id').limit(0),
  supabase.from('social_posts').select('media_ids').limit(0),
  supabase.from('social_post_revisions').select('media_ids').limit(0),
  supabase.from('social_posts').select('id,workspace_id,title,caption,link_url,revision,status,created_by,updated_by').limit(0),
  supabase.from('social_post_revisions').select('post_id,workspace_id,revision,link_url,action,actor_id').limit(0),
  supabase.from('discovery_sources').select('id,active,acquisition_until,permission_reference,provider', { head: true }),
  supabase.from('discovery_saved_searches').select('id,user_id,filters', { head: true }),
  supabase.from('import_batches').select('id,discovery_source_id,discovery_request_id,discovery_fingerprint', { head: true }),
  supabase.from('import_prospects').select('id,discovery_review,discovery_updated_at,discovery_note', { head: true }),
  supabase.from('intelligence_import_evidence').select('id,lead_id,prospect_id,source_file,snapshot', { head: true }),
  supabase.from('intelligence_enrichment_observations').select('id,lead_id,source,match_method,snapshot', { head: true }),
  supabase.from('accounts').select('id,account_type,assigned_producer,csr,since_date,email_consent,sms_consent,preferred_channel', { head: true }),
  supabase.from('leads').select('id,account_id,confirmed_fields,industry,last_viewed_at,last_activity_at,pipeline_stage,producer_owner,close_probability,expected_premium', { head: true }),
  supabase.from('clients').select('id,account_type,assigned_producer,csr,since_date,policy_effective_at,last_viewed_at,last_activity_at,intake_details', { head: true }),
  supabase.from('personal_applicants').select('id,lead_id,account_id,first_name,last_name,dob,gender,marital_status,ssn_masked,dl_number_masked,dl_status,dl_state,education,occupation,industry,prior_employer_years,applicant_type,lead_source,preferred_language', { head: true }),
  supabase.from('policies').select('id,client_id,account_id,policy_number,line_of_business,sub_type,premium,effective_date,renewal_date,expiration_date,status,billing_type,source,prior_policy_id', { head: true }),
  supabase.from('renewals').select('id,client_id,account_id,renewal_date,expiration_date,renewal_bucket', { head: true }),
  supabase.from('renewal_reviews').select('id,policy_id,account_id,renewal_term,status,assigned_to,notes,follow_up_date,next_policy_id,version,updated_by', { head: true }),
  supabase.from('renewal_review_events').select('review_id,actor_id,event_type,from_status,to_status,snapshot', { head: true }),
  supabase.rpc('crm_reporting_summary', {
    p_range_start: '2026-01-01', p_range_end: '2026-12-31',
    p_month_start: '2026-01-01', p_year_start: '2026-01-01', p_carrier: 'all',
  }),
  supabase.from('policy_change_requests').select('id,policy_id,requested_at,description,status,requested_by,assigned_to', { head: true }),
  supabase.from('policy_change_request_documents').select('id,request_id,file_id,file_snapshot,added_by,added_at', { head: true }),
  supabase.from('policy_transactions').select('id,policy_id,transaction_type,effective_date,snapshot', { head: true }),
  supabase.from('applications').select('id,account_id,line_of_business,status,created_at', { head: true }),
  supabase.from('claims').select('id,policy_id,client_id,account_id,claim_number,date_of_loss,status,description,adjuster_name,adjuster_contact,reserve_amount,payout_amount', { head: true }),
  supabase.from('claim_record_events').select('claim_id,actor_id,event_type,from_status,to_status,snapshot', { head: true }),
  supabase.from('certificates').select('id,client_id,account_id,policy_id,certificate_holder,holder_name,holder_address,issue_date,issued_date,expiration_date,coverage_summary,file_path,is_master,master_template_id,requested_at,requested_for,version,updated_by,reviewed_at,reviewed_by,issued_by,document_id,delivery_reported_at,delivery_method,delivery_reference,delivery_reported_by', { head: true }),
  supabase.from('certificate_record_events').select('certificate_id,actor_id,event_type,from_status,to_status,snapshot', { head: true }),
  supabase.from('billing_records').select('id,policy_id,account_id,invoice_date,due_date,amount,status,payment_method,commission_percent,commission_amount', { head: true }),
  supabase.from('tasks').select('id,account_id,kind,note_id,completed_at,updated_at,intake_event_id,status,priority,due_date,assignee', { head: true }),
  supabase.from('client_assets').select('id,client_id,lead_id,title,asset_type,value,metadata,archived_at,created_at,updated_at', { head: true }),
  supabase.from('interactions').select('id,lead_id,client_id,note_type,pinned,author_name,updated_at', { head: true }),
  supabase.from('lead_intake_events').select('id,lead_id,submission_key,submitted_at,received_at,time_basis,snapshot,opened_at,dismissed_at,handled_at,leads!inner(full_name,line_of_business,account_id,industry)', { head: true }),
  supabase.from('website_submission_receipts').select('submission_key,lead_id,recorded_at', { head: true }),
  supabase.rpc('website_submission_receipts_for', { p_payloads: [] }),
  supabase.from('notifications').select('id,task_id,reminder_version,intake_event_id,href', { head: true }),
  supabase.from('client_tasks').select('id,client_id,subject,description,due_date,status,priority,created_at,updated_at', { head: true }),
  supabase.from('client_files').select('id,client_id,file_name,file_url,file_type,file_size,status,metadata,uploaded_at,created_at', { head: true }),
  supabase.from('client_tags').select('id,client_id,tag,color,created_at', { head: true }),
  supabase.from('client_activities').select('id,client_id,activity_type,title,body,metadata,occurred_at,created_at', { head: true }),
  supabase.from('campaigns').select('id,name,status,account_id,list_name,scheduled_at,sent_at', { head: true }),
  supabase.from('campaign_sends').select('id,campaign_id,account_id,email,status,sent_at,error_message', { head: true }),
  supabase.from('outreach_settings').select('id,sender_profile,timezone', { head: true }),
  supabase.from('outreach_settings').select('configuration_revision,automation_configuration', { head: true }),
  supabase.from('automation_configuration_versions').select('revision,actor_id,configuration,recorded_at', { head: true }),
  supabase.from('sequence_enrollments').select('id,configuration_revision,step_gap_days,workflow_rule_id,workflow_execution_id', { head: true }),
  supabase.rpc('crm_scheduler_status'),
  supabase.rpc('preview_automation_job', { p_job: 'due-reminders' }),
  supabase.from('agency_members').select('user_id,role,active', { head: true }),
  supabase.from('account_email_changes').select('id,user_id,status,old_token_hash,new_token_hash,old_confirmed_at,new_confirmed_at', { head: true }),
  supabase.from('account_security_limits').select('key,started_at,attempts', { head: true }),
  supabase.from('email_setup_checks').select('id,configuration_hash,verified_at', { head: true }),
  supabase.from('email_suppressions').select('email,reason', { head: true }),
  supabase.from('marketing_email_consents').select('email,source,recorded_by_auth,revoked_at', { head: true }),
  supabase.from('resend_send_attempts').select('id,request_key,provider_id,status', { head: true }),
  supabase.from('resend_delivery_events').select('event_id,attempt_id,type,occurred_at', { head: true }),
  supabase.from('outreach_outbox').select('id,draft_revision,requires_manual_approval', { head: true }),
  supabase.from('outreach_marketing_profiles').select('id,lead_id,client_id,profile,updated_at', { head: true }),
  supabase.from('workflow_rules').select('id,trigger_type,action_type,template_id,content,offset_days,active', { head: true }),
  supabase.from('workflow_rules').select('id,revision,definition,owner_id,active_since', { head: true }),
  supabase.from('workflow_rule_versions').select('rule_id,revision,actor_id,definition,recorded_at', { head: true }),
  supabase.from('workflow_events').select('id,event_key,event_type,source_table,source_id,occurred_at,context', { head: true }),
  supabase.from('workflow_executions').select('id,event_id,rule_id,rule_revision,status,backlog_pending,result,error', { head: true }),
  supabase.rpc('workflow_rule_revision'),
  supabase.rpc('preview_automation_job', { p_job: 'custom-workflows' }),
  supabase.from('events').select('id,title,description,event_time,all_day,status,related_type,related_id,task_id,user_id,meeting_type,duration_minutes,location,calendar_sync,revision,time_zone,google_event_id,google_meet_url,sync_status', { head: true }),
  supabase.from('google_calendar_connections').select('user_id,email,status', { head: true }),
  supabase.from('zoom_connections').select('user_id,email,status', { head: true }),
  supabase.from('zoom_credentials').select('user_id,refresh_secret,access_secret,access_expires_at,refresh_lock,refresh_lease_until', { head: true }),
  supabase.from('zoom_oauth_states').select('state_hash,user_id,browser_hash,expires_at', { head: true }),
  supabase.from('events').select('zoom_meeting_id,zoom_join_url,zoom_subject,zoom_create_attempted_at', { head: true }),
  supabase.from('appointment_manage_tokens').select('event_id,expires_at', { head: true }),
  supabase.rpc('get_actionable_leads_count'),
  supabase.rpc('get_actionable_clients_count'),
];

for (const [name, args] of [
  ['get_business_research', { p_actor: '00000000-0000-0000-0000-000000000000', p_business: '00000000-0000-0000-0000-000000000000' }],
  ['save_research_business', { p_actor: '00000000-0000-0000-0000-000000000000', p_business: '00000000-0000-0000-0000-000000000000' }],
  ['browse_business_research_map_index', { p_actor: '00000000-0000-0000-0000-000000000000',
    p_state: '', p_city: '', p_bounds: null, p_query: '', p_tag_key: null, p_tag_pattern: null, p_zip: '', p_contact: '',
    p_latitude: null, p_longitude: null, p_radius_miles: null, p_page: 0 }],
]) {
  const result = await supabase.rpc(name, args);
  if (result.error?.code !== '42501') throw new Error(`Business research schema/scope contract failed (${name}). Apply the validated business research migrations through 20261111070000_business_research_browse.sql before release: ${result.error?.message ?? 'Unauthorized actor accepted.'}`);
}

for (const [name, args] of [
  ['save_policy_knowledge_candidate', { p_actor: '00000000-0000-0000-0000-000000000000', p_id: '00000000-0000-0000-0000-000000000000', p_expected: 0, p_values: {} }],
  ['review_policy_knowledge_candidate', { p_actor: '00000000-0000-0000-0000-000000000000', p_id: '00000000-0000-0000-0000-000000000000', p_expected: 1, p_approve: true }],
]) {
  const result = await supabase.rpc(name, args);
  if (result.error?.code !== '42501') throw new Error(`Policy wording review schema contract failed (${name}): ${result.error?.message ?? 'An unauthorized actor was accepted.'}`);
}

const appetiteContract = await supabase.rpc('save_carrier_appetite', {
  p_actor: '00000000-0000-0000-0000-000000000000', p_id: '00000000-0000-0000-0000-000000000000',
  p_expected: 0, p_action: 'activate', p_input: {},
});
if (appetiteContract.error?.code !== '42501') {
  throw new Error(`Carrier appetite review contract failed: ${appetiteContract.error?.message ?? 'An unauthorized actor was accepted.'}`);
}

for (const name of ['get_opportunity_context', 'get_opportunity_operations', 'opportunity_queue', 'get_opportunity_dashboard']) {
  const result = await supabase.rpc(name, name === 'opportunity_queue' ? { p_actor: '00000000-0000-0000-0000-000000000000', p_page: 0 }
    : name === 'get_opportunity_dashboard' ? { p_actor: '00000000-0000-0000-0000-000000000000' }
      : { p_actor: '00000000-0000-0000-0000-000000000000', p_type: 'lead', p_id: '00000000-0000-0000-0000-000000000000' });
  if (result.error?.code !== '42501') throw new Error(`Opportunity scope contract failed (${name}): ${result.error?.message ?? 'Unauthorized actor accepted.'}`);
}
const questionnaireContract = await supabase.rpc('public_opportunity_questionnaire', { p_hash: '0'.repeat(64), p_response: null, p_consent: false });
if (questionnaireContract.error?.code !== 'P0002') throw new Error(`Questionnaire schema contract failed: ${questionnaireContract.error?.message ?? 'An unknown token was accepted.'}`);

if (process.env.CRM_MULTI_AGENT_ENABLED === 'true') {
  checks.push(supabase.from('agency_members').select('user_id,role,active,sender_profile,gmail_ai_opt_in', { head: true }));
  checks.push(supabase.from('clients').select('id,agent_user_id', { head: true }));
  checks.push(supabase.from('leads').select('id,agent_user_id', { head: true }));
}
if (process.env.CRM_GMAIL_ENABLED === 'true') {
  checks.push(supabase.from('gmail_connections').select('id,user_id,email,status,history_id,bootstrap_complete', { head: true }));
  checks.push(supabase.from('agent_email_attempts').select('id,status,content_hash,communication_id', { head: true }));
  checks.push(supabase.from('scheduled_messages').select('id,agent_user_id,gmail_connection_id,approved_sender,last_error', { head: true }));
  checks.push(supabase.from('sequence_enrollments').select('id,agent_user_id,gmail_connection_id,template,auto_send_enabled,approved_recipient', { head: true }));
}
const results = await Promise.all(checks);
const privateSocialTables = new Set(['social_oauth_states', 'social_oauth_grants', 'social_provider_grants', 'social_provider_connections']);
const failures = results.flatMap((result, index) => {
  const table = checks[index].url.pathname.split('/').pop();
  if (privateSocialTables.has(table)) {
    return result.error?.code === '42501' ? [] : [
      `Contract ${index + 1} (${table}): ${result.error?.message ?? 'Direct access to private provider credentials was unexpectedly allowed.'}`,
    ];
  }
  return result.error
    ? [`Contract ${index + 1} (${table}): ${result.error.message?.trim() || result.error.code?.trim() || `HTTP ${result.status}`}`] : [];
});

if (failures.length > 0) {
  throw new Error(`Database schema is behind the application migrations:\n- ${failures.join('\n- ')}`);
}

for (const [name, args, expectedCode = '42501'] of [
  ['begin_social_oauth', { p_actor: null, p_state_hash: '', p_browser_hash: '', p_redirect_uri: '' }],
  ['consume_social_oauth_state', { p_actor: null, p_state_hash: '', p_browser_hash: '' }, 'PT409'],
  ['store_social_oauth_grant', { p_actor: null, p_id: null, p_external_user_id: '', p_user_name: '', p_encrypted_user_token: '', p_granted_scopes: [], p_token_expires_at: null }],
  ['finish_social_oauth_grant', { p_actor: null, p_id: null }],
  ['load_social_oauth_grant', { p_actor: null, p_id: null }],
  ['list_social_provider_connections', { p_actor: null }],
  ['save_social_provider_accounts', { p_actor: null, p_oauth_grant_id: null, p_accounts: [] }],
  ['disconnect_social_provider_account', { p_actor: null, p_connection_id: null }],
  ['load_social_provider_revoke', { p_actor: null, p_grant_id: null }],
  ['finish_social_provider_revoke', { p_actor: null, p_grant_id: null, p_revoked: false, p_error: '' }],
  ['prepare_social_publish_intent', { p_actor: null, p_id: null, p_post_id: null, p_revision: 1, p_connection_id: null }, '22023'],
  ['resolve_social_publish_intent', { p_actor: null, p_id: null, p_expected_version: 1, p_resolution: 'not_published', p_remote_id: null, p_permalink: null }],
]) {
  const result = await supabase.rpc(name, args);
  if (result.error?.code !== expectedCode) {
    throw new Error(`Social account connection schema contract failed (${name}): ${result.error?.message ?? 'An unauthorized actor was unexpectedly accepted.'}`);
  }
}

const bulkTasks = await supabase.rpc('bulk_reschedule_tasks', { p_tasks: [], p_due_date: null, p_actor: 'Schema verification' });
if (bulkTasks.error?.code !== '22023') {
  throw new Error(`Bulk task rescheduling schema contract failed: ${bulkTasks.error?.message ?? 'Invalid input was unexpectedly accepted.'}`);
}

for (const [name, args, expectedCode] of [
  ['connect_personal_gmail', { p_user: null, p_email: '', p_refresh: '', p_access: '', p_expires: null }, '42501'],
  ['enroll_personal_gmail_sales_sequence', { p_actor: null, p_lead: null, p_plan: {}, p_gap: 5 }, '42501'],
  ['configure_personal_gmail_scheduler', { p_actor: null, p_enabled: false }, '42501'],
  ['record_instantly_campaign_event', {
    p_event_key: '', p_campaign_id: null, p_lead_id: null, p_event_type: '',
    p_email: null, p_email_account: null, p_subject: null, p_body: null,
    p_event_at: null, p_provider_message_id: null,
  }, '22023'],
]) {
  const result = await supabase.rpc(name, args);
  if (result.error?.code !== expectedCode) {
    throw new Error(`Campaign provider schema contract failed (${name}): ${result.error?.message ?? 'Invalid input was unexpectedly accepted.'}`);
  }
}

for (const [name, args] of [
  ['intelligence_import_matches', { p_candidates: [], p_actor: null }],
  ['promote_import_prospect', { p_prospect: null, p_batch: null, p_actor: null, p_expected: {}, p_profile: {}, p_tasks: [] }],
  ['record_intelligence_enrichment', { p_lead: null, p_actor: null, p_source: 'fmcsa', p_record: {}, p_expected: {}, p_match_method: 'name_search' }],
  ['save_discovery_source', { p_actor: null, p_config: {} }],
  ['acquire_discovery_file', { p_actor: null, p_source: null, p_request: null, p_fingerprint: '', p_file: '', p_vendor: 'generic', p_row_count: 0, p_prospects: [] }],
  ['search_discovery_candidates', { p_actor: null, p_filters: {}, p_page: 0 }],
  ['review_discovery_candidate', { p_actor: null, p_candidate: null, p_expected: null, p_review: 'reviewed', p_note: '' }],
  ['get_intelligence_dossier', { p_actor: null, p_type: 'lead', p_id: null, p_page: 0 }],
  ['save_intelligence_dossier', { p_actor: null, p_type: 'lead', p_id: null, p_scope: '', p_expected: 0, p_request: null, p_findings: {}, p_reference: '', p_source_as_of: null }],
]) {
  const result = await supabase.rpc(name, args);
  if (result.error?.code !== '42501') {
    throw new Error(`Intelligence schema contract failed (${name}): ${result.error?.message ?? 'An unauthorized actor was unexpectedly accepted.'}`);
  }
}
const workflowBacklogPreview = await supabase.rpc('preview_workflow_backlog', {
  p_rule: '00000000-0000-0000-0000-000000000000',
});
if (workflowBacklogPreview.error?.code !== 'P0002') {
  throw new Error(`Workflow backlog schema contract failed: ${workflowBacklogPreview.error?.message ?? 'An unknown rule was unexpectedly accepted.'}`);
}
for (const [name, args] of [
  ['apply_workflow_backlog', { p_actor: null, p_rule: null, p_expected_revision: 1, p_expected_count: 0, p_expected_fingerprint: 'd41d8cd98f00b204e9800998ecf8427e' }],
  ['release_workflow_backlog', { p_actor: null }],
]) {
  const result = await supabase.rpc(name, args);
  if (result.error?.code !== '42501') {
    throw new Error(`Workflow backlog authorization contract failed (${name}): ${result.error?.message ?? 'An unauthorized actor was unexpectedly accepted.'}`);
  }
}
const ownerSettings = await supabase.rpc('save_agency_outreach_settings', {
  p_actor: '00000000-0000-0000-0000-000000000000', p_update: { timezone: 'America/Phoenix' },
});
if (ownerSettings.error?.code !== '42501') {
  throw new Error(`Owner settings schema contract failed: ${ownerSettings.error?.message ?? 'An unauthorized actor was unexpectedly accepted.'}`);
}
const versionedSettings = await supabase.rpc('save_agency_outreach_settings_versioned', {
  p_actor: '00000000-0000-0000-0000-000000000000', p_update: {}, p_expected_revision: 1,
});
if (versionedSettings.error?.code !== '42501') {
  throw new Error(`Versioned settings schema contract failed: ${versionedSettings.error?.message ?? 'An unauthorized actor was unexpectedly accepted.'}`);
}
for (const [name, args] of [
  ['save_agency_automation_settings', { p_actor: null, p_configuration: {}, p_expected_revision: 1 }],
  ['configure_crm_scheduler', { p_actor: null, p_enabled: false }],
]) {
  const result = await supabase.rpc(name, args);
  if (result.error?.code !== '42501') {
    throw new Error(`Automation owner schema contract failed (${name}): ${result.error?.message ?? 'An unauthorized actor was unexpectedly accepted.'}`);
  }
}

const automationSettings = await supabase.from('outreach_settings')
  .select('automation_configuration').eq('id', 1).single();
if (automationSettings.error) {
  throw new Error(`Automation policy schema contract failed: ${automationSettings.error.message}`);
}
const automation = automationSettings.data?.automation_configuration;
if (!automation || !automation.import_renewal || !automation.notifications
  || !automation.service?.task_templates?.claim || !automation.service?.task_templates?.endorsement
  || !automation.service?.task_templates?.certificate) {
  throw new Error('Automation settings are missing imported renewal, notification or service task-template controls. Validate and apply 20261105200000_imported_renewal_automation_policy.sql and 20261105210000_service_templates_and_notification_controls.sql in the coordinated release before building this source.');
}
const notificationGuard = await supabase.rpc('automation_notification_allows', {
  p_category: 'unsupported', p_event_at: new Date().toISOString(),
});
if (notificationGuard.error?.code !== '22023') {
  throw new Error(`Notification policy schema contract failed: ${notificationGuard.error?.message ?? 'Unsupported categories were accepted.'}`);
}
console.log('Supabase schema contract verified.');