export const CRM_HELP = {
  settings: {
    title: 'Settings tools',
    answer: 'Use **Team** for invitations and access; **Email** to test agency delivery and replies; **Automation & Outreach** for rules, sequences, templates, sender details and runs; **Lead discovery** for research, targeting and approved sources; **Marketing permission** to record existing consent; **Integrations** to manage connections. Personal mailbox connections are in [My Account](/account). Settings changes still need their Save button.',
  },
  integrations: {
    title: 'Connections and setup',
    answer: 'Use **Manage Gmail** in [My Account](/account?tab=signature), **Manage email** in [Settings](/settings?tab=email), or **Open conversations** to test drafting. Personal Gmail is send-only unless shared CRM sync is explicitly authorized. AI use has a separate authorization. Agent profiles supply drafting style and identity; agency claims are administrator-managed. Profile edits do not rewrite existing drafts or approvals. A configured connection is not the same as a successful test. Deployment-only fixes require the project administrator; Rashi cannot install keys or change deployment settings. Never paste passwords or API keys into chat.',
  },
  email: {
    title: 'Email tests and replies',
    answer: 'In [Email settings](/settings?tab=email), use **Send test & verify replies**. Reply from your mailbox, then **Refresh status**. If forwarding is required, use **Copy address** and preserve the original sender. An unconfirmed send must not be sent again until checked. Domain verification, sending credentials and reply routing need administrator setup when unavailable. Open detection requires its own verification; it is not proof that someone read an email.',
  },
  research: {
    title: 'Business research',
    answer: 'In [Business research](/settings?tab=intelligence), enable sources and choose refresh timing and internal task limits, then save. **Retry source** or **Retry research** reruns a failed lookup; a failed lookup is not a confirmed empty history. DOT searches need the server FMCSA_WEBKEY; OSHA searches need DOL_API_KEY. Register through the official FMCSA or DOL developer sites and have the administrator configure keys in Vercel, not chat. Source permissions still apply. Research does not create consent or send outreach.',
  },
  targeting: {
    title: 'Targeting',
    answer: 'In [Targeting](/settings?tab=intelligence&tool=targeting), use comma-separated exact terms. Empty lists include all reviewed businesses; unknown facts stay unknown. Targeting is separate from carrier acceptance. Carrier comparisons use reviewed appetite guides and confirmed facts, not permission to contact.',
  },
  sources: {
    title: 'Source approvals',
    answer: 'In [Source approvals](/settings?tab=intelligence&tool=sources), record the source, permission reference and acquisition end date. Approve only rights that allow storage, agent display and AI processing of the business data; do not approve restricted or sensitive datasets. Source permission is not marketing consent. Pausing stops new acquisition and promotion; it does not erase retained data. Changed or revoked rights require a retention review. Free DOT and OSHA registration do not override source terms.',
  },
  automation: {
    title: 'Automation rules',
    answer: 'In [Automation](/settings?tab=automation), edit a rule and save. Pausing preserves existing work; resuming applies to future events and does not replay old requests. Website request banners remain visible if task creation is paused. Renewal timings use recorded policy dates, not unverified predictions. New enrollments use sequence defaults; existing sequences keep their steps. Imports and website submissions need separate enrollment. Changes to agency-wide notification controls require confirmation.',
  },
  workflows: {
    title: 'Custom workflows',
    answer: 'In [Custom rules](/settings?tab=automation&section=rules&rules=custom), conditions use comma-separated values. Empty conditions match any value; all populated conditions must match. Use {{name}} in task wording. Built-in and existing open work take priority; the earliest matching custom rule owns each task or sequence, while notes and notifications can coexist. Future events run automatically. Existing backlog requires Preview and an explicit queue action. Marketing permission and active membership remain required; generated drafts require approval.',
  },
  templates: {
    title: 'Templates and sender',
    answer: 'In [Sales templates](/settings?tab=automation&section=templates), owners and admins edit shared wording and use **Save template**. Preview with example facts before applying. Missing merge facts must be supplied in the composer; never invent them. Delivery appends the agent signature, so do not add one to template bodies. SMS preview is not a connected SMS delivery tool. The [Sender](/settings?tab=automation&section=sender) controls agency wording; personal sender details belong in My Account. Automatic windows and daily caps use agency local time; manual approval sends immediately.',
  },
  permissions: {
    title: 'Marketing permission',
    answer: 'Use [Marketing permission](/settings?tab=permissions) to record consent you already obtained, including its source. Unsubscribes and delivery blocks remain in effect. A public email, research result, uploaded document or connected mailbox does not grant consent. Human review is the default. Auto-send requires a purpose, eligible connected mailbox and recorded marketing consent. Replies and opt-outs stop sequences. Changed senders, assignments or recipients invalidate approval.',
  },
  team: {
    title: 'Team access',
    answer: 'In [Team](/settings?tab=team), invite a member or use the available role and activation controls. Review the access confirmation before inviting. If invitations are unavailable, the administrator must check invitation redirects, agent permissions and Gmail setup; then use **Check setup again**. Never share mailbox authorization. Account email approval controls remain separate from consent.',
  },
  workers_comp: {
    title: 'Workers comp documents',
    answer: 'Open **Workers’ comp** in a business profile. On a saved lead or account, use **Add document facts** for policies, experience mods, payroll summaries and loss runs. Reading runs on your device; only reviewed fields are stored. Use employer-level or redacted documents, not claimant or medical details. Possible, stale, future and conflicting facts are withheld from automatic matching. Missing losses are not zero, and policy expiration is not a confirmed renewal. Arizona’s linked public verification service restricts commercial use and prohibits automated retrieval; the CRM does not import it.',
  },
} as const;
export type CrmHelpTopic = keyof typeof CRM_HELP;
export const CRM_HELP_EVENT = 'crm:rashi-help';
export interface CrmHelpRequest { topic: CrmHelpTopic; detail?: string }
export function isCrmHelpRequest(value: unknown): value is CrmHelpRequest {
  return Boolean(value && typeof value === 'object' && 'topic' in value && typeof value.topic === 'string'
    && Object.hasOwn(CRM_HELP, value.topic) && (!('detail' in value) || value.detail === undefined
      || typeof value.detail === 'string' && value.detail.length <= 8000));
}
export function crmHelpAnswer(question: string): string | null {
  if (!/\b(how|where|why|help|explain|setup|configure|settings|crm|tool)\b/i.test(question)) return null;
  if (/\b(premium|underwriting|exclusion|eligibility|deductible|coverage limit|policy wording|claim denial)\b/i.test(question)) return null;
  const patterns: Array<[CrmHelpTopic, RegExp]> = [
    ['workers_comp', /(?:add|read|upload|save|correct|document|crm|tool|section|profile).*(?:workers.?\s*comp|loss runs?|experience mod)|(?:workers.?\s*comp|loss runs?|experience mod).*(?:document|crm|tool|section|profile)/i],
    ['sources', /source approvals?|acquisition|retained.rights/i],
    ['research', /business research|lead discovery|osha|dol_api_key|fmcsa|dot (?:search|lookup)/i],
    ['targeting', /targeting/i], ['workflows', /custom (?:rules?|workflows?)|backlog/i],
    ['templates', /(?:sales |email |sms )?templates?|sender profile|merge fields/i],
    ['permissions', /marketing (?:permission|consent)|auto.send|opt.out|unsubscribe/i],
    ['team', /team|invitations?|invite (?:a |an )?(?:member|agent)|member access/i],
    ['email', /agency email|email (?:setup|settings|test|replies)|reply routing|open detection/i],
    ['integrations', /integrations?|gmail|connections?|api key|deployment/i],
    ['automation', /automation|sequence defaults|renewal (?:timings?|milestones)|notification (?:settings|controls)/i],
    ['settings', /settings|crm tools/i],
  ];
  const topic = patterns.find(([, pattern]) => pattern.test(question))?.[0];
  return topic ? CRM_HELP[topic].answer : null;
}
