export const INTAKE_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const INTAKE_MAX_FILES = 5;

export const INTAKE_FIELDS = {
  full_name: 'Insured / account name', address: 'Mailing address', phone: 'Phone', email: 'Email',
  carrier: 'Carrier', policy_number: 'Policy number', effective_date: 'Effective date',
  expiration_date: 'Expiration date', premium: 'Policy premium', line_of_business: 'Line of business',
  coverage_limits: 'Coverage limits', deductibles: 'Deductibles',
  vehicles: 'Vehicles', drivers: 'Drivers', properties: 'Properties / locations',
  additional_details: 'Additional policy details',
} as const;
export type IntakeField = keyof typeof INTAKE_FIELDS;
export const INTAKE_DETAIL_FIELDS = ['coverage_limits', 'deductibles', 'vehicles', 'drivers', 'properties', 'additional_details'] as const satisfies readonly IntakeField[];
export type ReviewedIntakeFields = Partial<Record<IntakeField, string>>;
export function isIntakeDetail(field: IntakeField): boolean {
  return INTAKE_DETAIL_FIELDS.some((detail) => detail === field);
}
export function validateReviewedIntakeFields(value: unknown): ReviewedIntakeFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Reviewed policy fields must be an object.');
  const fields: ReviewedIntakeFields = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(INTAKE_FIELDS, key)) throw new Error('Unsupported reviewed policy field.');
    const field = key as IntakeField;
    if (typeof entry !== 'string' || entry.length > (isIntakeDetail(field) ? 12000 : 1000)) throw new Error(`${INTAKE_FIELDS[field]} exceeds its review limit.`);
    if (entry.trim()) fields[field] = entry.trim();
  }
  return fields;
}
export interface IntakeTextCell { text: string; x: number; width: number }
export interface IntakeTextRow { cells: IntakeTextCell[] }
export interface IntakePdfTextItem extends IntakeTextCell { y: number; height: number }
export interface IntakePage {
  page: number; text: string; method: 'text' | 'ocr'; confidence: number | null;
  layout?: IntakeTextRow[];
}
export interface IntakeSuggestion { field: IntakeField; value: string; page: number; excerpt: string; priority?: number }
export interface LocalIntakeDocument {
  id: string;
  file: File;
  pages: IntakePage[];
  kind: 'policy' | 'declarations' | 'id_card' | 'unknown';
  suggestions: IntakeSuggestion[];
}

const labels = {
  full_name: '(?:first named insured|named insureds?(?:\\s+(?:and|&)\\s+(?:mailing\\s+)?address)?|insured(?:\\s+name)?(?:\\s+and\\s+address)?|name of (?:the )?insured|policy\\s*holder(?:\\s+name)?|business name|legal (?:business )?name|applicant(?:\\s+name)?)',
  address: '(?:mailing address|insured(?:\\s+mailing)? address|address of (?:the )?insured)',
  phone: '(?:(?:insured(?:\\s+contact)?\\s+)?(?:telephone|phone)(?:\\s+(?:number|no\\.?))?)',
  email: '(?:(?:insured(?:\\s+contact)?\\s+)?e-?mail(?:\\s+address)?)',
  carrier: '(?:insurance company|insuring company|underwriting company|underwritten by|issued by|insurer(?:\\s+name)?|carrier(?:\\s+name)?|company name|company(?=\\s*:|\\s*$))',
  policy_number: '(?:policy\\s*(?:number|num\\.?|no\\.?|#)(?:\\s*[:#])?|policy\\s*[:#])',
  effective_date: '(?:policy effective date|effective date|inception date|effective)',
  expiration_date: '(?:policy expiration date|expiration date|expiry date|expires|expiration)',
  premium: '(?:(?:total|estimated total)\\s+(?:estimated\\s+)?(?:policy\\s+|annual\\s+|term\\s+)?premium(?:\\s+(?:including (?:taxes and )?fees|and fees))?|(?:estimated )?annual premium|policy premium|written premium|full term premium|premium total|total policy cost|premium)',
  line_of_business: '(?:line of business|policy type|coverage type|type of (?:policy|insurance)|insurance type|product)',
  period: '(?:policy period|period of insurance|coverage period)',
  third_party: '(?:agent(?: information)?|agency|producer(?: information)?|broker(?: information)?)',
} as const;
type FieldMatch = { field: keyof typeof labels; start: number; end: number; x: number };
const datePattern = '\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?\\s+\\d{1,2},?\\s+\\d{4}';

function dateValue(value: string): string | null {
  const found = value.match(new RegExp(`^(?:${datePattern})\\b`, 'i'))?.[0];
  if (!found) return null;
  const iso = found.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const us = found.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const monthName = found.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const month = monthName ? months.indexOf(monthName[1].slice(0, 3).toLowerCase()) + 1 : 0;
  const normalized = iso ? iso[0] : us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
    : monthName && month ? `${monthName[3]}-${String(month).padStart(2, '0')}-${monthName[2].padStart(2, '0')}` : '';
  if (!normalized || !Number.isFinite(Date.parse(`${normalized}T00:00:00Z`))
    || new Date(`${normalized}T00:00:00Z`).toISOString().slice(0, 10) !== normalized) return null;
  return normalized;
}

export function reconstructPolicyText(items: IntakePdfTextItem[], cellGap?: number): { text: string; layout: IntakeTextRow[] } {
  const groups: Array<{ y: number; height: number; items: IntakePdfTextItem[] }> = [];
  for (const item of items.filter((item) => item.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const previous = groups[groups.length - 1];
    if (previous && Math.abs(previous.y - item.y) <= Math.max(2, Math.min(previous.height, item.height) * 0.4)) {
      previous.items.push(item);
    } else groups.push({ y: item.y, height: item.height, items: [item] });
  }
  const layout = groups.map((group) => {
    const cells: IntakeTextCell[] = [];
    for (const item of group.items.sort((a, b) => a.x - b.x)) {
      const previous = cells[cells.length - 1];
      const gap = previous ? item.x - previous.x - previous.width : 0;
      if (previous && gap < (cellGap ?? Math.max(12, group.height * 1.5))) {
        previous.text += `${gap > group.height * 0.15 ? ' ' : ''}${item.text}`;
        previous.width = Math.max(previous.width, item.x + item.width - previous.x);
      } else cells.push({ text: item.text, x: item.x, width: item.width });
    }
    return { cells };
  });
  return { text: layout.map((row) => row.cells.map((cell) => cell.text).join('  ')).join('\n'), layout };
}

function pageRows(page: IntakePage): IntakeTextRow[] {
  if (page.layout) return page.layout.map((row) => ({
    cells: row.cells.flatMap((cell) => Array.from(cell.text.matchAll(/\S(?:.*?\S)?(?=\s{2,}|$)/g), (match) => ({
      text: match[0], x: cell.x + (match.index ?? 0) / cell.text.length * cell.width,
      width: match[0].length / cell.text.length * cell.width,
    }))),
  }));
  return page.text.split(/\r?\n/).filter((line) => line.trim()).map((line) => ({
    cells: Array.from(line.matchAll(/\S(?:.*?\S)?(?=\s{2,}|$)/g), (match) => ({
      text: match[0], x: match.index ?? 0, width: match[0].length,
    })),
  }));
}
function rowMatches(row: IntakeTextRow): { text: string; matches: FieldMatch[] } {
  const text = row.cells.map((cell) => cell.text).join('  ');
  const matches: FieldMatch[] = [];
  for (const field of Object.keys(labels) as Array<keyof typeof labels>) {
    for (const found of text.matchAll(new RegExp(`\\b${labels[field]}(?=\\s|[:#.-]|$)`, 'gi'))) {
      const start = found.index ?? 0;
      const prefix = text.slice(0, start);
      if (!/(?:^|\s{2,})(?:\d+[.)]\s*)?$/.test(prefix)
        && !/^\s*[:#]/.test(text.slice(start + found[0].length))) continue;
      let offset = 0;
      let x = 0;
      for (const cell of row.cells) {
        if (start < offset + cell.text.length) {
          const localStart = start - offset;
          const numberedPrefix = /^(?:\s*\d+[.)]\s*)?$/.test(cell.text.slice(0, localStart));
          x = cell.x + (numberedPrefix ? 0 : localStart / cell.text.length * cell.width);
          break;
        }
        offset += cell.text.length + 2;
      }
      matches.push({ field, start, end: start + found[0].length, x });
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  return { text, matches: matches.filter((match, index) => !matches.slice(0, index).some((other) => other.start <= match.start && other.end > match.start)) };
}
function normalizedField(field: IntakeField, raw: string): string | null {
  const value = raw.replace(/^[\s:#|=.-]+/, '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > (isIntakeDetail(field) ? 12000 : 1000) || /^(?:not (?:assigned|available|applicable)|unknown|pending|n\/a|none)\b/i.test(value)) return null;
  if (field === 'effective_date' || field === 'expiration_date') return dateValue(value);
  if (field === 'premium') {
    const amount = value.match(/^(?:USD\s*)?\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{1,2})?)(?:\s*(?:USD|annually|annual|for (?:the )?policy (?:period|term)))?\s*$/i);
    return amount ? amount[1].replace(/,/g, '') : null;
  }
  if (field === 'policy_number' && (!/\d/.test(value) || !/^[a-z0-9][a-z0-9 ./-]{1,79}$/i.test(value))) return null;
  if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  if (field === 'phone' && !/^(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?$/i.test(value)) return null;
  if (field === 'full_name' && (/^\d|^(?:policy|effective|expiration|total|agent|producer|broker)\b/i.test(value) || !/[a-z]/i.test(value))) return null;
  return value;
}

export function reviewPolicySuggestions(documents: Pick<LocalIntakeDocument, 'suggestions'>[]): ReviewedIntakeFields {
  const values: ReviewedIntakeFields = {};
  for (const field of Object.keys(INTAKE_FIELDS) as IntakeField[]) {
    const candidates = documents.flatMap((document) => {
      const found = document.suggestions.filter((item) => item.field === field);
      const priority = Math.max(0, ...found.map((item) => item.priority ?? 0));
      return found.filter((item) => isIntakeDetail(field) || (item.priority ?? 0) === priority);
    });
    const distinct = [...new Set(candidates.map((item) => item.value))];
    if (isIntakeDetail(field)) {
      if (distinct.length) values[field] = distinct.join('\n');
    } else if (distinct.length === 1) values[field] = distinct[0];
  }
  return values;
}

function detailSection(line: string): IntakeField | null {
  const heading = line.trim().replace(/^\d+[.)]\s*/, '').replace(/[: -]+$/, '');
  if (/^(?:schedule of )?(?:covered |insured )?(?:vehicles?|autos?|automobiles?)(?: schedule| information| description)?$/i.test(heading)) return 'vehicles';
  if (/^(?:schedule of )?(?:listed |rated |covered )?drivers?(?: schedule| information| list)?$/i.test(heading)) return 'drivers';
  if (/^(?:schedule of )?(?:insured |covered |described )?(?:properties|property|premises|locations?)(?: schedule| information| addresses)?$/i.test(heading)) return 'properties';
  if (/^(?:coverage(?:s)?(?: and limits| limits)?|limits of (?:insurance|liability)|schedule of (?:coverages|limits))(?:\s+(?:limits?|deductibles?|premiums?))*$/i.test(heading)) return 'coverage_limits';
  if (/^(?:policy )?deductibles?(?: schedule)?$/i.test(heading)) return 'deductibles';
  if (/^(?:additional (?:policy )?(?:details|information|coverages)|forms and endorsements|endorsement schedule|mortgagee(?:s)?|additional insureds?|loss payees?)$/i.test(heading)) return 'additional_details';
  return null;
}

function structuredDetails(rows: IntakeTextRow[], page: number): IntakeSuggestion[] {
  const found: IntakeSuggestion[] = [];
  let section: IntakeField | null = null;
  let headers: IntakeTextCell[] = [];
  const add = (field: IntakeField, value: string, excerpt: string): void => {
    if (value.trim() && !found.some((item) => item.field === field && item.value === value)) found.push({ field, value, excerpt, page });
  };
  const columns = (row: IntakeTextRow): IntakeTextCell[] => row.cells.flatMap((cell) => {
    const labels = [...cell.text.matchAll(/\b(?:coverages?|limits?(?: of (?:insurance|liability))?|deductibles?|premiums?|name|date of birth|DOB|licen[cs]e number|year|make|model|VIN)\b/gi)];
    return labels.length > 1 ? labels.map((label) => ({
      text: label[0], x: cell.x + (label.index ?? 0) / cell.text.length * cell.width,
      width: label[0].length / cell.text.length * cell.width,
    })) : [cell];
  });
  for (const row of rows) {
    const line = row.cells.map((cell) => cell.text).join('  ').trim();
    const tableSection = /\byear\b/i.test(line) && /\b(?:make|model)\b/i.test(line) && /\b(?:vin|vehicle identification)\b/i.test(line) ? 'vehicles'
      : /\bname\b/i.test(line) && /\b(?:date of birth|DOB|licen[cs]e)\b/i.test(line) ? 'drivers'
        : /^(?:loc(?:ation)?\.?|premises)(?:\s+(?:no\.?|number))?\s{2,}.*\baddress\b/i.test(line) ? 'properties' : null;
    const next = detailSection(line) ?? tableSection;
    if (next) {
      section = next;
      headers = tableSection || next === 'coverage_limits' && (row.cells.length > 1 || /\b(?:deductibles?|premiums?)\b/i.test(line)) ? columns(row) : [];
      continue;
    }
    // Keep sensitive identifiers out of automatic field proposals, including schedule rows.
    if (/\b(?:social security|ssn|bank account|routing number|date of birth|DOB|(?:driver'?s? )?licen[cs]e number|FEIN|EIN|tax id|credit card)\b/i.test(line)) {
      if (section === 'drivers') headers = columns(row);
      continue;
    }
    const headings = rowMatches(row).matches;
    if (headings.length && !/^(?:coverage|limit|deductible)\b/i.test(line)) { section = null; headers = []; }
    if (/^(?:DBA|doing business as|business description|business classification|class code|NAICS|SIC|form(?: number)?|endorsement(?: number)?)\s*[:#]/i.test(line)) add('additional_details', line, line);
    if (/^(?:property address|premises address|(?:insured )?location(?: \d+)?)\s*:\s*\d/i.test(line)) {
      add('properties', line, line);
      if (section !== 'properties') { section = null; headers = []; }
      continue;
    }
    if (/\b(?:this policy|we will|company will|subject to|terms and conditions|page \d+ of)\b/i.test(line)) { section = null; headers = []; }
    const limit = line.match(/^(each occurrence|general aggregate|products[- /]+completed operations(?: aggregate)?|personal (?:and|&) advertising injury|damage to (?:premises|rented premises)|medical (?:expense|payments)|bodily injury(?: liability)?|property damage(?: liability)?|combined single limit|uninsured(?:\/underinsured)? motorists?|dwelling|other structures|personal property|loss of use|liability|building|business personal property)\b/i);
    if (limit && !(section === 'coverage_limits' && headers.length > 1)
      && /(?:\$|USD\s*)\s*\d|\b\d[\d,]*\s*(?:per|each)\b/i.test(line)) add('coverage_limits', line, line);
    if (/\b(?:deductible|ded\.?)\s*[:=]?\s*\$?\s*\d/i.test(line)) add('deductibles', line, line);
    if (!section && !headings.length && !limit && !/\b(?:deductible|ded\.?)\b/i.test(line)
      && /^[A-Z][A-Za-z0-9/& ()'-]{1,60}\s*:\s*\S.{0,999}$/.test(line)) add('additional_details', line, line);
    if (!section) continue;
    if (section === 'vehicles' && /\b(?:year|make|model|vin|vehicle identification)\b/i.test(line) && !/\b(?:19|20)\d{2}\b/.test(line)) { headers = row.cells; continue; }
    if (section === 'drivers' && /^(?:no\.?|number|name|driver(?: name)?)(?:\s|$)/i.test(line) && !/\d/.test(line)) { headers = columns(row); continue; }
    if (section === 'coverage_limits' && /\b(?:limit|deductible|premium)\b/i.test(line) && !/\d/.test(line)) { headers = columns(row); continue; }
    if (section === 'coverage_limits' && headers.length > 1) {
      const deductible = headers.find((cell) => /deductible/i.test(cell.text));
      const premium = headers.find((cell) => /premium/i.test(cell.text));
      const value = row.cells.filter((cell) => (!deductible || cell.x < deductible.x - 12) && (!premium || cell.x < premium.x - 12)).map((cell) => cell.text).join(' | ');
      if (value.includes(' | ')) add(section, value, line);
      if (deductible) {
        const amount = row.cells.filter((cell) => cell.x >= deductible.x - 12 && (!premium || cell.x < premium.x - 12)).map((cell) => cell.text).join(' ');
        if (/\d/.test(amount)) add('deductibles', `${row.cells[0]?.text}: ${amount}`, line);
      }
    } else if (section === 'vehicles') {
      if (/\b(?:19|20)\d{2}\b/.test(line) || /\b[A-HJ-NPR-Z0-9]{17}\b/i.test(line)) add(section, line, line);
    } else if (section === 'drivers') {
      const nameColumn = headers.find((cell) => /name/i.test(cell.text));
      const nameIndex = nameColumn ? headers.indexOf(nameColumn) : -1;
      const end = nameIndex >= 0 ? headers[nameIndex + 1]?.x : undefined;
      const name = nameColumn ? row.cells.filter((cell) => cell.x >= nameColumn.x - 12 && (end === undefined || cell.x < end - 12)).map((cell) => cell.text).join(' ') : line;
      if (/[a-z]/i.test(name) && !/\d{4,}|@|\b(?:DOB|licen[cs]e|birth)\b/i.test(name)) add(section, name.replace(/^\d+[.)]?\s+/, ''), line);
    } else if (section === 'properties') {
      if (/\d/.test(line) || /\b(?:construction|occupancy|roof|building|location)\b/i.test(line)) add(section, line, line);
    } else if (section === 'coverage_limits' || section === 'deductibles') {
      if (/\d/.test(line)) add(section, line, line);
    } else if (line.length < 1000 && /[:\d]/.test(line) && !/\b(?:DOB|licen[cs]e|birth)\b/i.test(line)) add(section, line, line);
  }
  return found;
}

export function suggestPolicyFields(pages: IntakePage[]): Pick<LocalIntakeDocument, 'kind' | 'suggestions'> {
  const text = pages.map((page) => page.text).join('\n');
  const kind = /(?:insurance identification card|insurance id card|evidence of liability insurance)/i.test(text) ? 'id_card'
    : /\bdeclarations\b/i.test(text) ? 'declarations' : /\bpolicy\b/i.test(text) ? 'policy' : 'unknown';
  const suggestions: IntakeSuggestion[] = [];
  for (const page of pages) {
    const rows = pageRows(page);
    let contactColumns: Array<{ x: number; thirdParty: boolean }> = [];
    const add = (field: IntakeField, raw: string, excerpt: string, priority?: number): void => {
      const value = normalizedField(field, raw);
      if (value) {
        if (!suggestions.some((item) => item.field === field && item.value === value)) {
          suggestions.push({ field, value, page: page.page, excerpt: excerpt.trim(), ...(priority === undefined ? {} : { priority }) });
        }
      }
    };
    for (const [rowIndex, row] of rows.entries()) {
      const { text: line, matches } = rowMatches(row);
      if (detailSection(line)) continue;
      const sections = matches.filter((match) => match.field === 'full_name' || match.field === 'third_party');
      if (sections.length) contactColumns = sections.map((match) => ({ x: match.x, thirdParty: match.field === 'third_party' }));
      if (!matches.length) {
        if (rowIndex < 12 && row.cells.length === 1 && !/\b(?:agency|broker|agent)\b/i.test(line)
          && /^[A-Z][A-Z0-9 &.,'-]+(?:INSURANCE (?:COMPANY|CO\.?|CORPORATION)|INDEMNITY (?:COMPANY|CO\.?)|LLOYD'?S)$/i.test(line)) add('carrier', line, line);
        const heading = line.match(/^(commercial general liability|general liability|business auto|commercial auto(?:mobile)?|businessowners?|business owners|workers[' ]? compensation(?: and employers[' ]? liability)?|commercial property|homeowners?|home owners|personal auto(?:mobile)?|auto(?:mobile)?|umbrella|motor truck cargo|inland marine|commercial package|professional liability|garage liability)(?:\s+(?:coverage(?: part| form)?|insurance|policy))?(?:\s+declarations|\s+coverage form|\s+policy|$)/i);
        if (heading) add('line_of_business', heading[1][0].toUpperCase() + heading[1].slice(1).toLowerCase(), line);
      }
      for (const [matchIndex, match] of matches.entries()) {
        if (match.field === 'third_party') continue;
        const contactColumn = contactColumns.filter((column) => column.x <= match.x + 12).at(-1);
        if (contactColumn?.thirdParty && ['phone', 'email', 'address'].includes(match.field)) continue;
        const nextLabel = matches[matchIndex + 1];
        let raw = line.slice(match.end, nextLabel?.start).replace(/^[\s:#|=-]+/, '').trim();
        let excerpt = line;
        let valueRow = rowIndex;
        if (!raw) {
          const following = rows[rowIndex + 1];
          if (following && !rowMatches(following).matches.length) {
            const cells = following.cells.filter((cell) => cell.x >= match.x - 12 && (!nextLabel || cell.x < nextLabel.x - 12));
            raw = cells.map((cell) => cell.text).join(' ');
            excerpt += `\n${following.cells.map((cell) => cell.text).join('  ')}`;
            valueRow += 1;
          }
        }
        if (match.field === 'period') {
          const dates = raw.match(new RegExp(datePattern, 'gi')) ?? [];
          if (dates.length === 2) { add('effective_date', dates[0], excerpt); add('expiration_date', dates[1], excerpt); }
          continue;
        }
        const valueLabels = rowMatches({ cells: [{ text: raw, x: 0, width: raw.length }] }).matches;
        if (!raw || valueLabels.some((label) => label.start === 0 && label.end === raw.length)) continue;
        if (match.field === 'address' || match.field === 'full_name') {
          const combinedAddress = match.field === 'full_name' && /\baddress\b/i.test(line.slice(match.start, match.end));
          if (match.field === 'full_name') add(match.field, raw, excerpt);
          if (match.field === 'address' || combinedAddress) {
            const addressRow = match.field === 'address' ? valueRow : valueRow + 1;
            const inColumn = (row: IntakeTextRow | undefined): string => row?.cells
              .filter((cell) => cell.x >= match.x - 12 && (!nextLabel || cell.x < nextLabel.x - 12))
              .map((cell) => cell.text).join(' ') ?? '';
            const street = match.field === 'address' ? raw : inColumn(rows[addressRow]);
            if (/^(?:\d+\s+\S|P\.?\s*O\.?\s+Box\b)/i.test(street)) {
              const city = inColumn(rows[addressRow + 1]);
              const cityLine = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(city) ? city : '';
              add('address', [street, cityLine].filter(Boolean).join(', '), `${excerpt}${combinedAddress ? `\n${street}` : ''}${cityLine ? `\n${cityLine}` : ''}`);
            }
          }
        } else add(match.field, raw, excerpt, match.field === 'premium' ? /\btotal\b/i.test(line.slice(match.start, match.end)) ? 2 : 1 : undefined);
      }
    }
    suggestions.push(...structuredDetails(rows, page.page).filter((item) => !suggestions.some((existing) => existing.field === item.field && existing.value === item.value)));
  }
  return { kind, suggestions };
}

export function validateIntakeFile(file: Pick<File, 'name' | 'size' | 'type'>): void {
  if (file.size < 1 || file.size > INTAKE_MAX_FILE_BYTES) throw new Error('Choose a nonempty document of 25 MB or less.');
  if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)
    || !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Use a PDF, PNG, JPEG or WebP document. Convert other photos to one of these formats first.');
  }
}
