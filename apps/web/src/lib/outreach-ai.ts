/**
 * Outreach AI: drafts personalized producer outreach grounded in a lead's
 * structured insurance profile, and generates pre-call talking points.
 * Grounding payloads are built strictly from stored data; the model is
 * instructed to cite which signals it used so output can be verified.
 */

export interface OutreachDraft {
  subject: string;
  body: string;
  cited_signals: string[];
}

export interface TalkingPoints {
  points: string[];
  cited_signals: string[];
}

interface LeadLike {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  line_of_business?: string | null;
  source?: string | null;
  status?: string | null;
  form_payload?: Record<string, unknown> | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function section(label: string, value: string | null | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

/** Flattens the structured profile into a factual grounding block for the model. */
export function buildGrounding(lead: LeadLike): string {
  const profile = (lead.form_payload?.profile ?? {}) as Record<string, unknown>;
  const kind = text(profile.kind) ?? 'generic';
  const lines: Array<string | null> = [
    section('Prospect', lead.full_name),
    section('Line of business', lead.line_of_business),
  ];

  if (kind === 'commercial') {
    const company = (profile.company ?? {}) as Record<string, unknown>;
    lines.push(
      section('Industry', text(company.industry)),
      section('Sales range', text(company.sales_range)),
      section('Employees', text(company.employees)),
      section('Website', text(company.website)),
    );

    const contacts = Array.isArray(profile.contacts) ? (profile.contacts as Array<Record<string, unknown>>) : [];
    for (const contact of contacts) {
      const who = [text(contact.name), text(contact.position)].filter(Boolean).join(', ');
      if (who) lines.push(`Contact: ${who}`);
    }

    const renewals = Array.isArray(profile.renewals) ? (profile.renewals as Array<Record<string, unknown>>) : [];
    for (const renewal of renewals) {
      const parts = [text(renewal.type), text(renewal.date)].filter(Boolean).join(' renews ');
      const carrier = text(renewal.carrier);
      const broker = text(renewal.broker);
      lines.push(
        `Renewal signal: ${parts}${carrier ? ` with incumbent carrier ${carrier}` : ''}${broker ? ` (broker: ${broker})` : ''}`,
      );
    }

    const pension = (profile.pension ?? {}) as Record<string, unknown>;
    if (text(pension.participants)) lines.push(section('Pension participants', text(pension.participants)));
    const benefits = (profile.benefits ?? {}) as Record<string, unknown>;
    if (text(benefits.participants)) lines.push(section('Benefits participants', text(benefits.participants)));

    const osha = (profile.osha ?? {}) as Record<string, unknown>;
    if (text(osha.safety_violations)) lines.push(section('OSHA safety violations on record', text(osha.safety_violations)));
    if (text(osha.health_violations)) lines.push(section('OSHA health violations on record', text(osha.health_violations)));

    const dot = (profile.dot ?? {}) as Record<string, unknown>;
    if (text(dot.units)) lines.push(section('Fleet units', text(dot.units)));
    if (text(dot.drivers)) lines.push(section('Fleet drivers', text(dot.drivers)));
    if (text(dot.violations)) lines.push(section('DOT violations', text(dot.violations)));
    if (text(dot.interstate)) lines.push(section('Interstate authority', text(dot.interstate)));
    if (text(dot.intrastate)) lines.push(section('Intrastate authority', text(dot.intrastate)));
    for (const bucket of ['bipd_primary', 'bipd_excess', 'cargo', 'surety'] as const) {
      const item = (dot[bucket] ?? {}) as Record<string, unknown>;
      if (text(item.xdate) || text(item.carrier)) {
        lines.push(
          `Coverage signal (${bucket.replace('_', ' ').toUpperCase()}): ${[text(item.xdate), text(item.carrier)].filter(Boolean).join(' with ')}`,
        );
      }
    }
    const signals = Array.isArray(dot.signals) ? (dot.signals as string[]) : [];
    for (const signal of signals) lines.push(`Fleet signal: ${signal}`);

    const fin = (profile.financials_990 ?? {}) as Record<string, unknown>;
    if (text(fin.report_type)) lines.push(section('990 report', [text(fin.report_type), text(fin.report_year)].filter(Boolean).join(' ')));
    if (text(fin.revenue)) lines.push(section('990 revenue', text(fin.revenue)));
    if (text(fin.expenses)) lines.push(section('990 expenses', text(fin.expenses)));
    if (text(fin.net_assets)) lines.push(section('990 net assets', text(fin.net_assets)));
    if (text(fin.insurance_expenses)) lines.push(section('990 insurance spend', text(fin.insurance_expenses)));

    const liability = (profile.liability ?? {}) as Record<string, unknown>;
    if (text(liability.gl_xdate)) lines.push(section('General Liability predicted X-date', text(liability.gl_xdate)));
    if (text(liability.commercial_auto_xdate)) lines.push(section('Commercial Auto predicted X-date', text(liability.commercial_auto_xdate)));
    if (text(liability.fidelity_bond)) lines.push(section('Fidelity bond', text(liability.fidelity_bond)));

    const awards = Array.isArray(profile.contract_awards) ? (profile.contract_awards as string[]) : [];
    if (awards.length > 0) lines.push(section('Government contract awards', `${awards.length} on record`));
  } else if (kind === 'personal_auto') {
    const demographics = (profile.demographics ?? {}) as Record<string, unknown>;
    lines.push(
      section('Homeowner', text(demographics.homeowner) === 'Y' ? 'Yes (bundle opportunity)' : text(demographics.homeowner)),
      section('Requested coverage', text(profile.coverage)),
      section('Current carrier', text(profile.current_carrier)),
    );
    const vehicles = Array.isArray(profile.vehicles) ? (profile.vehicles as Array<Record<string, unknown>>) : [];
    for (const vehicle of vehicles) {
      const described = [text(vehicle.year), text(vehicle.make), text(vehicle.model)].filter(Boolean).join(' ');
      if (described) lines.push(`Vehicle: ${described}${text(vehicle.annual_mileage) ? ` (~${text(vehicle.annual_mileage)} mi/yr)` : ''}`);
    }
  }

  // Website submissions: the prospect's own form answers are the strongest
  // grounding there is — feed them verbatim.
  const payloadRec = (lead.form_payload ?? {}) as Record<string, unknown>;
  const webMeta = (payloadRec.metadata ?? {}) as Record<string, unknown>;
  const webGuide = (webMeta.guide ?? {}) as Record<string, unknown>;
  const answers =
    text(webGuide.message) ??
    text(payloadRec.message) ??
    text(payloadRec.risk_details) ??
    text(payloadRec.details) ??
    text(payloadRec.requirements);
  if (answers) {
    const submitted =
      text(webMeta.submittedAt) ?? text(payloadRec.submission_date) ?? text(payloadRec.created_at);
    if (submitted) lines.push(section('They submitted the website form on', submitted.slice(0, 10)));
    lines.push(section('Business name', text(webMeta.businessName)));
    lines.push(
      section('Preferred contact method (honor this)', text(webMeta.preferredContactMethod)),
    );
    lines.push('Their exact answers on the quote request form:');
    for (const answerLine of answers.split(/\r?\n/)) {
      const trimmed = answerLine.trim();
      if (trimmed && !/[:=]\s*[{[]/.test(trimmed) && !trimmed.startsWith('{')) lines.push(`  ${trimmed}`);
    }
  }

  lines.push(section('Address', lead.address));

  // Verified public records pulled from government sources (strong, citable facts).
  const enrichment = (profile.enrichment ?? {}) as Record<string, unknown>;
  const fmcsa = (enrichment.fmcsa ?? {}) as Record<string, unknown>;
  if (text(fmcsa.dot_number)) {
    lines.push(section('FMCSA DOT number (verified)', text(fmcsa.dot_number)));
    lines.push(section('FMCSA operating status', text(fmcsa.operating_status)));
    lines.push(section('FMCSA safety rating', text(fmcsa.safety_rating) ?? 'None issued'));
    lines.push(section('FMCSA power units (verified)', text(fmcsa.power_units)));
    lines.push(section('FMCSA drivers (verified)', text(fmcsa.drivers)));
    if (text(fmcsa.driver_oos_rate)) {
      lines.push(
        section(
          'FMCSA driver out-of-service rate',
          `${text(fmcsa.driver_oos_rate)}%${text(fmcsa.driver_oos_national_avg) ? ` vs national average ${text(fmcsa.driver_oos_national_avg)}%` : ''}`,
        ),
      );
    }
    if (text(fmcsa.vehicle_oos_rate)) {
      lines.push(
        section(
          'FMCSA vehicle out-of-service rate',
          `${text(fmcsa.vehicle_oos_rate)}%${text(fmcsa.vehicle_oos_national_avg) ? ` vs national average ${text(fmcsa.vehicle_oos_national_avg)}%` : ''}`,
        ),
      );
    }
    if (text(fmcsa.crashes_total)) {
      lines.push(
        section(
          'FMCSA crashes last 24 months',
          `${text(fmcsa.crashes_total)} total (${text(fmcsa.crashes_fatal) ?? 0} fatal, ${text(fmcsa.crashes_injury) ?? 0} injury, ${text(fmcsa.crashes_tow) ?? 0} tow-away)`,
        ),
      );
    }
    lines.push(section('FMCSA inspections last 24 months', text(fmcsa.inspections_total)));
  }
  const oshaEnriched = (enrichment.osha ?? {}) as Record<string, unknown>;
  const oshaInspections = Array.isArray(oshaEnriched.inspections) ? (oshaEnriched.inspections as Array<Record<string, unknown>>) : [];
  if (typeof oshaEnriched.total_inspections === 'number') {
    lines.push(section('OSHA federal inspections on record (verified)', String(oshaEnriched.total_inspections)));
    if (typeof oshaEnriched.total_penalties === 'number' && oshaEnriched.total_penalties > 0) {
      lines.push(section('OSHA total current penalties', `$${oshaEnriched.total_penalties.toLocaleString()}`));
    }
    for (const inspection of oshaInspections.slice(0, 5)) {
      const parts = [
        text(inspection.open_date),
        text(inspection.inspection_type),
        [
          text(inspection.violations_serious) ? `${text(inspection.violations_serious)} serious` : null,
          text(inspection.violations_willful) ? `${text(inspection.violations_willful)} willful` : null,
          text(inspection.violations_repeat) ? `${text(inspection.violations_repeat)} repeat` : null,
        ]
          .filter(Boolean)
          .join(', ') || null,
        text(inspection.total_penalty) ? `$${text(inspection.total_penalty)} penalty` : null,
      ].filter(Boolean);
      if (parts.length > 0) lines.push(`OSHA inspection: ${parts.join(' · ')}`);
    }
  }

  // Everything the vendor file carried that wasn't structured — nothing is withheld from the model.
  const extras = (profile.extras ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(extras)) {
    const str = text(value);
    if (str) lines.push(`${key}: ${str}`);
  }

  return lines.filter(Boolean).join('\n');
}

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

async function chat(messages: ChatMessage[], maxTokens: number): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OUTREACH_CHAT_MODEL ?? process.env.RASHI_CHAT_MODEL ?? 'gpt-4o-mini',
        messages,
        temperature: 0.6,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.error('[outreach-ai] HTTP error', response.status, await response.text().catch(() => ''));
      return null;
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return payload.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.error('[outreach-ai] request failed', error);
    return null;
  }
}

const DRAFT_SYSTEM_PROMPT = `You are an outreach writer for Shield Assurance, an independent insurance agency in Tucson, Arizona.
Write a short, specific first-touch email from a producer to a prospect, grounded ONLY in the facts provided.
Hard rules:
- Lead with the single most time-sensitive or unusual fact (an upcoming renewal, a fleet change, a compliance record, a coverage gap signal) and name it precisely.
- Reference at least two concrete facts naturally; never pad with generic claims ("enhance your coverage", "improve cost efficiency") unless tied to a specific number or date.
- Never invent facts, pricing, or coverage details not in the grounding data.
- Tone: direct, professional, peer-to-peer. No hype, no emojis, no exclamation marks.
- Length: 60-120 words. One clear ask: a brief call.
- Do not mention how you obtained the data or any data provider.
- Sign as "Chance" from Shield Assurance.
Return JSON: {"subject": string, "body": string, "cited_signals": string[]} where cited_signals lists the exact grounding facts you used.`;

const POINTS_SYSTEM_PROMPT = `You prepare an insurance producer at Shield Assurance (Tucson, AZ) for a first sales call, using ONLY the facts provided.
Hard rules:
- Every point MUST be anchored to a specific fact from the grounding data (a date, carrier, broker, count, dollar figure, violation, or fleet detail). Quote the fact in the point.
- FORBIDDEN: generic filler such as "how is the market impacting you", "what challenges do you face", "tell me about your business", or any question that could be asked of any company. If a point could apply to a different company, delete it.
- Prefer angles a competing producer would miss: timing against a specific renewal date, the incumbent carrier/broker relationship, compliance exposure (OSHA/DOT) phrased respectfully, participant counts vs plan design, insurance spend vs revenue.
- Format: 3-6 points, each one sentence, written as something the producer can actually say or ask on the call.
- Never invent facts. Do not mention data sources or providers. No emojis.
Return JSON: {"points": string[], "cited_signals": string[]}.`;

export async function draftOutreach(lead: LeadLike, instruction?: string): Promise<OutreachDraft | null> {
  const grounding = buildGrounding(lead);
  const userContent = [
    `Grounding data:\n${grounding}`,
    instruction ? `Producer's instruction for this draft: ${instruction}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await chat(
    [
      { role: 'system', content: DRAFT_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    600,
  );
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<OutreachDraft>;
    if (!parsed.subject || !parsed.body) return null;
    return {
      subject: String(parsed.subject),
      body: String(parsed.body),
      cited_signals: Array.isArray(parsed.cited_signals) ? parsed.cited_signals.map(String) : [],
    };
  } catch {
    return null;
  }
}

export async function generateTalkingPoints(lead: LeadLike): Promise<TalkingPoints | null> {
  const grounding = buildGrounding(lead);
  const raw = await chat(
    [
      { role: 'system', content: POINTS_SYSTEM_PROMPT },
      { role: 'user', content: `Grounding data:\n${grounding}` },
    ],
    500,
  );
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<TalkingPoints>;
    if (!Array.isArray(parsed.points) || parsed.points.length === 0) return null;
    return {
      points: parsed.points.map(String),
      cited_signals: Array.isArray(parsed.cited_signals) ? parsed.cited_signals.map(String) : [],
    };
  } catch {
    return null;
  }
}

/** One-paragraph morning briefing summary from deterministic facts. */
export async function summarizeBriefing(facts: string): Promise<string | null> {
  const raw = await chat(
    [
      {
        role: 'system',
        content: `You are the morning briefing writer for a one-producer insurance agency (Shield Assurance, Tucson AZ).
Given today's facts, write 2-3 sentences telling the producer exactly what to prioritize first and why, referencing the specific numbers given.
No greetings, no fluff, no emojis, no generic advice. Return JSON: {"summary": string}.`,
      },
      { role: 'user', content: facts },
    ],
    220,
  );
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { summary?: string };
    return parsed.summary ? String(parsed.summary) : null;
  } catch {
    return null;
  }
}

const SEQUENCE_STEP_RULES: Record<'first' | 'followup' | 'final', string> = {
  first: `This is the FIRST email in the sequence. Lead with the single most time-sensitive or unusual fact and name it precisely. Reference at least two concrete facts. Length: 60-120 words. One clear ask: a brief call.`,
  followup: `This is a FOLLOW-UP in the sequence; earlier emails got no reply. Take a DIFFERENT angle: anchor on a fact you have NOT used in the previous emails (provided below). Do not guilt-trip about the lack of reply and do not summarize the previous email. One new concrete fact minimum. Length: 50-90 words. Ask for a brief call or offer a specific alternative (a two-line email answer).`,
  final: `This is the FINAL email in the sequence. Keep it short and gracious: 40-70 words. Reference one concrete fact, make clear you will stop reaching out, and leave a specific open door (for example, timed to their named renewal month). No guilt, no pressure.`,
};

function sequenceSystemPrompt(step: number, totalSteps: number): string {
  const kind = step <= 1 ? 'first' : step >= totalSteps ? 'final' : 'followup';
  return `You are an outreach writer for Shield Assurance, an independent insurance agency in Tucson, Arizona.
Write email ${step} of ${totalSteps} in a prospecting sequence from a producer to a prospect, grounded ONLY in the facts provided.
${SEQUENCE_STEP_RULES[kind]}
Hard rules:
- Never invent facts, pricing, or coverage details not in the grounding data.
- Never pad with generic claims ("enhance your coverage", "improve cost efficiency") unless tied to a specific number or date.
- Tone: direct, professional, peer-to-peer. No hype, no emojis, no exclamation marks.
- Do not mention how you obtained the data or any data provider.
- Do not repeat subject lines or opening lines from previous emails in this sequence.
- Sign as "Chance" from Shield Assurance.
Return JSON: {"subject": string, "body": string, "cited_signals": string[]} where cited_signals lists the exact grounding facts you used.`;
}

/** Drafts one step of an outreach sequence, avoiding repetition of earlier sends. */
export async function draftSequenceStep(
  lead: LeadLike,
  step: number,
  totalSteps: number,
  priorEmails: Array<{ subject: string; body: string }>,
): Promise<OutreachDraft | null> {
  const grounding = buildGrounding(lead);
  const priorBlock =
    priorEmails.length > 0
      ? `Previous emails already sent in this sequence (do NOT reuse their angles, subjects, or opening lines):\n${priorEmails
          .map((email, index) => `--- Email ${index + 1} ---\nSubject: ${email.subject}\n${email.body}`)
          .join('\n')}`
      : null;

  const raw = await chat(
    [
      { role: 'system', content: sequenceSystemPrompt(step, totalSteps) },
      { role: 'user', content: [`Grounding data:\n${grounding}`, priorBlock].filter(Boolean).join('\n\n') },
    ],
    700,
  );
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<OutreachDraft>;
    if (!parsed.subject || !parsed.body) return null;
    return {
      subject: String(parsed.subject),
      body: String(parsed.body),
      cited_signals: Array.isArray(parsed.cited_signals) ? parsed.cited_signals.map(String) : [],
    };
  } catch {
    return null;
  }
}
