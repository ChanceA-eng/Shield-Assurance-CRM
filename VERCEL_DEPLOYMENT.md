# Vercel Deployment Checklist

## Rich email workspace

Hosted schema preparation on November 19, 2026 applied eight reviewed
migrations: Team foundation and Owner protection, active Tasks, Team request
and dispatch authorization, staff policy inbox, branding images, and rich email.
They passed a transactional dry-run before application; the hosted schema
preflight passed afterward. Older migration-history gaps were not replayed.
Team remains disabled with `enforcement_version=0`; publishing this release
does not complete or activate the separate full Team rollout.

Templates now support an email-safe block workspace: one to three columns,
draggable text/image/button/divider/spacer blocks, borders, spacing, colors,
layout undo/redo, and desktop/mobile previews. Uploaded logos, banners and
signature images can be cropped and zoomed before upload; click destinations
are separate from image uploads. Images are public branding assets, never
customer documents.

My Account includes formatted personal signatures, optional image/button
layouts, and a signature-only tab for restricted staff. The main Leads,
Accounts and Communication email composers offer **Format email** for fonts,
styles, lists, alignment, colors and links. Plaintext bodies remain available
for history and processing; rich content travels separately through Gmail,
Resend and scheduling. Editing a scheduled body without formatting clears its
previous rich body rather than sending a stale design.

Before deploying this code, apply `20261119124000_email_branding_images.sql`
and `20261119125000_rich_email_workspace.sql` to the intended database after
the existing branded-template, agency-membership and Gmail/scheduling schema.
The rich workspace migration expands template limits, stores personal designs
outside Auth metadata, updates plaintext/rich signatures atomically, and
retains rich Gmail send snapshots in communication metadata.
The production schema preflight now checks these new tables/columns.
Local build success does not prove that hosted migrations have been applied.
Verify image upload, personal signature save/reload and delivery previews on
the release candidate before promoting it. Do not send customer emails as a
test or enable the separate Team rollout based on these editor checks.

## Website-style Team access

Apply `20261119231000_direct_team_access.sql` and
`20261119232000_team_setup_reauthorization.sql` before deploying this workspace.
Apply `20261120010000_team_training_access.sql`,
`20261120020000_complete_team_permissions.sql`, and
`20261120030000_apply_custom_team_permissions.sql` before deploying this
workspace. The November 20 permission migrations were applied to the production
database after a dry run containing only those two pending versions; older
migration-history gaps were intentionally not replayed.
The owner and existing administrators see the roster in the first authenticated
response. A role title is freeform and has no authorization effect. Invites
start with no CRM workspace grants unless the sender selects them explicitly.
The new per-person access mode does not turn on the old role-bundle rollout.
The permission picker groups the shared CRM catalog by section. Access is
evaluated through page requirements, API route policies, record scopes, and
database authorization; the role title itself never grants access.
Training access covers learning pages, quizzes and the member's own progress;
it does not grant the course editor or other knowledge-management features.
Existing non-owner legacy members retain their current access until an authorized
manager saves their new permission set. The owner cannot be edited or deactivated.

Configure Resend and set `CRM_INVITE_REDIRECT_URI` or `CRM_WEB_ORIGIN` to the
public HTTPS CRM. A localhost override falls back to the configured HTTPS
origin, otherwise sending is blocked. Gmail configuration is not required.
Setup is inactive until provider acceptance and verified recipient activation.
Use **Resend setup** to issue a fresh link or **Revoke invitation** to block
activation. Email provider acceptance is not evidence of delivery.
Activation rechecks the sending manager's current authority. An authorized
manager can resend to reauthorize a pending setup after its original sender
loses Team access.

Use an isolated QA project to verify custom titles, zero-permission sign-in,
granted and denied workspaces, edited/suspended staff, resend and revocation.
Do not create a temporary Owner in production; the Owner trigger prevents cleanup.

## Team access foundation (not activated)

The additive `20261110120000_team_access_foundation.sql` migration introduces
editable role bundles, scoped member exceptions, versioned/audited access changes
and a retryable invitation lifecycle. Team membership is designed independently
of Gmail and multi-agency onboarding. Its role-bundle invitation flow is
superseded by the Website-style per-person Team workspace above.

The migration leaves `team_access_rollout.enabled=false` and
`enforcement_version=0`. New management RPCs reject changes in that state.
The owner Team workspace and pending-member activation flow are staged behind
that same rollout. The follow-up `20261110121000_protect_agency_owner.sql`
migration prevents role/status changes or deletion of any Owner membership,
while permitting personal profile updates.
Do not enable it or raise the enforcement version until the page/API, direct
database/storage/realtime and worker checks, activation flow, and Team workspace
are implemented and verified together. Merely adding the capability catalog or
route-policy inventory does not enforce permissions.

The request guard requires the `20261119121000_team_request_authorization.sql`
RPC before deploying the matching app, even with rollout disabled. If the
API reports that the RPC is missing, only an authenticated, active Owner
verified through the existing membership policy retains access. Other failures
deny access. Verify the hosted API schema cache and owner sign-in on the
release candidate. Restricted staff see a limited sidebar, and agency-wide
notification polling/realtime and the lead and Rashi widgets are not mounted.
Social readers can view posts and images; social editors can also draft and
edit posts and upload marketing images. Archive, review, publishing, and
connection controls remain unavailable in restricted mode. Restricted staff
land on their first permitted record list, Social Marketing, or My Account.
Leads, Accounts, and Policies use focused staff screens, not the Owner
workspaces. These lists search and page inside the granted record scope.
Policies require an accessible linked account. Staff with account edit access
can update contact information only on rows within their edit scope.

Restricted-mode API support currently covers personal account, the social
actions above, basic account detail and edits, and scoped
account document lists, downloads, and uploads. The upload completion proof
binds the actor and file to the issued ticket, and completion rechecks account
assignment before looking up the object. `20261119123000_staff_policy_inbox.sql`
adds staff policy requests with Routine, High and Urgent priorities. In
**Policies > Open policy request inbox**, authorized administrators can review
and resolve requests or correct carrier and policy number. Submitting or
resolving a request does not change policy coverage or contact the carrier.
Apply this migration after Team request authorization and the policy placement
workspace; verify admin and staff flows on an isolated database before release.
Lead changes and service tasks are not yet exposed in the staff screens. Keep the rollout off
until the remaining enforcement and invited-user workflows are verified.
The `20261119122000_team_dispatch_authorization.sql` migration adds revocation
checks for staff-authored scheduled mail, staff-approved outreach, and real
social dispatch. It does not cover every automation path.

The separate `20261119120000_active_task_workspace.sql` migration is required
for the updated Tasks workspace and dashboard metrics. It excludes tasks
directly linked to archived leads from workspace reporting without changing
record history. The shell's Tasks badge uses the saved agency time zone.

The migration tests use an in-memory PostgreSQL engine; they do not connect to
Supabase or send invitations. Run the focused checks from the repository root:

```powershell
corepack pnpm --filter @crm/shared test -- src/team-access.test.ts src/team-access-db.test.ts
corepack pnpm --filter @crm/web test -- src/lib/team-route-policy.test.ts src/lib/agency-team.test.ts
```

No live schema, environment, memberships or mail-provider configuration was
changed while preparing this foundation. Keep existing mail-rollout flags
unchanged. Restoring an older application after future activation must not
re-admit restricted members through the legacy unrestricted authorization model.

## Tools-first settings and Rashi help (live)

Live: `dpl_EL7etgqJouJfMkoLLzMRRB13wMDD`
(`shield-assurance-okrqyid85-shield-assurance.vercel.app`) at
https://shield-assurance-crm.vercel.app. Selective source extends
`dpl_FzJXgaJNtPxCmaVXoizy9mbsrL6n`; unrelated local team-access and email
branding changes were not included. Release source is the current session's
`files/tools-cleanup-release` folder.

Settings retain save, connect, test, retry and access controls. Integration
diagnostics and source issues appear inline beside their controls. The persistent
Rashi assistant remains available from the lower-right corner. Template merge
fields are an insertion selector rather than a long list. Workers' comp retains
its resource links, document tools and recorded facts.

Known CRM tool questions have grounded answers without an AI-provider call.
Document/carrier-scoped questions retain the existing underwriting retrieval
path. Current diagnostics remain local to the contextual widget answer and are
not automatically sent to a model. Rashi does not install keys, change settings,
grant consent or repair provider connections automatically.

Verification: strict TypeScript, local production build, hosted schema/build
checks and 76 focused unit tests passed. Thirteen focused browser checks passed
locally and on the protected candidate; seventeen passed on the canonical live
domain. Checks covered real chat help, template insertion/save/reload, retained
Settings drafts and Back navigation, retries, mobile layout, and preserved
workers' comp reading and persistence. Delivery UI tests use mocked providers;
no invitation or outreach email was sent. No migrations or provider/rollout
configuration changes were required.

Rollback: promote `dpl_FzJXgaJNtPxCmaVXoizy9mbsrL6n`.

## Settings workspace (previous release)

Live: `dpl_FzJXgaJNtPxCmaVXoizy9mbsrL6n`
(`shield-assurance-gartg3367-shield-assurance.vercel.app`) at
https://shield-assurance-crm.vercel.app. This selective release extends the
workers' comp deployment `dpl_5BBmxtSNHcvh6YVBXKotFSMfhHtB`, not the older
Tasks-only source. Its isolated source is the current session's
`files/settings-workspace-release` folder.

Team is the default Settings section. Switching sections uses browser history
without another server navigation; visited forms and their drafts stay mounted.
Automation editor replacements retain discard guards, and hidden run-status
panels stop polling. Discovery tools load individually and omit successful
directory scan dumps while preserving repair actions. Email/integration setup
shows specific fixes instead of generic support messages.

The earlier invitation popup and its Gmail prerequisites are superseded by
the Website-style Team access section above.
Multi-agent rollout must still verify record permissions and per-agent Gmail.

Verification: strict TypeScript and the hosted production build passed;
8 targeted unit tests and 17 focused browser checks passed on the canonical
domain, including real workflow persistence and workers' comp checks.
The broader candidate run passed 26 checks; its two navigation fixture
failures (unmocked workers' comp reads) were reproduced on the preceding
production release. Invitation success/failure UI tests mock delivery; no
real invitation email was sent. The real owner team API confirmed all five
production blockers.

Rollback: promote `dpl_5BBmxtSNHcvh6YVBXKotFSMfhHtB`.

## Arizona workers' comp (previous release)

Workers' comp release: `dpl_5BBmxtSNHcvh6YVBXKotFSMfhHtB` at
https://shield-assurance-crm.vercel.app. This selective release extends the
previous Tasks deployment `dpl_GvvyNkdsPfz1UGanRnQ8SqH8UeYz`.
The hosted build and schema checks passed; four workers' comp browser checks
passed on both the candidate and canonical production domain.

The Workers' comp section shares the existing business profile UI in Finder,
leads and accounts. Unsaved Finder results receive official Arizona resource
links and name copying only; no lead is created and no private facts are loaded.
Saved records support private policy, mod worksheet, payroll, employer
self-insurance and carrier/TPA loss-run summaries with source report dates,
business-match review and optional page citations. Review supports correction,
optimistic revision checks and removal.

The [ICA coverage resources](https://www.azica.gov/obtaining-workers-compensation-coverage-information)
refer to [NCCI's verification site](https://www.ewccv.com/cvs/?ref=https://www.azica.gov/).
Its terms were checked directly: personal, non-commercial verification only;
scripted queries and automatic retrieval are expressly prohibited. The release
does not search that service, accept its terms, import its results, or treat a
lookup miss as uninsured. The ICA page separately lists self-insured employers;
a listing is not inferred coverage for a similarly named subsidiary.

Document reading uses the existing local PDF/OCR engine. Original files and
their extracted text never upload; only the structured fields explicitly
reviewed by the producer persist. Reopen the local source during review if
needed. Use employer-level or redacted documents, not claimant identifiers,
medical details or employee-level payroll. Raw source bytes therefore have
no server retention or download surface.

Applied migrations: `20261117010000_workers_comp_evidence.sql`,
`20261117011000_workers_comp_conflict_response.sql`, and
`20261117012000_workers_comp_record_isolation.sql`. The private table has
RLS and no authenticated/anonymous access. The service-only workspace function
checks active membership and both lead and linked-account assignments, keeps
each original record separate, audits access/review/removal without sensitive
field values, and rejects stale revisions. No global intelligence observations,
marketing profile, draft prompt, enrollment or send is updated.

Explicit private guide comparisons use only reviewed, current unambiguous
AZ class codes, in-period experience mods and a complete audited annual payroll
period. Conflicting values and multiple classes are left for producer review.
Losses stay report-period-specific: missing years are never zero; a zero-count
report is not mapped to an unqualified "no prior losses" fact. Policy expiration
does not create a confirmed renewal. Future, historical and stale evidence stays
visible but is withheld from automatic comparisons.

Validation commands:

- `corepack pnpm --filter @crm/web exec vitest run src/lib/workers-comp.test.ts src/lib/opportunity-matching.test.ts src/lib/carrier-appetite.test.ts`
- `node apps/web/scripts/test-workers-comp-db.cjs --use-local` (all fixture/schema changes roll back)
- From `apps/web`, use the existing protected QA fixtures to run
  `corepack pnpm exec playwright test browser-tests/workers-comp.pw.ts`.

## Evidence-led prospecting and clean status release

Live deployment: `dpl_AEPdz87kypGTtCDZa25wnj5Frb98` at
https://shield-assurance-crm.vercel.app. This selective release was assembled
from the previous live navigation source plus reviewed prospecting, outreach
and status-cleanup changes; unfinished Secure Intake changes were excluded.

Contact-preference and prospecting failures now show short, actionable messages;
database diagnostics remain in server logs. A single background queue-refresh
failure stays out of the banner, loaded requests remain available, and reconnecting
retries automatically. Repeated failures show one concise alert with Retry.
Starter templates and drafting favor a brief agent introduction, a specific
business detail and a simple question. Saved agency templates are preserved.

Verification: 1,384 unit tests passed (6 skipped), production schema checks,
strict TypeScript and build passed, 34 candidate browser checks passed, and
7 focused browser checks passed on the canonical production domain after
promotion. These cover the installed contact/cadence APIs, existing restrictions,
template workflows and transient/persistent queue failures.

The optional lead plan creates manual calls on Days 1, 4, 9 and 21 and
approval-required email drafts on Days 2, 7, 12 and 16. Day 1 is the enrollment
date in the agency time zone. The Outreach heartbeat prepares due drafts;
agents can also use **Prepare due email drafts** in the lead workspace.
No prospect is enrolled automatically and no cadence email sends automatically,
regardless of the global outreach setting.

These reviewed migrations were applied together in a transaction before release:

1. `supabase/migrations/20261113015000_record_contact_preferences.sql`
2. `supabase/migrations/20261113020000_prospecting_cadence.sql`

The contact migration uses version `20261113015000` because `20261113010000`
already belongs to the account-intake migration. Database validation supports
the installed schema and runs synthetic fixtures in a transaction that always
rolls back. Run
`node apps/web/scripts/test-prospecting-cadence-db.cjs --use-local` for that
verification, or set `TEST_DATABASE_URL` and omit `--use-local`.
The contact-preferences migration is required by lead listings and email
delivery; missing or incomplete restrictions block contact rather than silently
allowing it. Calls stop after a reply/connected call, opt-out, cancellation,
contact restriction or lead-stage/identity change. At most two voicemails may
be logged per plan. Drafts retain existing marketing-consent and sender checks.
The lead and account pages do not offer a control to mark a contact as
restricted. An existing restriction is displayed and may be cleared on its
original record; independent unsubscribe and consent rules still apply.

The prospecting card displays fresh source-backed facts and confirmed renewal
timing, suggests an editable A/B/C priority before enrollment, and snapshots the
selected angle, useful offer, source/data level and priority for outcome review.
The priority is an explained workflow suggestion, not a carrier eligibility or
sales-performance claim. Renewal-preparation reminders are opt-in and require a
current confirmed renewal date. Secure Intake is unchanged.

## Tasks workspace (previous release)

The Tasks release was `dpl_GvvyNkdsPfz1UGanRnQ8SqH8UeYz`
(`shield-assurance-cmlxadjbn-shield-assurance.vercel.app`). It extends
`dpl_D9jBiejxseHEQ2GnHaVWeERDU56e` with the Tasks workspace: one compact
toolbar, a **New task** popup, a floating selection bar with a **Reschedule**
popup, and a **Reassign** popup. It has no API or database changes and was
released from the isolated copy. Rollback: promote `dpl_D9jBiejxseHEQ2GnHaVWeERDU56e`.

## Secure Intake and CRM consistency

The previous live release is `dpl_D9jBiejxseHEQ2GnHaVWeERDU56e`
(`shield-assurance-qzxv635oz-shield-assurance.vercel.app`). It extends
`dpl_EZm6y9PcLSd3rU2kEa3zZ1qTa8WW` with the confirmed 30-minute intake
deadline, profile popups, shared visual primitives and navigation fixes.
It was released from a selectively updated isolated copy, never this dirty
worktree.
Invitations go to the address on the request even when it differs from the
record's email; do-not-contact, declined contact and opt-out still block them.
Invitation and code emails use the branded design, and the prospect page uses
one name step and one code step. Production sets `CRM_PROSPECT_REQUESTS_ENABLED`,
`CRM_PROSPECT_EMAIL_ENABLED` and `CRM_PROSPECT_UPLOADS_ENABLED` to `true`.
`20261114010000_prospect_questionnaires.sql`,
`20261114020000_prospect_intake_close_on_submit.sql` and
`20261114030000_prospect_intake_thirty_minutes.sql` are installed and registered.
The newest migration bounds existing open requests to creation plus 30 minutes
and verified sessions to their request deadlines; submitted and revoked requests
remain closed. Type-checking, 27 focused unit tests, the isolated production build
and rollback-only database lifecycle tests passed. Questionnaire, navigation,
placement, email settings and conversation layout suites passed 37/37 on both the
candidate and canonical site. Desktop/mobile screenshots of Settings, My Account
and the intake popup were reviewed. Uploads stay available only while the Windows
worker below keeps its scanner and cleanup heartbeats fresh.

Pages share the navy/cyan palette, panel and header treatment, controls and active
tabs through Tailwind tokens, global CRM classes, SectionLayout and Card.
Accounts and Settings use the same visual system as Dashboard and the pipeline.
Mobile navigation closes after choosing Dashboard and adapts when crossing the
desktop breakpoint. Account-directory edits and intake popups protect unfinished
changes; Gmail/Calendar authorization also checks before leaving edited settings.
Training navigation stays within the guarded workspace router.

Record policy from a lead or account opens only that record's policy form. It
does not load the policy register, and Back, Cancel or a successful save returns
to the profile; a save with warnings stays open so the warning can be read.

The Intake requests buttons on lead/account profiles open record-scoped popups.
The leads toolbar also offers an unlinked prospect popup. There is no separate
sidebar destination; legacy `/questionnaires` URLs redirect to a profile popup.
The popup offers shared starter templates and private agent copies.
Customizing and saving a shared template forks it rather than editing the
original. Request-only edits do not change reusable templates. Requests snapshot
their questions and recipient. Links expire 30 minutes after agent generation,
or close immediately on submission; verification never extends that deadline.
Agents can still revoke or replace links. Popups include
record-scoped request history; linked-lead requests remain accessible from their
account without moving document bytes. Review targets the request's original
record; linking a lead does not silently copy its proposed changes to an account.
New-prospect submissions create one assigned lead marked Needs review
and a review task. Existing values change only through explicit, concurrency-
checked producer review. No policy, marketing permission or automation enrollment
is inferred.

Prospects use `/secure-intake/<token>`, without the CRM shell, analytics or AI
widget. They enter first and last names, request a code, verify it, then complete
the remaining fields and uploads. Names are staged privately and snapshotted
with submissions; they do not prove identity or overwrite existing CRM names.
A code is sent only to the stored recipient email; no prospect account or
SMS is used. Codes expire in ten minutes, have five attempts, and use durable
request/email/network throttles plus a resend cooldown. HttpOnly browser-session
cookies are scoped to the request; verified sessions cannot outlast the link's
generation-based deadline. Only token/code/session hashes are stored. Submission
closes a link immediately, including retry-safe acknowledgement for 24 hours
before its verification session is eligible for cleanup. Administrators
(active owner/admin roles) alone can reopen submitted requests as new revisions.
Replacing an open link rotates its token and invalidates verification.
Replacement grants a fresh 30-minute deadline and requires verification again.
Replacing an unexpired open link retains its uploaded files; replacing an expired
open link starts a new revision and removes the old revision's file references.
It cannot reopen a submitted or revoked request. Old submissions remain unchanged.
Raw link secrets are shown on creation/replacement, not recoverable from storage.
Invitation delivery supports Copy link and an explicit CRM Send invitation using
Agency email or My Gmail. The server verifies the current link and its stored
recipient, enforces existing consent/opt-out checks and reuses stable provider
send identities. CRM invitations are recorded in conversation history.
Sending is never automatic; acceptance is not represented as delivered.
After a send attempt the sender is locked so a retry cannot switch providers.
HTML invitations show only the secure-form button, without a duplicate visible
URL; plain-text alternatives retain the URL so non-HTML readers can open the form.
Invitation correspondence necessarily contains the link; raw secrets are not
stored in questionnaire tables, events or notification metadata.

Required deployment gates:

- `CRM_PROSPECT_REQUESTS_ENABLED=true`: only after migration, tests and authorization
  verification. Disabled by default.
- `CRM_PROSPECT_EMAIL_ENABLED=true`: only after the configured Resend transactional
  sender is approved and a real test recipient receives its verification code.
  Uses the existing Resend safety/receipt pipeline, including suppression checks.
  A browser action requests the code; no unsolicited verification sends occur.
- `CRM_PROSPECT_UPLOADS_ENABLED=true`: only with the approved private scanner/
  cleanup worker running. The Windows computer worker and real private-storage/
  ClamAV/deletion integration have been verified. A selective web release and
  hosted verification remain necessary before prospects can use the live site.

Uploads use the private `prospect-documents` bucket, not public URLs or fake
accounts. Supported formats are PDF, JPEG, PNG, WebP and HEIC/HEIF: 10 MB per
file, 10 active files and 50 MB total per request revision. Reservations are
bounded to 30 attempts per revision, including removed/failed files. Storage
metadata and actual byte count/signatures are checked separately; file extensions
are not trusted as proof. Pending/failed/blocked files cannot be downloaded.
No uploaded ID is sent to AI, automatically added to email attachments or exposed
through generic account file selectors.

The bounded worker `node apps/web/scripts/scan-prospect-documents.cjs` requires
`CRM_PROSPECT_SCANNER_APPROVED=true`, a private server's Supabase credentials and
an absolute `PROSPECT_CLAMSCAN_PATH`, plus `PROSPECT_CLAMAV_DATABASE` when the
signature directory differs from the installation default. The Windows local
runner sets these privately. Update signatures with FreshClam and
schedule this worker every minute outside Vercel. It requires signatures newer
than 48 hours, claims up to ten leased jobs per invocation, blocks encrypted or
unscannable inputs, checks actual file signatures/bytes and records a SHA-256
verdict. Three failed attempts keep a document blocked for administrator action.
Upload issuance requires both scanner and cleanup heartbeats within five minutes. Downloads
require an immutable submitted revision, current record authorization, a clean
verdict and a matching byte digest; authorized download requests are audited. Antivirus
does not prove identity, authenticity or absolute file safety.

Approved document retention:

- Submitted files become inaccessible 24 hours after submission, including
  unreviewed and rejected submissions. Review does not extend the deadline.
- The private cleanup worker deletes the stored bytes on its next pass.
- Expired/revoked unsubmitted files and superseded draft uploads are deleted
  after outstanding upload tickets expire. A two-hour signed ticket plus a
  ten-minute issuance guard prevents a late upload from recreating a purged file.
- CRM records, immutable answers and minimal audit metadata are not deleted by
  this document-only policy. Downloading a copy creates a separate copy that
  this worker cannot erase. Storage-provider backups, if enabled, require their
  own matching retention settings.

Run `node apps/web/scripts/cleanup-prospect-documents.cjs` every minute as an
independent job, with `CRM_PROSPECT_CLEANUP_APPROVED=true` and private Supabase
credentials. Each invocation leases at most 100 deletions. It records completion
only after Storage confirms deletion; errors fail explicitly and leases permit
retries after three minutes. Removed-file tombstones remain until cleanup
succeeds. It also clears expired verification challenges and their staged names.
Database authorization enforces the 24-hour download deadline even if the worker
is down. Monitor both jobs and alert on stale heartbeats, deletion errors and
expired files without `purged_at`; blocked access is not proof of physical erasure.

### Current Windows computer worker

The approved active host is this Windows computer. Oracle is disabled; no Oracle
account, VM or paid resource is used. ClamAV is installed under
`%LOCALAPPDATA%\ShieldAssurance\SecureIntake` using the official Windows ZIP and
its detached signature, verified with Cisco Talos's published signing key before
executing any downloaded code. Definitions are initialized by FreshClam.
Its state, definitions, temporary scan files and bounded logs are restricted to
the current user, SYSTEM and local administrators. Do not copy this directory
into the repository or a shared/cloud-synced folder. Confirm device encryption
and your Windows account's access controls before using real identity documents.

Controls from the repository root:

- `start-intake-worker.bat`: starts/enables the current-user scheduled task now
  and at sign-in; no administrator password is stored.
- `stop-intake-worker.bat`: disables the task and stops only the verified local
  worker PID and its descendants. It does not stop the CRM or other Node apps.
- `intake-worker-status.bat`: shows task state, verified process and each job's
  most recent success/failure. Stopped-process status is explicitly historical.

The task is named `Shield Assurance Secure Intake`. Its direct Node process runs
independent, non-overlapping scanner/cleanup passes every minute and signature
updates every six hours. Both storage clients use bounded network timeouts;
failed operations remain failed/retryable, not successful-looking receipts.
It reads only the needed Supabase connection values from the existing local
`apps/web/.env.local`; no new credential copy or public server/listening port is
created. Local settings explicitly require `oracleEnabled=false`.

The computer must stay awake, online and signed in. No Windows sleep/security
settings are changed automatically. If it sleeps, shuts down or logs out,
uploads fail closed after the five-minute worker-heartbeat window and physical
deletion waits until it resumes. The 24-hour download cutoff still applies in
the database. The scanner removes its own temporary directory after each scan;
the control script/startup cleans narrowly named leftover scan directories after
an interrupted job. Logs are bounded and omit document contents/names.
The task restarts after failures, with a bounded Windows retry policy; check
status and restart it manually if that policy is exhausted.

To reinstall/update the user-scoped official engine, run
`powershell -NoProfile -ExecutionPolicy Bypass -File apps\web\scripts\local-intake-worker.ps1 -Action Install`
while the worker is stopped, then start it again. The installer uses the existing
Git for Windows GPG executable and the supported official version specified in
the script; review supported engine updates rather than letting it become stale.

Real integration verification:

```
cd apps\web
node scripts\test-local-intake-worker.cjs --approved-synthetic-test
```

Stop the scheduled worker first. This opt-in check uses Python/pypdf to generate
synthetic PDFs, private signed uploads and a synthetic agent/request. It verifies
clean PDF scanning, an encrypted-file block, a PDF containing the harmless EICAR
antivirus test, authorized digest-matched download, the 24-hour access cutoff,
actual Storage deletion and deletion receipts. It removes its exact synthetic
records/objects afterward and sends no email. Do not disable Defender/other
security software if it independently blocks the harmless antivirus fixture.
The passing receipt is saved privately in `integration-receipt.json`.

### Oracle Always Free worker setup (disabled, future option)

The user must first create/sign in to their own Oracle Cloud account and provide
an authorized administration path; do not put account passwords, SSH private keys
or service-role secrets in chat or source control. Use an Always Free-eligible
Ampere A1 VM with at least 4 GiB RAM and an ARM-compatible maintained Linux
distribution. Confirm the console's cost estimate before creation; do not choose
paid resources or upgrade billing automatically. Free capacity is not guaranteed,
and idle free instances may be reclaimed. See https://www.oracle.com/cloud/free/
and https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm.

Install maintained Node.js, ClamAV/FreshClam and the locked repository dependencies
on the private worker. Restrict its environment file and temporary scan directory
to the worker account, use encrypted storage, and do not expose a public scanning
endpoint or ClamAV port. The worker initiates HTTPS connections to the existing
Supabase project; no uploaded documents are sent to a public scanning vendor.
Schedule scanning and cleanup independently, prevent overlapping runs, and test
clean, blocked, encrypted, stale-signature and expired-file cases before enabling
uploads. No Oracle account, cloud VM or paid resource has been set up. Do not
enable this host while the computer worker is active without an explicit handover.

Verification commands:

```
cd apps/web
corepack pnpm exec vitest run src/lib/prospect-questionnaires.test.ts src/lib/prospect-questionnaire-routes.test.ts src/lib/workspace-navigation.test.ts src/lib/account-origin-middleware.test.ts
node scripts/test-prospect-questionnaires-db.cjs --use-local
corepack pnpm exec playwright test questionnaires.pw.ts
```

The SQL script always rolls back, including storage metadata fixtures. It uses
the installed schema when present, or applies it inside the rollback transaction
when absent; it never installs it persistently. Browser fixtures use synthetic
answers/files and mock delivery/storage APIs; real scanner/storage/deletion
verification is the separate opt-in check above. No real customer IDs are needed.
An authorized verification-transport test to the saved ELI test account received
a provider `delivered` receipt. This verifies the actual transactional sender,
not the still-disabled hosted public questionnaire.

## Explicit lead/account intake

Apply only `20261113010000_account_intake_details.sql` for this change. It
adds an object-valued `clients.intake_details` JSONB column; existing accounts
retain their data. The build schema gate checks this column.

Enter in an intake input cannot save or navigate. Enter in a VIN field performs
VIN decoding only. Use **Save as Lead** or **Save as Account** in the full
pipeline intake; the account/policy workflow retains **Save Account**. Explicit
buttons still support keyboard activation and normal required-field validation.

Both intake forms provide optional applicant/employment details, current-address
tenure, previous addresses with move dates, requested coverage dates and driver
license details. Previous addresses can be added under each driver;
missing history does not block saving. Dates and entered ranges are validated.
Requested coverage dates do not issue a policy or bind coverage.

Occupation intake uses **Industry**, then a filtered, alphabetized **Occupation**
dropdown. Changing industry clears the previous occupation. **Other - enter
manually** handles unlisted titles within any industry. Older saved occupation
codes infer their industry. The 1,016 O*NET-SOC 2019 titles are grouped by their
23 occupational families with producer-facing industry labels.
Source: [O*NET-SOC 2019 taxonomy](https://www.onetcenter.org/taxonomy/2019/list.html),
U.S. Department of Labor / Employment and Training Administration,
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The catalog retains
codes and titles unchanged; grouping labels, dropdowns and manual entry are CRM
additions. Attribution is maintained here rather than in operational intake.

Each driver now has an address block followed by years/additional months at that
address, residence status and previous addresses. Previous addresses support
move dates and individual tenure. The primary driver's address defaults from the
applicant address; additional drivers may have different addresses. Driver history
is validated, persisted in normalized intake answers and rendered within that
driver's saved summary. Current address/tenure also appears in driver inventory.
Existing applicant-level histories remain readable and are not rewritten.

The UI copy review removes repeated binding/recordkeeping disclaimers across
account linking, assets, quotes, placement, servicing, policy history, renewals,
documents and intelligence screens. Required attestations, source evidence,
consent controls, validation and actionable integration errors remain intact.

The intake/copy correction release is live at
`https://shield-assurance-crm.vercel.app`, deployment
`dpl_6mwfncoZJqpoVnZyY5rv4aQuQ11a`. Verification passed 55 focused unit tests,
strict web types, the schema-gated production build, 18 candidate browser checks
and seven canonical browser scenarios. Real lead, full-account and simple-account
saves verified industry selection and independent driver address histories,
including profile reloads. All disposable QA records and identities were removed.

## Workspace navigation and unsaved work

The shared authenticated header provides Back on desktop and mobile. Return paths
track real same-tab CRM history, including query parameters and reloads. A page
opened directly uses a valid parent destination rather than leaving the CRM.
Breadcrumbs link only real pages; intermediate dynamic route folders are not links.
Policy handoffs and linked task actions use client-side routing instead of full
document reloads. Open lead profiles retain their lead ID in the URL until closed,
so Back and reload can restore the same profile and queue URL. Gmail status refresh
and disconnect refresh only mailbox status, without overwriting sender edits.

`WorkspaceNavigationProvider` annotates browser history without dropping Next
router state. Its shared dirty-editor registry protects registered intake,
profile, message, quote, note, reminder, asset, social, template, automation,
sender and intelligence editors. Links, programmatic workspace navigation,
browser traversal and document unload use the same registry. Discarding via a
local editor's Close/Cancel also confirms where it would delete unsaved work.
Opening a new tab, downloading a file or following a same-page anchor does not
discard the original editor and does not trigger a leave warning.

Draft contents are not copied to browser storage. Only CRM return URLs and history
positions are stored per tab; login, authorization and public-token routes are
excluded. Successful saves clear their editor guard; failed saves retain it.

Navigation corrections are live at `https://shield-assurance-crm.vercel.app`,
deployment `dpl_6rqRbzrs5cP4k4vGc7iCRsCqCAdj`. The release was isolated from the
previous live source and contains only this navigation correction's overlay.
Verification passed 10 focused unit tests, strict web types, the schema-gated
production build, and 22 browser scenarios each on the candidate and canonical
site. Checks cover mobile Back, reload-restored return URLs and lead profiles,
cancelled browser traversal/unload, unsaved editor warnings and save/retry flows.
Temporary browser identities were cleaned up by the fixtures; private candidate
access files and the task-specific local server/cache were removed.
This is discard protection for registered editors, not draft autosave or coverage
of every legacy write form; component-only filters are not persisted.

The selected destination stores the normalized answers and a server-generated
readable summary. Drivers/vehicles remain separate inventory where entered.
Direct account intake creates no hidden lead, policy, lead follow-up or outreach
enrollment, and does not infer email/text consent. Saved account details appear
in Overview; lead details remain in its intake summary. Driver identifiers use
structured fields rather than generic notes. New structured license details,
birth dates and private address history are excluded from AI drafting grounding.

Released as `dpl_9E7SAqPNmqgh6DjSdsbQdFJ8c18X` on the canonical CRM domain.
Verification passed: 54 focused unit tests, strict types, the production
schema/build gates, rollback-only schema fixtures, six local UI scenarios,
and seven UI scenarios each on the protected candidate and canonical site.
Real synthetic lead, full-account and simple-account saves were separately
verified against the database, including structured driver inventory and profile
reloads, locally, on the candidate and live. Synthetic records and temporary QA
identities were removed. No customer email was sent.

## One-time AI carrier guide reading

Carrier guides previously used local pattern extraction, not OpenAI. **Save and
use guide** now asks OpenAI to interpret the original PDF/image plus its retained
source text. Text/CSV/XLSX use the locally extracted source pages. The server
uses `OPENAI_API_KEY` and `CARRIER_APPETITE_MODEL` (default `gpt-4.1-mini`), with
structured JSON output and `store: false`. Only the guide is sent, never a
prospect profile or conversation.

Apply `20261113001000_carrier_appetite_ai_readings.sql`. It adds a private,
source-hash/version cache, a concurrent-read claim, and atomic replacement of an
existing reading without leaving an active guide disabled on an activation
failure. Successful readings, including repeat uploads of identical bytes, are
reused. Failed calls require an explicit retry; abandoned claims can be retried
after three minutes. A different edition gets a different reading. AI outages,
configuration errors and credit limits are surfaced; local line parsing is not
silently presented as a successful AI interpretation.

For existing uploads, select **Read saved guides with AI** once. It preserves
draft/active state, dates explicitly entered by the producer, placement route,
original pages and file bytes. Completed guides are skipped on subsequent runs.
Guide summaries and source-cited executable criteria are persisted. Uncitable
or ambiguous material stays unresolved and cannot establish a confirmed fit.

Auto and property guides for the same carrier are evaluated separately.
Overlapping coverage and territory still require reconciliation. Public
business recommendations are provisional and identify matching facts and
missing details; they never establish underwriting approval or contact consent.
Market fit is recomputed locally against current saved guides when a profile is
opened, with no OpenAI call. Source wording is available under collapsed evidence
details, not repeated in the main recommendation.

Release `dpl_EuEBp1AKKT8DQbRiqn4wX3dbrPer` is live. The additive migration
is applied. Verification passed: 95 focused unit cases, strict types, production
schema/build gates, rollback-only database fixtures, nine local and nine staged
browser scenarios, and eight public-domain scenarios. Local/staged verification
included a real synthetic PDF sent through the configured OpenAI model, persisted
and reactivated against the real database, with unchanged cached reading/IDs on
repeat requests. Synthetic source files, guide records, revisions, cache entries
and temporary owner access were removed afterward. The public run skipped that
paid live-AI scenario to avoid another unnecessary call; it verified the eight
UI scenarios. No existing producer guide was sent to OpenAI during verification.

## Carrier extraction cannot block saving

PDF column spacing can differ from the stored source text. The save parser now
resolves whitespace-only differences to the original source substring and repairs
missing/duplicate internal IDs without asking the producer. Unknown decisions
remain unresolved. Entries that cannot be reliably cited are retained in
`unresolved_entries`, shown as warnings, and excluded from executable matching
rules. Their presence prevents a confirmed carrier fit; it does not prevent
saving or enabling the guide. Source text and download bytes remain unchanged.
No database migration is needed for these additional JSON notes.

Release `dpl_56oNFfyeweQpbnipMZfXcZWinLfm` is live on the public CRM domain.
Verification passed: 45 focused unit cases, strict web types, production schema
and build gates, rollback-only database save/activation checks, and seven browser
scenarios each on local, staged and public deployments. Browser writes use
fixtures; actual persistence and activation are verified separately inside the
rolled-back database transaction.

## Appetite guides are not policies

Carrier guides can be saved and enabled without coverage dates, territory,
coverage-line metadata or a decision on every extracted entry. Explicit guide
dates, if supplied, still apply; missing dates never create an artificial expiry.
Unclear entries remain unresolved in market assessments, not approved by default.
The normal workflow is **Save and use guide**, with rule editing collapsed and
optional. Existing uploads can **Re-read original guide** without losing the
private source or requiring another upload.

The local PDF/OCR reader now retains column positions for carrier guides while
keeping the existing source text and policy-intake behavior. Category lists and
class/status tables use column positions; target-class brochures separate
submission instructions from business classes, join wrapped bullets within their
columns, and retain exposures-to-avoid as exclusions. This is structural parsing,
not a claim to understand every possible guide layout or certify eligibility.
The previously saved producer guide was read without changing it: its 61
line-based entries (29 unresolved) became 44 structured entries, with target
classes, conditions and exclusions separately checked against the original PDF.

Apply only `20261112223000_carrier_appetite_guide_activation.sql` for the
activation change. It preserves owner access, upload safety, source citations,
revision conflicts and private source retention.
Applied after rollback-only guide activation/source-integrity checks and the
release dry run passed. Release `dpl_CjToXv8EDPxpCWEED1YrHynAYt3U` is live.
Verification passed: 59 focused unit tests, strict web types, production schema
and build gates, five local browser scenarios, five staged scenarios and five
public-domain scenarios. Browser saves use fixtures; the original saved PDF was
separately read without modifying its content, and database saves/activation were
verified in rollback-only transactions.

## Carrier guide upload simplification

Carrier PDFs no longer require a rights statement, reuse permission checkbox,
or appointment reference. Placement route remains a simple producer selection;
missing proof does not block saving or carrier matching. Rule review shows plain
decision labels, source wording and optional automatic checks with examples.
Authentication, agency roles, safe uploads and source-based underwriting review
are unchanged. Apply only `20261112193000_carrier_appetite_upload_without_proof.sql`
for this change; earlier migration files are not modified.
That migration is now applied after rollback-only carrier save/activation tests
and the release dry run passed. Deployed as `dpl_5yZGFbr2kom8WTPYY3bqxpDQCp8j`.
All 34 focused unit cases, web types and production build passed, together with
four local, four staged and four public-domain browser cases. The browser cases
read a real synthetic PDF and mock save responses; database save, activation,
history and permissions are separately verified with rollback-only fixtures.

Rashi is deployment-ready through the Next.js web app.

## AI drafting diagnostics

The shared JSON drafting adapter distinguishes missing configuration, rejected
credentials, exhausted quota, rate limits, model-access errors, provider outages
and request timeouts. Lead drafting no longer labels every unusable response as
a missing `OPENAI_API_KEY`. Errors retain the draft and require an explicit retry;
they never send email or generate a substitute message. Provider response bodies,
credentials and customer prompts are not written to diagnostic logs.
Deployed as `dpl_EVXi8mSU2Ujk8DzD1mKhVQAMb4i8`. The production key was already
configured and successful synthetic drafts were verified before the hotfix,
on its protected candidate and on the canonical live site after promotion.
The earlier failed request's exact cause could not be established from retained
logs. Production schema/build checks, strict types and 56 focused tests passed.
No key was replaced, no customer content was used for these provider checks,
and no email was sent.

## Branded sales emails

The template editor supports branded layouts, colors, headings, buttons and
desktop and mobile previews. In **Templates and Branding**, upload a JPEG or PNG
banner (up to 4 MB), add its description, and optionally enter the HTTPS page
recipients should reach when they click it. Existing banner images still render.
Apply `20261119124000_email_branding_images.sql` before releasing the upload
control. The dedicated bucket serves banners publicly; never use it for customer
files. Keep old banner objects available for previously delivered messages.
The approved design is captured with the message for immediate, scheduled and
sequence delivery; a changed template requires review. Plain-text alternatives
are included for recipients whose email clients do not display HTML.

The additive `20261112010000_branded_email_templates.sql` migration is applied
to the configured shared database. The exact migration and six dependent email
fixtures passed rollback validation and the matching apply checks; original
record identities and account contact fields were preserved. The runner accepts
`--fixtures=` with comma-separated fixture filenames for a scoped release, and
binds both migration and fixture hashes to its dry-run receipt. The complete
suite still encounters an unrelated business-research fixture failure; scoped
email acceptance is not a successful full release check or a website deployment.

Conversation tools use compact text controls. **Minimize editor** gives history
the available space without discarding the draft; **Expand editor** restores it.
Expanded conversations constrain email and editor widths for readability. Lead
profile sections share the same dark header and selected-tab styling.
Lead contact details and estimated premium are edited through the header
**Edit** popup, not an inline white form. Notes, assets and reminders stay in
their existing **Notes**, **Assets** and **Tasks** tabs without duplicate
header shortcuts. Cancelling leaves the record unchanged; failed saves keep
the popup and entered values available for retry.
The composer sender selector contains only **Agency email** and **My Gmail**;
connection setup stays in My Account rather than the writing area. Both choices
remain selectable; sending still validates the selected provider.

Owners and admins can also edit a selected template's layout, logo, banner,
colors and button directly in the conversation **Templates** popup, using the
visual layout chooser and live preview. **Save template design** persists a new
shared revision before **Use template** can apply it. Failed saves retain the
edits; agents can use saved designs but cannot change shared templates.

The compact lead profile and conversation corrections are deployed as
`dpl_EQkXsMyYjmt4T1FynCzmJF3CN2do` at
https://shield-assurance-crm.vercel.app. The release was assembled from the
preceding live source plus reviewed email/profile corrections, not the entire
dirty worktree. Production schema, compilation and type checks passed; all
31 protected-candidate browser scenarios and six canonical-live checks passed.
Focused unit tests passed (148). No new database migration or real customer
email was part of this deployment.

## Lead Finder release

The Finder now has one combined results list, Google Maps with an OpenStreetMap
option, working distance filters, and automatic OSHA checks. Producer-facing
copy uses plain source names and short statuses rather than server diagnostics.
Google Places and DOL credentials are configured separately in Vercel production.
Carrier matching still requires reviewed carrier appetite guides.
No database migrations or automatic outreach activation are part of this release.
Deployed and promoted as `dpl_9aNuDud19zTVbtvKVpiU1SxRdkrp` to
https://shield-assurance-crm.vercel.app. Production schema, compilation and type
checks passed; all 18 staged Finder browser scenarios and four public-domain
checks passed. Browser scenarios use provider fixtures, not a full live-source
coverage audit.
The historical implementation notes below describe earlier local acceptance.

**Profile popup and Google Maps search.** Results stay in a compact list with
top Previous/Next paging; selecting a business opens its research profile in a
popup with DOT & fleet, OSHA, Benefits & pension, Risk & location, Market fit
and Sources tabs. Each tab shows dated evidence or the exact setup it is
waiting on (`FMCSA_WEBKEY`, `DOL_API_KEY`, or active reviewed carrier-appetite
documents for Market fit).
The **Google Maps** results source runs a live Places API (New) Text Search
with the keyword (or the selected industry/NAICS title), city, state and map
area. Set server-only `GOOGLE_PLACES_API_KEY` (Places API (New) enabled,
billing on). Phone/website fields use the Enterprise SKU: 1,000 free requests
per month, then paid; `GOOGLE_PLACES_MONTHLY_CAP` (default 1000) refuses
further requests that month. Google returns at most 60 places per search
(3 pages of 20), so search more map areas or cities for more. Google's terms
forbid storing its names, addresses and phone numbers, so results are shown
live with attribution and never saved; **Find public records & research**
switches to the stored public-record index so OIP researches a storable record.

The new Lead Finder is a search/results workspace. OIP retains and reconciles
public business research separately from the active pipeline, enriches profiles
in the background and shares categorized results with existing lead/account
workspaces. Only **Add to leads** creates a prospect; contactless businesses are
allowed. Strong existing matches link automatically without exposing another
producer's private CRM record. Internal tasks require a saved/linked business
and owner-enabled capacity rules. No automatic customer communication is added.

The additive migrations `20261111050000_business_research.sql` and
`20261111060000_business_research_indexes.sql` are applied to the configured
shared database after their exact rollback validation and apply checks passed.
This repairs the missing research schema used by localhost; it is not a
production website deployment.
`20261111070000_business_research_browse.sql` is also applied after rollback
scope/filter/pagination fixtures passed. It supports empty and optional filters
across available public index partitions, without requiring a category, state,
city, radius or an upstream territory lookup. The Finder loads its first page
automatically, clears back to browsing and refreshes empty indexing results.
ZIP filters remain exact; removing one is an explicit producer action.
Its rollback validation includes scoped access, conflicting identities,
contactless saves, leases, paused research, date-sensitive result expiry,
appetite-change invalidation, partial-source retries and task deduplication/caps.
The deployment schema gate now requires its tables and unauthorized-actor RPC
contracts, so an ordinary release must not bypass that gate.

Verification for the expanded search: strict web/shared/worker types, 64 focused unit tests
and eleven local browser scenarios passed. Actual read-only Form 5500 streaming
and IRS nonprofit discovery passed; the latest FMCSA discovery check returned
HTTP 429 (earlier actual tests passed). The final expanded map/index production
compilation passed. New Finder browser flows use API fixtures and the map
test substitutes browser tile responses; the existing real dossier
scenario uses disposable records. Neither those tests nor rollback SQL fixtures
prove that the new research engine is running in production.
An actual Arizona nonprofit filing also passed exact-EIN index selection,
bounded retrieval of its specific ZIP XML member, and dated aggregate-only
extraction. This verifies one supported filing path, not full-directory
coverage or the accuracy of every return schema.

Local repair acceptance: browser-equivalent authenticated HTTP requests to
`http://127.0.0.1:3000/api/intelligence/business-search` returned HTTP 200 and
25 actual businesses each for Arizona nonprofit discovery and a bounded
Arizona restaurant map search, without mocked provider or database responses.
Optional-browse acceptance additionally retrieved 200 distinct actual
businesses across eight unfiltered pages. State-only and category-only requests
returned HTTP 200 without a city. The reported Tucson/238220 request returned
five businesses without a ZIP; adding 85705 returned zero from the currently
indexed evidence, not an error. This remains a coverage limitation, not proof
that the ZIP has no plumbing/HVAC businesses. Twelve Finder browser scenarios,
33 focused unit cases, strict web types and rollback browse fixtures passed.
The isolated optimized build also passed, with the existing Supabase Edge
Runtime warning; its schema step skips outside Vercel without exported server
credentials. The new browse RPC was instead verified through actual
authenticated local requests and applied-database rollback fixtures.
Disposable verification identities were removed afterward. OSM, IRS and fleet
discovery and Form 5500 are enabled; automatic task creation and the remote research cron
remain off. Arizona OSM/IRS index acquisition has persisted resumable batches;
it has not yet published complete state coverage.

For local development, run `corepack pnpm dev` in `apps/web` and, in a separate
terminal, `corepack pnpm research:local`. The latter loads `.env.local` and
requires `CRON_SECRET`; it calls only the local authenticated business-research
heartbeat, advances queued state indexes and processes pending research.
It logs failures and retries, does not redirect shared cron to localhost, and
does not run messaging/outreach heartbeat jobs. Stop it when stopping local
development. A local web server alone is not a durable indexing worker.

Read-only actual-source checks prove IRS nonprofit and FMCSA Census discovery
by Tucson/AZ without a known business name or saved CRM leads. IRS master-file
financials are dated organizational filings, not current insurance or financial
health. DOT registration is not authoritative trucking NAICS.

Search choices now use the official Census 2022 NAICS hierarchy (2,125 entries,
including six-digit industries and combined sectors), not a handful of invented
category labels. Census Gazetteer 2026 supplies 32,363 selectable places across
the 50 states, DC and Puerto Rico. City choices follow the selected state;
changing state clears city/ZIP/radius/map-area selections. Reference files are
generated reproducibly with `node scripts/generate-research-reference-data.cjs`.
City choices do not use Nominatim autocomplete.

Supported filters include reported business contacts, fleet-size ranges,
nonprofit filing-revenue ranges, employer-plan type/participant ranges, radius
from a selected official city center and displayed map bounds. Participant
counts are not employee counts; unavailable employee/current-P&C-carrier data
is not fabricated. Numeric filters exclude unknown values. Form 5500 uses
reported principal-business codes where they match the official NAICS hierarchy;
OSM matches remain labelled mapped categories, not reported NAICS.

Ordinary category discovery now uses a local index of Geofabrik's public,
contributor-metadata-stripped OpenStreetMap state extracts, not a public
Overpass dependency. The verified official catalogue supplies 53 U.S.
state/territory extract URLs, generated with
`node scripts/generate-research-reference-data.cjs --osm-only`. Actual bounded
Arizona acquisition passed, including the complete 305,039,778-byte extract:
32,932 mapped business observations across 38 resumable batches. This was a
read-only source proof, not publication to the production database.
Each indexing batch reads at most 8 MiB, validates
the source version and resumes only at a complete PBF blob boundary. Expanded
blobs are limited to 32 MiB. This index retains named, tagged business point
locations only: area-only ways/relations are not included. Extract boundaries
are buffered, so an index partition never becomes a guessed reported address
state. Categories are community mappings, not reported NAICS.
Search applies category, contact, ZIP, bounding-area and spherical-radius
filters in SQL before pagination; local index searches do not consume upstream
request slots. Empty warming searches are not held in the search cache.
OSM results require ODbL attribution and are not an exhaustive directory.
`CRM_RESEARCH_OVERPASS_URL` remains for legacy observation refresh only;
its configured public service timed out in actual probes. The city-territory
resolver uses `CRM_RESEARCH_NOMINATIM_URL` without autocomplete or bulk lookup.
Google Maps is an outbound search link, not an ingested profile/review feed.

Address-corroborated OSHA attachment is implemented behind `DOL_API_KEY`;
name-only establishment matches are rejected. Live OSHA verification remains
outstanding. Census address-range locations, NWS alerts and FEMA zones are
context, not certified flood determinations, claims or carrier restrictions.
Missing or failed evidence remains visible, including partial jobs in owner
Settings with retry controls.

Form 5500 sponsor/plan and IRS master-file directory ingestion now use the
authenticated heartbeat with leased, versioned state partitions, durable row
checkpoints and bounded streaming batches. Each run scans at most 2,500 new
filing rows; raw ZIPs are not buffered or expanded in memory as entire files.
Range/version/schema checks fail explicitly. Published complete versions remain
available during partial refresh, and changed latest indexed facts requeue linked
research; older historical snapshots do not trigger redundant invalidation.
No signer, preparer, care-of or administrator personal fields are
retained. Owner Settings shows progress/failures and offers retries.

The current safety budget is 50,000 retained records per source/state/version,
40 MB compressed Form 5500 input, 64 MB IRS input, 256 MB expanded input and a
40-second ingestion attempt. Exceeding a budget fails visibly rather than
publishing complete coverage. A complete Arizona public-point scan passed;
large-state limits, full Form 5500/IRS ingestion and actual deployed
heartbeat/restart acceptance remain unverified. Schedule A insurer joins and
individual Form 990 XML extraction have actual-source proofs, not full filing
coverage or verification of every supported return schema; plan filings
must not be advertised as current WC/GL/auto coverage.

The list/map view uses Leaflet with interactive-only OSM tiles, visible
attribution and normal browser caching. Map markers select the same researched
profile, and map-area searches pass the actual displayed bounds. Tiles are a
best-effort basemap, not a lead-data service; a basemap loading does not prove
that business discovery works. `NEXT_PUBLIC_RESEARCH_TILE_URL` allows a compatible
owner-approved OSM-derived tile endpoint. No prefetch/offline downloads occur.

The separate `crm-business-research` scheduler and automatic tasks remain
inactive for the local repair. Discovery and the OSM/IRS/fleet sources are
enabled, along with Form 5500. Enabling the owner control requires the existing authenticated
heartbeat endpoint and secret. Source refresh follows owner cadence; cached
date-sensitive assessments expire by the next UTC date boundary, and eligible
saved businesses retry deferred internal work on reevaluation. Deleted task
receipts remain tombstones. Do not enable the old OIP recurrence as a substitute.

Preserve the live deployment below until source/runtime acceptance, exact
migration application, authenticated processing, protected-candidate checks and
canonical smoke tests pass. No new migration, source activation, scheduler
activation or deployment has been performed for this replacement.

## Live workflow consolidation and first public-source adapter

Live at https://shield-assurance-crm.vercel.app on deployment
`dpl_33mp9SbTipkQv7V8c847EThbKhBP`. The canonical alias was verified against
this deployment. Search controls now occupy a left sidebar on desktop, with
results alongside; mobile filters can be toggled and collapse after search.
Six Finder scenarios passed locally, on the protected candidate and on canonical
production, including measured side-by-side bounds at 1280/1024 pixels, mobile
result visibility and actual disposable file acquisition. Strict types and the
schema-checked production build passed. No additional migration was installed.

The preceding consolidation deployment `dpl_J4Jfx7bAeKFco9vbuvjvqCGeTmG6`
passed eighteen browser scenarios on its protected candidate and eighteen on
canonical production, including real disposable approved-file
acquisition/review/promotion and outcome/questionnaire persistence. Strict web
types, 50 targeted unit/API tests, the production build and configured schema
verification passed. Temporary QA records were removed; no customer message,
paid provider request or real AI request was made.

The standalone Opportunity Intelligence destination is removed.
Market fit/actions open in lead/account Overview; reviewed businesses, watches,
digests and outcomes use Work Queue. Historical opportunity task links redirect
to existing records. No extra producer page is required.

The additional migration `20261111040000_public_discovery.sql` is applied after
explicit owner authorization and matching rollback-only validation. Existing
SQL regression suites and the public-source fixture passed on dry run and apply;
original CRM identities/contact fields were preserved. It adds immutable source
provider selection while preserving existing file/capture approvals. The schema
gate checks `discovery_sources.provider`. Do not reapply the three historical OIP
migrations or install unrelated pending schema.

FMCSA public search also requires a free server-only `FMCSA_WEBKEY` and an explicit
owner-approved FMCSA source in Settings > Intelligence. Add keys through Vercel
environment settings and redeploy; never expose them as `NEXT_PUBLIC_` values.
`DOL_API_KEY` enables existing OSHA enrichment, not Form 5500 ingestion.
Missing configuration visibly disables public search rather than faking results.
Authenticated candidate and canonical runtime checks confirm the FMCSA key is
available. A subsequent explicitly authorized disposable live pilot searched
Greyhound and received 50 business matches. None had a reported phone, and the
selected DOT lookup also supplied no contact route. Selected-record acquisition,
same-request retry, provenance and review passed; promotion correctly stayed
blocked without contact information. The temporary source approval and staged
record were removed. No permanent FMCSA approval or actual lead was created.
Recurrence and its scheduler were explicitly verified paused/inactive.
This proves public research acquisition, not contactable-lead discovery or the
complete public-source lead -> inline fit/task pilot.
Form 5500/990 ingestion and recurring public-source refresh remain future work.

## Previous OIP release: carrier appetite, actions and operations

The preceding deployment was `dpl_Cu8pafqiskZVSZZNBFM4RGr7co3A`.
All three migrations below remain applied.
Validation: 1,195 unit tests, strict web/shared/worker types, 55 existing
rollback SQL regression suites plus OIP-specific SQL fixtures, a schema-checked
Vercel production build, 27 protected-candidate browser checks and 13 canonical-live
OIP checks. The browser checks include real disposable outcome corrections and
revocable questionnaire submission/retry/revocation. Synthetic records were
removed; original CRM identities/contact fields were preserved. No customer
message, paid provider request or real AI request was sent. Production recurrence
and its scheduler were explicitly verified paused/inactive after rollout.

Release authorization covers exactly these migrations, in order:

1. `20261111010000_carrier_appetite.sql`
2. `20261111020000_opportunity_actions.sql`
3. `20261111030000_opportunity_operations.sql`

Use `node scripts/phase123-db.cjs --dry-run` followed by matching `--apply`
with those explicit filenames from `apps/web`. The runner preserves original
record/contact fingerprints and requires a fresh matching validation manifest.
Do not install unrelated pending work. Release verification includes strict
web/shared/worker types, web unit tests, rollback OIP fixtures, existing database
regressions, the production build and all three OIP browser suites.

Owner Settings > Intelligence contains agency targeting and recurrence.
Recurrence is paused by default; no actual watch/source approval is created by
installation. Enabling it requires the existing authenticated HTTPS heartbeat
configuration in Vault. Only the new `crm-opportunity-intelligence` schedule is
controlled by OIP settings. The optional worker reconciler is disabled unless
`CRM_INTELLIGENCE_WORKER_ENABLED=true`. Both paths use database lease fences.
Jobs use retained authorized data, never provider acquisition, AI, automatic
customer communication or sequence enrollment.

The operational release adds reviewed change/document/held-line evidence,
opt-in linked-conversation drafting/rewrite, separately approved introductions,
revocable business questionnaires, deliberate capture, internal weekday digests
and source/outcome reporting with append-only corrections. Public questionnaires
expose no account names/history and do not accept document uploads. Imported
leads never author carrier rules. Licensed discovery/contact verification and
predictive models remain unavailable; no paid services or accuracy claims are
introduced. Consult README for permissions, retention and operational boundaries.

Deploy a protected production candidate without moving the live alias, verify
schema and candidate workflows, then promote and verify the canonical origin.
Customer sends and paid AI/provider calls are not release checks.

### Historical local carrier-appetite validation

This feature is local and **not deployed**. Review/apply
`supabase/migrations/20261111010000_carrier_appetite.sql` before deploying;
schema verification now checks both appetite tables. Reuse the existing private
`account-documents` bucket (or a private `ACCOUNT_DOCUMENTS_BUCKET` override).
No external AI keys or public Rashi source uploads are used.

Knowledge & Training > Carrier Appetite supports document-local PDF/OCR,
TXT/CSV/XLSX proposals, page-pinned excerpts, owner-only save/activation/
withdrawal, immutable original text, exact-revision concurrency checks and
revision snapshots. Active edits invalidate approval; missing dates/scope or
unreviewed rules block activation. Agency access remains separate from carrier
acceptance. Other active sources for the same carrier are flagged, not merged
or silently superseded. Agents see active guidance only. Lead imports never
author rules. Activation does not run outreach. The separate opportunity pilot
below consumes explicitly reviewed comparisons; semantic conflict resolution
and business outcome learning remain future work.

Before promotion, run carrier appetite extraction/API tests, the rollback-only
SQL script, TypeScript, and `carrier-appetite.pw.ts` against the protected
candidate. Confirm the real private source upload/download and owner/agent roles
after installing the migration; local browser record writes use QA mocks.

Local validation completed: optimized production build, strict web/shared
TypeScript, 44 focused unit/API/adapter/regression tests, four browser scenarios
(including a real synthetic carrier PDF and a multi-carrier source), and
rollback-only database verification of approval, evidence, concurrency,
history, permissions and overlaps. The local build skipped the deployment
schema gate because deployment credentials were not loaded in that shell;
the new migration remains unapplied. No customer files or communications were
used and no external semantic extraction was enabled.

### Historical local opportunity-to-action pilot

The Phase 4/5 pilot is local. **Neither new migration has been applied.**
When deployment is explicitly approved, review/apply carrier appetite first,
then `supabase/migrations/20261111020000_opportunity_actions.sql`. Existing
agency membership, canonical dossiers, sender profiles, linked task destinations
and communication delivery migrations are prerequisites. Do not bypass the
deployment schema gate; it checks all four opportunity tables and unauthorized
context/queue calls. No new environment keys or provider subscriptions are needed.

Leads > Opportunity Intelligence ranks the full permitted reviewed set before
paging, recomputing current evidence on demand with bounded database concurrency.
It is not a background ranking index. Visible gates remain independent of score;
do-not-contact records appear last and cannot prepare/send outreach. Numeric
thresholds are inclusive; text/list comparisons are exact normalized matches,
not inferred synonyms. Compound/free-form guidance remains manual. Missing
expiry/access, overlaps, referrals or unreviewed facts prevent possible-fit
claims. Business review freshness is 90 days; carrier approval freshness is 180.

Profile history, exact draft approvals, task evidence snapshots and once-only
send claims are persisted through actor-scoped RPCs. Changing recipient,
profile/dossier/carrier evidence, sender profile, canonical linkage or UTC day
invalidates drafts. A different recipient must be verified anew. Draft edits
invalidate approval. A started or uncertain attempt stays locked; operators must
check conversation/provider history before composing another message.

The local sender-aware starter needs no AI. Optional per-request AI consent
shares only the named business, reviewed line, sender and selected current
confirmed priorities/required lines/next step, never private carrier originals,
excerpts or mailbox history. Missing AI configuration returns an error.
Only immediate individual email is supported here, via the existing delivery
handler; SMS, sequences, scheduling and Gmail activation are not enabled.
Licensed discovery/contact verification, extra authority/location signals,
recurring refresh, relationship mining and outcome learning are not included.

Before promotion, rerun strict web/shared types, the optimized production build,
opportunity/appetite unit/API tests, both rollback-only database scripts, and
`opportunities.pw.ts` plus `carrier-appetite.pw.ts`. After an approved installation,
verify real owner/agent scope, private source storage, a permitted test-recipient
approval and provider history on a protected candidate. Local browser/API
delivery and AI checks use mocks; no customer communications were sent.

Local validation passed: 93 focused unit/API/adapter/regression tests, eight
appetite/opportunity browser scenarios, strict web/shared TypeScript and the
optimized production build. Both database scripts verified their invariants
inside rolled-back transactions, including changed-recipient verification,
canonical linkage, task-assignee access and once-only delivery. The build skipped
the deployment schema gate because deployment credentials were not loaded in
that shell; this does not certify the unapplied production schema.

## Zoom appointment integration

Published at https://shield-assurance-crm.vercel.app, deployment
`dpl_CGuhUt3NHXmvYTQn3dRJeVxd8evW`. Validation: 1,104 unit tests,
web/shared TypeScript checks, rollback SQL fixtures, a schema-verified
production build, 37 protected-candidate browser tests and 22 canonical-live
browser tests. Browser checks include real disposable database appointment
lifecycle and real Zoom-status/setup APIs; Zoom meeting HTTP calls are mocked.
No real emails, calls or Zoom meetings were initiated.

Zoom is an independent per-agent connection under Account > Signature. It does
not require Google Calendar and does not change Gmail authorization. Selecting
Zoom in a conversation or Calendar appointment creates a unique scheduled
meeting. Reschedules update the same meeting; cancellation deletes it remotely
and retains CRM history. Customer manage links use the same lifecycle.
Confirmations include only the attendee join URL, never Zoom's host start URL.
Pending or failed meeting updates block booking/cancellation notification until
sync is resolved. No provider invite emails or automatic recordings are enabled.

Applied migration: `20261109180000_zoom_appointments.sql`. OAuth state is
single-use, browser/user-bound and expires after ten minutes. Credentials use
the existing versioned Gmail encryption keyring in separate Zoom-only tables.
Rotating refresh tokens and appointment changes use database leases. Unknown
creation outcomes reconcile by an appointment marker before any further create.
If no meeting can be found, the agent must explicitly confirm that they checked
Zoom before retrying creation; the CRM checks again under the appointment lease.
Disconnect removes the CRM's Zoom credentials only; existing Zoom meetings stay.
Changing the connected Zoom identity is blocked while meetings reference it.

### Zoom activation (administrator)

1. Create a **General App**, **user-managed OAuth**, in the
   [Zoom App Marketplace](https://marketplace.zoom.us/). This is not a
   Server-to-Server OAuth integration.
2. Register this exact OAuth redirect URL and add it to the OAuth allowlist:
   `https://shield-assurance-crm.vercel.app/api/zoom/callback`.
3. Configure these user-level granular scopes:
   `user:read:user`, `meeting:read:list_meetings`, `meeting:read:meeting`,
   `meeting:write:meeting`, `meeting:update:meeting`, `meeting:delete:meeting`.
   See [Zoom scope reference](https://developers.zoom.us/docs/integrations/oauth-scopes-granular/).
4. Configure `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` and
   `ZOOM_OAUTH_REDIRECT_URI` in Vercel production, then redeploy. Use credentials
   for the same development/production app configuration as the registered URL.
   Never paste the secret into chat or source control. The existing
   `GMAIL_TOKEN_KEYS` and `GMAIL_TOKEN_KEY_VERSION` must remain available.
5. Enable the app for the intended test/account users, or complete Zoom's
   distribution/review requirements before offering it to outside accounts.
   Each agent then connects their own Zoom account in Account > Signature.
6. With an authorized test account, verify a real create, reschedule and cancel
   before agency use. Zoom account plan limits still apply.

Production has no Zoom app credentials configured at this release. The UI
reports unavailable setup instead of producing a broken authorization link.
Live Zoom OAuth and real meeting creation remain unverified until activation;
the provider calls are covered by isolated tests, not actual Zoom meetings.

For Google's separate `redirect_uri_mismatch`, add
`https://shield-assurance-crm.vercel.app/api/google-calendar/callback` to the
existing Google OAuth client's **Authorized redirect URIs**. Preserve its Gmail
callback. This Google Cloud setting cannot be corrected by redeploying the CRM.

## Calendar, Google Meet and appointment lifecycle

Published at https://shield-assurance-crm.vercel.app, deployment
`dpl_5YyejuH4QyhA4Ef9PPLCNRBH5FCQ`.

- Honest dashboard task chart with a true completed total.
- Appointments can be rescheduled and cancelled from the conversation and the
  calendar, with history kept. Customers get a public manage link.
- Google Calendar connects separately from Gmail (Gmail stays send-only).
- Migrations applied: `20261109160000_google_calendar_appointments.sql` and
  `20261109170000_calendar_task_status_sync.sql`. The superseded
  `20261106000000` migration was removed and must not be applied.
- One-time Google Cloud setup: enable the Google Calendar API, add the Calendar
  scopes to the OAuth client and register `<origin>/api/google-calendar/callback`.
- Validation: unit suite, rollback SQL fixtures, real-database browser suites,
  candidate and live checks. Real Meet creation and confirmation email delivery
  are unverified until a Google account is connected. No Zoom or Calendly.

## Agency intake and appointment readiness

Published at https://shield-assurance-crm.vercel.app, deployment
`dpl_4y97asCZbijwPeXrbRrWnqerLwiE`.

Personal Gmail now sends multipart plain-text/HTML messages with escaped content,
readable paragraphs and a linked agency website in producer signatures.
Attachments, original sender identity and existing uncertain-send protections
are preserved. Pre-update Gmail attempts remain retry-compatible without a
second provider send. Shared-mailbox HTML uses the same presentation renderer.

Manual lead intake and account/lead vehicle assets support VIN decoding and
year/make/model selection using the official NHTSA catalog. Catalog failures
offer retry or manual entry; decoded details require agent review. Existing
imported vehicle details remain editable. Intake captures personal and commercial
coverage interests, drivers, properties, business details and industry questions;
it is not a complete carrier application or an integrated rating engine.
Duplicate-lookup failures are visible. Follow-up setup failures preserve a saved
intake and display a warning rather than silently reporting complete success.
Incomplete rollback failures explicitly warn against creating a duplicate.

Appointment confirmation templates select saved calendar appointments instead
of asking agents to type appointment details. The server reloads authorized
calendar facts in agency time. New linked appointments in conversations and the
calendar default to sending a confirmation from the booking agent's Gmail;
the checkbox can be turned off before saving. A failed confirmation leaves the
booking intact and offers retry using the event's durable send identity.
Opt-outs, contact assignment and own-mailbox restrictions remain enforced.

Operational boundaries: calling opens a `tel:` handoff, not a built-in dialer.
SMS is unavailable in the web conversation UI. Quote options are manually
recorded and do not bind coverage. The connected Gmail mailbox has send-only
authorization, so external replies are not automatically imported and agents
must pause follow-ups when they receive a reply outside the CRM. The personal
Gmail job is enabled; broader reminder/heartbeat jobs remain disabled. No real
customer email or call is performed by this verification.

Validation: 1044 web unit tests, strict web/shared TypeScript and a schema-verified
production build passed. All 42 focused candidate browser checks passed before
promotion, including the separately enabled send-only OAuth contract check.
All 20 canonical live checks passed after promotion. Disposable records verified
real manual intake, vehicle persistence, account linking, duplicate detection,
quote retry/history and absence of automatic policy binding; every QA record
was removed. Website replay checks verified archive/purge protection. The actual
connected Gmail token refreshed successfully and its send scope was verified
without sending email. Rollback-only database tests also verified cold-import
filtering, durable website arrivals, atomic notes/reminders, task ownership,
asset history and account conversion. The dashboard heading is "Task timing".

## Gmail availability, account controls and compact dashboard

Published at https://shield-assurance-crm.vercel.app, deployment
`dpl_BUED19zoKDfrebSkXyDcZYLaD4Xm`.

Personal Gmail is selectable directly above the shared conversation toolbar.
Existing connected mailboxes are selected automatically unless the agent has
deliberately selected another sender. Unconnected/revoked mailboxes link to My
Account; status failures offer an explicit refresh rather than silently changing
the sender. My Account retains the original Profile, Security and personal
signature controls alongside send-only Gmail settings. A failed refresh preserves
the last displayed mailbox and reports the error; reconnect retains send-only
authorization rather than requesting mailbox read access.

Schedule send is beside Send on account, lead, inbox and reviewed-email
composers. Both rows share the same popup context. Existing schedule editing,
cancellation, attachment/reply restrictions and reviewed-sequence approval are
unchanged. Development indicators are disabled to prevent the Next.js badge
from covering the left-aligned Send button on short localhost screens.

The premium chart is 208px high. An animated task donut sits beside it on desktop
and below it on mobile, using the CoreUI green/red palette and real
`/api/metrics/tasks` data. The authenticated endpoint reads every task page, not
just the first database result page. Green includes completed-on-time tasks,
open tasks not yet overdue and tasks without deadlines. Red includes currently
overdue tasks and tasks completed after their deadlines. Unknown completion
timing is excluded and identified instead of falsely labeled on time. Empty
datasets and request failures are distinct, with retry available for failures.

Campaign navigation and visible copy use neutral names. Provider-specific
integration contracts remain unchanged, with new campaigns still deferred.
No mailbox was disconnected, no sending safeguards were removed, and no
customer email was sent during QA.

Validation: all 1007 web unit tests and strict TypeScript passed. The production
build verified the configured Supabase schema and optimized compilation.
All 27 targeted browser checks passed on the protected candidate before
promotion; all 15 focused checks then passed on the canonical live release.
Checks include real authenticated Gmail availability and OAuth-start requests,
signature persistence, intercepted Gmail send payloads on all three conversation
surfaces, schedule placement, mobile hit-testing, chronological scroll
anchoring, calendar booking and approved follow-up sequences. Local validation
also confirmed the disabled Gmail flag repair and removal of development-badge
overlap. Gmail delivery itself was not tested by sending a real message.

## Account-derived conversation layout correction

Published at https://shield-assurance-crm.vercel.app, deployment
`dpl_BSbXLdomLt88i6bK5Qb8Ta9wB4bD`.

Account -> Communication is the visual reference for accounts, leads and inbox
conversations. Contact headers and message receipts remain, while a fixed,
maximum two-row toolbar sits above the fixed subject/body editor. Small tools
open upward anchored popovers; templates, sequence review and account attachments
open bounded dialogs. Only the conversation history pane scrolls as a panel.
Long editor text and popup content can scroll internally without moving the
toolbar or Send controls.

Templates, Draft, Reply, Book, Schedule and Sequences retain their existing
operations and confirmations. Account-only attachment and summary controls
remain on accounts; linked-account sequences still select existing open leads.
The reviewed-email workspace uses the same toolbar/editor without claiming to
be a conversation history. Redundant "Write email"/"Write text" headings and
nested composer disclosures are removed. AI dossier opt-in, draft replacement
confirmation and busy guards are preserved, with drafting failures visible
inside the popup.

Messages render oldest-to-newest with timestamp/ID tie-breaking and initially
show the newest real message. Older pages load from the history top without
moving the visible message. Background updates preserve loaded history and the
agent's position; new messages follow the bottom only when the agent was already
near it. Otherwise a Latest messages button offers an explicit jump. Account
history no longer eagerly loads every page. Its existing server-side recent
summary remains independent of the displayed page. Upcoming/failed scheduled
emails live in Schedule rather than after the newest actual message.

Validation: all 1003 web unit tests and strict TypeScript passed. The production
build verified the configured Supabase schema and optimized compilation.
All 28 applicable local browser checks passed, including exact scroll
anchoring, account-reference parity, 320px two-row layout, upward popup bounds,
keyboard focus restoration, attachments, receipts, Gmail reply payloads,
appointment retry reconciliation and sequence review. The production-only
OAuth-start check was intentionally skipped locally.
All 29 checks passed on the final production candidate, including send-only
OAuth-start verification, before promotion. Fifteen focused checks then passed
on the canonical live release. Visual review also caught floating-assistant
overlap with right-aligned Send; the account-style left action placement is
restored and browser checks verify the button's center is unobstructed.
Wide toolbars fit one row; compact/mobile toolbars remain within two rows.
The isolated local helper/build and temporary candidate-access credentials
were removed. No real customer email was sent during verification.

No sending permissions, mailbox connections, database schema, scheduler
activation or paid campaign settings are changed by this layout correction.

## Unified conversations and personal Gmail sequences

Published at https://shield-assurance-crm.vercel.app, deployment
`dpl_GfAA128JDqpJSMN75DztNCXrVMTW`.

Accounts, leads and the inbox use the same message/composer components. Gmail
reply selection, reply AI drafting and own-mailbox links are inside that composer;
the separate Gmail thread/composer panel is retired. Template selection remains
collapsed, advanced actions share one disclosure, and primary send/draft controls
remain accessible on mobile. The inbox also supports ordinary record-grounded AI
drafts with the same explicit, per-draft dossier opt-in.

Appointments can be booked from all three conversation surfaces. They call the
existing calendar event API, linking the event and task to the correct lead/account
in the agency time zone. An interrupted save is checked by its original UUID
before retrying. Editing after uncertain acceptance cannot create another event
until the original save has been checked. Message drafts are preserved.

Personal Gmail sequences work independently of `CRM_MULTI_AGENT_ENABLED`.
Enrollment can approve all displayed steps once and queue automatic follow-ups,
or retain review-first behavior. Account/inbox conversations select an existing
open linked lead; they do not silently create or convert contacts. The additive
`20261107020000_personal_gmail_sales_sequences.sql` migration is installed.
Only reviewed Gmail sales messages may proceed without a separate marketing
consent record. Explicit refusal, recorded revocation, opt-outs, suppressions,
sender/recipient/template changes and duplicate-send protections still apply.
Resend and legacy automation retain their existing permission requirements.

The dedicated Supabase `crm-personal-gmail` timer is enabled after the matching
web release passed candidate and live verification. It runs every five minutes,
processing bounded Gmail schedules and explicitly approved Gmail sales sequences,
not the broader agency
automations. Its sequence cursor advances past deferred rows and resets after the
last page. The shared 50-attempt rolling-24-hour mailbox limit remains enforced.
Send-only Gmail does not read incoming replies: agents must pause follow-ups when
a reply is only in Gmail; CRM-observed replies automatically stop the sequence.
Thread replies use Send Now; scheduling clearly requires a new email instead.

Owner deployment controls:

```powershell
node apps\web\scripts\configure-gmail-scheduler.cjs --enable
node apps\web\scripts\configure-gmail-scheduler.cjs --enable --empty-queue-only
node apps\web\scripts\configure-gmail-scheduler.cjs --pause
```

The script authenticates against the canonical deployment using the existing
Vault credential and changes only the personal Gmail timer. It verifies that
the two broader jobs retain their previous state. The empty-queue activation
check also requires no connected mailbox, preventing customer sends during QA.
For this release, an owner had already connected send-only Gmail. Normal owner
activation followed a separate check confirming zero pending/processing Gmail
schedules and zero active Gmail sequences. Activation authenticated using
`verify_only` and did not invoke a delivery job. The two broader jobs remain
inactive. No new secret or OAuth read permission is introduced.
A naturally scheduled run then reached the canonical live handler and completed
successfully, recording zero scheduled or sequence emails sent. This verified
the timer-to-web execution path without manually invoking a delivery job.

Technical environment/setup checklists have been removed from user-facing
pages. Unavailable integrations retain concise errors and connect/refresh
actions. Instantly drafting, staging and activation are deferred; campaign
history and confirmed pausing remain available.

Validation: 996 web unit tests and all 51 rolled-back SQL fixture suites pass.
The production build verifies the configured Supabase schema and strict types.
Browser coverage includes unified fields/actions, exact delivery receipts, mobile
send visibility, draft/privacy retention, whole-plan Gmail approval, selected
reply payloads, deferred campaigns and calendar saves including lost responses.
All 27 browser checks passed on the final production candidate before promotion;
nine focused checks then passed on the canonical live domain. Both runs included
real send-only OAuth-start verification without completing Google consent.
Writes/sends were mocked or used disposable fixtures; no real customer email
was sent during testing. Temporary candidate-access credentials and the isolated
verification build were removed.

## Budget-first Gmail fallback (preceding release)

Published at https://shield-assurance-crm.vercel.app, deployment
`dpl_HQ5XE5h66KA38HrbRwDXsP4CpLFY`.

The reviewed-email workspace is `/communication/reviewed-email`. It selects up
to 50 contacts, keeps a separate subject/message and review approval for each,
and uses the existing per-contact scheduling and cancellation controls. Editing
a draft clears its review approval. This is not an unattended cold campaign.

Explicit Gmail schedules work with `CRM_MULTI_AGENT_ENABLED=false`. The delivery
runner partitions schedules by their stored Gmail connection, never falling back
to Resend when a Gmail schedule fails. Send-only connections do not promise inbox
reconciliation for uncertain sends.

Migration `20261107010000_gmail_mailbox_send_limit.sql` is installed. Its
transactional trigger reserves at most 50 CRM Gmail attempts per mailbox over a
rolling 24 hours, including uncertain attempts. Immediate and scheduled sends
share the same limit. Rate-limited schedules remain pending and are deferred
15 minutes; uncertain provider acceptance is never automatically resent. This
does not count mail sent outside the CRM or implement a campaign-provider limit.

Validation: 988 web unit tests, strict TypeScript, the schema-enabled production
build, 50 rollback SQL fixture suites and five local browser checks passed.
Six distinct candidate browser checks passed, including a real send-only OAuth
start request that verified encryption, PKCE, the canonical callback and no
mailbox-read scope. Both reviewed-email/OAuth checks passed on the final live
release. The four campaign cases also passed live on the preceding identical-code
release; one Windows worker crash required a focused successful retry.
`node apps/web/scripts/test-gmail-mailbox-limit.cjs` also verified two concurrent
claims at 49 reservations: exactly one succeeded, the other returned `PT429`.
Disposable test identities, connections, attempts and audit rows were removed.
No real email or campaign was sent and no paid service was purchased.

Production Gmail environment configuration is now installed: enabled flag,
encrypted keyring/version and the canonical OAuth callback. Before activation,
the database was checked to contain zero connected Gmail mailboxes and zero
pending/processing Gmail schedules. The owner must still register
`https://shield-assurance-crm.vercel.app/api/gmail/callback` as an authorized
redirect URI on the existing Google OAuth web client and explicitly connect
their mailbox under My Account > Signature / Mailbox (`/account?tab=signature`).
No Google consent was completed by QA. The affordable
automated cold lane and read-authorized reply handoff remain unfinished; do not
represent the reviewed Gmail workspace as an Instantly replacement.

The current Vercel scheduled-message cron runs daily at 01:00 UTC. The
five-minute Supabase heartbeat is configured but remains inactive. The owner
authorized a production cron-key rotation after the local credential failed
live authentication. The new sensitive Vercel value was verified on a candidate
using `verify_only`, the release was promoted, and the matching credential was
stored in Supabase Vault after another live authentication check. An invalid key
returns 401. Database checks confirmed credential equality and both broader
jobs still inactive; no delivery job was run by verification.

The provisioning script preserves explicitly supplied environment values rather
than overwriting them with local settings. Local and production cron credentials
are now intentionally different. Any external caller using the previous
production key must be updated. Do not enable the broader automation jobs merely
to speed up manually scheduled email.

## Private account and policy intake (deployed)

Production: https://shield-assurance-crm.vercel.app, deployment
`dpl_CEU7oWktRdZCTwfbyGydSzxcdFgN`. The production build passed the configured
Supabase schema contract, optimized compilation and TypeScript checks. All 20
affected browser checks passed on the staged production candidate before
promotion; four further checks passed on the live domain for structured PDF
and photo imports, a 125-page policy and scanned-PDF searchable-header fallback.
No migrations, provider activation or customer communications occurred during
deployment. Browser fixtures used disposable authentication identities,
synthetic documents and mocked record writes alongside real read-only API checks.

New Account and New Policy share the account-entry form and modal layout.
New Policy can create an account without leaving the intake, then return to the
policy with its identity and contacts filled in. This first step explicitly saves
the account before the policy; cancelling the policy retains that account.
Combined atomic account/policy recording belongs to the planned document intake.

The policy form calls its document/reference step **Evidence of coverage**.
A selected stored policy, declarations page or carrier binder satisfies the
document/reference requirement without another confirmation number. Agent review,
evidence date and exact-term attestation remain required. An ID card alone does
not establish full coverage. The server-side placement evidence contract is
unchanged; imports never automatically bind coverage, complete a lead or send a
message.

Document intake extracts text PDFs and performs real English OCR on photos and
scanned PDF pages **in the browser**. PDF/OCR workers, language data and WASM are
packaged under the same-origin `public/intake-engine` directory by the existing
dev/build scripts. Generated engine assets are ignored by Git. No private OCR
worker host or external OCR/AI service is required. Limits are five files, 25 MB
per file and 16 megapixels per rendered image/page. PDFs have no page-count
limit and are processed sequentially with per-page cleanup; long scanned policies
take longer to OCR. Review shows
the proposed values and source pages; conflicts stay blank and fields are not
applied until the agent confirms review. Cancelled or failed extraction saves
nothing. Processing and account/source saves lock each other.

Native PDF extraction preserves row and column coordinates. Field recognition
handles multiline insured/address blocks, table headers with values beneath them,
adjacent labeled fields, policy-period date ranges and carrier declaration
headings. Agent/broker contact sections are excluded from insured contacts.
Large scanned image blocks trigger local OCR even when a searchable header exists;
small logos alone do not trigger this fallback. **Retry with OCR** explicitly
reprocesses the selected PDFs locally and resets their document review.
Unrecognized readable text is reported as no fields, not successful extraction;
agents can inspect extracted text page by page without sending it anywhere.
An unreadable file is named and excluded, while readable files in the same batch
remain available for review. These are review suggestions, not a guarantee of
support for every carrier layout; handwritten/non-English text is not supported.

Structured review now maps business/insured and carrier aliases, distinguishes
total policy premium from component premiums, and preserves OCR word coordinates
instead of flattening scanned tables. Coverage limits, deductibles, vehicles,
driver names, properties/locations and selected additional policy details have
separate multiline fields. Supplementary schedules are combined; conflicting
scalar values remain selectable rather than silently overwritten. Driver birth
dates and license numbers, bank identifiers and SSNs are not automatically
proposed. This remains deterministic browser-local parsing, not an external
AI document-understanding service.

The review no longer repeats source excerpts or missing-field explanations
under each box. Raw page text remains behind one collapsed **Extraction details**
control. Existing account and policy form widths are unchanged.

Reviewed originals are uploaded to existing private account storage on account
save, or through the policy intake's explicit source-save action. Source upload
retries reuse completed attachments across the inline account and policy steps.
Explicitly reviewed fields are stored in the source document's existing private
`client_files.metadata.intake_review` object (no schema migration). Policy save
also verifies source/review persistence before recording coverage. Retry reuses
stored bytes and updates the review; failures remain visible. Saved reviews can
be reopened under **Reviewed policy details** in the account's Files tab. They
are not public Rashi knowledge, automatic asset records, or evidence that a
vehicle/driver/property is covered.
Unapplied extraction text/coordinates remain local to the open intake.
Combined atomic account/policy recording, durable extraction revisions and
explicit multi-policy grouping remain unfinished. Do not describe this
foundation as a completed one-click document-to-account/policy workflow.

### Owner-reviewed policy wording

[20261106030000_policy_knowledge_review.sql](supabase/migrations/20261106030000_policy_knowledge_review.sql)
is **installed after explicit authorization**. Its exact-selection dry run and
apply each passed 46 rolled-back SQL
fixture suites, including review permissions, null/stale revisions, edit
invalidation, private table permissions, source URL protection and cascading
insight deletion. Original record identities/contact fields were preserved; only
the selected schema change was committed. The production schema gate now requires
its tables/RPCs. REST cache refresh was necessary before the new RPCs were
discoverable.

Persistent verification also exposed the existing unapplied Prisma prerequisite
[20261106100000_knowledge_source_publication_date/migration.sql](apps/api/prisma/migrations/20261106100000_knowledge_source_publication_date/migration.sql).
After separate authorization, only its nullable `sourcePublishedAt` date column
was added and that migration was recorded with Prisma. A rollback-only test and
apply both preserved original knowledge/contact fingerprints. No other pending
Prisma migrations were installed. The schema gate now checks this field too.

Knowledge Manager links to **Policy wording review**. Agents can submit and
revise their own de-identified excerpts; only an active owner can approve an
exact revision, publish or withdraw it. Both agent and owner confirm privacy and
reuse permission. Server checks reject common identifiers and known account or
policy identifiers; they do not prove complete anonymization, so human owner
inspection is mandatory. Submissions are not automatically extracted from private
originals and are never indexed before approval.

Only approved sanitized wording and carrier/form/edition/jurisdiction/line context
reach embeddings or Rashi. Publication uses a dedicated transaction and stable
document ID, not public-source ingestion. A provider failure retains approval and
indexes nothing; there is no fallback publication. Withdrawal atomically deletes
the Rashi document and cascading insights/embeddings. Generic source attachment
and re-ingestion cannot modify an owner-reviewed excerpt. Private originals,
account IDs and private download links never become Rashi sources. Observed form
wording is explicitly not evidence of carrier-wide underwriting appetite.

Initial foundation verification: 931 web unit tests, 15 affected browser checks, strict TypeScript and
an isolated optimized Next.js build passed locally. Browser checks include real
native-PDF/photo/scanned-PDF extraction with zero external requests, cancellation,
manual placement/quote/renewal/rewrite regressions and explicit owner actions.
The local build skipped its configured-schema gate outside Vercel; the complete
configured Supabase schema verifier subsequently passed separately.

Extraction reliability repair verification: 11 focused unit tests, 17 affected
browser checks and strict TypeScript passed. Coverage includes positioned
producer/insured columns, multiline addresses, a 125-page PDF with a field only
on its final page, scanned pages with searchable headers, explicit OCR retry,
readable-text diagnostics, partial-batch errors and zero external requests.

Expanded structured-intake verification: 28 focused unit/API-contract tests,
20 affected browser checks and strict TypeScript passed. Real synthetic PDFs and
photos populate separate coverage/deductible columns, multiple vehicles, driver
names and property details. Browser checks also cover removing per-field source
clutter, applying reviewed values to policy forms, saved-review payloads,
metadata retry without duplicate account creation/uploads, and reopening the
review under the account's private Files tab. Persistence routes are covered by
Supabase request-contract tests; no new schema was installed by this repair.

The explicitly enabled persistence check uses real owner authorization and
synthetic-only data to verify submission, approval, edit invalidation, stale
publication rejection, one real embedding/publication, idempotent retry and full
withdrawal of the document plus insights/embeddings. It removes its synthetic
account, candidate, audit and auth records. It also checks actual scoped Rashi
retrieval: the approved excerpt is cited before withdrawal and returns no
citations afterwards. State/line tags use the existing Rashi normalization so
scope filters remain consistent. Run it with
`CRM_POLICY_KNOWLEDGE_QA_ALLOWED=1` in addition to the normal browser QA flags.
Ordinary browser runs skip this external-embedding/database mutation check.
Local SQL configuration was corrected to reference the existing SQL connection,
not the Supabase website URL; no production environment settings were changed.
No customer communications were sent. The intake release above is now deployed.

## What Runs On Vercel

- The root [vercel.json](c:\Users\chanc\Shield Assurance CRM\vercel.json) builds the web app only.
- Rashi ingest, query, stats, and document reads now run from the Node routes under `apps/web/src/app/api/rashi`.
- The separate Nest API and BullMQ worker remain useful for local and non-Vercel deployments, but they are no longer required for the web deployment to serve Rashi.

## Required Environment Variables

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `RASHI_EMBEDDING_MODEL` optional, defaults to `text-embedding-3-small`
- `RASHI_CHAT_MODEL` optional, defaults to `gpt-4o-mini`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Database Requirements

- Apply `supabase/migrations` and the Prisma migrations before deployment.
- The web build runs `schema:verify` before `next build`. Vercel will reject a deployment when required Supabase columns or functions are missing; apply migrations, then redeploy.
- Agency time-zone reads require `20261105290000_agency_time_zone.sql`. It is installed after 43 passing rollback suites on both exact-selection dry run and apply, preserving existing identities and contact fields. Schema verification now checks `outreach_settings.timezone` so a missing column cannot pass the release gate. The separate agency-calendar migration was not included in this repair.
- Release recovery: reporting (`20261105280000`), policy-service lifecycle (`20261105240000`), certificate lifecycle (`20261105250000`) and service-request ownership/documents (`20261105270000`) are installed after exact-selection rollback validation. The first three passed 41 SQL suites on dry run and apply; the ownership/documents dependency passed 42 on each. Existing record identities and account contact fields were preserved, and the complete current schema verifier passes. This is database readiness, not a deployment or production-build success. The isolated dossier candidate terminated during build finalization and was not deployed; do not promote that incomplete build or treat its older committed baseline as the current production baseline.
- Ensure the target PostgreSQL instance has the `vector` extension enabled.
- Ensure the target database includes the Rashi migrations in `apps/api/prisma/migrations`.
- Bulk task rescheduling requires `20261103011500_bulk_task_reschedule.sql` and `20261103012500_bulk_task_conflicts.sql`. The latter returns non-retryable HTTP 409 for stale selections rather than a transient serialization failure. The build verifies the service-only RPC with deliberately invalid input (no task changes). Apply the migrations after a successful rollback-only database dry run.

## Sales Communication Templates

Requires [20261106020000_sales_templates.sql](supabase/migrations/20261106020000_sales_templates.sql).
This additive migration is installed after 45 rollback suites passed on both
exact-selection dry run and apply, preserving record identities and contact
fields. Do not edit the installed migration or apply unrelated pending migrations.
The installed follow-up
[20261106021000_sales_template_conflicts.sql](supabase/migrations/20261106021000_sales_template_conflicts.sql)
also passed all 45 rollback suites on exact dry run and apply. It returns `PT409`
for stale saves instead of a retryable serialization error, so the editor can
promptly ask the agent to reload without overwriting content.
The configured schema verifier checks the new template, history and provenance
contracts. The preceding sales-communication release was deployed at https://shield-assurance-crm.vercel.app
(deployment `dpl_CezkDK268dsB4VqxhipBLjSKnvBg`). Production schema verification,
900 web unit tests and 21 staged browser checks passed before promotion; three
additional browser smoke checks passed on the live domain. This release includes
the expanded templates, unified composers, template removal, task/queue action
links and server-resolved AI grounding references. No new migrations or provider
activation were performed during deployment, and validation sent no customer messages.

- **Settings > Automation & Outreach > Sales templates** is the shared library.
  Active owners and admins can create, edit, preview, archive and reset templates,
  then **Save template** to persist a new CRM revision. Admins also have direct
  template management from Settings. Agents can use saved templates and edit
  individual messages, but cannot overwrite the shared library.
- Thirty-three built-in sales moments cover introduction/inquiry, unsuccessful calls,
  appointments, information collection, quotes, closing/handoff and reconnecting.
  Each has email and short SMS wording. Existing servicing templates remain;
  servicing and renewal expansion is deferred.
- Prospecting, post-appointment and post-quote review each offer six distinct
  numbered touches. Messages progress through priorities, useful comparisons,
  objections, practical help, timing and permission to close, rather than repeat
  "just following up." The format is a relevant reason, concrete value and one
  low-effort reply decision; it does not promise conversions, savings or coverage.
  Later prospecting touches require a verified insurance interest, and appointment
  follow-ups require the agreed next step. Agents select the appropriate touch;
  numbering does not enroll anyone or add automatic sends.
- Refreshed starter wording does not replace saved agency customizations or
  rewrite queued messages/pinned sequence steps. To adopt a refreshed default for
  a customized item, explicitly **Reset to built-in**, review, then **Save template**.
  Existing short sequence presets and their sending permissions are unchanged.
- Lead, account, inbox and Gmail composers share the saved library. Browse or
  search, preview, verify the details and explicitly apply. Replacing an existing
  draft requires confirmation. **Use template** requires no AI; **Personalize
  with AI** is a separate draft-only action using existing eligible context.
  Missing appointment, next-step and quote details must be supplied, not invented.
  Unmatched conversations cannot use AI history personalization without a CRM link.
- Sender identity is server-owned. Template ID/revision follows sends and
  schedules; queued message text is not rewritten when the library changes.
  Revision conflicts require reloading rather than silently overwriting edits.
  Unresolved merge fields block sending and scheduling.
- **Optional sales sequences** in a lead's Conversation offer initial-contact,
  post-appointment and quote follow-ups. Enrollment requires review and starts
  approval-first. Appointment/quote sequences require actual supporting CRM
  records. Auto-send is a separate per-enrollment authorization for eligible
  bounded follow-ups; first/event-dependent steps still require approval.
- Replies, opt-outs, changed stage/assignment/recipient/sender, changed template
  revisions or supporting records, and overlapping scheduled messages prevent
  further sends. Cancel/recreate to review changed content. Resume keeps
  automatic sending off. Existing consent, suppression, send-window, caps,
  atomic claims and uncertain-send protections remain in force.
- SMS templates are draft-only: no outbound SMS provider is connected, and SMS
  sending/scheduling remains blocked. No live sending or scheduler activation is
  performed by this change. Scheduled Gmail replies still start new emails;
  scheduled attachments remain unsupported. Delivery occurs on the next configured
  delivery run, not at a guaranteed exact time.
- Validation uses mocked adapters and disposable QA identities/records, never
  customer sending jobs. Browser coverage verifies all four composer surfaces,
  failure/draft retention, SMS blocking, optional enrollment, permanent owner/admin
  saves, a second agent's picker and denied writes, and stale-save HTTP 409 within
  five seconds. The responsive lead drawer retains its original width and scrolling.

## Unified Communication Presentation

- Lead, account, inbox and Gmail use the shared `MessageComposer` for sender/
  template placement, subject and body fields, CoreUI action styling and
  scheduling placement. Shared `ConversationMessage` cards align incoming,
  outgoing and scheduled message appearance. Existing drawer widths and the
  account's expand/collapse layout remain unchanged.
- Context-specific capabilities remain intentional: leads retain AI purpose,
  explicit dossier opt-in and sales sequences; accounts retain conversation
  summaries, servicing templates, uploads and saved-file attachments; Gmail
  retains source-message selection, eligibility checks and thread-specific reply
  metadata. The inbox retains unmatched-contact handling and linked Gmail access.
  Sales-template preview/AI personalization and scheduling remain available in
  their applicable composers; unimplemented delivery capabilities are not implied.
- Account uploads still block scheduling while selected; Gmail scheduled replies
  are still disclosed as new emails. SMS delivery remains unavailable. Busy fields
  and options are locked during drafting/sending/scheduling so an in-flight action
  cannot consume changes made midway through the request.
- Imported Gmail content remains escaped plain text inside the shared card.
  Canonical email history retains readable formatting, expandable quoted text
  and delivery/open receipts. No sending, identity, consent or queue logic changed.
- Settings template options show names and archive state without default/revision
  suffixes; save confirmations and revision conflict protection remain intact.
- Composer template previews offer **Clear selection** without changing a draft.
  Applied templates show **Remove template** even when the library is collapsed.
  Removal confirms before clearing subject/body edits and template provenance;
  cancelling keeps the message intact. It does not delete the shared template,
  attachments or any already-scheduled message.

## Opportunity Intelligence: Import and Evidence Foundation

Requires [20261105090000_intelligence_import_foundation.sql](supabase/migrations/20261105090000_intelligence_import_foundation.sql). Validate it with the rollback-only database runner before applying this specific migration; do not apply unrelated pending migrations. The build checks the private source tables and all three service-only RPCs.

- Duplicate review checks the complete lead/client book using indexed email, normalized phone and business-name/address matching, plus lead DOT identifiers. Different street-address branches remain separate. Matches require review; the foundation never auto-merges accounts or treats shared contacts as proven company identity.
- Each selected prospect promotes in one transaction: lead, source snapshot, tasks, staging marker and batch counters. A batch intentionally permits partial completion; results distinguish failures, duplicates, blocked contacts and already-imported retries. Re-selecting an imported prospect does not duplicate its lead/tasks. Stale review rejects changes; old ambiguous grouped rows require re-upload rather than silently taking the first branch.
- Reparse covers the complete uncommitted batch, retains manual contact edits and reports missing/ambiguous source rows or save conflicts. Committed source history cannot be rewritten through staging.
- Renewal predictions display a month, not an asserted exact policy date. Other imported dates/carriers/brokers remain vendor-reported. Tasks ask agents to verify timing; imports do not establish consent, enroll outreach or send email.
- The lead profile shows source file and capture time. Source reporting date remains unknown unless the source actually provides it. Private source snapshots survive staging deletion. New FMCSA/OSHA refreshes retain observation history and merge only their source into the current lead profile; changed identity or an older concurrent result rejects the save. Name-search results are observations, not verified entity matches or coverage gaps.
- This release is the trust foundation, not a licensed Lead Finder, complete company/contact resolver, appetite ranking engine or automated provider refresh service. Source licensing, provider access, verified decision-makers and agency market appetite remain later-phase gates.

## Lead Finder: Approved File Acquisition

Requires [20261105103000_file_lead_discovery.sql](supabase/migrations/20261105103000_file_lead_discovery.sql), applied only after a matching rollback-only dry run. The build checks source/search tables, staging columns and service-only discovery RPCs. Legacy imports retain their existing behavior.

- **Settings > Lead discovery** lets only an active agency owner approve a documented file source. This adapter requires verified rights to acquire files and retain their data for CRM storage, agent display and AI processing after the acquisition period. Do not approve restricted, sensitive or expiring-use datasets: field-level permissions, revocation and retention workflows are not implemented here. A contract reference is an attestation, not independent legal verification.
- **Leads > Lead Finder** acquires a source-approved CSV/XLSX file (10 MB and 5000 prospects maximum). One transaction stages the entire file; a retained upload request identity/fingerprint reconciles retries without duplicate candidates. The browser retains only a content-hash/request key in session storage so the same file/source retry survives reload in that tab. No new provider charge is initiated; the file's purchase cost is unknown. Live provider searches, purchases and recurring refresh remain disabled.
- Targeting searches acquired candidates by business name, industry, address state, numeric employees, reported renewal line/month and review state. Employee range/unknown values do not pass numeric-size filters. Predictions remain predicted months. Saved targeting belongs to the signed-in agent and is not recurring acquisition.
- Research-only businesses remain candidates without contact details. Agents can mark candidates reviewed, needing verification or dismissed, with version-checked notes. Imported roles/emails are reported, not independently verified; capture time is not source freshness. Matches are possible duplicates, never proof of identity or an auto-merge.
- Promotion uses the reviewed staged profile, checks source acquisition approval and rechecks the complete live book. Any contact/profile edit clears review; dismissed/unreviewed candidates cannot bypass review via Import Center. Promotion/replay uses the existing atomic lead/evidence/task transaction; it does not establish consent, enroll outreach or send email. Use **Fix contact / inspect source** to open the exact batch in Import Center.
- Pausing a source or passing its acquisition end date blocks new acquisition and promotion; already-promoted retained-use records are unchanged. An actual rights revocation needs a separate retention review, not the pause switch. Source approval and review/promotion changes are audited. Discovery APIs require active membership even while the multi-agent rollout flag is off; browser clients cannot directly alter sourced staging rows or call the unguarded promotion core.

## Opportunity Dossiers: Reviewed Findings and Internal Briefings

Requires [20261105113000_intelligence_dossiers.sql](supabase/migrations/20261105113000_intelligence_dossiers.sql), applied only after its matching rollback-only dry run. Schema verification checks the private dossier tables and actor-guarded service RPCs.

- Lead and account **Overview > Opportunity dossier** shows retained import/FMCSA/OSHA observations alongside separate agent-confirmed findings. Linked leads share the canonical account dossier. Linking preserves historical standalone findings but never silently merges them into current account findings.
- Every confirmation requires a reviewed business finding, evidence reference and nonfuture UTC confirmation date. Confirm the whole submitted revision against that reference; blank fields retract current findings while preserving append-only history. A reference is an agent attestation, not automatic document, identity or contact verification.
- Saves are atomic, version/scope checked and replay-safe. A stale revision, changed account link or reassignment rejects the write. The editor retains unsaved changes on errors; explicitly reloading requires discard confirmation. Paginating history does not upgrade a stale editor's save version.
- APIs require active membership even when the multi-agent flag is off. Agents cannot access another assigned agent's lead/account dossier or that agent's linked source observations. Owner/admin review remains permitted. Browser roles cannot directly modify the tables; service-role history updates/deletes are revoked.
- **Internal opportunity briefing** separates missing answers and discovery questions from tentative renewal-window/fleet-change signals. Fleet comparisons require the same DOT/lead and different valid reporting dates; stale source observations are suppressed. Predictions remain month-only, and reported changes may reflect corrections or reporting lag. Signals use only the loaded 25-observation history page, not a complete-book scan.
- When a current agent-confirmed renewal line/date matches the active dossier revision, conflicting predicted or vendor-reported timing for that same line is suppressed in the briefing and, when dossier grounding is explicitly requested, in AI outreach/call prep. Month-only reports are compared at month precision; independently confirmed records and other coverage lines remain visible.
- This release does not overwrite provider profiles, create policies, establish consent, enroll sequences or send messages. Current agency appetite/access remains an explicit missing answer. Licensed contact verification, extracted document evidence, full appetite-aware ranking, automated refresh/outcome learning and permissioned expansion remain later-phase work.
- Manual lead/account AI drafts and lead call prep use dossier findings only when the agent explicitly opts in for that request. The CRM sends the allowed business findings and confirmation date only when active findings exactly match the latest confirmed revision; it does not send the internal evidence reference or decision-maker finding. Unconfirmed, stale or mismatched findings are never used. AI returns exact grounding citations for review. Drafts remain unsent; call prep is advisory. Leaving the option off does not query the dossier.

## Social Marketing: Revision-Bound Reviews

Requires [20261105170000_social_marketing_reviews.sql](supabase/migrations/20261105170000_social_marketing_reviews.sql). Run its rollback-only database dry run before applying this exact migration; schema verification checks the review event history and revision fields.

- Social drafts and uploaded media are managed in **Communication > Social**. Reviews are tied to the saved post revision; editing a reviewed draft invalidates its prior review. Only an authorized owner/admin can approve or request changes, and agents can see the review outcome without changing it.
- Review history is append-only. Approval is an internal content review only: it does not schedule or publish a post, connect a social provider, or enable automated posting.
- The authenticated mock UI/browser tests and real database/browser flow cover upload, review permissions, stale revision rejection and cleanup. The migration and source are locally validated, but have not been deployed or promoted.

## Social Marketing: Meta Connections and Publishing

The Meta connection screen is a server-side OAuth/account-discovery flow for Facebook Pages and linked professional Instagram accounts. Live targets use the durable social-intent/outbox worker and are separate from the deterministic test adapter. The new HTTPS link field and live-target path require migrations `20261109190000_social_marketing_publish_links.sql` and `20261109200000_social_marketing_real_publishing.sql`, in addition to the draft, media, review, engine, and connection migrations. All remain subject to the shared migration runner, schema gate, and explicit apply approval; none were applied as part of this source change.

- Register the exact `SOCIAL_META_REDIRECT_URI` callback in the Meta developer app. Set `SOCIAL_META_CLIENT_ID`, `SOCIAL_META_CLIENT_SECRET`, a reviewed pinned `SOCIAL_META_GRAPH_API_VERSION`, and `SOCIAL_META_CONNECTIONS_ENABLED=true` only after the app and permissions are approved. Requested permissions are Page discovery/engagement/publishing and Instagram Basic/Content Publishing.
- Configure `SOCIAL_TOKEN_KEY_VERSION` and `SOCIAL_TOKEN_KEYS` in both the web server and worker's encrypted environment; use a random 32-byte key encoded as canonical base64. Keep prior key versions available while stored credentials use them. The worker also needs `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY` to create short-lived URLs for private images. Never put these values in `NEXT_PUBLIC_*`, logs, source control, queue payloads, or browser responses.
- OAuth is bound to the signed-in actor, active owner/admin membership, single-use state, and an HttpOnly browser cookie. The owner/admin must select each authorized Page; the app stores provider credentials encrypted at rest. Disconnect disables local use; revocation also requests Meta to revoke the app authorization. A failed remote revoke leaves CRM publishing disabled and an explicit retry state.
- Approved live targets require an already-reviewed exact content revision, a separate owner/admin destination approval, and a due schedule. Facebook supports text/link and one image; Instagram supports one image and caption (draft links are intentionally rejected for Instagram). Each destination has a separate intent and status, so one platform's failure does not retry another platform's successful post.
- The test adapter and real publisher have separate worker gates: `SOCIAL_TEST_WORKER_ENABLED=false` and `SOCIAL_REAL_PUBLISHING_ENABLED=false` by default. Keep the CRM engine paused until an authorized staging test, provider permissions, migrations, restart/schedule/cancel/revoke checks, and schema verification have passed. An uncertain provider acknowledgement is held for manual confirmation and never automatically retried.
- Local provider-adapter, worker-contract, route, and shared-contract tests pass. No Meta app credentials, migrations, live Meta calls, deployment, or promotion were used. Phase 6/7 acceptance is not complete until an authorized Page and professional Instagram account publish and reconcile real test posts, the worker restart/schedule path is verified, and intentional cleanup is performed.

## Manual Communications: Schedule Send

Lead profile **Conversation > Schedule send** queues the current email for a future agency-local date/time. Pending and failed emails appear below the composer; the creating agent can cancel a pending email. Lead-only scheduling does not create an account. Consent/opt-out and the approved recipient are checked again at execution; agent mode additionally requires the original Gmail mailbox and sender identity. Exact request retries reconcile the original schedule instead of inserting another email.

The same control is available in account conversations, the Communication Center (including unmatched email conversations), and Gmail reply panels. Account rescheduling uses agency time, rejects invalid/past times, and cannot edit or cancel an already-processing send. Account attachments must be removed before scheduling; immediate sending retains attachment support. Scheduled Gmail replies are explicitly new emails, not replies in the selected Gmail thread. SMS sending and scheduling remain disabled with an explicit provider-not-connected message; this does not add or activate a Twilio outbound adapter. All queue creation endpoints reject SMS instead of recording a message that cannot send.

Requires `20261106010000_lead_scheduled_messages.sql`, installed after 44 rollback suites passed on both exact-selection dry run and apply. The schema check includes the lead scheduling columns. Both delivery paths atomically claim pending rows as `processing`; an interrupted processing row requires review, not automatic retry or a second schedule. Account-only scheduling endpoints exclude lead schedules.

Delivery uses the existing `/api/messages/process-scheduled` job on its next run after the selected time, not an exact-time guarantee. The current Vercel schedule is daily at 01:00 UTC. Local scheduling saves a queue entry but does not itself run delivery. This change does not enable cron, send live test email or deploy the source.

## Tasks: Bulk Rescheduling

On **Tasks > Open**, check individual tasks or **Select all** in the toolbar (maximum 200); use **Due filter** to narrow by current due date and/or time first.
A bar appears only while tasks are selected. Click **Reschedule**, choose the new date/time in the popup and click **Reschedule N tasks**. All displayed times and filters use Arizona (UTC-7), regardless of the browser timezone; time filters match the displayed minute.
The operation changes only the due date and audit actor. Linked calendar appointments and reminder invalidation follow the existing task triggers.
If any selected task changed, was completed or was deleted, the entire operation fails without partially rescheduling others. Refresh and reselect before retrying.

## Outreach: Rewrite With Instructions

Pending outbox drafts offer **Rewrite with AI** beside **Reject** and **Approve and send**.
Enter up to 1,000 characters of specific instructions and select **Generate rewrite**.
The AI uses your current edits, sender profile and permitted contact context; the replacement and factual citations are saved for review.
Rewritten drafts always require explicit approval, even with automatic outreach enabled. Concurrent changes reject stale rewrites and approvals.
Provider/quality failures retain the original draft and instructions. No email is sent by rewriting.
AI email, SMS and sequence drafts select grounding reference IDs; the server resolves them to exact stored excerpts. Unknown IDs and unsupported legacy citations still fail validation, without saving a substitute draft.
Task titles and lead queue items open their saved action destination when available, including the specific outreach draft awaiting approval. Record task lists and account next actions honor the same destinations; ordinary lead tasks still open the lead profile.
Sending an email does not automatically change the lead pipeline status to Contacted. Pipeline stage remains agent-controlled; provider acceptance is not evidence of delivery or a customer response.
Requires `20261103020000_outreach_draft_rewrites.sql` and a configured `OPENAI_API_KEY`; missing AI configuration returns an explicit unavailable error, not a substitute draft.
Browser verification of the real AI rewrite uses a disposable synthetic prospect and requires `CRM_BROWSER_AI_QA_ALLOWED=1` in addition to the normal browser QA opt-in. It never approves or sends email.

## My Account and Agency Settings

- Versioned automation configuration requires [20261105100000_automation_configuration_versions.sql](supabase/migrations/20261105100000_automation_configuration_versions.sql). Run its specific rollback-only dry run before applying it. It seeds the preserved built-in baseline in the existing outreach settings row and records non-secret configuration snapshots; applying or saving it performs no intake, task creation, enrollment, drafting or sending.
- Owner-only `GET /api/settings/automation` returns the current configuration/revision and private, non-cacheable history (20 entries per page, `before` revision cursor). New sender saves submit `expected_revision`; stale saves return HTTP 409 and retain the form edits. **Reload saved settings** requires confirmation before discarding them. Compatible older saves remain owner-checked and versioned.
- Editable built-ins require [20261105130000_built_in_automation_controls.sql](supabase/migrations/20261105130000_built_in_automation_controls.sql). Validate/apply this exact migration, not unrelated pending migrations. Settings > **Automation & Outreach** has Rules, Sequences, Sender and Runs sections; old Outreach/Operations tab URLs resolve to their corresponding section. Owner-only, revision-checked saves change future rule behavior without executing business work. Re-enabling a paused rule establishes a future-event cutoff; existing tasks and sequence enrollments remain intact.
- First-contact timing/priority, pipeline stages/timing/priority, service work/acknowledgements, reply targets/successful-send completion, reminder dispatch, renewal windows/grace/milestones and new sequence step/gap defaults use persisted policy. New sequences snapshot default timing and configuration revision. [20261105200000_imported_renewal_automation_policy.sql](supabase/migrations/20261105200000_imported_renewal_automation_policy.sql) adds saved task creation/timing controls for imported renewal records; its rollback-only dry run and applicable SQL fixtures pass, but the migration remains unapplied. [20261105210000_service_templates_and_notification_controls.sql](supabase/migrations/20261105210000_service_templates_and_notification_controls.sql) adds owner-editable wording for new service tasks (both subjects and descriptions render `{service_type}` and `{account_name}`), future-only service/renewal/reply notification cutoffs and separate confirmation for notification changes. Its rollback-only dry run and applicable SQL fixtures pass; it remains unapplied. Assignment remains manual. Custom source enrollment/drafting requires the separate workflow migrations below; built-in automatic-enrollment flags remain unsupported. A per-job preview is not a backlog migration.
- Runs uses owner-only `GET /api/automation/run?job=...` counting previews and explicitly confirmed `POST` requests with the preview revision. A stale revision returns 409 before execution. Exactly one supported job runs with durable start/result tracking. Preview/save never creates tasks, enrollments or drafts, or sends email. Due outreach execution can use AI and send only under existing approval, consent, suppression and provider-idempotency safeguards.
- The top-right profile menu opens **My Account** (`/account`), not agency Settings. Profile, Security and Signature / Mailbox are separate URL-addressable tabs; switching tabs preserves unfinished forms. Display name and contact phone update only the signed-in user. Membership role is read-only; user-editable profile metadata never grants access.
- The left drawer opens **Settings** (`/settings`). Agency sender context, approval policy, daily limits and Arizona send windows are configured here, not on the Outreach work screen.
- Agency configuration is owner-only, even while `CRM_MULTI_AGENT_ENABLED` is disabled. Admin membership does not automatically grant configuration or team-management authority. Personal sender profiles cannot replace agency identity or approved claims.
- Team settings now provides an owner-only member list and explicit deployment prerequisites even with multi-agent rollout disabled. Invitations remain blocked until the invitation redirect and Gmail configuration are present; enabling multi-agent mode switches manual email to each agent's own mailbox, not a shared-provider fallback.
- Manual first-contact email to imported/discovered leads is not permitted through Resend without genuine recorded permission or a prior request. Send failures identify that refusal separately from infrastructure failures. If Resend accepted a message but receipt recording failed, the response says acceptance is unrecorded and warns against resending; it never labels that message unsent.
- Validate `20261105010000_owner_settings_foundation.sql` with the rollback-only migration runner before applying it. It adds an owner-checked, audited settings RPC and blocks direct authenticated settings writes. Disabling required approvals requires explicit confirmation. No contact is enrolled or emailed by the migration.
- Before rollout, explicitly verify the initial owner's existing confirmed auth account. Do not assign ownership to the first login. Inventory existing legitimate users before using the audited `bootstrap_agency_owner` procedure: membership initialization activates existing restrictive database policies, even if the web multi-agent flag remains off. Preserve authorized users' access and validate the owner account before enforcement is released.
- Personal signatures are editable in My Account even with the agent feature disabled; they apply to manual shared-mailbox sends without changing the authorized From address or automated sequence identity. Existing authored draft signatures are retained, not duplicated. When agent mailbox access is active, its existing authorized sender-profile/mailbox controls remain in this tab. Team management belongs in owner Settings.
- DNS, hosting and infrastructure secrets remain outside the CRM. Configuration presence must not be presented as tested connectivity or delivery.
- This foundation separates existing working controls. Expanded record scopes, delegated permissions, saved import automation, personal notification preferences and other planned settings require their own persisted implementations and verification; the navigation change does not enable them.
- Sender-profile density pilot: short fields use compact suggestion inputs populated from saved active sender profiles and the current account name. Job title uses a visible dropdown with standard agency titles, saved titles and an Other / custom title editor; custom titles remain non-authorizing text. Existing multiline values stay multiline rather than being flattened. The agency signature has a live preview; approved factual claims remain available in a focused expandable editor. Saved sender payload and existing sending controls are unchanged. This visual pilot does not enable new automation or change access roles.
- The approved sender pilot was promoted as `dpl_4SCz1TUCJUdmXEuzYxfpFKbmuZEq` to the canonical CRM after 49 targeted unit tests, a schema-checked production build, 13 candidate browser checks and 13 canonical live browser checks. Expanded editable automation, unified Automation & Outreach sections and scheduling changes remain separate pending work.
- Website replay repair is live in `dpl_GdH2iLa8pscAhE2vQbuzqcjy4aUo`, following migration `20261105070000_website_submission_receipts.sql`. Submission-only receipts survive lead purge; both direct POST and full-history pull consult them. Verified with 63 targeted unit tests, 25 rollback SQL fixture suites, schema-checked production build, and 14 candidate plus 14 canonical browser checks including disposable archive/purge replay. The real website export's 32 submissions were all recognized without invoking the bundled sending runner. The historical replay alerts were already acknowledged by final verification; no customer leads or tasks were changed during alert cleanup.

### Supabase background scheduling (Vercel Hobby)

- Requires [20261105150000_supabase_automation_heartbeat.sql](supabase/migrations/20261105150000_supabase_automation_heartbeat.sql) and [20261105160000_bounded_automation_heartbeat.sql](supabase/migrations/20261105160000_bounded_automation_heartbeat.sql), each validated/applied specifically. Duplicate migration timestamps are rejected; an already-recorded version for another filename must not be treated as successfully installed.
- Migrations install `pg_net` and create **inactive** `pg_cron` jobs: reminders every minute, authenticated HTTP heartbeat dispatch every five minutes. Vault holds the canonical HTTPS endpoint and bearer token; API status returns no credentials. Only the owner can pause/resume both jobs through Settings > Automation & Outreach > Runs.
- Each dispatch queues separate authenticated requests for scheduled messages, follow-ups, outreach, renewal radar, website intake and internal reconciliation; the custom workflow migration adds a separate custom-rule request. They do not share one sequential AI-heavy 60-second request. Scheduled sends process one message; outreach processes one due enrollment with a retained continuation cursor and at most ten known-accepted bookkeeping recoveries; renewal policies process pages of 25 with a retained cursor; website pull processes at most 20 genuinely unseen submissions, using durable receipts. Subsequent pulses continue the queue, rather than starving later records.
- Deploy/verify the exact candidate and canonical heartbeat before provisioning: from `apps/web`, run `node scripts/configure-heartbeat.cjs` (optionally `--owner=UUID` when multiple verified owners exist). It loads `.env.local`, verifies live `verify_only` authorization without business work, then stores named credentials in Vault. Use `--enable` only after release verification, or explicitly enable in Runs. Never print tokens or commit them.
- Missing/mismatched `CRON_SECRET` is rejected. Heartbeats require a supported single `job`; `{ "verify_only": true }` performs no database/business execution. Existing daily Vercel cron entrypoints retain authorization and share per-job concurrency tracking with heartbeat/manual runners. Failed or ambiguous sends must be investigated, never blindly retried or automatically cleared.
- A successful cron queue dispatch proves only queuing. Verify persisted per-job `server-heartbeat:*` results and actual due-work results after enabling. Observe request durations and continuation progress under the agency's workload before declaring scheduling operational. A crashed running job is deliberately not auto-reset; investigate its provider/bookkeeping state first.

### Custom workflow rules

Requires [20261105180000_custom_workflow_events.sql](supabase/migrations/20261105180000_custom_workflow_events.sql) and [20261105190000_workflow_future_configuration_scope.sql](supabase/migrations/20261105190000_workflow_future_configuration_scope.sql), each specifically dry-run and applied. [20261105230000_custom_workflow_backlog.sql](supabase/migrations/20261105230000_custom_workflow_backlog.sql) adds explicit queue-only backlog support after the reserved social engine migration; it must also be dry-run and applied before building this source. The build verifies private rule/version/event/execution tables, backlog RPC authorization and enrollment provenance.

- **Rules > Custom rules** provides an owner-only editor, actual member assignment choices, condition lists, pause/save/reload, revision history and recent execution errors. Selected rules retain their IDs in the URL. Conflicting saves preserve edits; mouse and keyboard navigation require confirmation before discarding them.
- Supported events are lead creation/stage changes, website submission, inbound email/text, service/policy changes, renewal milestones, due reminders and outreach draft/acceptance/blocked states. Actions create internal tasks, agency notifications or linked-record notes, or enroll/draft eligible lead sequences. There are no arbitrary scripts, HTTP actions, binding, direct sends or automated SMS.
- Built-ins retain priority. The earliest matching custom rule owns a task or sequence; deliberate notes and notifications may coexist. Canonical account aliases and existing open work are deduplicated under locks. A later event can create fresh work after completion, but never rewrites/reopens the prior completed task. Existing active/paused enrollments are preserved; replay can only recover the same originating execution.
- Saving never executes or backfills business work. Behavioral definition edits establish a new future-event cutoff; name-only/no-op saves preserve it. Changes to renewal milestone/window/grace configuration also establish a future cutoff for custom renewal capture. Previously captured jobs retain their versioned definitions. Past dates not captured before a behavior change do not silently run under the new configuration.
- Date events are emitted independently of paused built-ins, capped at 100 source records per pulse and deduplicated with existing reminder/renewal notification identities. Processing handles at most 50 internal actions and one sequence adapter job. A custom preview counts queued actions and bounded uncaptured date sources without emitting events, drafting or sending; confirmed runs require both agency and custom-rule revisions.
- An owner can preview and explicitly queue existing leads or linked, unhandled website submissions for one selected active rule. Apply binds the rule revision, eligible count and fingerprint and queues at most 100 records; it never executes an action, creates business side effects, invokes AI or sends messages. Backlog stays held from cron and adapters until an owner separately confirms a manual Custom Rules run. Paused/edited rules and sources that are no longer eligible are skipped, not released.
- Sequence actions recheck actual actor/mailbox, canonical lead/recipient, marketing permission, opt-outs and suppressions in the locked enrollment transaction. Enroll-only invokes no initial AI call. Draft actions share a 20-second total AI budget; every workflow-origin draft is permanently forced to manual approval. The custom job does not send email. Later outreach delivery still uses its existing approval and provider safeguards.
- Source deletion redacts contact names/emails in workflow event snapshots and skips queued work. Internal-action failures roll back partial side effects and retain explicit failed execution evidence; claimed adapter failures are recorded and never blindly reset/retried. Pausing preserves already-created work.
- Legacy Nest/BullMQ deal-bound automation is separately gated by `CRM_LEGACY_DEAL_BOUND_AUTOMATION_ENABLED=true`; absent that exact value, the API does not enqueue jobs and the worker skips any already queued job. Its legacy contact model has no channel-consent field, so this is not a replacement for the web/Supabase policy. The legacy workflow no longer sends SMS; its Twilio adapter reports a configuration error instead of returning a fake local success. Service-template/notification controls, any explicit backlog application, scheduler activation and the broader density rollout remain separate completion gates.

### Passwords and verified email changes

- Requires `20261105060000_account_security.sql`, applied only after the rollback-only migration dry run. The build checks its private tables. The migration adds rate limits, audited owner approval and database enforcement around auth email changes; it does not change any existing user's email/password.
- Security supports current-password-verified password changes. Login offers **Forgot password?**. Recovery requires an explicit confirmation click and a short-lived HttpOnly proof bound to the verified user/session; other refresh sessions are revoked after a password change. Existing access tokens expire normally.
- Owners and admins request their own email change; agents require owner approval in **Settings > Team** (available independently of team invitations). Every change requires the current password and independent, single-use confirmations at both the old and new email addresses. Replaced, cancelled, expired or unauthorized approvals cannot change the auth identity. Stable membership ID and role remain unchanged; membership email synchronizes after completion.
- Auth/security messages deliberately use the official Resend service-message transport, independently of personal agent-mailbox mode. Configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO`, `RESEND_SENDING_ENABLED=true`, Supabase service credentials and the canonical HTTPS `CRM_WEB_ORIGIN`. No alternative provider or customer-mailbox fallback is used.
- Confirmation tokens travel in URL fragments, not server query strings. Only hashes are persisted for email-change proofs and send request identifiers. GET does not consume links; confirmation requires POST. Public recovery uses a generic account-existence response, with durable per-address and overall rate limits. Account mutations reject cross-site/non-JSON requests.

### Email and Settings tabs

- Settings opens on Team. URL-addressable sections switch locally without repeating server authentication or refetching visited panels; browser Back/Forward works and unfinished forms survive switching top-level sections. Links that replace an editor still require discard confirmation. Leaving Settings entirely unmounts its panels.
- **Invite member** opens a popup. The owner can invite an agent when setup is complete, retry failed invitations without losing the address, and manage existing roles/access. Disabled invitations show the exact deployment steps with Copy and Check setup actions; they never bypass the multi-agent/Gmail gates.
- Lead discovery separates Business research, Targeting and Source approvals. Only visited tools load. Successful directory scan logs are omitted; failed sources and incomplete research keep their retry actions.
- Integrations links to Gmail/email controls and names missing deployment settings instead of generic contact-support messages.
- Email checks the configured sending domain against Resend, displays the effective local/deployed sending state, and names missing deployment variables. DNS and secrets are not editable here.
- **Send test & verify replies** sends fixed content only to the signed-in owner. Reply from that mailbox, then select **Refresh status**. Set `RESEND_REPLY_TO` and `RESEND_INBOUND_ADDRESS` to the same Resend-receiving address for direct CRM replies. If intentionally using a separate mailbox as Reply-To, configure forwarding while preserving the original sender.
- `20261105020000_email_setup_checks.sql` stores the test identity and signed incoming reply evidence. The test is rate-limited and idempotent. Only a matching owner reply received at the configured address verifies the current sender/reply-to/receiving/webhook configuration; forwarded copies of the outgoing test do not count.
- A verified reply check unlocks the existing sequence reply gate without a redeploy. Changing the email configuration invalidates that proof. Domain verification alone does not prove that replies reach the CRM.
- An unconfirmed test is not automatically resent. Existing customer sends, consent and unsubscribe protections are unchanged.

### Client message thread and open detection

- The client conversation drawer has one chronological thread, incoming messages aligned left and outgoing aligned right. SMS uses blue/gray bubbles; email uses teal incoming and violet outgoing sender headers on white letter cards. The compact single-row toolbar contains the client's name, channel selector, expand/collapse and close icons, with no routine Refresh button. **Expand** gives the thread full available height with a separately scrolling right-side composer on desktop. On narrow screens the composer stays below the thread with a capped height. **Collapse** restores the drawer without losing the draft. **Schedule send** is below **Send Now**; templates, documents and AI actions are under **Message options**.
- Client, lead and inbox threads refresh automatically on authenticated task/notification realtime changes, with visible-only 15-second polling and focus recovery as a fallback. Incoming-message automation updates the canonical reply task, which is already in the realtime publication; raw message-table publication is not required. Refresh failures retain the previous thread and draft and expose a Retry control.
- Reply tasks resolve across email and SMS for the same canonical client/lead when a newer outbound message has recorded successful-send status. Scheduled, failed, uncertain and unverified sends do not complete reply work; unrelated follow-up tasks remain open. A new inbound message reopens reply work. The database trigger applies this rule across send surfaces, including linked leads; `20261105050000_reply_task_completion.sql` tightens the successful-send guard.
- Task lists and record-level task panels consume the same automatic-update signals, so completed reply work does not remain visibly open until a manual reload.
- Client account email/phone details link to the device's email/calling apps. The conversation toolbar has a compact Call shortcut, disabled when the client has no phone number. These external-app shortcuts do not send through the CRM, record call outcomes or automatically complete reply tasks.
- `20261105030000_email_open_receipts.sql` allows signed Resend `email.opened` events. Receipts match durable request/provider identities, never subject text or recipient guesses. Older messages without a stored send identity do not receive guessed receipts.
- Enable open tracking on the Resend sending domain and verify its tracking-subdomain CNAME. Settings shows the live tracking state and required DNS record. Outbound messages include escaped HTML and original plain text; plain-text-only email cannot load an open-tracking pixel.
- **Open detected** shows first/last provider-reported times, not proof of a human read. Image blocking can hide opens; privacy proxies and scanners can cause opens. CRM `read_at` only means an agent viewed an incoming message and is never used as a client's read receipt.
- Routine provider-acceptance banners are omitted. Outgoing emails show their actual open timestamp or **No open recorded**, never a guessed unread/read state. Failed or uncertain sends remain visible to prevent accidental duplicate sends. Lead conversations and the inbox use the same open indicators.
- Email bodies normalize mailbox whitespace and keep quoted history, including wrapped Gmail attribution headers, under **Show quoted email**, without modifying saved content. Safe Markdown renders emphasis, paragraphs, lists and tables; raw HTML and remote images are not rendered. HTML-only ingestion preserves paragraph/list structure, decodes entities and strips executable markup.
- The client thread uses a navy toolbar, teal incoming sender headers and violet outgoing sender headers with matching edge accents. Sender identity, subject, body and receipt timestamps have separate visual hierarchy; the full-height desktop reading area and right-side composer remain independent.
- Direct routing affects newly sent emails only. Replies to old messages still go to their original Reply-To mailbox; forward those into CRM while preserving the sender if they need to be ingested. Setup-check replies verify infrastructure and intentionally do not create client activity.

## Multi-Agent Gmail Activation
The membership and Gmail migrations can be installed with `CRM_MULTI_AGENT_ENABLED` and `CRM_GMAIL_ENABLED` disabled. Do not bootstrap memberships or turn on either flag until the existing owner is explicitly mapped and the rollout prerequisites in the [README](README.md) are met.
Production needs the Google OAuth application, approved redirect URI/scopes, versioned encryption keys, Pub/Sub configuration and a running reconciliation worker. Vercel deploys the web app, not the BullMQ worker.
AI also requires the configured provider key and documented Gmail AI privacy approval; a code deployment does not connect mailboxes or authorize AI access. Each agent must explicitly connect their own Gmail account.

### Google Workspace setup checklist

1. Create or select the agency's project in [Google Cloud Console](https://console.cloud.google.com/). Enable **Gmail API** and **Cloud Pub/Sub API**.
2. Configure Google Auth Platform branding, support contact and audience. Use **Internal** only when the project belongs to the agency's Workspace organization and every agent belongs to that organization. Otherwise use **External**, add intended test users for initial testing, and complete applicable Google verification before production rollout. Shared mailbox sync requests `https://www.googleapis.com/auth/gmail.readonly` (restricted) and `https://www.googleapis.com/auth/gmail.send` (sensitive). The separate manual send-only connection requests `openid`, `https://www.googleapis.com/auth/userinfo.email`, and `https://www.googleapis.com/auth/gmail.send`; it cannot read or sync mailbox content. External testing is not a durable production authorization setup. See [Google's scope requirements](https://developers.google.com/workspace/gmail/api/auth/scopes).
3. Create an OAuth client with application type **Web application**. Register the exact authorized redirect URI `https://shield-assurance-crm.vercel.app/api/gmail/callback` (replace the origin if the actual live CRM differs). Store its ID and secret as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel's secure production environment, and set `GMAIL_OAUTH_REDIRECT_URI` to that exact URI. Never paste the secret into chat.
4. Configure Team setup separately using the **Website-style Team access** instructions above. It does not depend on Gmail or Supabase SMTP.
5. Generate a private 32-byte encryption key locally. Set `GMAIL_TOKEN_KEY_VERSION=v1` and `GMAIL_TOKEN_KEYS` to a JSON object shaped as `{"v1":"<base64-encoded-32-byte-key>"}` in secure deployment settings. Do not use a placeholder key, commit it, log it, or replace it after mailbox connection without preserving the previous version in the keyring. A local generation command is `node -e "process.stdout.write(JSON.stringify({v1:require('node:crypto').randomBytes(32).toString('base64')}))"`; keep the output private.
6. Create a Pub/Sub topic. Grant `gmail-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher** role on that topic. Set `GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/<topic-id>`. Create an authenticated push subscription to `https://shield-assurance-crm.vercel.app/api/gmail/push`, using a dedicated service account. Set `GMAIL_PUBSUB_SERVICE_ACCOUNT` to that account's email and `GMAIL_PUBSUB_AUDIENCE` to the exact OIDC audience configured for the push subscription. Keep signed push verification enabled.
7. Provision the existing worker and Redis; Vercel alone does not run this worker. Configure `CRM_WEB_ORIGIN`, `CRON_SECRET`, `REDIS_HOST`, `REDIS_PORT` and both agent/Gmail flags consistently in the worker's secure environment. Verify reconciliation reaches `/api/gmail/sync/worker` and that expired authorization, failed sends and watch renewal are surfaced.
8. Before enabling `CRM_MULTI_AGENT_ENABLED=true` and `CRM_GMAIL_ENABLED=true` in production, verify installed agency/Gmail schema, map the existing owner's membership, assign existing records appropriately, and test cross-agent isolation with disposable accounts. The flags change access and sender behavior together; do not enable them merely to remove the Settings notice. Keep `CRM_GMAIL_AI_ENABLED` disabled unless separately approved.
9. In a coordinated validated deployment, connect the owner's mailbox under **My Account > My agent account & Gmail**, approve the displayed sharing consent, complete the sender profile and send a test only to a controlled address. Verify Sent history, incoming replies, reconciliation and no duplicate retry. Then use **Settings > Team > Invite agent**; each invited agent activates their account and independently connects their own mailbox. Gmail authorization is not consent for promotional campaigns, permission to spam, or a guarantee that unsolicited outreach is permitted.

## Instantly Cold Campaigns

The campaign workspace is deployed at `https://shield-assurance-crm.vercel.app/outreach/campaigns`
(deployment `dpl_5FXdk3344zhjQU4Y89txHjikTu6L`). The campaign and personal Gmail
migrations are installed. Validation passed 983 web tests, 49 rolled-back SQL
fixture suites, schema-enabled production builds, and four candidate/four
canonical browser checks. No campaign was activated and no email was sent.
At this release, production still lacks `INSTANTLY_API_KEY`,
`INSTANTLY_WEBHOOK_SECRET`, and `INSTANTLY_ALLOWED_SENDER_DOMAINS`.
These are provider configuration requirements, not unfinished campaign code.

Instantly is the isolated cold-campaign delivery lane. Resend remains for transactional/system email and its existing consent-gated CRM messages. Producer Gmail is for human-initiated one-to-one follow-up, not campaign sending. This integration does not decide whether a campaign is lawful; confirm applicable rules and provider terms before activating, and honor every refusal and unsubscribe.

1. Configure Instantly with dedicated campaign mailboxes on domains that are not the agency's primary producer-mail domain. Keep those mailboxes and DNS/reputation controls in Instantly; do not connect producer Gmail or route cold campaigns through Resend.
2. Set `INSTANTLY_API_KEY` and a private random `INSTANTLY_WEBHOOK_SECRET` of at least 32 characters in Vercel. Set `INSTANTLY_ALLOWED_SENDER_DOMAINS` to a comma-separated allowlist of the dedicated campaign-mailbox domains (domains only, no `@`). Keep `CRM_WEB_ORIGIN`, `EMAIL_UNSUBSCRIBE_SECRET` and the complete `EMAIL_POSTAL_ADDRESS` configured; the CRM adds a signed unsubscribe link and address to every first-touch message.
3. For a new environment, apply `supabase/migrations/20261106050000_instantly_campaigns.sql` and `supabase/migrations/20261106060000_manual_gmail_sender.sql` as part of the same coordinated deployment as the web release. These are already installed in production. They store reviewed campaign state, idempotent webhook receipts, warm-prospect follow-up actions and send-only Gmail connection metadata. They do not create, import or activate a campaign by themselves.
4. Ensure Vercel deployment protection allows Instantly to reach `https://shield-assurance-crm.vercel.app/api/instantly/webhook`. The endpoint accepts POST only and verifies the configured bearer secret. Campaign creation registers this webhook through the API. Do not copy the secret into the URL or into logs.
5. In **Communication > Instantly Campaigns**, select active, unlinked leads, generate grounded AI drafts and review/edit every subject and body. Sparse leads may fail the factual quality checks; add verified profile data instead of inventing claims. Set sender mailboxes only from the allowed domains and a conservative daily cap. Creating the campaign stages it paused; it does not send.
6. Confirm the campaign appears in Instantly with the expected sender mailboxes, schedule, content, footer and suppression behavior. Only then choose **Activate** in the CRM. Replies are recorded in the lead timeline and stop existing sequence follow-ups; only an explicit Instantly `lead_interested` event creates a warm-prospect notification/task. Unsubscribe actions are recorded in the CRM and added to Instantly's blocklist. Provider-acceptance uncertainty is surfaced; the CRM will not retry campaign setup or activation automatically.
7. Test only with authorized controlled addresses first. Verify reply ingestion, interest notification idempotency, unsubscribe confirmation and pause behavior. **Pause** stops an active campaign; **Resume** explicitly reactivates a paused campaign. Unconfirmed provider states cannot be resumed automatically; inspect Instantly first. A staged campaign is not evidence that a message was delivered; Instantly remains the sending system of record.

## Resend Activation

Resend handles system/transactional email and consent-gated CRM outreach. The application uses its official Node SDK; no legacy provider key or selector is needed. Sending remains disabled until verified. Local environment cleanup does not change secrets in an existing Vercel release. Never alter normal mailbox MX records to enable outbound email.

1. In Squarespace DNS, keep all five Google Workspace MX records on the root host `@`, plus Google's SPF/DKIM records. Verify the website still resolves. Do not replace root MX with Resend. Add only the DNS records Resend shows for `updates.shield-assurance.com`; do not activate while Resend reports sending as unverified. Keep the From address `camani@updates.shield-assurance.com`. For direct CRM replies, use Reply-To `replies@updates.shield-assurance.com` after verifying receiving on that subdomain.
2. In Resend **API Keys**, create two keys: (a) a sending-only key restricted to `updates.shield-assurance.com`, stored as `RESEND_API_KEY`; and (b) a key with permission to retrieve received email, stored as `RESEND_RECEIVING_API_KEY`. Configure sender/reply-to as above. Revoke and replace any keys that were ever committed, shared in chat, or exposed in an example file. Never paste secrets into chat or put them in the CRM permission form.
3. Keep `RESEND_SENDING_ENABLED=false` and `RESEND_REPLY_SYNC_READY=false` everywhere. The `.env.example` is only a template; it does not configure anything. For local web development, set values in the ignored `apps/web/.env.local`; the worker reads the root `.env`. For production, set values in Vercel's encrypted environment variables for the target environment and redeploy. If a separate worker is in use, configure its server environment too.
4. In Resend **Webhooks**, register `https://shield-assurance-crm.vercel.app/api/email/resend`, select `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`, `email.opened`, and `email.received`, then copy its signing secret to `RESEND_WEBHOOK_SECRET`. The endpoint verifies Svix signatures and recent timestamps. Ensure deployment protection allows Resend to reach this exact public endpoint while leaving signature verification enabled.
5. Set `RESEND_INBOUND_ADDRESS` to the verified Resend receiving address, matching `RESEND_REPLY_TO` for direct replies. The receiving MX may be used on the `updates` subdomain, but must not replace the five Google MX records at `@`. Forwarding is only needed if intentionally retaining a separate mailbox as Reply-To; preserve the original sender and avoid loops. The CRM retrieves content using `RESEND_RECEIVING_API_KEY`; inbound attachments remain in the receiving mailbox and are not imported.
6. Apply `20261104001000_resend_delivery.sql` only during the coordinated code release, after `node apps\web\scripts\phase123-db.cjs --dry-run 20261104001000_resend_delivery.sql` passes. It adds send/event/suppression tables, consent recording and stricter sequence claims. **Applying it changes promotional send eligibility even on the previous release**; do not apply it independently and leave old code running. The migration does not send mail or infer permission for imported contacts.
7. Configure `CRM_WEB_ORIGIN=https://shield-assurance-crm.vercel.app`, a stable random `EMAIL_UNSUBSCRIBE_SECRET` of at least 32 characters and your **complete real business mailing address** in `EMAIL_POSTAL_ADDRESS`. Keep the signing secret stable so existing unsubscribe links remain valid. Do not use the test addresses in fixtures. Resend promotional sends require an active record in `marketing_email_consents`; administrators record the evidence under Settings. Recording consent does not remove existing opt-outs or bounce/complaint blocks. Promotional sends through Resend must comply with [Resend's opt-in policy](https://resend.com/legal/acceptable-use); cold campaign setup belongs only in the Instantly section above.
8. Deploy a staged release with the new schema, confirm Settings configuration, and test delivery/bounce/complaint events and unsubscribe using authorized test recipients. GET unsubscribe pages are confirmation-only; signed POST handles the actual stop, including RFC 8058 one-click POSTs. Validate that retries do not duplicate sends and that delivery means mail-server acceptance, not proof someone read it.
9. Test a genuine reply: it must appear in the CRM, stop the sequence and create the expected alert only once. Received attachments stay in the receiving mailbox; the CRM adds a notice rather than silently pretending to import them. Complete the owner Settings reply test to persist current-configuration evidence, or set `RESEND_REPLY_SYNC_READY=true` only after independently verifying the same pipeline. Keep approval mode on. Missing reply readiness blocks Resend sequence sending.
10. After explicit activation approval, verified sending DNS, applied migration and successful end-to-end checks, set `RESEND_SENDING_ENABLED=true` consistently in web/worker and redeploy. The setup-test endpoint only sends a fixed test message to the signed-in user's own email address. Reconcile unresolved attempts from the previous provider before allowing queued retries. Remove obsolete provider secrets from hosted environments during this coordinated release, not while the previous production code still depends on them.

The client thread reads persisted Resend events inline; unlinked historical/uncertain sends remain accessible under **Other send receipts** in that same thread. Unknown outcomes stay uncertain; they are not reported as delivered or silently retried. Existing communication-log history is preserved, but the retired provider's activity API is no longer queried. The old unsigned `/api/messages/webhook` endpoint returns 410; use the signed receiver above.

Account authentication, domain/DNS verification, webhook registration and real sending require authorized Resend access. If account access is not available during implementation, complete those steps in the Resend dashboard; placeholder environment entries do not prove external setup. Keep existing mailbox delivery and forward replies only after verifying the receiving configuration.

## Build Notes

- The web app depends on `@prisma/client` and `pdf-parse` at build/runtime.
- The root install already runs Prisma client generation through the workspace postinstall step.
- For production uploads, keep PDF sizes modest enough for serverless request limits or move large file storage/extraction to object storage plus background jobs.

## Local Preview On Windows

Double-click `start-site.bat` to open the local CRM at `http://127.0.0.1:3000`.
If another site is using port 3000, the launcher uses `http://127.0.0.1:3010`
without stopping the other server. It opens the browser only when the CRM
login responds. Keep the launcher window open while it runs the server.
Otherwise it starts the web development server using isolated `.next-local` output so verification builds cannot overwrite its generated files; keep its window open while working locally. An occupied port without a responding CRM is reported explicitly, and existing servers are never stopped.