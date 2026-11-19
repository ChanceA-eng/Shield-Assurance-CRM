# Shield Assurance CRM: website audit and implementation plan

Date: November 2, 2026
Source baseline: `5343baf`  
Scope: website functionality, action wiring, record handoffs, automation, and product readiness.

## Current phase status

| Phase | Status | What remains |
|---|---|---|
| 1-3 | Implemented and substantially verified locally | Coordinated deployment, provider configuration, and operational acceptance remain. |
| 4 | Implementation and placement acceptance verified locally | Coordinated deployment and operational acceptance. |
| 5 | Lifecycle, ownership/documents, renewal outcomes and claim task links implemented and locally verified | Coordinated schema release and operational acceptance. Carrier/delivery evidence remains agent-reported. |
| 6 | Reporting, timezone behavior and source-level authorization review implemented and locally verified | Isolated dry-runs and coordinated application of pending reporting/timezone migrations; operational acceptance. |
| 7 | Course navigation/progress, assessment history, Rashi citations and optional source-date capture implemented and focused browser-verified locally | Isolated Prisma migration dry-run/release and privacy-safe learning context decision. |
| 8 | Dashboard responsiveness measured; stale local Next.js dev process refreshed after user authorization | Warm dashboard is responsive; database release gates remain for reporting, policy service requests, and certificates. |

These are implementation phases, not a claim that the CRM is complete. Local phase work is substantially implemented; schema release, broader Phase 7 browser coverage and operational acceptance remain.

### Phase 4 implementation and verification update

- Added carrier confirmation evidence: an uploaded account document or carrier reference, a nonfuture confirmation date, and explicit operator attestation. The server records the authenticated operator; evidence is not independent carrier verification.
- Added retained quote/policy document links with original filename snapshots, private downloads, and deletion safeguards. Recorded policy revisions cannot be removed through policy deletion or cascading account deletion.
- Added on-demand policy revision history, exact predecessor/successor navigation, renewal/rewrite handoffs, working rewrite/history pages, and paginated policy registers. A rewrite does not cancel the original term. CRM revisions are not a carrier transaction or accounting ledger.
- Quote preparation reuses existing record contacts, highlights missing information and links existing inventory. Carrier eligibility remains manual; account inventory is not an insured schedule.
- Applied only `20261102210000_policy_placement_workspace.sql` and `20261102230000_policy_record_retention.sql`, each after successful scoped transactional dry runs. Twelve SQL fixture suites passed for the retention migration; fixture data was rolled back and original account contact fingerprints remained unchanged.
- Live integration passed for evidence persistence, concurrent/retried placement, preserved quote and asset snapshots, exact-byte retained downloads, document attachment retry, revision cursor strings and rewrite lineage, including the extended retention/account-deletion scenario after the retention migration. Disposable account/lead/issuance records, private bytes and auth identity were cleaned up.
- Workspace strict types, 318 web unit tests plus one each in shared, API and worker, and a Vercel production build passed. All six placement and all three quote browser cases passed against the staged Vercel release.
- The previous agency/outreach syntax blocker was resolved by its owner. The staged-release browser run passed 40 of 41 cases, including all performance, workspace, Gmail and bulk-task UI checks. The added live bulk-task API check exposed a stale-batch conflict returning HTTP 500 instead of 409; this is being coordinated with that feature's owner before promotion.
- User previously authorized Vercel deployment after validation. Phase 5 lifecycle work is now implemented and locally verified; no Phase 5 deployment or migration apply has occurred.

### Loading performance release

- Replaced five repeated shell/badge requests with one authenticated database summary, preserving exact task counts, unread totals and reminder processing. Hidden tabs stop polling; realtime bursts and overlapping refreshes are coalesced.
- Explicit GET-only middleware delegation avoids verifying the same session twice only where the handler independently authenticates it. Writes and all other routes keep their middleware checks. All twelve delegated endpoint shapes rejected anonymous access with HTTP 401.
- Dashboard premium totals now use complete database aggregates rather than downloading every policy page. SQL fixtures verify 1,501-policy completeness, all twelve Arizona-relative months and service-role-only access. The scoped migration passed thirteen rollback fixture suites before application.
- Initial lead loading now issues one pipeline read and reuses the shell unread summary. All three loading browser cases passed against the production preview.
- Same-machine warm development API batch: 4,821 ms before, 1,322 ms after (about 73% faster). Production-preview optimized batch: 724 ms cold / 453 ms warm; warm shell 259 ms, home metrics 415 ms, account directory 452 ms. These are measured API timings, not guaranteed page-render times or production latency.
- Staged Vercel production release: authenticated shell/metrics/directory batch 653 ms first request / 430 ms warm. Login returned HTTP 200 and all twelve auth-delegated endpoint shapes still rejected missing application sessions with HTTP 401.
- Protected-deployment browser checks accept a local Playwright storage-state file through `PLAYWRIGHT_STORAGE_STATE`; keep that credential-bearing file outside the repository. This does not bypass application authentication.

### Lead archive, permanent delete and plain-language errors

- Deleting a lead previously failed whenever it had tasks, notes or files (almost every lead), and bulk delete hid the reason. Delete is now **Archive**: `archive_leads` atomically closes open lead tasks and their notifications, rejects drafts awaiting approval, dismisses unworked website requests and pauses email sequences. Archived leads drop out of lists, counts, dashboards, reports, duplicate checks, follow-up automation and arrival banners.
- **Restore** (`restore_leads`) reopens only tasks unchanged since archiving; email sequences stay paused until resumed. A new website submission from an archived lead restores it automatically.
- **Permanent delete** (`purge_leads`) only works on archived leads, from one row, a selection, or "Delete all archived permanently", and requires typing DELETE. It erases the lead with its tasks, reminders, calendar items, notifications, notes, files, messages, website requests, drafts, sequences and lead-only activity. Records shared with a linked client account and issued policies are kept with that account.
- All three run through `POST /api/leads/archive` (≤200 IDs per call; the page batches larger sets). Migrations `20261103030000_lead_archive.sql` and `20261103040000_lead_purge.sql` passed 18 rollback fixture suites before application.
- Raw database and provider errors are no longer shown to staff. API routes pass errors through `friendlyErrorMessage`/`databaseError` (technical detail is logged server-side), and screen messages such as "Failed to load claims." now say what happened and what to do next.
- Verification: 342 unit tests, strict types, production build, and 45 browser cases including the new archive/restore/permanent-delete flow.

## Executive conclusion

The CRM has a useful lead/account workspace foundation, but it is not yet a complete professional insurance agency management system. The main weakness is inconsistent handoffs: individual screens can save records while the associated task, document, notification, or lifecycle behaves differently elsewhere.

The next investment should be reliability and connected workflows, not additional menus or cosmetic expansion.

Recommended order:

1. Fix misleading saves, contact overwrites, unsafe merge handoffs, and competing automation.
2. Remove misleading navigation and unify existing task actions.
3. Build a deterministic agent work queue with ownership.
4. Connect lead qualification, quote preparation, binding, and policy history.
5. Finish account servicing and renewal workflows.
6. Correct reports and finish administration.
7. Improve knowledge/training independently; defer full accounting and rating.

No application code, environment settings, deployments, or customer records were changed for this audit.

## Method and confidence

- Inventoried all 127 page files: 42 outside Learning and 85 within Learning.
- Inventoried 110 API route files.
- Examined all 35 sidebar destinations, including Dashboard and duplicate/query-based destinations.
- Used a TypeScript syntax-tree scan across website TSX source: 317 native JSX button declarations. No obvious native button without a handler or submit-form context was found. This does **not** establish that a handler performs the right action.
- Checked literal internal JSX links against page/API route patterns. Found one unmatched destination: `/learning/module/12`. Computed links, redirects, query semantics, authorization, and runtime data are outside that check.
- Read action-bearing code and traced principal persistence paths through Next.js routes, automation helpers, and relevant database migrations.
- Re-ran `corepack pnpm --filter @crm/web test`: 7 test files, 69 tests passed.
- Existing browser tests cover selected workspace workflows using mocked API fixtures. They are not proof that all production screens or database side effects work.
- No authenticated browser click-through, provider delivery tests, database writes, or full production acceptance test was performed. This is a source-based audit, not a claim that every button was exercised live.
- Database behavior below is supported by checked-in migrations; the deployed schema was not re-inspected in this turn.
- This is not an exploit/security assessment or insurance compliance certification.

### Classification

- **Code-backed:** identifiable UI action and persistence/read path exist; runtime acceptance may still be needed.
- **Partial:** real functionality exists, but important handoffs or advertised behavior are incomplete.
- **Placeholder:** description/static empty-state only; not a usable module.
- **Redirect/mismatch:** route exists, but does not provide the feature its label promises.

## How the CRM is actually wired

```text
Website forms / imports / agent intake
  -> Next.js API routes
  -> Supabase leads + immutable intake events
  -> intake tasks + notifications + stacked arrival banners
  -> lead workspace
       -> explicit account linking
       -> shared notes, reminders, assets, record history

Accounts / policies / claims / endorsements / certificates / events
  -> Next.js API routes
  -> Supabase CRM tables
  -> newer shared-workspace functions AND older automation helpers

Email / text webhooks
  -> communication_log
  -> sender matching
  -> outreach reply handling
  -> message notification + reply task
  -> unread counts
  -> account/lead conversation views

Vercel daily cron
  -> scheduled-message processing
  -> website sync + outreach + renewal radar

Knowledge / Learning
  -> Next.js routes
  -> Prisma-backed models and knowledge services

Separate Nest API + BullMQ worker
  -> Prisma accounts / contacts / deals
  -> bound-deal and knowledge jobs
```

The main CRM UI predominantly uses relative `/api/...` Next.js handlers, not the separate Nest API. The Nest deal-bound worker must not be assumed to run when a Supabase lead becomes Won or a policy is added.

Evidence: [app shell](apps/web/src/components/layout/AppShell.tsx), [policy route](apps/web/src/app/api/policies/route.ts), [account linking](apps/web/src/app/api/leads/[id]/workspace/route.ts), [knowledge service](apps/web/src/lib/rashi-server.ts), [Nest deal service](apps/api/src/modules/deals/deals.service.ts), [worker](apps/worker/src/worker.ts), [cron configuration](vercel.json).

## Website and action inventory

### Agent-facing CRM

| Surface | Actions reviewed | Classification | Assessment / next step |
|---|---|---|---|
| Dashboard | KPI links, priority links, recent-record links, Tasks/Renewals links, premium chart | Partial | Real APIs and deterministic briefing; still fragmented priorities and inconsistent renewal/report definitions. Chart receives only the first 100 policies from the general policy list API. |
| Global header/sidebar | Navigation toggle, expandable groups, bell, mark read/all read, user menu, sign out, breadcrumbs | Code-backed / partial destinations | Controls have handlers. Several destinations are stubs, and notification fallback links can send servicing work to Leads rather than its account. |
| Website arrival banners | Open profile, dismiss, retry; newest-first stacked requests | Code-backed | Retains all unreviewed requests. Opening acknowledges arrival, not completion of the customer's work. Preserve this distinction. |
| Lead Pipeline | Board/list/queue views, search/sort, outcome filters, drag stage, lost reason, edit, bulk stage/delete/follow-up, new lead, duplicates | Partial | Real actions. Queue is lead-only and based on loaded leads and up to 200 tasks. Snooze still uses old local-time presets. Merge does not migrate every newer child record. |
| New Lead | Personal/commercial forms, duplicate lookup, smart prefill, multiple drivers/vehicles/properties, interview script, save | Code-backed / partial | Much stronger intake. Duplicate lookup scans leads/accounts in batches; creation uses multiple writes with compensating cleanup rather than a single transaction. Add retry/concurrency acceptance. |
| Lead workspace | Contact/premium save, notes/reminders/assets, history, account link/create, call/email links, messages, AI drafts/talking points, public-record enrichment, sequence enrollment | Partial | Shared record panels are valuable. Conversation loads on workspace mount and can mark messages read before the Conversation tab is viewed. Sending can automatically create a separate account. |
| Import Leads | Upload, mapping, parse/reparse, preview, include/exclude/edit rows, commit, batch history, repair | Code-backed | Retained lead-import workflow, not the retired Applicants import. Treat repair/commit as data-changing operations with staged acceptance tests. |
| Accounts directory | Search including policy number, lifecycle/renewal/overdue filters, paging, open, new/edit/remove, unread-message link | Code-backed / partial | Useful entry point. Assigned producer is displayed; ownership and task assignment are not yet a unified work-allocation system. Prefer archive over destructive Remove for business records. |
| Account workspace | Overview, policies, assets, notes, tasks, files, tags, history, insights, communication, templates, scheduling/edit/cancel, delivery audit | Partial | Strong shared notes/assets foundation. Policies tab is read-only. Local file selection does not upload file bytes. Messaging and delivery states need correction. |
| Legacy account resolver | Open workspace from `?lead=...` | Redirect/mismatch | Still attempts a stage update and assumes account ID is non-null. Can navigate an unlinked lead to `/clients/null`. Retire in favor of explicit linking. |
| Tasks | Open/completed, scopes, quick add, complete/reopen, priority, snooze presets/custom time, linked-record open | Partial | Lead/account opening works. Quick add has no account/lead picker. Non-lead/account task types cannot open their record. Custom snooze closes after a failed save because the update helper catches the failure. |
| Policies | List, new, edit, remove | Partial | Database-backed CRUD, not a complete placement workflow. Requires re-entry, has coarse LOB choices, and can overwrite account contact details. No dedicated policy detail/term/insured-schedule workflow. |
| Renewals | 30/60/90/overdue filters | Partial | Real data view, but no row link, review action, owner, remarket, confirm, or non-renew workflow. Status/date definitions disagree with the radar and Dashboard. |
| Claims | New/edit, open/in-review/closed filters, retained status history | Partial | Lifecycle and audit events are implemented locally, but the schema migration is pending coordinated release. Advanced backend fields lack corresponding form controls. Created tasks still use claim IDs instead of openable account targets. |
| Endorsements | New/edit/remove, policy selection | Partial | CRUD and creation automation exist, but not a structured carrier-confirmed change workflow. Open-only list; legacy tasks cannot open from Tasks. |
| Certificates | Request/review/issue/delivery-report lifecycle, private document attachment and history | Partial | Source is implemented locally; migrations are pending release. Issuance requires a stored private account document. Delivery is staff-reported; no provider-confirmed delivery or certificate generation is claimed. |
| Inbox | Search, open thread, open account/lead, send email | Partial | Groups by account only, skips lead-only messages, reads latest 1,000 logs, threads capped at 100. Some load/read failures become empty state or clear badges. Thread does not automatically refresh with conversation-list polling. |
| Outreach | Edit/approve/send/reject draft, pause/resume/cancel enrollment, settings, refresh, run engine | Code-backed / provider-dependent | Real orchestration. AI/email configuration and scheduled execution are separate dependencies; retain explicit approval and delivery status. |
| Scheduler | Calendar views, date/event click, add/edit, drag reschedule, task panel | Partial | Real events API. UTC/local conversions can shift dragged times, past events are excluded by default, task due time does not reliably follow event time/reschedule. |
| Events | New, status filters, complete/reopen, Scheduler link | Partial | Same event store as Scheduler but a separate UI. Relationship inputs and task linkage need consistent record pickers and sync. |
| Reports dashboard | Date/carrier filters, refresh, six report links | Partial | Real database queries, incorrect filtering and metric definitions. Not dependable decision support yet. |
| Six report detail types | Production, renewals, claims, endorsements, leads, carriers; range selection, back links | Partial | Recent-row samples rather than complete drilldowns; no export/paging, weak error handling. Renewal report is not an upcoming-renewal dataset. |

Evidence: [Dashboard](apps/web/src/app/page.tsx), [header](apps/web/src/components/layout/AppHeader.tsx), [banners](apps/web/src/components/layout/NewLeadBanner.tsx), [Leads](apps/web/src/app/leads/page.tsx), [new intake](apps/web/src/app/leads/NewLeadModal.tsx), [lead workspace](apps/web/src/app/leads/LeadWorkspace.tsx), [import](apps/web/src/app/leads/import/page.tsx), [Accounts](apps/web/src/app/clients/page.tsx), [account workspace](apps/web/src/app/clients/[clientId]/page.tsx), [legacy resolver](apps/web/src/app/clients/workspace/page.tsx), [Tasks](apps/web/src/app/tasks/page.tsx), [Policies](apps/web/src/app/policies/page.tsx), [Renewals](apps/web/src/app/renewals/page.tsx), [Claims](apps/web/src/app/claims/page.tsx), [Endorsements](apps/web/src/app/endorsements/page.tsx), [Certificates](apps/web/src/app/certificates/page.tsx), [Inbox](apps/web/src/app/communication/page.tsx), [Outreach](apps/web/src/app/outreach/page.tsx), [Scheduler](apps/web/src/app/scheduler/page.tsx), [Events](apps/web/src/app/events/page.tsx), [Reports](apps/web/src/app/reports/page.tsx), [report details](apps/web/src/app/reports/[reportSlug]/page.tsx).

### All 16 placeholder sidebar destinations

These should not be presented as completed features. Keep compatibility routes, but remove them from normal navigation or clearly label unavailable capabilities.

| Destination | Evidence |
|---|---|
| Policy Transactions | [Static page](apps/web/src/app/policies/transactions/page.tsx) |
| Policy Rewrites | [Static page; says create a request without a create action](apps/web/src/app/policies/rewrites/page.tsx) |
| ACORD Library | [Coming soon](apps/web/src/app/policies/acord/page.tsx) |
| Commission Statements | [Coming soon](apps/web/src/app/commissions/statements/page.tsx) |
| Service Team Rules | [Coming soon](apps/web/src/app/commissions/rules/page.tsx) |
| Manage Service Team | [Coming soon](apps/web/src/app/commissions/team/page.tsx) |
| Commission Reports | [Coming soon](apps/web/src/app/commissions/reports/page.tsx) |
| Billing | [Route-active placeholder](apps/web/src/app/billing/page.tsx) |
| Accounting Center | [Static billing/receivables cards](apps/web/src/app/accounting/page.tsx) |
| Favorite Reports | [Static empty state; no favorite action](apps/web/src/app/reports/favorites/page.tsx) |
| Scheduled Reports | [Static empty state; no scheduling action](apps/web/src/app/reports/scheduled/page.tsx) |
| Shared Reports | [Static empty state](apps/web/src/app/reports/shared/page.tsx) |
| Agency Settings | [Route-active placeholder](apps/web/src/app/settings/page.tsx) |
| Security and Access | [Static roles/MFA cards](apps/web/src/app/security/page.tsx) |
| Integrations | [Static marketplace cards](apps/web/src/app/marketplace/page.tsx) |
| Solution Center | [Static support cards](apps/web/src/app/support/page.tsx) |

Other navigation issues:

- Manage Carriers redirects to Knowledge Center; it does not manage carrier appointments/configuration: [carrier route](apps/web/src/app/carriers/page.tsx).
- Financial Reports and All Reports duplicate `/reports`: [registry](apps/web/src/config/navigation.ts).
- Sidebar active matching uses path prefixes, so query-specific Work Queue and Pipeline cannot be accurately distinguished, and nested report/lead links can overlap: [sidebar](apps/web/src/components/layout/AppSidebar.tsx).
- The [design instructions](.github/instructions/coreui-design.instructions.md) already require deduplicated navigation and real data.

### Knowledge, Training, login, and shared controls

| Surface | Classification | Actions / limitations |
|---|---|---|
| Knowledge Center `/rashi` | Code-backed | Asset/category filters, open document, manage knowledge. |
| Knowledge Manager | Code-backed / partial | Ingest text/files/links, scope tags, query, citations, document list. Requires separate Prisma/knowledge data verification. |
| Carrier/state/policy knowledge pages | Code-backed | Scoped chat and citations; not carrier administration or a rater. |
| Document viewer | Code-backed / partial | Source link/file attachment, quick analysis, reingest. Preserve source/date/provenance and explicit analysis failure. |
| Global Rashi widget | Code-backed / partial | Chat, analysis, alert/bundle tabs. Analysis is triggered when widget opens in a supported context; not needed for basic operational priority. |
| Learning Center | Partial | Course catalog, start/import course, resume, studio. Progress uses a browser learner key rather than a consistent authenticated-agent identity. |
| Course builder and module editor | Code-backed / partial | Course/module/lesson/block/quiz creation, editing, ordering, duplication/deletion, snapshots/restore. Several mutations do not validate HTTP success consistently. |
| Dynamic lesson player | Code-backed / partial | Lesson navigation, progress, quiz submission, simulations. Needs per-agent persistence and retry tests. |
| Static training module family (modules 1-11) | Partial / content | Separate static lessons/assessments/completion pages coexist with database lessons. Static assessment answers/results are React state, not durable learner progress. |
| Dynamic course overview | Partial | Ignores course content for rendering and always links to static contractor modules; Continue always opens module 1 lesson 1. |
| Module 11 completion | Broken link | Go to Module 12 points to a route that does not exist. |
| Login | Code-backed | Supabase password sign-in, validation/errors, safe redirect. Password recovery/account management are not exposed here. |
| Shared record panels | Code-backed | Notes, pin/edit, combined dated reminders, complete/reopen, multiple typed assets, archive/restore, provenance, history, explicit account linking. Retain and reuse rather than rebuild. |

Evidence: [knowledge components](apps/web/src/components/rashi), [knowledge service](apps/web/src/lib/rashi-server.ts), [Learning](apps/web/src/app/learning/page.tsx), [course builder](apps/web/src/app/learning/course-builder), [lesson player](apps/web/src/components/learning/LessonPlayer.tsx), [static assessment](apps/web/src/app/learning/module/1/assessment/page.tsx), [course overview](apps/web/src/app/learning/course/[id]/overview/page.tsx), [missing Module 12 link](apps/web/src/app/learning/module/11/complete/page.tsx), [login form](apps/web/src/app/login/login-form.tsx), [shared record panels](apps/web/src/components/crm).

## Prioritized findings

Priorities indicate product/data impact, not vulnerability severity.

| ID | Priority | Confirmed source behavior | Required correction |
|---|---|---|---|
| F01 | P0 | Account file input stores `local-upload://filename` and metadata, not bytes. Save File can appear successful without a retrievable document. | Real private storage upload/download with visible failure; label URL-only references separately. |
| F02 | P0 | Policy POST/PATCH copies policy name/contact fields into the account, including nulling omitted contact data; same-name automatic matching can choose the wrong identity. | Explicit account/lead IDs; preserve contact data unless deliberately edited; transactional placement. |
| F03 | P0 | Duplicate merge updates survivor/tasks/notes, then deletes absorbed leads, but does not repoint newer assets/intake/message relationships. Unlinked leads with assets are blocked by history protection after earlier writes have already occurred. | Transactional merge covering every child relationship, conflict review, no partial result or history loss. |
| F04 | P0 | Immediate SMS through communication-log is `logged_only`; UI can record "Sent outbound message." Scheduled SMS explicitly fails without a provider. Certificate/claim helpers also write delivery-shaped logs without actually sending SMS/holder documents. | Truthful queued/accepted/delivered/failed/log-only states; disable unavailable sends; adapter-backed delivery. |
| F05 | P1 | Policy creation still invokes the old renewal initializer: policy/renewal_pipeline tasks plus an approaching-renewal notification immediately. Radar separately creates marker-based account tasks within 45 days. | One renewal workflow per policy term; migrate old work with provenance; eliminate premature/duplicate alerts. |
| F06 | P1 | Tasks resolves names/opens only lead/client records; events, claims, endorsements, old policy/renewal_pipeline tasks have no usable record opener. | Canonical account target plus optional service/policy context; shared record-link resolver. |
| F07 | P1 | Leads snooze uses +4 hours/local tomorrow/+7 days; Tasks uses +3 hours/Arizona/next Monday/custom. Tasks closes custom picker even if PATCH fails. | One helper/control everywhere; preserve picker/value on error; optimistic version check. |
| F08 | P1 | Inbox omits null-client messages; lead workspace marks read on mount; failed thread requests can look empty and mark-read responses are not checked. | Include lead/unmatched conversations, read only when actually viewed successfully, retain previous data and show retry. |
| F09 | P1 | Renewal view is active-only/expiration-date; radar also includes issued/bound statuses with a renewal-date fallback; home count includes overdue active policies without a lower date bound. | Shared status/date/time definitions and identical named-window counts; directly actionable renewal rows. |
| F10 | P1 | Scheduled messages run once daily at 01:00 UTC (6 PM Arizona); chosen send time is eligibility, not exact dispatch. Event API defaults to today onward, uses date-only task due dates, and does not update task due time on event reschedule. | Durable due-time processing, Arizona time semantics, calendar range queries, bidirectional task/event synchronization. |
| F11 | P1 | Renewal/message task errors and legacy notification/audit writes can be swallowed or reported only as false/counts. These look like successful upstream work despite missing side effects. | Observable persisted job results, retries and failure UI; no invisible task/notification failure. |
| F12 | P1 | Reports echoes carrier filter but does not apply it; QTD/12m policy query uses year start; YTD total uses six-month trend data, clamped to current-year January. Details get latest eight records, not filtered complete datasets. | Correct metric contracts, filtered aggregate queries, paginated drilldown/export, cross-surface reconciliation tests. |
| F13 | P1 | Work Queue contains only loaded lead tasks, not account servicing/renewals/unworked intakes; task quick add cannot link a record. | Agency-wide actionable queue, explicit owner/record picker and reason, exact counts, paging. |
| F14 | P2 | 16 sidebar placeholders, carrier-label mismatch, duplicate report destination, prefix-based active state. | Smaller truthful navigation and compatibility redirects; no fake empty-state feature promises. |
| F15 | P2 | Legacy resolver can try `/clients/null`; dynamic course overview ignores its course; Module 12 missing; static progress differs from dynamic progress. | Retire legacy resolver, unify learning navigation/progress and fix dead link. |
| F16 | P2 | Claims/endorsements display open-only results; account policies are read-only; frontend forms expose fewer fields than backend APIs. Billing/change-request APIs have no corresponding working website module. | Finish record detail/history/closed views and connect selected backend capabilities intentionally. |

### Evidence anchors for higher-impact findings

- F01: [file selection and Save File](apps/web/src/app/clients/[clientId]/page.tsx#L1147), [create file record](apps/web/src/app/clients/[clientId]/page.tsx#L701), [metadata-only file API](apps/web/src/app/api/clients/[clientId]/files/route.ts#L41).
- F02: [account matching/contact update](apps/web/src/app/api/policies/route.ts#L207), [PATCH contact sync](apps/web/src/app/api/policies/route.ts#L374).
- F03: [merge writes/deletion](apps/web/src/app/api/leads/merge/route.ts#L198), [history protection](supabase/migrations/20261031110000_shared_account_workspace.sql#L566).
- F04: [email-only delivery and logged_only response](apps/web/src/app/api/communication-log/route.ts#L85), [UI sent activity](apps/web/src/app/clients/[clientId]/page.tsx#L646), [legacy SMS/certificate logging](apps/web/src/lib/automation.ts#L235), [scheduled SMS failure](apps/web/src/app/api/messages/process-scheduled/route.ts#L119).
- F05: [policy calls old renewal initializer](apps/web/src/app/api/policies/route.ts#L313), [old initializer](apps/web/src/lib/automation.ts#L156), [new radar](apps/web/src/lib/renewal-automation.ts#L86).
- F06/F07: [task record opening](apps/web/src/app/tasks/page.tsx#L192), [snooze editor save](apps/web/src/app/tasks/page.tsx#L146), [old queue snooze](apps/web/src/app/leads/page.tsx#L331), [shared snooze helper](apps/web/src/lib/task-snooze.ts).
- F08: [Inbox skips lead-only logs](apps/web/src/app/api/communication/inbox/route.ts#L43), [lead workspace conversation effect](apps/web/src/app/leads/LeadWorkspace.tsx#L956), [Inbox empty fallback](apps/web/src/app/communication/page.tsx#L98).
- F09: [renewals view](supabase/migrations/20260831100000_account_parity_foundation.sql#L125), [home metric](apps/web/src/app/api/metrics/home/route.ts#L39), [renewals API](apps/web/src/app/api/renewals/route.ts).
- F10/F11: [daily crons](vercel.json#L7), [event creation/status synchronization](apps/web/src/app/api/events/route.ts#L128), [calendar drag conversion](apps/web/src/app/scheduler/page.tsx#L183), [best-effort helpers](apps/web/src/lib/automation.ts#L49), [message alerts](apps/web/src/lib/message-alerts.ts#L123).
- F12: [report date/aggregate queries](apps/web/src/app/api/reports/route.ts#L91), [response metrics](apps/web/src/app/api/reports/route.ts#L253), [sample-only details](apps/web/src/app/reports/[reportSlug]/page.tsx#L74).
- F13-F16: [lead queue](apps/web/src/app/leads/page.tsx#L188), [registry](apps/web/src/config/navigation.ts), [legacy resolver](apps/web/src/app/clients/workspace/page.tsx#L24), [course overview](apps/web/src/app/learning/course/[id]/overview/page.tsx#L24), [billing API](apps/web/src/app/api/billing-records/route.ts), [policy-change API](apps/web/src/app/api/policy-change-requests/route.ts).

## Implementation roadmap

The original audit and roadmap below are retained as the baseline. The user subsequently authorized implementation of Phases 1-3 and applying pending shared migrations after a successful dry run; application deployment has not been authorized.

### Phase 1-3 implementation and verification

Phases 1-3 are implemented in the local application, with eight approved shared Supabase migrations through `20261102160000` applied after transactional dry-run verification. The user's later decision supersedes the original standalone Workday design: one Tasks register, internal automation and an uncluttered metrics dashboard. No application deployment or customer message was performed.

- **Phase 1:** private signed document upload/download and retry recovery; contact-safe policy issue/update and atomic merges; canonical term renewal tasks; exact service-record links; shared Arizona snooze with retained drafts; checked read acknowledgement; provider-event receipts, transactional alerts, serialized send claims and retryable acceptance bookkeeping. Uncertain delivery never becomes an automatic resend.
- **Phase 2:** truthful operational navigation, clear unavailable pages for unfinished modules, canonical account/lead destinations, unified calendar/list workflows and scoped service-context detail. Newest-first stacked submission banners remain intact.
- **Phase 3:** internal transactional source automation and safe scheduled reconciliation feed canonical Tasks and notifications. Inbound replies, open service requests and outreach approvals/issues use the existing task lifecycle, ownership and snooze, with exact action links. Retries preserve manual completion; changed events reopen work; source resolution completes it. Successful website conversion is not another intake chore, and historical imported messages are not replayed indiscriminately. Workday navigation, dashboard panels and global polling are removed; `/workday` redirects to Tasks. Automation health lives in Settings / Release & Setup.
- **Passed:** production build, strict TypeScript, 160 unit tests, all 34 migrations and seven reliability SQL suites in disposable PostgreSQL, including unmatched sender and linked-account reply consolidation. All 19 browser cases passed across the final run and targeted retries of two network-interrupted cases, covering ordinary automated tasks, assignment/snooze, exact source navigation, clean dashboard, complete inbox, banner ordering and existing workspace flows. The retained compatibility-view 18,000-item fixture returned the last 25 rows plus exact counts in 572 ms; this is not a production network SLA or a new visible Workday queue.
- **Real-service checks passed:** cross-session private upload, refresh, exact-byte download, anonymous denial, same-ticket retry, overlapping inbound receipt/reply/alert processing and policy issuance/renewal, immediate source-triggered service/outreach tasks and notifications, concurrent duplicate prevention, and automatic source-driven completion. Temporary QA records and bytes were removed. Original IDs and account contact data were preserved by the shared release.
- **Explicit operational boundaries:** provider DNS/webhook/secret configuration and controlled provider delivery testing are still required; no live email/SMS was sent for verification. Run history starts when this application version executes jobs; it does not invent earlier success. Identity-less email fingerprint fallback can collapse identical messages. Assignment is a shared label, not a new RBAC/user-directory system. My Work/team permission rules remain a later decision.
- **Still outside this implementation:** deployment, Phases 4-7, a carrier rater, binding/servicing confirmation, real accounting and deeper reporting. Phase 2's exact context viewer does not claim to implement Phase 4's full policy-term workspace.

### Bounded follow-on: dashboard data completeness

- Corrected the premium KPI's default Supabase row cap and the chart's latest-100-policy input. Both now use one complete server-side paginated calculation, advancing by actual returned row count even under a smaller server cap.
- Preserved total recorded written premium, rather than silently redefining it as current in-force premium. The chart uses policy effective dates for twelve Arizona calendar months (current plus eleven preceding); out-of-period policy premiums remain in the all-time total only.
- Aligned the 30-day renewal KPI with the canonical renewal list bucket; overdue policies no longer inflate that KPI.
- Failed policy pages and invalid premiums return explicit errors rather than partial/zero success. No new dashboard panels, migration, deployment or customer messaging.
- Verified exact output with 1,501 policies, smaller server page caps, empty policies, Arizona month boundary, out-of-period policies and failed later page. All **167 web unit tests**, strict TypeScript, production build and the focused browser/live-authenticated metric-versus-renewal check passed.
- This is an early Phase 6 report-query correction, not completion of expanded reporting or Phase 4 placement.

### Phase 1: make existing actions trustworthy

Addresses F01-F08, F11 and the legacy resolver in F15.

- Implement real account document storage, upload progress, private download, explicit references, and retention metadata.
- Stop policy edits from overwriting account contact details. Use explicit record IDs and duplicate/conflict review.
- Make merge atomic; migrate assets, notes, tasks, intake events and communication/outreach references; preserve source payload history and handle conflicting account links.
- Separate delivery state from log creation. Until provider support exists, make unavailable SMS actions visibly unavailable instead of "sent."
- Replace old renewal initialization with the canonical term-based radar/workflow. Reconcile existing tasks without deleting user-created work.
- Resolve every service task to an account/lead and its context.
- Unify snooze everywhere; preserve failed drafts. Make message read acknowledgement explicit and checked.
- Show task/notification/job failures and allow safe retry; make duplicate prevention database-backed where concurrency is possible.

Acceptance:

1. Upload a PDF/image in an isolated test environment, refresh, download it from another session, and compare bytes; upload failure creates no fake uploaded record.
2. Edit only a policy premium/date: account name, email, phone and address remain unchanged.
3. Merge two leads containing assets, intake history, notes, reminders and messages: all relationships/history survive; forced failure leaves the original records unchanged.
4. One policy term produces one canonical renewal work item under repeat and overlapping runs.
5. Every generated task opens the intended account and service context, including completed tasks.
6. Leads, Tasks and profile snooze have identical presets/Arizona conversion; a failed save retains the user's chosen time.
7. Opening Overview does not mark a conversation read. Viewing a failed thread does not clear badges.
8. A provider-disabled SMS cannot create a "sent" activity. Provider acceptance is not represented as delivery.

### Phase 2: simplify the website and finish existing navigation

Depends on Phase 1's record/action contracts.

- Keep Dashboard, Work Queue/Tasks, Leads, Accounts, Policies/Renewals, Communication and usable Reports as the operational spine.
- Move unfinished accounting/commission/report variants out of normal navigation. Preserve routes with clear unavailable explanations.
- Rename Knowledge/Carriers correctly; expose actual carrier administration only when implemented.
- Use query-aware active navigation and remove duplicate report destinations.
- Consolidate Scheduler and Events as calendar/list views over the same workflow.
- Make account/policy/service rows directly open their detail/action surface.
- Add accessible form labels, focus handling, mobile overflow and explicit loading/error/empty states to retained workflows.
- Preserve the requested newest-first stacked banners; do not collapse or cap them without a separate UX decision.

Acceptance: every visible navigation item has a useful destination; every action has an explicit result/error; browser back/deep links preserve intended view; no duplicate active items; desktop/mobile keyboard flows work.

### Phase 3: internal automation feeding Tasks (supersedes standalone Workday)

Depends on Phase 1 and reuses Phase 2's action components.

Use the existing canonical Tasks register, not a separate action desk or source panel, for:

- Actual first-contact follow-ups from website lead intake; do not duplicate successfully converted submissions with another intake-response task.
- Overdue follow-ups and due reminders.
- Unanswered inbound conversations, independent of read/unread state.
- Renewal work and outstanding claims/change/certificate requests.
- Outreach approvals and delivery failures when relevant.

Source changes transactionally synchronize one managed ordinary task and its notification. Rows retain account/lead, action category, due time, owner and exact source destination. Reconciliation preserves snooze and manual completion for unchanged events; new events/reopened sources can reopen work. Source resolution is distinct from manually completing a follow-up.

- Add record picker to quick task creation and explicit assign/reassign controls.
- Show My Work/Unassigned/Team scope only after ownership rules are agreed.
- Keep the dashboard focused on its primary metrics, premium chart and renewal table; remove added action tiles, task lists and briefing/activity prose.
- Use canonical due-task counts for sidebar Tasks and profile task lists; unread message counts remain distinct.
- Show last successful intake/automation run and explicit partial-failure status only in Settings / Release & Setup.
- Keep urgency deterministic; AI remains optional for drafting/underwriting.

Acceptance:

- Queue includes all relevant records across pages, not just a latest-200 sample.
- Read/dismiss/open/complete are separate operations with clear meanings.
- Reading a message does not resolve a reply; accepted outbound replies and closed source records resolve their ordinary tasks.
- Successful website conversion is not presented as unresolved intake work.
- Task and notification counts reflect the same canonical records, with due-task and unread definitions clearly distinguished.
- Completing/reopening/reassigning is reflected across surfaces without duplicates.
- Query-based pagination and filtering meet an agreed representative-volume performance budget; set the budget before implementation.

**Loading improvement implemented locally:** account core renders before saved-work requests finish. Complete conversation/delivery history is deferred until Communication or Insights is opened; hidden Quotes/Assets load on first visit and retain drafts. Core-mode API explicitly omits redundant legacy sections while retaining default compatibility, and linked leads now load in parallel. Login skips notification networking; overlapping refreshes are coalesced. Summary/risk actions wait for complete history and expose load failures rather than treating missing history as empty.

**Verified:** all 192 unit tests and all 24 browser cases passed, with a targeted blocked-request test proving notes/history cannot block the account heading or trigger hidden-panel fetching. Production build/strict types and live disposable-record integration passed, including the core omission contract and existing default workspace contract. Remote API timing varied between samples; no global latency target or bundle-size reduction is claimed. No migration, deployment or provider send.

### Phase 4: connect lead-to-policy placement

Depends on stable account identity, documents and ownership from Phases 1-3.

**First slice implemented locally:** Record policy from an account or active linked lead opens the existing issuance form with exact identity and saved contact prefill. The authenticated prefill endpoint rejects missing, mismatched and terminal leads; account-only placement chooses no lead. Carrier/premium/policy-number/term dates are not guessed. UI and policy POST require explicit operator confirmation of carrier binding/issuance (attestation, not carrier proof or a bind API). Existing atomic issuance, account-contact safety and same-ID failed-save retry remain intact. Confirmed policy entry is not a saved quote-options workflow.

**Verified:** 173 unit tests, the complete 21-case browser run, strict types, production build and live disposable-record authenticated prefill/confirmation rejection. Failed unconfirmed issuance left the lead and policy count unchanged. No new migration, deployment or provider send. The remaining quote preparation/options, confirmation evidence, insured asset schedules and policy-term detail workspace below are not yet implemented by this slice.

**Next slice implemented locally: manual quote options.** Accounts and lead workspaces share an account-owned Quotes section with multiple options: carrier, line of business, premium, optional effective/expiration dates, limits, deductibles, notes and Draft/Presented/Accepted/Declined outcomes. Lead-side saves require an explicit account link. Accepted is not bound coverage and does not create policies or change pipeline status. Same-ID creation retries, version-checked edits, retained failed/tab-switch drafts and transactional database change snapshots are wired. Quote source-lead provenance survives lead deletion/merge while its live lead link may be cleared; the canonical account retains the option.

**Verified:** migration `20261102170000` passed transactional dry run and SQL assertions before approved shared application. Live disposable-record checks verified cross-session account visibility, repeat-safe creation, accepted history, stale-version conflict and unchanged policy/lead state; all fixture records were removed. All 186 web unit tests, the full 22-case browser suite, production build and strict types passed. No deployment or provider send. Still remaining: quote documents/history viewer, insured-asset schedules, explicit quote-to-confirmed-policy linkage and policy-term workspace. This does not claim an automated rater.

**Selected quote placement implemented:** accepted quotes now open confirmed policy recording with account-scoped carrier/premium/line/term prefill and a last-loaded quote version. Confirmation remains unchecked; no quote status invokes binding or policy creation by itself. The atomic quote issuance wrapper reuses existing issuance/contact/lead safety, serializes request and quote access, rejects stale/nonaccepted/cross-account sources, enforces one policy per quote and stores the placement-time quote snapshot. Repeat issuance after later quote edits returns the same policy and original snapshot. Account Policies and exact policy context expose the snapshot as historical quoted terms, not a confirmed coverage schedule. Account-only placement does not complete the quote's source lead.

**Verified:** migration `20261102173000` passed dry-run and rollback tests (wrong account, stale version, uniqueness rollback, snapshot preservation and retry) before approved shared application. Live concurrent confirmed placements and retry after a later quote revision passed with one linked policy; fixture records were removed without provider sends. A saved quote history viewer exposes immutable revisions on demand in account and lead workspaces, with account-scoped authorization, lossless cursor pagination, visible errors/retry and preserved edit drafts; route/unit/live checks and all three quote browser cases pass. A focused policy-term view presents real term dates, renewal date, premium, billing and status, and navigates to a predecessor only after same-account verification. Its renewal handoff verifies the source term against the selected account, carries forward identity/carrier/line/premium as reviewable suggestions, leaves the new policy number and dates blank, requires the existing carrier-confirmation step, and records the predecessor on the new term. It does not bind or guarantee a renewal. **Verified:** 203 web unit tests, strict types, production build, all 27 browser cases plus the focused renewal browser case, live disposable-record integration, and whitespace checks passed. Remaining: confirmation evidence, insured-asset schedules, quote documents, and a complete policy transaction/renewal/rewrite workspace. These changes remain local and are not deployed.

**Insured-asset schedules implemented:** policy issuance now accepts an explicit selection of active assets belonging to the selected account, and records immutable placement-time snapshots transactionally with ordinary or quote-linked issuance. Exact request retries preserve the same policy/schedule; changed selections under a reused request ID, archived assets, and cross-account assets are rejected. Account inventory remains separate, and the policy view labels the schedule as CRM recordkeeping rather than carrier proof. The choices API paginates instead of silently truncating large inventories.

**Verified:** migration `20261102180000_policy_insured_asset_schedule.sql` passed a scoped dry run and SQL fixture checks, then was applied without applying the separate pending outreach-marketing migration. Live checks verified selection, retry, and snapshot immutability. All 232 web unit tests and the four targeted policy handoff, quote-placement, and renewal browser cases passed; web strict TypeScript and production build passed. The recursive CI typecheck failure was fixed with NodeNext-compatible `.js` shared exports, and Next.js webpack now resolves those specifiers to TypeScript sources. A full live release-integration run has not yet completed end-to-end. No deployment or provider send occurred.

```text
Lead
  -> qualification / missing information
  -> quote preparation / carrier options
  -> quote presented
  -> bind confirmed
  -> policy term on the existing account
```

- Start quote preparation from the actual lead/account, with reusable contacts/assets and required-information checks.
- Keep manual carrier quote records first; do not invent an automated rater or guaranteed eligibility.
- Record options, premium, limits/deductibles, documents, dates, owner, presented/accepted/declined outcomes.
- Binding requires explicit carrier confirmation and policy details, not merely dragging a lead to Won.
- Preserve notes, messages, documents, intake history and asset IDs; explicitly select insured assets for each policy term.
- Create a policy detail workspace with term history, renew/rewrite links, servicing context and documents.
- Choose the authoritative CRM model/event path before connecting the separate Nest deal-bound worker; avoid duplicate welcome automation.

Acceptance: prepare and bind a quote without retyping the person/business; exactly one account/policy relationship; no guessed identity matching; retry-safe binding; all history retained; inventory clearly distinct from confirmed insured schedule.

### Phase 5: account servicing and renewals

Depends on policy term/context from Phase 4; basic task/link repairs happen in Phase 1, not here.

- **Policy service-request slice implemented locally:** the existing policy-change request record now supports typed service requests, requested effective dates, submitted/waiting/confirmed/closed/cancelled/reopened states, agent-reported carrier confirmation date/reference, optimistic version checks, and append-only change history. Request changes synchronize a linked task through the existing service automation settings; the task opens the account’s servicing tab. Existing claim, endorsement and certificate task templates and pause gates remain unchanged. Legacy `processed` records remain explicitly legacy and are not rewritten as carrier-confirmed.
- **Claims history slice implemented locally:** claims now carry optimistic versions and append-only status/detail events; the Claims page can filter open/in-review/closed/all records, inspect the timeline, and close without deleting history. Claim edits are actor-attributed, stale writes conflict, and invalid reserve/payout amounts are rejected.
- **Certificate lifecycle slice implemented locally:** new records are requests (not issued certificates); review, issuance and delivery-report states are versioned and audited. Issuance requires an uploaded private account file; delivery needs a method and is explicitly agent-reported. Certificate tasks remain active until delivery is reported, and request creation no longer sends an email claiming issuance.
- **Renewal review slice implemented locally:** reviews are keyed to the active policy term, support owner/follow-up/outcome history, enforce linked same-account next-term lineage for a renewed result, and synchronize the canonical renewal task. The renewals view replacement preserves its existing column order rather than relying on `p.*`.
- **Service-request ownership/documents implemented locally:** active agency owners can be assigned at creation or update, ownership is included in append-only change snapshots and the follow-up task, and verified private account files can be linked/downloaded with immutable request links and file snapshots. Cross-account, external-link, and non-stored files are rejected.
- **Claim task links:** the claim lifecycle SQL fixture now asserts that follow-up opens the exact claim; task-link unit and browser coverage exercise the account context. Service-request follow-ups also hydrate the account and open the exact request.
- **Verified:** migrations `20261105240000_policy_service_request_lifecycle.sql`, `20261105250000_certificate_service_lifecycle.sql`, `20261105260000_renewal_review_lifecycle.sql`, and `20261105270000_service_request_ownership_documents.sql` passed the scoped transactional dry run with all registered SQL fixtures, including claim, certificate, renewal, ownership, file-scope and task-link assertions. Twelve targeted lifecycle/task-link unit tests, strict web TypeScript, and authenticated mock browser flows for service-request owner/documents/status, claim history, and renewal owner/outcome/linkage/history passed. The Phase 5 migrations remain unapplied pending a coordinated code/schema release; no deployment or customer-facing carrier action occurred.
- **Phase 5 implementation is complete locally.** Carrier and delivery reports remain agent-reported evidence only; they are not independently verified. Coordinated release is still required before these schema-dependent routes can run against the production database.

- Reuse the existing policy-change-request API/model where suitable.
- Structured request types: address/name change, vehicle/property addition/removal, endorsement, certificate, cancellation and rewrite.
- Capture requested change, requested effective date, owner, carrier submission, confirmation, documents and status history.
- Suggested lifecycle: Draft -> Submitted -> Waiting on carrier/client -> Confirmed -> Closed, with Cancelled/Reopened where appropriate.
- Separate reported profile/inventory updates from carrier-confirmed coverage changes.
- Claims: adjuster/contact/claim number, follow-up, open/closed history.
- Certificates: review and issue only after an uploaded private document is attached; retain a delivery report without calling it provider-verified or automatically sending the holder.
- Renewals: review/remarket/retain/non-renew action, linked next policy term, cancellation/expiration handling, stale-task reconciliation after date/status changes.
- Client-facing messages remain intentional and consent-aware.

Acceptance: each request produces one owned, openable work item and a durable timeline; status changes update that work; a closed/cancelled item remains reviewable; asset edit does not silently change insured coverage; renewal outcome creates/links the right term.

### Phase 6: trustworthy reports and administration

Can begin report-query corrections from F12 after Phase 1; expanded lifecycle metrics depend on Phases 3-5.

- **Reporting accuracy and complete detail slice implemented locally:** reporting periods validate MTD, QTD, YTD and rolling 12 months; the database aggregate applies carrier/date filters consistently and the API no longer derives totals from capped client-side samples. Report detail endpoints provide stable 25-row pagination, exact filtered counts, linked policy/claim/endorsement/lead records, and full filtered CSV export. Upcoming renewals are explicitly the next 90 days rather than a sample of recent policies. CSV formula-leading values are neutralized.
- **Access and integration status:** agency-wide report APIs require an active owner or admin; agents cannot fetch team-wide report data. The owner-only Integrations tab reports database, Resend, per-agent Gmail and OpenAI configuration/health without returning credentials. Existing Team settings handle invitations/roles, and producer assignment is restricted to active owners/admins by the assignment RPC. The final source-level review confirmed owner-only team administration, active-member checks, and active owner/admin assignment checks; the timezone endpoint now also rejects inactive members before reading agency settings.
- **Verified:** strict web TypeScript and 20 focused report, integration and role tests passed. The reporting migration `20261105280000_reporting_summary.sql` and registered SQL fixture passed the scoped transactional dry run; all fixture writes and migration changes were rolled back. Two authenticated browser tests passed for report pagination/navigation/filter/export and owner integration status. The migration remains unapplied and the schema guard requires it before a release build can consume the reporting RPC.
- **Timezone implementation update:** agency timezone is owner-configurable and validated; DST-aware boundaries drive outreach eligibility/caps, task due-today filters and briefing counts, renewal radar dates, report ranges, calendar appointment/task synchronization, task entry/display, and snooze behavior. Browser, route, helper and API tests cover owner save/reload, DST boundaries, and agency-local appointments.
- **Authorization review verified:** timezone settings, agency settings, team management, assignment, and agency-wide reports now have explicit active-member/role checks; the database assignment RPC independently enforces active owner/admin actors and active targets. Focused timezone and authorization regressions pass. This closes the Phase 6 source review, but does not replace the required isolated migration dry-run.
- **Schema/release gate:** `20261105290000_agency_time_zone.sql` and `20261106000000_agency_calendar_time_zone.sql`, with their rollback fixtures, remain unapplied and have not been dry-run against a confirmed isolated database. Do not release code that reads the new column until both migrations pass the coordinated schema gate.
- Report scheduling/sharing remains deferred until the report and delivery flows are reliable.
- Define written premium versus current in-force premium, conversion, response time, retention, overdue work and renewal windows.
- Correct MTD/QTD/YTD/rolling-12-month and carrier filtering.
- Full paginated drilldowns, record links and export; reconcile aggregates rather than calculating from capped list data.
- Real agency settings, timezone/business hours, producer assignment and user administration.
- Integration status page shows configured/missing/healthy/failed without exposing keys.
- Team/role permissions are enforced and covered by dedicated authorization tests; do not enable team-wide features before the coordinated migration/schema release.
- Favorite reports first; scheduling/sharing only after reports and delivery jobs are reliable.

Acceptance: known seeded data yields exact totals for each date/carrier/status combination; missing/failing integrations are explicit; owner/role rules pass dedicated authorization tests; no fake zero counts.

### Phase 7: knowledge and training consistency

Independent of core CRM placement/servicing; lower operational priority.

- Keep Knowledge Center distinct from carrier management.
- Use the actual course ID/modules for overview/Continue.
- Replace missing Module 12 link and reconcile static/dynamic course routes.
- Tie durable progress to the authenticated agent, not device-specific/shared fallback keys.
- Check every builder mutation before claiming success; preserve drafts and snapshot restore failures. Course/module/lesson/quiz/block mutations now check HTTP success, show actionable status, and retain editor drafts on failures. Course creation has a regression test for failure retention and successful reload.
- Static Modules 1–11 now save authenticated practice-attempt history and display the latest result after reload. Results are explicitly practice scores calculated in the browser, not independently verified credentials. Prisma migration `20261105190000_learning_assessment_attempts` is added and validated locally but remains unapplied.
- Learning Rashi now requires an authenticated learner; answers retain retrieved citations and the Rashi widget displays source titles, safe external links, carrier/state/line context, and library update dates. Rashi answers continue to state uncertainty when indexed evidence cannot verify a criterion.
- Knowledge documents can record an optional reported publication date; ingestion validates real calendar dates and citation views distinguish that agent-entered date from the library record update timestamp. The assistant is instructed not to treat the latter as proof of source currency. Missing dates remain explicit, never inferred. Prisma migration `20261106100000_knowledge_source_publication_date` is pending isolated dry-run and release.
- Snapshot restoration now performs course/module/lesson/quiz/block replacement inside one Prisma transaction; two route tests cover successful nested restore and surfaced nested-write failure.
- Verified this continuation: all 853 web unit tests passed across 80 files; all five Learning browser flows passed; strict web/API TypeScript and Prisma schema validation passed. Prisma client generation emitted updated types but hit a Windows file-lock error while renaming its query-engine DLL; do not restart the user's existing server to retry.
- Learning browser verification now passes all five focused flows: dynamic course resume, no dead Module 12 link, course builder failed-save draft preservation, failed/successful snapshot restore, and static assessment retry/reload history. The local shared fixture setup can exceed the default 45-second per-test timeout; the focused suite passed with a bounded 120-second timeout. The long-lived server remains untouched.
- Remaining: profile-specific learning context needs a trusted source model and privacy decision; do not add personal context to learning assistant requests without a clear, consented purpose.

Acceptance: correct course opens; Continue resumes the correct lesson; progress survives another device/session; dynamic and static assessment results persist; AI actions disclose dependency/cost and never stand in for deterministic work prioritization.

### Phase 8: local development responsiveness

The earlier loading-performance release improved shared API round trips and selected production paths. This phase is specifically for the user's reported slow local experience; distinguish cold Next.js compilation, warm route rendering, and API latency instead of treating them as one number.

- Defer nonessential dashboard chart code and let metrics render independently of the renewals request.
- Capture cold and warm navigation/heading timings and initial API durations for representative routes; keep performance checks deterministic and report the measurements they actually collect.
- Inspect local server memory and generated build-cache ownership before any restart or cleanup. Never stop an existing server or delete shared `.next*` outputs as an implicit optimization.
- Prefer route-level/code-loading changes with measurable first-content benefit; preserve authenticated first paint and real API/error states.
- The long-lived dev process had grown to about 2.96 GB working set while Windows had about 483 MB free. With explicit user authorization, only that Next.js process was restarted; build caches and files were not cleared. After the cold dashboard compile (17.4 seconds), a warm dashboard reload reached DOMContentLoaded in 0.77 seconds and the full dashboard state in 2.37 seconds; the process used about 356 MB and free memory rose to about 1.8 GB. These local measurements are not production SLAs.
- The dashboard renewal 500 was traced to selecting the not-yet-installed `renewals.renewal_on` view column. The API now derives the same term from `renewal_date` or `expiration_date`, keeps the 250-row bound and chronological ordering, and returns HTTP 200 against the current schema. No visual changes were made.
- The read-only schema check still reports missing `crm_reporting_summary`, policy-change-request fields and certificate lifecycle fields (migrations `20261105280000`, `20261105240000`, and `20261105250000`). These require the existing isolated dry-run and coordinated schema release; none was applied here.

Acceptance: dashboard metrics are visible without waiting for the renewals table; representative cold/warm local timings identify whether remaining delay is compilation, API or rendering; no user server, shared cache or credentials are disturbed.

### Deferred: accounting, commission reconciliation, licensed forms and rating

Do not build these merely to fill menus.

- Decide agency-bill versus direct-bill responsibilities, commission basis and statement reconciliation before expanding the existing billing-record API.
- ACORD/form capabilities require appropriate licensed access; do not fabricate a form library.
- Carrier rating/submission integrations require carrier/vendor arrangements, validated contracts and adapter boundaries.
- Full automated outbound/inbound messaging depends on the provider setup the user has deferred.
- These should not block internal documents, queues, identity safety, placement tracking or service requests.

## Engineering boundaries and release gates

- Web/UI and present Next.js adapters remain in `apps/web`.
- If adding durable API orchestration, use modular services in `apps/api`; jobs belong in `apps/worker`; shared event/contracts belong in `packages/shared`.
- Do not simultaneously rewrite the working Supabase CRM and route everything through the separate Prisma/Nest model. First define authoritative IDs/models and migrate deliberately if necessary.
- Keep strict TypeScript, native Tailwind/CoreUI conventions and existing shared workspace components.
- External integrations stay behind adapters. Record provider IDs, job states, failure reasons and retry behavior.
- Prefer transactional/idempotent domain operations over several UI-triggered independent writes.
- Preserve existing confirmed customer fields, source submission history, user notes/reminders and the stacked-banner behavior.
- Keep compatibility routes when retiring pages. Do not delete live records as navigation cleanup.

For each phase:

1. Write focused failing tests for its actual bug/acceptance criterion.
2. Implement one bounded workflow, not another disconnected screen.
3. Run affected unit/route tests and strict typecheck.
4. Run browser flows with isolated fixtures; cover success, failure, refresh, undo/reopen and mobile.
5. Run database integration tests only against an isolated disposable database.
6. Verify provider jobs with controlled test recipients/configuration, not customer data.
7. Deploy only after explicit authorization and verify the release against the correct commit.

Current tests establish a useful baseline, but are concentrated around shared workspace/intake/helpers. Add coverage for policy contact preservation, merges, document bytes, legacy/new renewal reconciliation, service task links, event timing, SMS delivery states, report filtering and navigation.

## Decisions needed before later phases

- Team workflow: single-agent now or My Work/Unassigned/Team with reassignment?
- Quote handling: manual carrier options first, which lines/carriers, and what confirms binding?
- What can an agent change directly versus what requires carrier confirmation?
- Message dispatch latency/business hours and whether outbound actions require approval?
- Accounting responsibility: actual invoicing/collections or commission tracking only?

These decisions do not block the first reliability phase. Do not implement a full rater, accounting system, or new business behavior based on assumptions.

## Recommended first implementation batch

Start with **Phase 1**, broken into independently verifiable slices:

1. Policy/account identity safety and real document storage.
2. Transactional merge and history preservation.
3. Canonical renewal tasks, record links and unified snooze.
4. Truthful message delivery and read state.

Then simplify navigation and build the shared work queue. This delivers more practical value than exposing another dozen incomplete modules.
