import { APPETITE_DECISIONS, CARRIER_ACCESS, type AppetiteDecision, type CarrierAppetiteRule, type CarrierAppetiteValues } from '@crm/shared';
import { isRecord, isUuid } from './workspace-validation';
import { WorkspaceError } from './record-scope';
import type { IntakePage, IntakeTextCell } from './policy-document-intake';
import { parseAppetitePredicate } from './opportunity-matching';

function decision(text: string): AppetiteDecision {
  if (/\b(?:not eligible|ineligible|prohibited|excluded|unacceptable|not written|do not write|will not write|no appetite|not accepted|not available|avoid|decline[ds]?)\b/i.test(text)) return 'excluded';
  if (/\b(?:refer|referrals?|prior approval|subject to approval|case.by.case)\b/i.test(text)) return 'referral';
  if (/\b(?:preferred|target(?:ed)? (?:classes|risks|industries|business))\b/i.test(text)) return 'preferred';
  if (/\b(?:eligible|acceptable|accepted|we write)\b/i.test(text)) return 'eligible';
  return 'needs_review';
}

function sourceExcerpt(source: string, excerpt: string): string | null {
  if (!excerpt.trim()) return null;
  if (source.includes(excerpt)) return excerpt;
  const pattern = excerpt.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return source.match(new RegExp(pattern))?.[0] ?? null;
}

function categoryGuide(page: Pick<IntakePage, 'page' | 'text' | 'layout'>): CarrierAppetiteRule[] | null {
  if (!page.layout?.some((row) => row.cells.some((cell) => /^(?:online |email )?target classes$/i.test(cell.text.trim())))) return null;
  if (!page.layout.some((row) => row.cells.some((cell) => /^(?:how to submit|exposures to avoid)$/i.test(cell.text.trim())))) return null;
  const carriers = [...new Set(Array.from(page.text.matchAll(/^(?:carrier|insurance company|insurer)\s*:\s*(.{1,150})$/gim), (match) => match[1].trim()))];
  if (carriers.length > 1) return null;
  type Entry = { x: number; category: string; fragments: string[]; decision: AppetiteDecision };
  const entries: Entry[] = [], active = new Map<number, Entry>(), headings = new Map<number, string>();
  let mode: AppetiteDecision = 'needs_review', submitX = Infinity, left = -Infinity;
  const column = (x: number): number => [...headings.keys()].find((key) => Math.abs(key - x) < 25) ?? x;
  for (const row of page.layout) {
    const section = row.cells.find((cell) => /^(?:(?:online |email )?target classes|exposures to avoid|ineligible classes|prohibited classes)$/i.test(cell.text.trim()));
    if (section) {
      mode = /avoid|ineligible|prohibited/i.test(section.text) ? 'excluded' : 'preferred';
      active.clear(); headings.clear();
      submitX = row.cells.find((cell) => /^how to submit$/i.test(cell.text.trim()))?.x ?? Infinity;
      left = Number.isFinite(submitX) ? section.x - 15 : -Infinity;
      continue;
    }
    if (mode === 'needs_review') continue;
    for (const cell of row.cells) {
      const text = cell.text.trim();
      if (!text || cell.x >= submitX - 5 || cell.x < left
        || /@|https?:|www\.|^bhhc\.|insurance company|^PO Box|product.*available/i.test(text)) continue;
      const bullet = /^[•●▪\-]\s*|^8\s+(?=\S)/.exec(text);
      if (bullet) {
        const key = column(cell.x);
        const explicit = decision(text);
        const stated = mode === 'excluded' ? 'excluded' : explicit !== 'needs_review' ? explicit
          : /\b(?:must|up to|minimum|maximum|at least|as low as|limited|deductible)\b/i.test(text) ? 'condition' : mode;
        const entry: Entry = { x: key, category: headings.get(key) ?? '', fragments: [text], decision: stated };
        entries.push(entry); active.set(key, entry);
      } else if (mode !== 'excluded' && /^[A-Z0-9][A-Z0-9 /+&()-]*$/.test(text) && /[A-Z]{3}/.test(text)) {
        const key = column(cell.x);
        const previous = headings.get(key);
        const continued = previous && !active.has(key) && /(?:\/|LOCATION|COMMERCIAL|MULTIPLE)$/.test(previous);
        const label = continued ? `${previous} ${text}` : text;
        headings.set(key, label); active.delete(key);
        // A category heading under TARGET CLASSES is itself an affirmative class.
        if (previous && label !== text) {
          const last = [...entries].reverse().find((entry) => entry.x === key && entry.category === previous && entry.fragments.length === 1);
          if (last) { last.fragments.push(text); last.category = label; continue; }
        }
        entries.push({ x: key, category: label, fragments: [text], decision: mode });
      } else {
        const key = [...active.keys()].sort((a, b) => Math.abs(a - cell.x) - Math.abs(b - cell.x))[0];
        if (key !== undefined && Math.abs(key - cell.x) < 25 && cell.width < 220) active.get(key)?.fragments.push(text);
      }
    }
  }
  return entries.flatMap((entry): CarrierAppetiteRule[] => {
    let start = -1, end = 0;
    for (const fragment of entry.fragments) {
      const index = page.text.indexOf(fragment, end);
      if (index < 0) return [];
      if (start < 0) start = index;
      end = index + fragment.length;
    }
    const wording = entry.fragments.join(' ').replace(/^[•●▪\-8]\s*/, '');
    const criterion = entry.category && wording !== entry.category ? `${entry.category}: ${wording}` : wording;
    const excerpt = page.text.slice(start, end);
    if (excerpt.length > 4000) return [];
    const explicit = decision(wording);
    const stated = entry.decision === 'excluded' ? 'excluded' : explicit !== 'needs_review' ? explicit
      : /\bno\b.*\bcoverage\b/i.test(wording) ? 'excluded'
      : /\b(?:must|minimum|maximum|limited|deductible)\b/i.test(wording) ? 'condition' : entry.decision;
    return [{ id: crypto.randomUUID(), ...(carriers[0] ? { carrier: carriers[0] } : {}), criterion, decision: stated, page: page.page, excerpt }];
  });
}

/** Source text is the only input. CRM prospects, outcomes and embeddings cannot author appetite. */
export function extractCarrierAppetite(pages: Pick<IntakePage, 'page' | 'text' | 'layout'>[]): CarrierAppetiteRule[] {
  const rules: CarrierAppetiteRule[] = [];
  for (const page of pages) {
    const categorized = categoryGuide(page);
    if (categorized) { rules.push(...categorized); continue; }
    let heading = '';
    let inherited: AppetiteDecision = 'needs_review';
    let columns: string[] | null = null;
    let statusIndex = -1;
    let sourceCarrier = '';
    let categoryColumns: Array<{ x: number; label: string; decision: AppetiteDecision }> = [];
    let tableColumns: IntakeTextCell[] = [];
    const rows = page.layout ?? page.text.split(/\r?\n/).map((text) => ({
      cells: Array.from(text.matchAll(/\S(?:.*?\S)?(?=\t| {2,}|$)/g), (match) => ({
        text: match[0], x: match.index ?? 0, width: match[0].length,
      })),
    }));
    const add = (criterion: string, excerpt: string, stated: AppetiteDecision): void => {
      if (!criterion.trim() || !excerpt.trim() || !page.text.includes(excerpt)) return;
      rules.push({ id: crypto.randomUUID(), ...(sourceCarrier ? { carrier: sourceCarrier } : {}),
        page: page.page, excerpt, criterion: criterion.slice(0, 2200), decision: stated });
    };
    for (const row of rows) {
      const raw = row.cells.map((cell) => cell.text).join('  ');
      const text = raw.trim();
      if (!text || text.length > 2000 || /^\s*(?:page \d+|\d+)\s*$/i.test(text)) continue;
      const carrierLabel = text.match(/^(?:carrier|insurance company|insurer)\s*:\s*(.{1,150})$/i);
      if (carrierLabel) { sourceCarrier = carrierLabel[1].trim(); heading = ''; inherited = 'needs_review'; columns = null; categoryColumns = []; continue; }
      if (/^(?:line of business|coverage line|product|states?|territor(?:y|ies)|effective date|expiry date|expiration date)\s*:/i.test(text)) continue;
      const categoryHeaders = row.cells.filter((cell) => decision(cell.text) !== 'needs_review'
        && cell.text.length < 80 && !/[.!?]/.test(cell.text));
      if (categoryHeaders.length === row.cells.length && categoryHeaders.length > 1) {
        categoryColumns = categoryHeaders.map((cell) => ({ x: cell.x, label: cell.text, decision: decision(cell.text) }));
        columns = null; heading = ''; inherited = 'needs_review';
        continue;
      }
      const cells = text.split(/\t| {2,}|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.trim().replace(/^"|"$/g, ''));
      if (cells.some((cell) => /^(?:class(?:ification)?(?: description)?|business(?: type)?|industry|operations?|risk|naics|sic|category)$/i.test(cell))
        && cells.some((cell) => /^(?:appetite|status|eligibility|eligible|decision)$/i.test(cell))) {
        columns = cells;
        tableColumns = row.cells;
        statusIndex = cells.findIndex((cell) => /^(?:appetite|status|eligibility|eligible|decision)$/i.test(cell));
        heading = ''; inherited = 'needs_review'; categoryColumns = [];
        continue;
      }
      if (categoryColumns.length) {
        for (const cell of row.cells) {
          const column = [...categoryColumns].reverse().find((entry) => cell.x >= entry.x - 5) ?? categoryColumns[0];
          const explicit = decision(cell.text);
          add(`${column.label.replace(/:$/, '')}: ${cell.text}`, cell.text, explicit === 'needs_review' ? column.decision : explicit);
        }
        continue;
      }
      const aligned = page.layout && columns && tableColumns.length === columns.length && row.cells.length > 1
        ? columns.map((_, index) => row.cells.filter((cell) => {
          const nearest = tableColumns.reduce((best, entry, i) => Math.abs(cell.x - entry.x) < Math.abs(cell.x - tableColumns[best].x) ? i : best, 0);
          return nearest === index;
        }).map((cell) => cell.text).join(' ')) : cells;
      if (columns && aligned.length === columns.length) {
        const status = aligned[statusIndex];
        let stated = decision(status);
        if (/^(?:eligible|eligibility)$/i.test(columns[statusIndex])) {
          if (/^yes$/i.test(status)) stated = 'eligible';
          if (/^no$/i.test(status)) stated = 'excluded';
        }
        const carrierColumn = columns.findIndex((column) => /^(?:carrier|insurer|insurance company)$/i.test(column));
        const carrier = carrierColumn >= 0 ? aligned[carrierColumn] : sourceCarrier;
        rules.push({ id: crypto.randomUUID(), ...(carrier ? { carrier } : {}), page: page.page, excerpt: raw, decision: stated,
          criterion: aligned.map((cell, index) => cell ? `${columns?.[index]}: ${cell}` : '').filter(Boolean).join('; ') });
        continue;
      }
      columns = null;
      const explicit = decision(text);
      const isHeading = text.length < 100 && !/\d/.test(text)
        && (/[:：]$/.test(text)
          || /^(?:(?:preferred|eligible|ineligible|prohibited|excluded|unacceptable|target|acceptable)(?: (?:business|classes|risks|operations|industries))?|underwriting (?:guidelines|requirements)|referrals?|limits|deductibles|states|territor(?:y|ies))\s*$/i.test(text));
      if (isHeading) {
        heading = text;
        inherited = explicit;
        continue;
      }
      if (heading || explicit !== 'needs_review' || /\b(?:must|minimum|maximum|limit|deductible|years in business|states?|NAICS|SIC|payroll|revenue|sales|radius)\b/i.test(text)) {
        rules.push({ id: crypto.randomUUID(), ...(sourceCarrier ? { carrier: sourceCarrier } : {}), criterion: heading ? `${heading.replace(/:$/, '')}: ${text}` : text,
          decision: explicit === 'needs_review' ? inherited : explicit, page: page.page, excerpt: raw });
      }
    }
  }
  return rules;
}

export function extractCarrierAppetiteMetadata(pages: Array<{ text: string }>): Partial<CarrierAppetiteValues> {
  const found: Partial<CarrierAppetiteValues> = {};
  const aliases = { carrier: 'carrier|insurance company|insurer', line: 'line of business|coverage line|product',
    states: 'states?|territor(?:y|ies)', effective_on: 'effective date|effective on', expires_on: 'expiry date|expiration date|expires on' };
  for (const [field, alias] of Object.entries(aliases)) {
    const matches = pages.flatMap((page) => page.text.split(/\r?\n/).flatMap((line) => {
      const match = line.match(new RegExp(`^\\s*(?:${alias})\\s*:\\s*(.{1,150})$`, 'i'));
      return match ? [match[1].trim()] : [];
    }));
    const unique = [...new Set(matches)];
    if (unique.length !== 1) continue;
    const value = unique[0];
    if (field === 'carrier' || field === 'line' || field === 'states') found[field] = value;
    if ((field === 'effective_on' || field === 'expires_on') && /^\d{4}-\d{2}-\d{2}$/.test(value)) found[field] = value;
  }
  if (!found.line) {
    const coverages = pages.flatMap((page) => page.text.split(/\r?\n/).slice(0, 5))
      .map((text) => text.trim()).filter((text) => /^(?:commercial property|general liability|workers[’']? compensation|commercial auto|businessowners|professional liability|inland marine|commercial umbrella)$/i.test(text));
    if (new Set(coverages.map((text) => text.toLowerCase())).size === 1) found.line = coverages[0];
  }
  return found;
}

export function parseCarrierAppetite(value: unknown, pages: Array<{ page: number; text: string }>): CarrierAppetiteValues {
  if (!isRecord(value)) throw new WorkspaceError('Provide carrier appetite details.', 400);
  const text = (key: string, required = false, max = 500): string => {
    const entry = value[key];
    if (typeof entry !== 'string' || entry.length > max || required && !entry.trim()) throw new WorkspaceError(`Enter valid ${key.replace(/_/g, ' ')}.`, 400);
    return entry.trim();
  };
  const result: CarrierAppetiteValues = {
    carrier: text('carrier', true, 150), title: text('title', true, 200), line: text('line'), states: text('states'),
    effective_on: text('effective_on'), expires_on: text('expires_on'),
    access: 'unconfirmed', access_reference: value.access_reference === undefined ? '' : text('access_reference', false, 2000),
    rights_reference: value.rights_reference === undefined ? '' : text('rights_reference', false, 2000), rules: [],
  };
  if (value.interpretation !== undefined) {
    const entry = value.interpretation;
    if (!isRecord(entry) || typeof entry.version !== 'string' || entry.version.length > 50
      || typeof entry.source_hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.source_hash)
      || typeof entry.summary !== 'string' || entry.summary.length > 1600) throw new WorkspaceError('The saved AI reading could not be verified. Read the guide again.', 400);
    result.interpretation = { version: entry.version, source_hash: entry.source_hash, summary: entry.summary };
  }
  for (const day of [result.effective_on, result.expires_on]) {
    if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))
      || new Date(day).toISOString().slice(0, 10) !== day)) throw new WorkspaceError('Use valid calendar dates.', 400);
  }
  if (result.expires_on && result.effective_on && result.expires_on < result.effective_on) throw new WorkspaceError('Expiry must not precede the effective date.', 400);
  if (!CARRIER_ACCESS.some((access) => access === value.access)) throw new WorkspaceError('Choose an agency access route.', 400);
  result.access = value.access as CarrierAppetiteValues['access'];
  if (!Array.isArray(value.rules) || value.rules.length > 1000) throw new WorkspaceError('Review up to 1,000 rules per document; split this review if necessary.', 400);
  const ids = new Set<string>();
  for (const row of value.rules) {
    if (!isRecord(row)) throw new WorkspaceError('The guide entries could not be read. Re-read the original guide.', 400);
    const original = typeof row.excerpt === 'string' ? row.excerpt : '';
    const page = pages.find((page) => page.page === row.page);
    const excerpt = page && original.length <= 4000 ? sourceExcerpt(page.text, original) : null;
    if (typeof row.criterion !== 'string' || !row.criterion.trim() || row.criterion.length > 2200
      || !excerpt || excerpt.length > 4000) {
      (result.unresolved_entries ??= []).push({
        criterion: (typeof row.criterion === 'string' && row.criterion.trim() ? row.criterion : original || 'Unreadable entry').slice(0, 4000),
        page: page?.page ?? null, reason: 'Could not reliably link this entry to the guide. Not used for automatic matching.',
      });
      continue;
    }
    const id = isUuid(row.id) && !ids.has(row.id) ? row.id : crypto.randomUUID();
    ids.add(id);
    if (row.carrier !== undefined && (typeof row.carrier !== 'string' || row.carrier.trim().toLowerCase() !== result.carrier.toLowerCase())) {
      throw new WorkspaceError('This review contains rules for another carrier. Select a single carrier and review its rules separately.', 400);
    }
    result.rules.push({ id, ...(typeof row.carrier === 'string' ? { carrier: row.carrier } : {}),
      criterion: row.criterion.trim(), decision: APPETITE_DECISIONS.some((entry) => entry === row.decision) ? row.decision as AppetiteDecision : 'needs_review', page: Number(row.page), excerpt,
      ...(row.predicate === undefined ? {} : { predicate: parseAppetitePredicate(row.predicate) }) });
  }
  if (value.unresolved_entries !== undefined) {
    if (!Array.isArray(value.unresolved_entries) || value.unresolved_entries.length > 1000) throw new WorkspaceError('The saved guide notes could not be read.', 400);
    for (const entry of value.unresolved_entries) {
      if (!isRecord(entry) || typeof entry.criterion !== 'string' || entry.criterion.length > 4000
        || typeof entry.reason !== 'string' || entry.reason.length > 500
        || entry.page !== null && !pages.some((page) => page.page === entry.page)) throw new WorkspaceError('The saved guide notes could not be read.', 400);
      (result.unresolved_entries ??= []).push({ criterion: entry.criterion, page: typeof entry.page === 'number' ? entry.page : null, reason: entry.reason });
    }
  }
  if (new TextEncoder().encode(JSON.stringify({ values: result, pages })).byteLength > 3500000) {
    throw new WorkspaceError('This review is too large to save safely. Split the carrier document; nothing was saved.', 413);
  }
  return result;
}

export function parseAppetitePages(value: unknown): Array<{ page: number; text: string }> {
  if (!Array.isArray(value) || !value.length) throw new WorkspaceError('Read the carrier document before saving.', 400);
  const pages: Array<{ page: number; text: string }> = [];
  let length = 0;
  for (const entry of value) {
    if (!isRecord(entry) || entry.page !== pages.length + 1 || typeof entry.text !== 'string') throw new WorkspaceError('Source pages must be consecutive and contain text.', 400);
    length += entry.text.length;
    if (length > 1500000) throw new WorkspaceError('Extracted text exceeds the review size. Split the document; nothing was saved.', 413);
    pages.push({ page: pages.length + 1, text: entry.text });
  }
  return pages;
}
