export interface DraftText { subject: string; body: string }

export interface OutreachQualityContext {
  email?: boolean;
  coldFirstTouch?: boolean;
  specificSignals?: string[];
  citedSignals?: string[];
}

const GENERIC_COPY = [
  /\bthank you for (?:reaching out|contacting us)\b/i,
  /\bgiven your focus in\b/i,
  /\btailored coverage\b/i,
  /\bcoverage that suits your (?:business|needs)\b/i,
  /\bplease let me know if there are specific coverages?\b/i,
  /\blooking forward to your response\b/i,
  /\b(?:general|generic|sales|insurance) pitch\b/i,
  /\bno documents or (?:a )?meeting (?:are|is) needed to reply\b/i,
  /\bskip anything that is not useful\b/i,
];
const SIGNAL_LABELS_TO_IGNORE = /^(?:prospect|business name|line of business|industry|actual business industry|website|contact|preferred channel(?:.*)?|needs recorded from|needs last confirmed on|channel|draft date|sender profile(?:.*)?)$/i;
const GENERIC_SIGNAL_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'been', 'before', 'being', 'business', 'company', 'could',
  'coverage', 'current', 'from', 'have', 'into', 'insurance', 'just', 'more', 'need', 'needs', 'only', 'other',
  'please', 'policy', 'priorities', 'recorded', 'review', 'said', 'should', 'that', 'their', 'them', 'there',
  'this', 'through', 'today', 'with', 'would', 'your',
]);

export function isSpecificOutreachSignal(signal: string): boolean {
  const label = signal.split(':', 1)[0]?.trim() ?? '';
  return !SIGNAL_LABELS_TO_IGNORE.test(label)
    && !/^(?:OSHA|.*safety violations?|DOT violations|Objections to respect)\b/i.test(label);
}

function signalTerms(signal: string): string[] {
  const delimiter = signal.lastIndexOf(': ');
  const value = delimiter >= 0 ? signal.slice(delimiter + 2) : signal;
  return [...new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
    .filter((word) => !GENERIC_SIGNAL_WORDS.has(word) && (/[a-z]/.test(word) ? word.length >= 3 : word.length >= 4));
}

function draftUsesSignal(draft: string, signal: string): boolean {
  const terms = signalTerms(signal);
  if (!terms.length) return false;
  const bodyWords = new Set(draft.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const matches = terms.filter((word) => bodyWords.has(word)).length;
  return matches >= Math.min(2, terms.length);
}

function firstEmailContentParagraph(body: string): string {
  const message = body.split(/\n\s*--[ \t]*\n/)[0]?.trim() ?? '';
  return message.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).find((paragraph) =>
    paragraph && !/^(?:hi|hello|dear|hey)\b[^.!?]*[,!]?$/i.test(paragraph)) ?? '';
}

function signalLeadsOpening(opening: string, signal: string): boolean {
  const openingSentences = (opening.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).slice(0, 2).join(' ');
  return draftUsesSignal(openingSentences, signal);
}

export function outreachQualityIssues(
  draft: DraftText,
  previous: DraftText[] = [],
  limits = { min: 35, max: 140 },
  context: OutreachQualityContext = {},
): string[] {
  const issues: string[] = [];
  const words = draft.body.trim().split(/\s+/).filter(Boolean).length;
  if (!draft.subject.trim() || /[\r\n]/.test(draft.subject)) issues.push('Use one nonempty subject line.');
  if (draft.subject.length > 100) issues.push('Shorten the subject to 100 characters or fewer.');
  if (words < limits.min || words > limits.max) issues.push(`Keep the message between ${limits.min} and ${limits.max} words (currently ${words}).`);
  if (/\{\{[^}]+\}\}|\[(?:first.?name|name|company|insert[^\]]*|your[^\]]*)\]/i.test(draft.body)) issues.push('Replace unresolved template placeholders.');
  if (GENERIC_COPY.some((pattern) => pattern.test(draft.body))) {
    issues.push('Remove generic sales copy. Open with the actual request or a specific profile detail, then explain the relevant next step.');
  }
  if (context.email) {
    const message = draft.body.split(/\n\s*--[ \t]*\n/)[0]?.trim() ?? '';
    const paragraphs = message.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
    if (paragraphs.length < 3) issues.push('Structure the email as a greeting, a short relevant explanation, and a separate next-step paragraph.');
  }
  const specificSignals = context.specificSignals ?? [];
  if (specificSignals.length && !specificSignals.some((signal) =>
    (context.citedSignals ?? []).includes(signal) && draftUsesSignal(draft.body, signal))) {
    issues.push('Use at least one specific profile detail in the email body, and cite that same detail. A name or broad industry alone is not specific.');
  }
  if (context.email && context.coldFirstTouch && specificSignals.length) {
    const opening = firstEmailContentParagraph(draft.body);
    if (!specificSignals.some((signal) =>
      (context.citedSignals ?? []).includes(signal) && signalLeadsOpening(opening, signal))) {
      issues.push('For a cold first touch, mention a specific cited business detail near the beginning, after a brief introduction if needed.');
    }
  }
  if ((draft.body.match(/\?/g) ?? []).length > 1) issues.push('Use one clear question or next step.');
  if (/\bguarantee(?:d)?\b|\bsave\s+\d+%|\bcoverage (?:is )?(?:bound|confirmed|guaranteed)\b/i.test(draft.body)) {
    issues.push('Remove unverified savings, guarantees or assertions of bound coverage.');
  }
  const opening = (body: string): string => body.trim().split(/\n/).map((line) => line.trim())
    .filter((line) => line && !/^(?:hi|hello|dear|hey)\b[^.!?]*[,!]?$/i.test(line))[0]?.toLowerCase() ?? '';
  if (previous.some((item) => item.subject.trim().toLowerCase() === draft.subject.trim().toLowerCase())) issues.push('Use a different subject from previous emails.');
  if (opening(draft.body) && previous.some((item) => opening(item.body) === opening(draft.body))) issues.push('Use a different opening from previous emails.');
  return issues;
}
