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

## Reviewed carrier appetite

Knowledge & Training > Carrier Appetite reads PDF/images locally (including OCR),
plus TXT, CSV and XLSX. Originals use private account-document storage, not public
Rashi uploads or external AI. Each document has its own carrier, scope, dates,
source permission, cited rules and separate agency access reference. Owner review
activates the exact saved revision; edits return it to draft. Overlapping carrier
sources remain visible and never automatically override each other. Imported
leads do not create or change appetite.

Installation requires review and application of
[`20261111010000_carrier_appetite.sql`](supabase/migrations/20261111010000_carrier_appetite.sql).
Apply it with the two opportunity migrations below using the validated release runner.
It requires the existing agency membership and private account-document storage
migrations. `ACCOUNT_DOCUMENTS_BUCKET`, if overridden, must remain private.

Extraction is conservative proposal generation, not a semantic underwriting
decision engine. Check every source, rule and missing criterion; multi-carrier
guides must be reviewed separately per carrier. There is no PDF page-count
ceiling; files remain limited to 25 MB, OCR rasterization to 16 megapixels,
extracted text to 1.5 million characters and a saved review to 3.5 MB/1,000 rules.
Activation alone does not run outreach or publish to public Rashi. Reviewed
matching comparisons are used by the separate opportunity workspace below;
free-form/compound rules remain manual review until explicitly translated.

Validation from `apps/web`: `corepack pnpm exec vitest run src/lib/carrier-appetite.test.ts src/lib/carrier-appetite-routes.test.ts`,
`corepack pnpm typecheck`, and `node scripts/test-carrier-appetite-db.cjs`
with `TEST_DATABASE_URL` (or explicitly `--use-local`). The SQL check always
rolls back its temporary schema and fixtures; it cannot install the feature.
Browser coverage: `corepack pnpm exec playwright test carrier-appetite.pw.ts`
with the existing disposable-user QA environment.

## Opportunity Intelligence: market fit and agent actions

Lead/account Overview > Business intelligence > Market fit and next actions
compares **reviewed business facts** against active, owner-reviewed carrier
guidance, without leaving the record. Business reviews, watches, digests and
source outcomes live in the existing Work Queue; Lead Finder links there.
Historical opportunity/task URLs redirect to the appropriate lead/account
overview, and record-action links survive reload until the drawer is closed.
Matching and history load on demand; fact editing and individual follow-up
composing stay collapsed until requested. Linked leads use the canonical account
profile. Imports never author carrier appetite or establish contact permission.

Owners can add exact text/list or inclusive numeric comparisons to cited carrier
rules. Missing facts/comparisons, overlapping sources, referral requirements,
unknown expiry or unverified market access stay **needs review**, not acceptance.
Business facts expire after 90 days; carrier review after 180 days. A current
matching exclusion or unmet mandatory condition blocks that market. Multiple
carriers remain separate; possible fit is not a quote or underwriting approval.

The queue evaluates the entire permitted reviewed set before paging, with
bounded database concurrency. Gates precede deterministic scores: fit /40,
renewal timing /25, evidence /20, contactability /10 and relationship /5.
Do-not-contact records appear last and support internal review only. Scores
are explained review priorities, never acceptance probabilities. Evaluation is
on demand, not a cached full-book index. Explicit watched records can also be
reevaluated by the opt-in internal scheduler described below.

Agents get internal briefings, source excerpts, missing questions and assigned
review tasks linking back to the same business record. The shared composer offers a local
sender-aware starter and optional explicitly authorized AI drafting. AI receives
only the business name, coverage line, sender and selected current confirmed
dossier priorities/required lines/next step; no carrier documents, excerpts or
mailbox history are forwarded by default. An additional explicit linked-conversation
choice permits only already-linked authorized CRM messages, under each contributing
agent's AI permission. No unrelated mailbox search is performed. Missing AI
configuration fails explicitly.

Saving, preparing, approving and assigning tasks never send. Individual email
requires exact saved-text approval, a current verified permitted email route and
a separate explicit send through the existing guarded delivery path. Evidence,
recipient, sender-profile, linkage or UTC-day changes invalidate approval.
Changing an email address clears its previous route verification. Once delivery
starts, the draft cannot be reused; uncertain attempts require checking
conversation/provider history, not automatic retry. Confirmed sent drafts offer
a separate follow-up that must be saved and approved again.

Installation additionally requires
[`20261111020000_opportunity_actions.sql`](supabase/migrations/20261111020000_opportunity_actions.sql)
after carrier appetite and existing dossier/task/communication migrations.
Then apply
[`20261111030000_opportunity_operations.sql`](supabase/migrations/20261111030000_opportunity_operations.sql).
No real messages are sent during validation. These workflows do not activate
Gmail, send SMS, enroll sequences or schedule future message delivery.

From `apps/web`, run opportunity matching/API tests, `opportunities.pw.ts`
alongside the appetite browser checks, and
`node scripts/test-opportunity-actions-db.cjs --use-local` (or
`TEST_DATABASE_URL` without that flag). Database checks roll back schema and
fixtures. Browser delivery/AI are mocked; existing provider integrations still
need separately approved end-to-end rollout checks.

## Opportunity Intelligence: operations and expansion

Lead Finder opens directly on Industry / State / Business name search and matching
business cards, with available company details, named contacts, email and phone
together. More filters, source/review notes, file acquisition and controlled capture
remain available behind disclosures. Saving searches, source approval, duplicate
checks and reviewed promotion still use the same guarded APIs. The search source
selector distinguishes saved prospects from FMCSA public business search.

The local public-record acquisition slice requires
`20261111040000_public_discovery.sql`, a server-only `FMCSA_WEBKEY` and an active
owner-approved **FMCSA** source in Settings > Intelligence. Existing approvals
remain file/capture sources; approvals cannot change provider after creation.
FMCSA searches business names, pages the documented 50-record source result and
strictly filters each page by state. It is not an all-industry or territory-wide
directory. A page with no in-state matches can still have further source pages.

Selecting a business retrieves its DOT record server-side and stages it through
full-book matching and the existing reviewed promotion flow. Unchanged retries
retain their identity across reload; an already-saved acquisition reconciles
without another provider lookup. Searches never create records or messages.
Reported phone/fleet/registration information remains unverified; driver counts
are not employee counts, registration dates are not policy renewals and missing
carrier/coverage information remains unknown. Records without a reported contact
stay research candidates. Provider failures are errors, never empty-success results.

Free keys belong in Vercel server environment settings (and local
`apps/web/.env.local` for local verification), never chat or `NEXT_PUBLIC_` keys:
- `FMCSA_WEBKEY`: https://mobile.fmcsa.dot.gov/QCDevsite/docs/apiAccess
- `DOL_API_KEY`: https://dataportal.dol.gov/registration (existing OSHA lead lookup)

This slice is not yet a verified live acquisition release. A configured real-source
search/acquire/review/promote pilot is still required. Form 5500/Schedule A and
Form 990 acquisition, broad industry discovery, automatic contact verification and
public-source recurring refresh are not implemented. Existing recurrence still
reevaluates retained evidence only; no LeO-only data or predictions are promised.

The earlier supported OIP operations release is deployed; its three OIP migrations are installed.
See [deployment verification](VERCEL_DEPLOYMENT.md#oip-release-carrier-appetite-actions-and-operations)
for the release record and validation boundaries.

Owner **Settings > Intelligence** configures exact industries, states, lines,
revenue limits, exclusions, confirmed renewal window, digest capacity and agency-time
weekday digest hour. Targets are distinct from carrier appetite; missing facts
remain unknown. Each agency uses its own deployment/database, not shared tenancy.

Recurrence starts **paused**, with no records automatically watched. Enabling it
requires the existing authenticated database heartbeat configuration. Explicit
record watches and each agent's saved searches reevaluate retained, authorized CRM
evidence only; they do not fetch websites, purchase data or invoke AI. Fenced leases,
bounded retries, visible errors, restart recovery and actor/day digest uniqueness
prevent duplicate work. Digests are internal linked lists, not outgoing email or
automatically created tasks. An optional worker reconciler uses
`CRM_INTELLIGENCE_WORKER_ENABLED=true`; the database scheduler already provides
the hosted path and need not be duplicated.

Opportunity workspaces support dated, reviewed authority/location changes,
source-qualified contact roles, confirmed held lines and cross-sell questions.
Private document linkage reuses uploaded account files and projects only reviewed
carrier/line/term metadata for agent confirmation, never personal fields or raw
document text. Changes are evidence for review, not proof of growth or a coverage
gap. Relationship suggestions require separate opt-in, sourced evidence and
approval; there is no automatic private-mailbox mining.

Agent-created business questionnaires expire after seven days, can be revoked,
and expose only saved questions. Responses require explicit retention consent,
remain unverified, and cannot overwrite a submitted response. Documents continue
through approved private storage; creating a link never sends it. Controlled
capture in Lead Finder stages only deliberately pasted, source-authorized business
text, URL and date through existing candidate review. It cannot read a browser
page or scrape a site. Hashed retry identities survive reload in the same tab.

Source/date-range reports use append-only recorded outcomes, incremental costs
and latest actual quote/bind premiums per business/source. Corrections supersede
an earlier outcome without deleting its audit record. Stage and recorded-business
rates are not causal funnel estimates or model accuracy. Licensed discovery,
automated contact verification and predictive learning remain explicitly gated:
no paid provider was authorized, and no representative held-out evaluation exists.
New industries reuse the same reviewed evidence contracts; no market quality or
conversion claim is made without actual pilot evidence.

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

### Native social marketing (content studio and test execution)

Communication -> Social Marketing (`/communication/social`) supports creating,
editing, and archiving caption drafts, with immutable revision history and
optimistic-concurrency checks. Its private image library accepts JPEG/PNG uploads
up to 4 MB and 20 megapixels (8192 pixels per side), requires alt text and usage
rights/source, and converts images to metadata-free JPEG with thumbnails.
Transparency is flattened to white; originals are not retained. Drafts currently
support one image, with attachment changes captured in immutable revisions.
Saved revisions can be submitted or withdrawn from review. Active owners/admins
can approve content or request changes with a reason; agents cannot approve.
Review history is immutable and version-checked independently from content.
Editing or archiving reviewed content invalidates its review, while a no-op save
preserves approval. Content approval does not schedule or publish anything.
The internal test destination requires separate approval for the exact revision
and scenario. Future real destinations must receive their own approval.
The workspace separates posts from the image library, offers image-led grid and
list views, and searches the currently loaded page. The responsive composer
keeps a live content preview beside editing, with an on-demand image picker and
persistent save controls with saved/unsaved status. The content studio uses
segmented navigation, soft editing surfaces, and an accessible browse/drop
image-upload surface. Preview formatting is generic until accounts connect.
Caption help offers free editable starters and optional AI suggestions using
the existing OpenAI configuration/model. AI runs only on an explicit
credit-labeled request, sends only the entered public topic/current caption,
and never saves or replaces content until staff choose to apply it.
New-draft uploads retain the selected file and metadata after a failure for an
explicit retry, prevent overlapping uploads, and block draft saving while busy.
It reuses current CRM sign-in and active membership
when agency membership has been initialized. It can schedule simulated test runs,
but cannot publish to real networks or connect social accounts. Existing
email/outreach and appointment scheduling are unchanged.

The additive `20261105220000_social_marketing_engine.sql` migration adds test
intents, immutable transition history, attempts, acceptance receipts, durable
outbox records, and a workspace pause control (initially paused). Validate and
apply it only through the approved database runner. The runner discovers
`supabase/tests/social_marketing_engine.sql` when installed. Test calendar and
execution controls require this migration; it is not applied automatically.

To operate after an approved apply: configure the separate worker's PostgreSQL
`DIRECT_URL` (or `DATABASE_URL`) and Redis connection, set
`SOCIAL_TEST_WORKER_ENABLED=true`, and run `corepack pnpm --filter @crm/worker dev`
or its existing build/start commands. Worker execution RPCs require a privileged
database connection; the web service role cannot dispatch or fabricate receipts.
Startup fails explicitly if database/queue readiness checks fail. Owners/admins
then approve a test destination, schedule it, and resume the test engine.
The UI reports worker check-ins separately from permission to dispatch.

PostgreSQL is canonical; Redis carries only intent ID/version. Polling every
15 seconds repopulates lost due jobs. Two-minute fenced leases prevent stale
workers committing outcomes; up to three dispatch attempts use exponential
backoff with bounded jitter.
Pre-dispatch pauses or crashes do not spend an attempt. Accepted-but-unconfirmed
dispatches are reconciled against deterministic receipts before any retry.
The explicit uncertain scenario requires **Confirm test outcome**; failed
unaccepted tests can be explicitly retried within budget. Use pause before
maintenance and inspect worker logs plus execution history for failures.
Restarting the worker recovers expired leases; do not manually reset running
intents or clear acceptance receipts.

The Test calendar uses Arizona wall time, storing UTC instants. Rescheduling
and canceling invalidate old queued versions. Content edits/withdrawals block
pending destination approvals. Accepted runs say **Test completed**, never
published. The UI shows the latest 200 intents and 10 transitions per intent;
complete transition history remains in PostgreSQL. Appointment calendar
integration, real provider reconciliation, analytics, advanced media/retention,
and production hardening remain later work.

Apply `supabase/migrations/20261105120000_social_marketing_drafts.sql` followed by
`supabase/migrations/20261105140000_social_marketing_media.sql` through the
existing approved SQL migration process before deploying this surface. The
schema verifier checks its tables; the database release runner includes
`supabase/tests/social_marketing_drafts.sql` and `supabase/tests/social_marketing_media.sql`
when installed. Missing schema is
reported explicitly rather than presenting an empty successful workspace.

Also apply `supabase/migrations/20261105170000_social_marketing_reviews.sql` for
review state and owner/admin review commands. The database runner includes
`supabase/tests/social_marketing_reviews.sql`. Reviewer membership must be active
in `agency_members`; authentication alone never grants approval permission.

Media storage uses the private `social-marketing-media` bucket. Original uploads
pass through a bounded authenticated server endpoint before decoding; only
sanitized image/thumbnail variants reach storage. Processing reserves one of two
workspace slots and enforces a 250 MB library budget. Failed uploads remain
visible; partial storage is cleaned up without deleting confirmed ready images.
Previews require authorization and use 60-second signed links (any already-issued
link remains usable until expiry). Referenced images are retained for revision
history; image deletion, video, direct browser uploads, and provider-specific
delivery/processing are not enabled in this phase.

The appointment Calendar remains at `/scheduler`, with its existing linked-task
behavior. Future social-calendar integration will project separate publishing
records into that view; social posts will not become appointment rows or tasks.
The engine is for this CRM first; multi-agency isolation remains future work.

When a deal moves to `BOUND`, API endpoint `PATCH /deals/stage` enqueues `deal.bound` on Redis queue `insurance-workflows`.
Worker flow:
1. Load deal, account, and primary contact.
2. Send SMS (Twilio adapter placeholder).
3. Send email (SendGrid, or explicitly selected Resend with durable retry protection).
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

Lead deletion task cleanup: `20261104002000_lead_task_delete_cleanup.sql` removes
lead-linked tasks, their alerts and linked calendar events before any lead deletion,
including deletion outside the archive purge RPC. Archiving still completes tasks
and restoring still reopens untouched archived tasks. Historical tasks pointing to
already missing leads require separately verified, targeted repair; this migration
does not delete existing task history or enable email.

### Resend email (disabled until verified)

The web app and worker use the official Resend SDK through a shared durable adapter. Resend is the only agency email transport; there is no provider selector or fallback. Multi-agent Gmail remains a separate feature requiring each agent's authorized mailbox.

See the [Resend activation checklist](VERCEL_DEPLOYMENT.md#resend-activation) for DNS, keys, signed delivery events, forwarding replies, consent and unsubscribe setup. Settings shows configuration status without revealing credentials and allows administrators to record actual marketing permission. No credentials or domain verification are bundled with the code.

All outreach sequences require recorded marketing permission, including authorized agent-mailbox sequences. Website quote/contact permission and imported data are not automatically marketing consent. Marketing also requires your full postal address, HTTPS `CRM_WEB_ORIGIN` and a stable `EMAIL_UNSUBSCRIBE_SECRET`; missing setup blocks sending. Keep approval mode on during migration. Dynamic drafts, scheduling and approvals remain CRM-managed; this integration does not create Resend broadcasts or import contacts into a marketing audience.

Configure these server-only variables in the ignored root `.env` and `apps/web/.env.local` for local use, and in Vercel's encrypted environment settings for deployment:

```env
RESEND_API_KEY=                     # Sending-only key restricted to updates.shield-assurance.com
RESEND_FROM_EMAIL=camani@updates.shield-assurance.com
RESEND_REPLY_TO=camani@shield-assurance.com
RESEND_WEBHOOK_SECRET=               # Signing secret from the Resend webhook
RESEND_RECEIVING_API_KEY=            # Separate receiving-capable key
RESEND_INBOUND_ADDRESS=              # Exact Resend-provided receiving address
RESEND_SENDING_ENABLED=false         # Keep false until coordinated release and authorized test
RESEND_REPLY_SYNC_READY=false        # Keep false until a forwarded real reply is verified
EMAIL_UNSUBSCRIBE_SECRET=            # Random, private, stable value of at least 32 characters
EMAIL_POSTAL_ADDRESS=                # Complete real business mailing address
CRM_WEB_ORIGIN=https://shield-assurance-crm.vercel.app
```

In the Resend dashboard, receiving may be enabled for the `updates.shield-assurance.com` subdomain; do not point the root-domain (`@`) MX records away from Google Workspace. The sender must be on the verified sending domain; the Reply-To remains the existing inbox. The worker also needs `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO`, `RESEND_SENDING_ENABLED`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`). The web app needs the Resend settings above plus its existing Supabase server credentials. Keep all API and webhook secrets server-side. Credentials accidentally placed in `.env.example` or shared in chat must be revoked and replaced, not reused.

Resend send attempts are durably claimed before contacting the provider. Accepted attempts can recover their receipt; uncertain attempts require reconciliation and are not automatically resent, even after Resend's 24-hour idempotency window. Signed delivery webhooks can recover provider acceptance by the CRM attempt tag. A bounce, complaint or provider suppression blocks the address and stops its sequences. Lead purge cascades through lead-owned Resend attempts/events; minimal opt-out/suppression records remain to prevent emailing an opted-out address after re-import.

### Personalized marketing outreach

- Imports create first-contact tasks due next business day at 4 PM Arizona and
  renewal tasks only when usable future renewal dates exist. The import summary
  distinguishes both task counts, reports follow-up setup failures, and posts one
  notification per committed batch. Imports do not automatically enroll or email
  contacts. Use Tasks with due-date filters cleared to see future follow-ups.
- Retrying enrollment for an active sequence retries its missing next-step draft
  without creating another enrollment or sending email. Paused sequences stay paused.
- Email drafts have the saved sender signature attached deterministically by the
  CRM. AI repair prompts use the actual word range for the selected draft type;
  final word count, exact citations and safety checks still apply before acceptance.

- Apply `supabase/migrations/20261102200000_outreach_marketing_profiles.sql` before using marketing profiles. This adds profile storage and a sender-profile field; it does not enroll contacts, rewrite existing drafts or send messages.
- In a lead or account's **Notes**, expand **Marketing profile & email purpose** to save stated insurance interests, priorities, concerns, preferred next-step channel and the agreed next step. Stated needs/preferences require a source and confirmation date. These fields are agent-recorded context, not AI-inferred facts or marketing consent.
- Explicitly linked leads share the account profile. Until one is saved, the latest saved profile from an explicitly linked lead is available; saving through either workspace writes the account profile. Unlinked contacts never share preferences based on a guessed name or email.
- In **Outreach > Guardrails**, edit the shared **Agency sender profile** (name, role, specialties, service area, tone, signature and approved claims). This is agency-wide writing context for the current single-producer workflow, not per-user sender routing or a change to the email provider's From address.
- Lead, account and sequence generation use these profiles, active assets, notes and the latest twelve messages from the canonical conversation. Five purpose-based writing templates cover quote responses, missing information, renewal reviews, relevant coverage conversations and dormant-lead reactivation. Choose a default on the profile or override it in the lead email composer.
- AI output must pass strict JSON shape, word-count, subject/placeholder, basic risky-claim, repetition (within a sequence), exact grounding-citation and signature checks. A failed result gets one repair attempt; persistent failure is explicitly reported, with no substitute draft. These checks are not a semantic guarantee of accuracy: review every claim and next step. Approval shows original cited facts and live wording warnings for edits.
- Generated emails carry a standard authored-signature delimiter so immediate and scheduled manual delivery preserve the selected producer's signature rather than appending a second, hardcoded producer. Unsigned manual messages retain the existing default signature; system automation retains its system signature.
- Existing opt-outs, reply-stop processing, approval mode, send windows, caps and provider-acceptance recovery are unchanged. Saving a profile or template never sends anything. AI requests use the existing configured provider and require `OPENAI_API_KEY`; tests mock AI and email delivery.

### Phases 1-3: local reliability release

- Run `start-site.bat` to open the CRM at `http://127.0.0.1:3000` without a production build. The explicit address avoids opening a different app listening on IPv6 `localhost`. Keep the launcher window open when it starts the server; it never stops another server.
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

## Multi-agent Gmail (optional, disabled by default)

Each active agent has a private Gmail grant and personal sender profile. CRM contact
records and matched conversations are shared within this single agency. This is not
a multitenant SaaS model. Owner/admin invitations create agents, not administrators;
only an owner may promote administrators/owners. There is no public registration.

### Rollout and Google setup

1. Keep `CRM_MULTI_AGENT_ENABLED`, `CRM_GMAIL_ENABLED` and `CRM_GMAIL_AI_ENABLED`
   false during setup. Obtain database authorization before applying, in order,
   `20261102220000_agency_memberships.sql` and `20261102221000_gmail_connections.sql`.
   Validate first with the existing rollback-only SQL runner. No application startup
   applies migrations. The Gmail fixture tests memberships, history/live cutover,
   consent, deactivation, mailbox ownership and accepted-send reconciliation.
2. Select an existing, email-confirmed Supabase auth user for the initial owner.
   Set server-only `CRM_BOOTSTRAP_OWNER_ID` to that exact UUID, enable agency mode,
   and issue an authenticated `POST /api/agency?bootstrap=true` as that user.
   Bootstrap is single-use; remove the bootstrap variable afterward. Bootstrapping
   also activates restrictive membership checks on existing authenticated table and
   account-document access. Invite existing users before opening access to them.
   Never infer ownership from names or user-editable auth metadata.
3. Configure Supabase invitations with the allowed redirect
   `CRM_INVITE_REDIRECT_URI=https://your-crm/auth/accept`. The activation page consumes
   the Supabase session/link and sets a password; Gmail does not replace CRM login.
   Disable public signups in Supabase. Each agent completes their own profile in
   Settings. Legacy free-text producer assignments remain untouched.
4. Create a Google **Web application** OAuth client and enable Gmail API. Register
   the exact HTTPS `GMAIL_OAUTH_REDIRECT_URI` (`/api/gmail/callback`); configure
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` server-side. Both consumer Gmail and
   Workspace accounts use individual grants for `gmail.readonly` and `gmail.send`,
   offline access, single-use state, browser binding and PKCE. The actual From
   address comes from Google's verified mailbox profile, never a form field.
5. Configure `GMAIL_TOKEN_KEYS` as JSON mapping key versions to base64-encoded random
   **32-byte** keys, and `GMAIL_TOKEN_KEY_VERSION` as the active version. Generate
   secrets with a cryptographically secure secret manager; do not commit them.
   AES-256-GCM tokens are bound to the owning user. To rotate, retain old versions,
   switch the write version, re-encrypt stored token/state values through a reviewed
   server-side operation, verify decryption, then retire unused old versions.
   Removing a key prematurely requires affected agents to reconnect.
6. Create `GMAIL_PUBSUB_TOPIC`, grant publish access to Google's Gmail publishing
   service account, and configure an authenticated push subscription to
   `/api/gmail/push`. Configure `GMAIL_PUBSUB_AUDIENCE` to its exact HTTPS audience
   and `GMAIL_PUBSUB_SERVICE_ACCOUNT` to the subscription's OIDC service-account
   email. JWT signature, issuer, audience and verified email are checked. Pushes
   only request sync; history is the source of truth. Watches renew daily.
7. Enable the two agency/Gmail flags in web **and worker**, configure worker
   `CRM_WEB_ORIGIN`, `CRON_SECRET` and existing Redis settings. The existing BullMQ
   worker reconciles every minute; inactive/disconnected mailboxes cannot claim
   work. Manual sync is durable and does not depend on an open browser. The legacy
   scheduled processor now always requires `CRON_SECRET`; a cron user-agent is not
   authentication. Use deployment cron for `/api/messages/process-scheduled`.
8. Complete Google consent-screen verification and any required restricted-scope
   security assessment before external rollout. `gmail.readonly` is restricted,
   and grants broad mailbox access even though only matching CRM threads are
   retained. Consumer accounts cannot assume an internal-Workspace exemption.
   Connect authorized QA mailboxes and explicitly authorize test emails before
   running live send/receive acceptance checks. Unit/browser mocks are not proof
   that a Google deployment is configured.

### Communication and AI safeguards

- Sync follows exact CRM email addresses and explicit lead-account links. No name
  guessing, Gmail dot/plus collapsing, automatic account creation or inferred consent.
  Complete matched threads are paginated; mixed/ambiguous participants are held
  without retaining their bodies. Update the actual CRM contact records to resolve
  ambiguity, then request sync. Matching is revalidated at ingestion.
- Settings shows health, pending historical import and held-thread Gmail links.
  Inbox/contact workspaces group Gmail messages by source thread, attribute sender,
  page older history and allow explicit, reviewed replies. Own-mailbox mappings
  preserve Gmail thread references; a teammate's thread or a changed subject starts
  a new thread in the sending agent's mailbox. Replies to a changed contact email
  are blocked rather than silently redirected. Incoming attachment bytes are not
  downloaded; metadata identifies them and own-mailbox links open Gmail. Existing
  CRM attachments continue to send through MIME.
- Historical messages are read imports, not new alerts/tasks/sequence replies.
  Live history can promote a message seen first during backfill exactly once.
  Expired history cursors trigger scoped backfill, not dropped messages.
- All agent sends pin an explicit mailbox, durable attempt UUID and RFC Message-ID.
  Provider acceptance is not recipient delivery. Ambiguous sends are never retried
  automatically or through fallback SendGrid; Sent sync reconciles known copies.
  Until resolved, a second request to that recipient is blocked. An unresolved
  attempt absent from Sent requires operator investigation; absence alone is not
  proof that an email was not accepted. Do not delete attempts to force a resend.
- Sequences default to human review. Settings records explicit recipient marketing
  consent/evidence and authorizes a particular owned sequence/purpose for auto-send.
  Sender, recipient and assignment changes invalidate automatic approval; paused
  sequences must be explicitly reauthorized after resume. Opt-outs, intake consent,
  send caps and stop-on-reply remain enforced. Existing legacy/unowned sequences
  and schedules never acquire an inferred agent. Review/cancel and recreate them.
- General legacy/system workflows are deliberately blocked from using the old email
  fallback in agency mode. They require a separately reviewed system-sender adapter
  before activation; do not enable agency mode expecting legacy SendGrid automations
  to continue impersonating a producer. Agent-owned manual, scheduled and sequence
  sends use the Gmail adapter.
- Gmail-content AI remains off until the configured provider/privacy approval is
  complete **and** every source agent for a message has opted in. Deactivated or
  revoked source grants exclude that content from future drafts. No mailbox data
  may be used for model training or unrelated advertising. Opt-in alone does not
  establish Google Limited Use compliance. Replies are drafts, never auto-sent.
  Agent voice, client-stated insurance needs and eligible conversation context
  remain separate; raw email instructions are not trusted as system instructions.

### Retention, disconnect and operational recovery

Disconnect stops the watch when possible, revokes Google's grant when possible,
always removes local tokens/states and pauses owned sequences. Failure to confirm
Google shutdown is shown explicitly with a link-removal instruction. Existing
shared CRM history remains; disconnect is **not** history deletion.

Before rollout the owner must establish a documented retention period, privacy
notice and deletion-request procedure. Removal is a reviewed, authorized database
operation: identify all source `gmail_message_links`, account/lead provenance and
durable-send records; remove message content/attachment metadata, derived AI drafts
and references according to that policy, preserving required audit records without
retaining deleted message bodies. Check cross-mailbox copies before deleting shared
history. Do not cascade-delete an auth user or silently erase regulated records.

An invitation email can succeed before its membership insert fails. The API reports
that condition, denies CRM access, and does not invite a second identity. An owner
must verify the existing auth user's exact ID and email, then recover an **agent**
membership and audit event in one authorized database transaction, or remove only
the failed invite after confirming it has no records. Existing Supabase users can
be onboarded by this same reviewed membership transaction. Never promote them
through auth metadata or disable membership checks for recovery.

Official references: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[sync](https://developers.google.com/workspace/gmail/api/guides/sync),
[push](https://developers.google.com/workspace/gmail/api/guides/push), and
[Google user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

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