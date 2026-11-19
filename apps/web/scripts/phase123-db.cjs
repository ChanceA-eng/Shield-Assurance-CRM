const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..', '..', '..');
const mode = process.argv[2];
if (!['--dry-run', '--apply', '--inspect'].includes(mode)) throw new Error('Choose --inspect, --dry-run or --apply. Applying requires explicit database authorization.');
const fixtureOption = process.argv.slice(3).find((value) => value.startsWith('--fixtures='));
const selectedFixtures = new Set((fixtureOption?.slice('--fixtures='.length) || '').split(',').filter(Boolean));
if (fixtureOption && !selectedFixtures.size) throw new Error('Choose at least one SQL fixture.');
const selectedMigrations = new Set(process.argv.slice(3).filter((value) => !value.startsWith('--fixtures='))
  .flatMap((selection) => selection.split(','))
  .map((selection) => selection.trim())
  .filter(Boolean)
  .map((selection) => selection.endsWith('.sql') ? selection : `${selection}.sql`));
require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] })).config({ path: path.join(root, 'apps', 'web', '.env.local') });
const url = process.env.TEST_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error('A database connection is required.');
const db = new PrismaClient({ datasources: { db: { url } } });
const rollback = new Error('DRY_RUN_ROLLBACK');

function statements(sql) {
  const result = [];
  let start = 0, quote = '', dollar = '', line = false, block = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) {
      if (c === '/' && next === '*') { block++; i++; }
      else if (c === '*' && next === '/') { block--; i++; }
      continue;
    }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = ''; } continue; }
    if (quote) { if (c === quote) { if (next === quote) i++; else quote = ''; } continue; }
    if (c === '-' && next === '-') { line = true; i++; continue; }
    if (c === '/' && next === '*') { block = 1; i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '$') {
      const tag = /^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/.exec(sql.slice(i));
      if (tag) { dollar = tag[0]; i += dollar.length - 1; continue; }
    }
    if (c === ';') { result.push(sql.slice(start, i).trim()); start = i + 1; }
  }
  result.push(sql.slice(start).trim());
  if (quote || dollar || block) throw new Error('Unterminated SQL statement.');
  return result.filter((statement) => {
    const code = statement.replace(/--[^\n]*/g, '').trim();
    return code && !/^(begin|commit|rollback)$/i.test(code);
  });
}

async function fingerprint(tx) {
  const rows = await tx.$queryRawUnsafe(`select md5(coalesce(string_agg(
    id::text||coalesce(full_name,'')||coalesce(email,'')||coalesce(phone,'')||coalesce(address,''),'|' order by id),''))
    as fingerprint from public.clients`);
  return rows[0].fingerprint;
}

async function main() {
  try {
    const files = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => /^\d{14}_/.test(name) && name >= '20261101080000').sort();
    const versions = new Set();
    for (const file of files) {
      const version = file.split('_')[0];
      assert.ok(!versions.has(version), `Duplicate migration version ${version}. Rename the unapplied migration before validation.`);
      versions.add(version);
    }
    for (const selectedMigration of selectedMigrations) {
      if (!files.includes(selectedMigration)) throw new Error(`Unknown migration selection: ${selectedMigration}`);
    }
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("set local lock_timeout='5s'");
      await tx.$executeRawUnsafe("set local statement_timeout='60s'");
      await tx.$executeRawUnsafe("select pg_advisory_xact_lock(hashtext('crm-phase123-release'))");
      const history = await tx.$queryRawUnsafe('select version,name from supabase_migrations.schema_migrations');
      for (const selectedMigration of selectedMigrations) {
        const [version, ...name] = selectedMigration.replace(/\.sql$/, '').split('_');
        const installed = history.find((row) => row.version === version);
        assert.ok(!installed || installed.name === name.join('_'), `Migration ${version} is already recorded for a different file; do not skip this migration.`);
      }
      assert.ok(history.some((row) => row.version === '20261031110000'), 'The shared workspace baseline must be installed and recorded.');
      const pending = files.filter((file) => (!selectedMigrations.size || selectedMigrations.has(file))
        && !history.some((row) => row.version === file.split('_')[0]));
      console.log('Pending migrations:', pending.join(', ') || 'none');
      if (mode === '--inspect') return;
      const contactFingerprint = await fingerprint(tx);
      const originalIds = {};
      for (const table of ['clients', 'leads', 'tasks', 'interactions', 'client_assets', 'communication_log', 'lead_intake_events', 'policies']) {
        originalIds[table] = (await tx.$queryRawUnsafe(`select id::text from public.${table}`)).map((row) => row.id);
      }
      for (const file of pending) {
        const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', file), 'utf8');
        for (const statement of statements(sql)) {
          try { await tx.$executeRawUnsafe(statement); }
          catch (error) { console.error('Migration statement failed:', file, statement.split('\n')[0].slice(0,120)); throw error; }
        }
        const [version, ...name] = file.replace(/\.sql$/, '').split('_');
        await tx.$executeRawUnsafe('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,ARRAY[$3]::text[])',
          version, name.join('_'), sql);
        console.log('Validated migration', file);
      }
      for (const [table, ids] of Object.entries(originalIds)) {
        const rows = await tx.$queryRawUnsafe(`select count(*)::int as amount from public.${table} where id=any($1::uuid[])`, ids);
        assert.equal(rows[0].amount, ids.length, `Original ${table} identities must be preserved.`);
      }
      assert.equal(await fingerprint(tx), contactFingerprint, 'Migration must not overwrite account contact details.');
      const bucket = await tx.$queryRawUnsafe("select public,file_size_limit from storage.buckets where id='account-documents'");
      assert.equal(bucket.length, 1); assert.equal(bucket[0].public, false); assert.equal(Number(bucket[0].file_size_limit), 26214400);
      await tx.$queryRawUnsafe('select id from public.agent_workday limit 1');
      await tx.$queryRawUnsafe('select key from public.conversation_inbox limit 1');
      await tx.$executeRawUnsafe('select public.unread_message_summary()');
      const fixtureFiles = ['identity_renewal_reliability.sql', 'calendar-task-reliability.sql', 'agent_workday.sql', 'inbound_action_reliability.sql', 'operational_surfaces.sql', 'internal_action_automation.sql', 'manual_quote_options.sql', 'quote_policy_link.sql', 'policy_insured_asset_schedule.sql', 'outreach_marketing_profiles.sql', 'policy_placement_workspace.sql', 'policy_record_retention.sql'];
      const zoomSchema = await tx.$queryRawUnsafe("select to_regclass('public.zoom_connections') is not null as installed");
      if (zoomSchema[0].installed) fixtureFiles.push('zoom_appointments.sql');
      const salesTemplates = await tx.$queryRawUnsafe("select to_regclass('public.sales_templates') is not null as installed");
      if (salesTemplates[0].installed) fixtureFiles.push('sales_templates.sql');
      const brandedTemplates = await tx.$queryRawUnsafe("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales_templates' and column_name='email_design') as installed");
      if (brandedTemplates[0].installed) fixtureFiles.push('branded_email_templates.sql');
      const leadSchedules = await tx.$queryRawUnsafe("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='scheduled_messages' and column_name='lead_id') as installed");
      if (leadSchedules[0].installed) fixtureFiles.push('lead_scheduled_messages.sql');
      const socialSchema = await tx.$queryRawUnsafe("select to_regclass('public.social_posts') is not null as installed");
      if (socialSchema[0].installed) fixtureFiles.push('social_marketing_drafts.sql');
      const socialMediaSchema = await tx.$queryRawUnsafe("select to_regclass('public.social_media_assets') is not null as installed");
      if (socialMediaSchema[0].installed) fixtureFiles.push('social_marketing_media.sql');
      const socialReviewSchema = await tx.$queryRawUnsafe("select to_regclass('public.social_review_events') is not null as installed");
      if (socialReviewSchema[0].installed) fixtureFiles.push('social_marketing_reviews.sql');
      const socialConnectionsSchema = await tx.$queryRawUnsafe("select to_regclass('public.social_provider_connections') is not null as installed");
      if (socialConnectionsSchema[0].installed) fixtureFiles.push('social_marketing_connections.sql');
      const socialEngineSchema = await tx.$queryRawUnsafe("select to_regclass('public.social_intents') is not null as installed");
      if (socialEngineSchema[0].installed) fixtureFiles.push('social_marketing_engine.sql');
      const socialPublishingSchema = await tx.$queryRawUnsafe("select to_regprocedure('public.prepare_social_publish_intent(uuid,uuid,uuid,integer,uuid)') is not null as installed");
      if (socialPublishingSchema[0].installed) fixtureFiles.push('social_marketing_publishing.sql');
      const socialLinkSchema = await tx.$queryRawUnsafe("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='social_posts' and column_name='link_url') as installed");
      if (socialLinkSchema[0].installed) fixtureFiles.push('social_marketing_publish_links.sql');
      const gmailSchema = await tx.$queryRawUnsafe("select to_regclass('public.gmail_connections') is not null as installed");
      if (gmailSchema[0].installed) fixtureFiles.push('agency_gmail.sql');
      const performanceSchema = await tx.$queryRawUnsafe("select to_regprocedure('public.crm_shell_summary()') is not null as installed");
      if (performanceSchema[0].installed) fixtureFiles.push('loading_performance.sql');
      const bulkTaskSchema = await tx.$queryRawUnsafe("select to_regprocedure('public.bulk_reschedule_tasks(jsonb,timestamptz,text)') is not null as installed");
      if (bulkTaskSchema[0].installed) fixtureFiles.push('bulk_task_reschedule.sql');
      const rewriteSchema = await tx.$queryRawUnsafe("select to_regprocedure('public.rewrite_outreach_draft(uuid,uuid,integer,text,text,jsonb)') is not null as installed");
      if (rewriteSchema[0].installed) fixtureFiles.push('outreach_draft_rewrites.sql');
      const archiveSchema = await tx.$queryRawUnsafe("select to_regprocedure('public.archive_leads(uuid[],text,text)') is not null as installed");
      if (archiveSchema[0].installed) fixtureFiles.push('lead_archive.sql');
      const purgeSchema = await tx.$queryRawUnsafe("select to_regprocedure('public.purge_leads(uuid[],text)') is not null as installed");
      if (purgeSchema[0].installed) fixtureFiles.push('lead_purge.sql');
      const websiteReceipts = await tx.$queryRawUnsafe("select to_regclass('public.website_submission_receipts') is not null as installed");
      if (websiteReceipts[0].installed) fixtureFiles.push('website_submission_receipts.sql');
      const configuredAutomation = await tx.$queryRawUnsafe("select to_regprocedure('public.save_agency_automation_settings(uuid,jsonb,integer)') is not null as installed");
      if (configuredAutomation[0].installed) fixtureFiles.push('built_in_automation_controls.sql');
      const importedRenewalAutomation = await tx.$queryRawUnsafe("select to_regprocedure('public.import_renewal_due_date(date,text,timestamp with time zone)') is not null as installed");
      if (importedRenewalAutomation[0].installed) fixtureFiles.push('imported_renewal_automation_policy.sql');
      const notificationAutomation = await tx.$queryRawUnsafe("select to_regprocedure('public.automation_notification_allows(text,timestamp with time zone)') is not null as installed");
      if (notificationAutomation[0].installed) fixtureFiles.push('service_template_notification_settings.sql');
      const heartbeat = await tx.$queryRawUnsafe("select to_regprocedure('public.crm_scheduler_status()') is not null as installed");
      if (heartbeat[0].installed) fixtureFiles.push('supabase_automation_heartbeat.sql');
      const workflows = await tx.$queryRawUnsafe("select to_regprocedure('public.execute_workflow_internal(integer)') is not null as installed");
      if (workflows[0].installed) fixtureFiles.push('custom_workflow_events.sql');
      const taskCleanupSchema = await tx.$queryRawUnsafe("select to_regprocedure('public.cleanup_deleted_lead_tasks()') is not null as installed");
      if (taskCleanupSchema[0].installed) fixtureFiles.push('lead_task_delete_cleanup.sql');
      const policyServiceRequests = await tx.$queryRawUnsafe("select to_regprocedure('public.sync_policy_change_request_service_action()') is not null as installed");
      if (policyServiceRequests[0].installed) fixtureFiles.push('policy_service_request_lifecycle.sql');
      const certificateLifecycle = await tx.$queryRawUnsafe("select to_regclass('public.certificate_record_events') is not null as installed");
      if (certificateLifecycle[0].installed) fixtureFiles.push('certificate_service_lifecycle.sql');
      const renewalReviews = await tx.$queryRawUnsafe("select to_regclass('public.renewal_review_events') is not null as installed");
      if (renewalReviews[0].installed) fixtureFiles.push('renewal_review_lifecycle.sql');
      const serviceRequestDocuments = await tx.$queryRawUnsafe("select to_regclass('public.policy_change_request_documents') is not null as installed");
      if (serviceRequestDocuments[0].installed) fixtureFiles.push('service_request_ownership_documents.sql');
      const reportingSummary = await tx.$queryRawUnsafe("select to_regprocedure('public.crm_reporting_summary(date,date,date,date,text)') is not null as installed");
      if (reportingSummary[0].installed) fixtureFiles.push('reporting_summary.sql');
      const resendSchema = await tx.$queryRawUnsafe("select to_regclass('public.resend_send_attempts') is not null as installed");
      if (resendSchema[0].installed) fixtureFiles.push('resend_delivery.sql');
      const ownerSettingsSchema = await tx.$queryRawUnsafe("select to_regprocedure('public.save_agency_outreach_settings(uuid,jsonb,boolean)') is not null as installed");
      if (ownerSettingsSchema[0].installed) fixtureFiles.push('owner_settings_foundation.sql');
      const automationVersions = await tx.$queryRawUnsafe("select to_regclass('public.automation_configuration_versions') is not null as installed");
      if (automationVersions[0].installed) fixtureFiles.push('automation_configuration_versions.sql');
      const agencyTimeZone = await tx.$queryRawUnsafe("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='outreach_settings' and column_name='timezone') as installed");
      if (agencyTimeZone[0].installed) fixtureFiles.push('agency_time_zone.sql');
      const agencyCalendarTimeZone = await tx.$queryRawUnsafe("select to_regprocedure('public.sync_agency_calendar_time_zone()') is not null as installed");
      if (agencyCalendarTimeZone[0].installed) fixtureFiles.push('agency_calendar_time_zone.sql');
      const emailSetupSchema = await tx.$queryRawUnsafe("select to_regclass('public.email_setup_checks') is not null as installed");
      if (emailSetupSchema[0].installed) fixtureFiles.push('email_setup_checks.sql');
      const replyCompletion = await tx.$queryRawUnsafe("select exists(select 1 from supabase_migrations.schema_migrations where version='20261105050000') as installed");
      if (replyCompletion[0].installed) fixtureFiles.push('reply_task_completion.sql');
      const accountSecurity = await tx.$queryRawUnsafe("select to_regclass('public.account_email_changes') is not null as installed");
      if (accountSecurity[0].installed) fixtureFiles.push('account_security.sql');
      const intelligenceImport = await tx.$queryRawUnsafe("select to_regclass('public.intelligence_import_evidence') is not null as installed");
      if (intelligenceImport[0].installed) fixtureFiles.push('intelligence_import_foundation.sql');
      const discoverySchema = await tx.$queryRawUnsafe("select to_regclass('public.discovery_sources') is not null as installed");
      if (discoverySchema[0].installed) fixtureFiles.push('file_lead_discovery.sql');
      const publicDiscoverySchema = await tx.$queryRawUnsafe("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='discovery_sources' and column_name='provider') as installed");
      if (publicDiscoverySchema[0].installed) fixtureFiles.push('public_discovery.sql');
      const dossierSchema = await tx.$queryRawUnsafe("select to_regclass('public.intelligence_dossiers') is not null as installed");
      if (dossierSchema[0].installed) fixtureFiles.push('intelligence_dossiers.sql');
      const policyKnowledgeSchema = await tx.$queryRawUnsafe("select to_regclass('public.policy_knowledge_candidates') is not null as installed");
      if (policyKnowledgeSchema[0].installed) fixtureFiles.push('policy_knowledge_review.sql');
      const instantlySchema = await tx.$queryRawUnsafe("select to_regclass('public.instantly_campaigns') is not null as installed");
      if (instantlySchema[0].installed) fixtureFiles.push('instantly_campaigns.sql');
      const personalGmailSchema = await tx.$queryRawUnsafe("select to_regprocedure('public.connect_personal_gmail(uuid,text,text,text,timestamptz)') is not null as installed");
      const businessResearch = await tx.$queryRawUnsafe("select to_regprocedure('public.get_business_research(uuid,uuid)') is not null as installed");
      if (businessResearch[0].installed) fixtureFiles.push('business_research.sql');
      const researchDirectories = await tx.$queryRawUnsafe("select to_regprocedure('public.claim_business_research_partition()') is not null as installed");
      if (researchDirectories[0].installed) fixtureFiles.push('business_research_indexes.sql');
      const researchBrowse = await tx.$queryRawUnsafe("select to_regprocedure('public.browse_business_research_map_index(uuid,text,text,jsonb,text,text,text,text,text,double precision,double precision,double precision,integer)') is not null as installed");
      if (researchBrowse[0].installed) fixtureFiles.push('business_research_browse.sql');
      if (personalGmailSchema[0].installed) fixtureFiles.push('manual_gmail_sender.sql');
      const gmailSendLimit = await tx.$queryRawUnsafe("select to_regprocedure('public.enforce_gmail_mailbox_send_limit()') is not null as installed");
      if (gmailSendLimit[0].installed) fixtureFiles.push('gmail_mailbox_send_limit.sql');
      const personalGmailSequences = await tx.$queryRawUnsafe("select to_regprocedure('public.enroll_personal_gmail_sales_sequence(uuid,uuid,jsonb,integer)') is not null as installed");
      if (personalGmailSequences[0].installed) fixtureFiles.push('personal_gmail_sales_sequences.sql');
      for (const file of selectedFixtures) assert.ok(fixtureFiles.includes(file), `SQL fixture unavailable for the installed schema: ${file}`);
      const fixtures = fixtureFiles.filter((file) => !selectedFixtures.size || selectedFixtures.has(file));
      for (const file of fixtures) {
        await tx.$executeRawUnsafe('savepoint release_fixture');
        try {
          for (const statement of statements(fs.readFileSync(path.join(root, 'supabase', 'tests', file), 'utf8'))) await tx.$executeRawUnsafe(statement);
        } catch (error) { console.error('SQL fixture failed:', file); throw error; }
        await tx.$executeRawUnsafe('rollback to savepoint release_fixture');
        await tx.$executeRawUnsafe('release savepoint release_fixture');
        console.log('PASS rolled-back SQL fixtures', file);
      }
      const manifest = [
        ...pending.map((file) => `${file}:${createHash('sha256').update(fs.readFileSync(path.join(root, 'supabase', 'migrations', file))).digest('hex')}`),
        ...fixtures.map((file) => `fixture:${file}:${createHash('sha256').update(fs.readFileSync(path.join(root, 'supabase', 'tests', file))).digest('hex')}`),
      ].join('\n');
      const receipt = path.join(process.env.TEMP || require('node:os').tmpdir(), 'shield-crm-phase123-dry-run.json');
      if (mode === '--dry-run') {
        fs.writeFileSync(receipt, JSON.stringify({ manifest, database: createHash('sha256').update(url).digest('hex'), at: Date.now() }));
        throw rollback;
      }
      const checked = JSON.parse(fs.readFileSync(receipt, 'utf8'));
      assert.equal(checked.manifest, manifest, 'Migrations changed after dry run; repeat validation.');
      assert.equal(checked.database, createHash('sha256').update(url).digest('hex'), 'Dry run must use the same database.');
      assert.ok(Date.now() - checked.at < 3600000, 'Dry run expired; validate again.');
      console.log('Original records/contact fields preserved. Fixture writes rolled back. Committing approved schema changes only.');
    }, { timeout: 240000, maxWait: 10000 });
    console.log(mode === '--apply' ? 'Approved migrations committed.' : 'Inspection complete.');
  } catch (error) {
    if (error === rollback) console.log('Dry run passed. All database changes rolled back; matching migration manifest recorded for apply.');
    else {
      console.error('Release validation failed:', error.code || error.name, error.meta?.code || '', error instanceof assert.AssertionError ? error.message : error.meta?.message || error.message || '');
      process.exitCode = 1;
    }
  } finally { await db.$disconnect(); }
}
void main();
