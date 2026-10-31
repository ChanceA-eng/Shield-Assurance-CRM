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
  supabase.from('accounts').select('id,account_type,assigned_producer,csr,since_date,email_consent,sms_consent,preferred_channel', { head: true }),
  supabase.from('leads').select('id,account_id,confirmed_fields,last_viewed_at,last_activity_at,pipeline_stage,producer_owner,close_probability,expected_premium', { head: true }),
  supabase.from('clients').select('id,account_type,assigned_producer,csr,since_date,policy_effective_at,last_viewed_at,last_activity_at', { head: true }),
  supabase.from('personal_applicants').select('id,lead_id,account_id,first_name,last_name,dob,gender,marital_status,ssn_masked,dl_number_masked,dl_status,dl_state,education,occupation,industry,prior_employer_years,applicant_type,lead_source,preferred_language', { head: true }),
  supabase.from('policies').select('id,client_id,account_id,policy_number,line_of_business,sub_type,premium,effective_date,renewal_date,expiration_date,status,billing_type,source,prior_policy_id', { head: true }),
  supabase.from('policy_change_requests').select('id,policy_id,requested_at,description,status,requested_by', { head: true }),
  supabase.from('policy_transactions').select('id,policy_id,transaction_type,effective_date,snapshot', { head: true }),
  supabase.from('applications').select('id,account_id,line_of_business,status,created_at', { head: true }),
  supabase.from('renewals').select('id,account_id,expiration_date,renewal_bucket', { head: true }),
  supabase.from('claims').select('id,policy_id,client_id,account_id,claim_number,date_of_loss,status,description,adjuster_name,adjuster_contact,reserve_amount,payout_amount', { head: true }),
  supabase.from('certificates').select('id,client_id,account_id,policy_id,certificate_holder,holder_name,holder_address,issue_date,issued_date,expiration_date,coverage_summary,file_path,is_master,master_template_id', { head: true }),
  supabase.from('billing_records').select('id,policy_id,account_id,invoice_date,due_date,amount,status,payment_method,commission_percent,commission_amount', { head: true }),
  supabase.from('tasks').select('id,account_id,kind,note_id,completed_at,updated_at,intake_event_id,status,priority,due_date,assignee', { head: true }),
  supabase.from('client_assets').select('id,client_id,lead_id,title,asset_type,value,metadata,archived_at,created_at,updated_at', { head: true }),
  supabase.from('interactions').select('id,lead_id,client_id,note_type,pinned,author_name,updated_at', { head: true }),
  supabase.from('lead_intake_events').select('id,lead_id,submission_key,submitted_at,opened_at,dismissed_at,handled_at', { head: true }),
  supabase.from('notifications').select('id,task_id,reminder_version,intake_event_id,href', { head: true }),
  supabase.from('client_tasks').select('id,client_id,subject,description,due_date,status,priority,created_at,updated_at', { head: true }),
  supabase.from('client_files').select('id,client_id,file_name,file_url,file_type,file_size,status,metadata,uploaded_at,created_at', { head: true }),
  supabase.from('client_tags').select('id,client_id,tag,color,created_at', { head: true }),
  supabase.from('client_activities').select('id,client_id,activity_type,title,body,metadata,occurred_at,created_at', { head: true }),
  supabase.from('campaigns').select('id,name,status,account_id,list_name,scheduled_at,sent_at', { head: true }),
  supabase.from('campaign_sends').select('id,campaign_id,account_id,email,status,sent_at,error_message', { head: true }),
  supabase.from('workflow_rules').select('id,trigger_type,action_type,template_id,content,offset_days,active', { head: true }),
  supabase.from('events').select('id,title,description,event_time,all_day,status,related_type,related_id,task_id', { head: true }),
  supabase.rpc('get_actionable_leads_count'),
  supabase.rpc('get_actionable_clients_count'),
];

const results = await Promise.all(checks);
const failures = results.flatMap((result) => result.error ? [result.error.message] : []);

if (failures.length > 0) {
  throw new Error(`Database schema is behind the application migrations:\n- ${failures.join('\n- ')}`);
}

console.log('Supabase schema contract verified.');