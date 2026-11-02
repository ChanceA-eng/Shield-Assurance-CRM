export interface DraftText { subject: string; body: string }

export function outreachQualityIssues(
  draft: DraftText,
  previous: DraftText[] = [],
  limits = { min: 35, max: 140 },
): string[] {
  const issues: string[] = [];
  const words = draft.body.trim().split(/\s+/).filter(Boolean).length;
  if (!draft.subject.trim() || /[\r\n]/.test(draft.subject)) issues.push('Use one nonempty subject line.');
  if (draft.subject.length > 100) issues.push('Shorten the subject to 100 characters or fewer.');
  if (words < limits.min || words > limits.max) issues.push(`Keep the message between ${limits.min} and ${limits.max} words (currently ${words}).`);
  if (/\{\{[^}]+\}\}|\[(?:first.?name|name|company|insert[^\]]*|your[^\]]*)\]/i.test(draft.body)) issues.push('Replace unresolved template placeholders.');
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
