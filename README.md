# Shield Assurance CRM

Enterprise CRM foundation for insurance agencies combining:
- Salesforce-style relational rigor (PostgreSQL + Prisma)
- HubSpot-style asynchronous automation (BullMQ + Redis)
- Microsoft 365 integration surface (MSAL + Graph webhook and SharePoint stubs)

## Architecture

- `apps/web`: Next.js CRM with a metrics dashboard, Lead Pipeline, Accounts, Tasks and communication workspaces
- `apps/api`: NestJS API + Prisma + workflow enqueue logic
- `apps/worker`: BullMQ worker for `deal.bound` automation chains
- `packages/shared`: shared events and contracts
- `infra/docker-compose.yml`: local Postgres and Redis

## Quick Start

1. Install dependencies

```bash
pnpm install
```

2. Configure environment

```bash
cp .env.example .env
```

3. Start infrastructure

```bash
pnpm compose:up
```

4. Generate Prisma client and run migration

```bash
pnpm db:generate
pnpm db:migrate
```

5. Start all services

```bash
corepack pnpm dev
```

Web runs on `http://localhost:3000` and API on `http://localhost:4000`.

If you usually run `npm run dev`, the workspace-native alternative is:

```bash
corepack pnpm dev
```

## Workflow Engine

When a deal moves to `BOUND`, API endpoint `PATCH /deals/stage` enqueues `deal.bound` on Redis queue `insurance-workflows`.
Worker flow:
1. Load deal, account, and primary contact.
2. Send SMS (Twilio adapter placeholder).
3. Send email (SendGrid adapter placeholder).
4. Log `SYSTEM_NOTE` activity in PostgreSQL.

Jobs use retries with exponential backoff.

## Microsoft 365 Integration Stubs

- `MsalAuthService`: placeholder auth URL and token exchange hooks.
- `GraphWebhookController`: webhook endpoint/validation handling.
- `SharePointFolderService`: placeholder account folder provisioning.

## Security and Realtime

- Header-based API key guard (`x-api-key`) for protected endpoints.
- Role checks via `x-user-role` (`ADMIN`, `MANAGER`, `AGENT`).
- Socket.IO gateway broadcasts `activity:new` events for the live feed.

## Tests and CI

- Workspace tests use Vitest (`corepack pnpm -r test`).
- GitHub Actions CI validates install, typecheck, and tests on push/PR.

## Lead and Account Workspaces

### Personalized marketing outreach

- Apply `supabase/migrations/20261102200000_outreach_marketing_profiles.sql` before using marketing profiles. This adds profile storage and a sender-profile field; it does not enroll contacts, rewrite existing drafts or send messages.
- In a lead or account's **Notes**, expand **Marketing profile & email purpose** to save stated insurance interests, priorities, concerns, preferred next-step channel and the agreed next step. Stated needs/preferences require a source and confirmation date. These fields are agent-recorded context, not AI-inferred facts or marketing consent.
- Explicitly linked leads share the account profile. Until one is saved, the latest saved profile from an explicitly linked lead is available; saving through either workspace writes the account profile. Unlinked contacts never share preferences based on a guessed name or email.
- In **Outreach > Guardrails**, edit the shared **Agency sender profile** (name, role, specialties, service area, tone, signature and approved claims). This is agency-wide writing context for the current single-producer workflow, not per-user sender routing or a change to the email provider's From address.
- Lead, account and sequence generation use these profiles, active assets, notes and the latest twelve messages from the canonical conversation. Five purpose-based writing templates cover quote responses, missing information, renewal reviews, relevant coverage conversations and dormant-lead reactivation. Choose a default on the profile or override it in the lead email composer.
- AI output must pass strict JSON shape, word-count, subject/placeholder, basic risky-claim, repetition (within a sequence), exact grounding-citation and signature checks. A failed result gets one repair attempt; persistent failure is explicitly reported, with no substitute draft. These checks are not a semantic guarantee of accuracy: review every claim and next step. Approval shows original cited facts and live wording warnings for edits.
- Existing opt-outs, reply-stop processing, approval mode, send windows, caps and provider-acceptance recovery are unchanged. Saving a profile or template never sends anything. AI requests use the existing configured provider and require `OPENAI_API_KEY`; tests mock AI and email delivery.

### Phases 1-3: local reliability release

- Run `start-site.bat` to launch the current source at `http://localhost:3000` without a production build. Keep its window open. The launcher never kills another server.
- **Tasks is the single action register.** Agency Workday navigation and dashboard panels are removed; the legacy `/workday` URL redirects to `/tasks`. There is no secondary source checklist. Dashboard retains its primary metrics, premium chart and renewal table, without the recently added task lists, briefing/activity prose or operational tiles.
- Task quick-add supports named lead/account selection and an optional free-text assignee. Reassignment is team-visible; this is not a permission or user-directory system.
- Account Documents distinguish private uploads from external references and legacy metadata-only records. Files are stored before a document is recorded. A failed confirmation retains the selected file and retries the same upload, recovering an already-saved record without duplicating it or deleting its bytes. Downloads require authentication.
- Eight approved reliability migrations through `20261102160000` have been applied to the configured shared Supabase database after successful transactional dry runs. Existing record IDs and account contact data were preserved. The final migration also initializes genuine outstanding source actions without sending messages. Starting localhost never migrates or deploys anything. Application changes remain local and are not yet deployed.
- Internal transactional automation creates ordinary tasks and linked notifications for inbound messages, open claims/endorsements/certificate requests, outreach approvals and delivery uncertainty/failures. Scheduled reconciliation repairs missed actions and detects stale sends; it never sends messages, invokes AI, binds coverage or changes customer service statuses. Converted website requests keep their existing real lead follow-ups, not a second intake chore. Historical imported messages are not indiscriminately replayed.
- Retry/reconciliation preserves assignment, Arizona snooze and manual completion for an unchanged event. A new inbound event or reopened source can reopen its managed task. Accepted outbound replies and resolved service/outreach sources complete their tasks; reading, failed/scheduled sends and banner dismissal do not. Linking a lead to an account consolidates reply work. Task action links open the actual conversation, scoped service record or exact outreach attempt, even outside the recent activity sample.
- Verification: production build, strict TypeScript and **160 web unit tests** passed. All **19 browser cases** passed across the final run and targeted retries of two network-interrupted cases: single Tasks workflow, assignment/snooze, exact source navigation, clean dashboard, banner ordering, inbox pagination, saved drafts, calendar and responsive workspaces. All **34 migrations** applied in order to disposable PostgreSQL; all seven reliability SQL suites passed, including unmatched inbound, retry safety and linked-account reply consolidation. Provider storage tables/cron scheduling are mocked only in this isolated SQL fixture.
- Real shared-service verification passed using disposable QA records and two independent authenticated sessions: private upload/retry/refresh/exact-byte download/anonymous denial, overlapping inbound receipts/alerts and policy issuance/renewal, immediate service/outreach task and notification creation, duplicate prevention and source-driven task completion. Fixture records, bytes and auth users were removed; no customer records were edited and no email/SMS was sent.
- Inbox search/pagination and account/lead history use canonical database conversation identity, including explicitly linked lead history. Unread totals cover the complete canonical thread, not a latest-message sample. Sidebar Tasks counts open tasks due by the end of the Arizona day, including internal actions; message badges retain separate unread semantics. There is no global Workday polling or badge.
- Settings / Release & Setup contains persisted automation health, including internal-action maintenance: running, success, skipped, partial and failed results with the last actual success. An unrun job is not reported healthy. The manual Run action can process real outreach and use AI credits; release QA did not invoke it. Cron authorization requires the configured secret or a logged-in session.
- Dashboard premium totals and the chart now come from the same server-side, fully paginated policy calculation, not the latest 100 policies. Total Written Premium retains the sum of all recorded policy premiums (not current in-force premium); the chart groups effective dates into the current Arizona calendar month and preceding eleven months. Missing premium contributes zero; invalid premium or a failed page returns an explicit error instead of partial totals. The 30-day renewal KPI uses the same canonical bucket as the renewal list, excluding overdue policies. This follow-on correction passed seven new tests (including 1,501 policies and a smaller server page cap), bringing the web suite to **167 passing tests**, plus production build, strict types and authenticated dashboard/renewal checks. No new dashboard panels or database migration were added.
- **Placement handoff (Phase 4, first slice):** Accounts and active linked leads offer **Record policy**, opening the existing policy form with exact record IDs and saved contact details. Leads must be explicitly linked first; missing, mismatched or terminal leads produce an error. Account-only handoff selects no lead. Carrier, premium, policy number and term dates remain blank for confirmed placement details; unsupported lines require explicit selection. Saving requires an operator's carrier binding/issuance confirmation in the form and `carrier_confirmed: true` on `POST /api/policies`; this is an attestation, not carrier verification or an automated bind request. Policy saves retain the same issuance ID after a failed response, never change account contacts, and complete only the explicitly selected lead through the existing atomic issuance transaction. No quote-options store, rater or insured-asset schedule is claimed. Verification: **173 unit tests**, all **21 browser cases**, strict types, production build and live disposable-record prefill/confirmation-rejection checks passed. No new migration, deployment or customer messages.
- **Manual quote options (subsequent Phase 4 slice):** the Quotes section in Accounts and lead workspaces saves multiple carrier options with line of business, quoted premium, optional term dates, limits, deductibles and notes. Draft/Presented/Accepted/Declined are quote outcomes only: acceptance never binds coverage, creates a policy or marks the lead Won. Link/create the correct account before saving from a lead; account-owned options stay visible across linked profiles, and source lead identity/history is retained if a lead is merged. Failed create retries reuse the save ID; edits require the last-loaded version, and conflict failures retain drafts. Switching profile tabs retains the form. Every saved change captures a database history snapshot; a history viewer, quote documents, insured-asset selection and quote-to-policy conversion remain future work. Migration `20261102170000` was applied after a successful transactional dry run and rolled-back SQL fixtures. The complete 22-case browser suite, production build, strict types, validation tests and real cross-session save/retry/history/conflict checks passed without customer edits or provider sends. Application remains local, not deployed.
- **Selected quote to recorded policy:** accepted quotes offer **Record policy from [carrier]**. Exact account-scoped prefill includes carrier, line, premium and available term dates; the policy number and carrier confirmation still require the operator. Only an explicitly selected source lead is completed. A new atomic issuance wrapper locks the quote, checks its accepted status and last-loaded version, enforces one policy per quote, and stores immutable-at-placement quote provenance on the policy. Later quote edits never rewrite that snapshot; failed/conflicting placements roll back, and the same issuance ID safely retries even after later quote changes. Account Policies and exact policy context show **Original quote at placement**, clearly distinguished from confirmed insured coverage. Changing the selected account clears quote linkage. Migration `20261102173000` passed dry-run/SQL rollback assertions and was applied; live overlapping confirmed placements produced one linked policy and retained its original snapshot after editing/retry. No carrier request or customer message was sent. Policy term/asset schedules, carrier confirmation evidence and quote documents/history viewer remain unfinished.
- Latest verification: **192 web unit tests**, strict TypeScript, final production build and live disposable-record integration passed. All **23 browser cases** passed across the full run and a targeted retry of one account-navigation visibility timeout. Localhost remains available; application changes are not deployed.
- Outreach distinguishes sending, uncertain acceptance, accepted-but-unrecorded and recorded acceptance. Uncertain sends cannot be resent from the UI; accepted attempts can retry bookkeeping without contacting the provider again. Provider acceptance is not delivery confirmation. Configure provider webhooks/secrets before expecting live incoming messages; identity-less email fingerprinting can collapse identical legitimate messages. Deployment and controlled provider end-to-end testing remain separate release steps, not completed by local QA.

- **Accounts** is a dedicated sidebar destination covering prospects, active clients and accounts with inactive or cancelled policies. The directory searches contact names, linked website business names, email, phone and policy numbers; filters use actual policy lifecycle, upcoming expirations and overdue task timestamps. Results are paginated, not capped at 100 accounts.
- The account overview prioritizes next actions, coverage, account details, pinned notes and recent history. Assets & People, Notes, Tasks and Documents remain separate; communication opens on demand. Tags, activity and risk review are under **More**. Account creation alone never establishes coverage.
- **Lead Pipeline → + New Lead** is the single place to capture a phone, walk-in or referral prospect. Personal lines collect applicant, coverage, current carrier/X-date, drivers, vehicles and homes; commercial lines collect the business, primary contact, specific business type (NAICS) and industry questions. Selecting Auto prefills the applicant as a driver; selecting Home/Condo/Renters/Landlord prefills the home address. Matching email or phone warns about existing leads/accounts before a duplicate is created. Vehicles, drivers and properties become profile assets, call notes become a call note, and the first-contact task is scheduled.
- The retired Applicants pages (Create Personal/Commercial Applicant, Completed Quotes, Submission Center and Applicants Import) redirect to Lead Pipeline; imports live under **Leads → Import Leads**. Their legacy database tables are kept untouched.

- Add separate vehicles, properties, equipment and drivers from a lead or account's **Assets** tab. Keep unknown fields empty; source references and edit/archive/restore history remain available.
- **Add note** records call, underwriting or service details. **Also create a reminder** saves the note and dated action together, or use **Add reminder** on its own. Reminder times are entered and displayed in Arizona (UTC-7); reminders are in-app notifications, not messages to customers, and do not call AI.
- Profile tasks, the main Tasks page and dashboard use the same task records. **Completed** keeps completed work separate and allows reopening an accidental completion.
- Link a lead to an explicitly selected existing account or create a prospect account. Notes, tasks and assets keep their IDs and history. Opening a workspace does not create an account; a placed policy, not the account row itself, determines client status.
- Website banners represent individual submissions, newest first. Opening the rendered profile or dismissing a submission acknowledges that event; a later submission remains a new event. Unworked arrivals do not expire after seven days or disappear at a twenty-row limit.
- Asset inventory is not proof of coverage and never binds a policy or processes an endorsement. Carrier schedules, billing, claims and renewal servicing remain separate workflows.

### Messages, renewals and task automation

- **Inbound email** (`/api/messages/webhook`, SendGrid Inbound Parse) and **inbound text** (`/api/messages/sms-webhook`, Twilio, verified with `X-Twilio-Signature`) are matched to the account and/or lead by email or phone. Provider-event receipts and transactional alerts make retries safe: one message notification and one open "Reply to {name}" task per conversation. A reply stops active outreach, and its reply checkpoint survives an alert retry. Repeated messages do not reset an agent's existing snooze or owner.
- Unread inbound messages show a red count on **Communication / Inbox** in the sidebar, an "N new messages" badge on the account row in **Accounts**, a count on the account **Communication** button and the existing per-lead pipeline badges. Opening the conversation marks it read.
- **Renewal radar** runs from the daily `/api/cron/sync-leads` cron. For every in-force policy renewing within 45 days (or lapsed up to 7 days) it keeps one renewal-review task on the account (due 30 days before renewal, escalated to high priority at 15 days) and posts one notification per milestone (45/30/15/7/due). It is internal only and never emails or texts the client.
- Tasks can be snoozed to later today, tomorrow 9 AM, next Monday 9 AM or any picked Arizona date and time.
- Setup outside the code: point a reply subdomain MX record at `mx.sendgrid.net` and add a SendGrid Inbound Parse host posting to `https://<crm-domain>/api/messages/webhook?secret=<INBOUND_WEBHOOK_SECRET>`; set the Twilio number's "A message comes in" webhook to `https://<crm-domain>/api/messages/sms-webhook` (HTTP POST); set `INBOUND_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN` and `CRON_SECRET` in Vercel.

Focused checks:

```powershell
corepack pnpm --filter @crm/web test src/lib/workspace-validation.test.ts src/lib/arizona-time.test.ts src/lib/outreach-ai.test.ts src/lib/workspace-routes.test.ts src/lib/client-directory.test.ts
corepack pnpm --filter @crm/web typecheck
corepack pnpm --filter @crm/web test:workspace-db
```

The database check requires an explicit `TEST_DATABASE_URL` for a prepared test database and rolls back all fixtures. `--use-local` explicitly selects the database in the ignored web environment; localhost may share production data. On an unmigrated database it also rolls back the workspace migration. Only `--apply` commits the migration and records its Supabase version; use that option only after authorization and a successful dry run. Post-application fixtures are still rolled back.

Browser checks use an installed Microsoft Edge and a running localhost build:

```powershell
$env:CRM_BROWSER_QA_ALLOWED = '1'
corepack pnpm --filter @crm/web test:browser
```

They sign in as a temporary, automatically deleted Supabase auth user, verify authenticated read-only task counts, intake queues, account lists and an existing account workspace, and mock the interactive workspace requests so no real lead, asset, note or task is changed. Tokens and passwords stay in memory; traces and screenshots are disabled.

Release integration verification uses only its own disposable account, document, policy, message and task records, then removes them:

```powershell
$env:CRM_RELEASE_QA_ALLOWED = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://localhost:3000'
node apps\web\scripts\verify-release-integration.cjs
node apps\web\scripts\phase123-db.cjs --inspect
```

The Phase 1-3 database runner's `--dry-run` rolls back migration/fixture changes; `--apply` requires a matching successful dry-run receipt less than one hour old and explicit operator approval. Neither option is needed for normal startup. Already-applied migrations must not be edited; use a new forward migration for later database changes.

## Account loading and background refresh

Account identity, policies and core profile render before saved notes/tasks/documents finish. Initial workspace requests use `mode=core`, explicitly omitting redundant communication, timeline-task and legacy-file queries; default API responses remain compatible. Linked leads load in parallel with the other workspace sections.

Complete conversation history and delivery details load when Communication or Insights is opened, with visible loading/errors and retry. Summary/risk actions wait for that history. Quotes and asset panels load on first visit and remain mounted afterward to retain drafts. Login runs no notification polling, and overlapping notification updates share serial refreshes rather than concurrent request bursts.

These changes remove unnecessary initial work, not remote database/auth latency or cold Next.js development compilation. They do not truncate conversation history or cache authenticated data across users. Performance work requires no database migration.

## High-End UI Features

- Optimistic kanban card transitions with rollback on API failure.
- Global command center on `Cmd/Ctrl + K`.
- Real-time activity feed with Socket.IO client hook.

## Production Hardening Next

1. Add authentication/authorization (Azure AD RBAC + JWT session model).
2. Add request/response DTO validation for every endpoint.
3. Add test suites (unit + integration + e2e).
4. Replace integration stubs with real Twilio, SendGrid, and Graph SDK adapters.
5. Add observability (OpenTelemetry, structured logs, and alerting).
#   S h i e l d - A s s u r a n c e - C R M  
 