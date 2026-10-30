import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { stripContractPrefix } from './lead-identity';

/**
 * Vendor-aware lead import engine.
 * Detects the file's vendor profile, converts rows into structured staged
 * prospects (grouping commercial contact rows into companies, coalescing
 * personal multi-phone/email columns), and preserves compliance data.
 */

export type VendorProfile = 'commercial' | 'personal_auto' | 'generic';

export interface ProspectContact {
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
}

export interface RenewalSignal {
  type: string;
  date: string; // ISO yyyy-mm-dd
  carrier: string | null;
  broker: string | null;
}

export interface StagedProspect {
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  line_of_business: string;
  profile: Record<string, unknown>;
  raw: Record<string, unknown>[];
}

export interface ParsedImport {
  vendorProfile: VendorProfile;
  rowCount: number;
  prospects: StagedProspect[];
}

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^"+|"+$/g, '').trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return null;
}

function normKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normRow(row: Row): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(row)) out[normKey(key)] = text(value);
  return out;
}

function pick(row: Record<string, string | null>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = row[normKey(alias)];
    if (value) return value;
  }
  return null;
}

/** Excel serial day-count -> ISO date (1899-12-30 epoch). */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 10000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** Parses MM-DD-YYYY, MM/DD/YYYY, YYYY-MM-DD, or an Excel serial. */
export function parseVendorDate(value: unknown): string | null {
  if (typeof value === 'number') return excelSerialToIso(value);
  const str = text(value);
  if (!str) return null;

  const asNumber = Number(str);
  if (Number.isFinite(asNumber) && str.length <= 8 && !str.includes('-') && !str.includes('/')) {
    return excelSerialToIso(asNumber);
  }

  const mdy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }

  const ymd = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }

  return null;
}

function normPhone(value: unknown): string | null {
  const str = text(value);
  if (!str) return null;
  const digits = str.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (digits.length !== 10) return str;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ---------- File parsing ----------

export function parseFileRows(buffer: Buffer, fileName: string): Row[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return parseCsv(buffer.toString('utf-8'), { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true }) as Row[];
  }
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  // Pick the best sheet: favor ones whose headers look like column names
  // (text, not numbers/emails) — vendors ship junk or headerless extra sheets.
  let best: Row[] = [];
  let bestScore = -1;
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[name], { defval: null });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const namedHeaders = headers.filter(
      (header) => Number.isNaN(Number(header)) && !header.includes('@') && !/^\d/.test(header.trim()),
    ).length;
    const score = rows.length * (namedHeaders * namedHeaders);
    if (score > bestScore) {
      bestScore = score;
      best = rows;
    }
  }
  return best;
}

// ---------- Profile detection ----------

export function detectVendorProfile(rows: Row[]): VendorProfile {
  if (rows.length === 0) return 'generic';
  const keys = new Set(Object.keys(rows[0]).map(normKey));

  if (keys.has('prospectname') && (keys.has('contactfirstname') || keys.has('contactlastname'))) {
    return 'commercial';
  }
  if (keys.has('car1make') || (keys.has('leadid') && keys.has('firstname') && (keys.has('cellcombo') || keys.has('landlinecellcombo')))) {
    return 'personal_auto';
  }
  return 'generic';
}

// ---------- Commercial (company-grained) ----------

const RENEWAL_COLUMNS: Array<{ dateCol: string; type: string; carrierCol?: string; brokerCol?: string }> = [
  { dateCol: 'WC Renewal', type: 'Workers Comp', carrierCol: 'WC Carrier', brokerCol: 'WC Broker' },
  { dateCol: 'Pension Renewal', type: 'Pension', carrierCol: 'Pension Carrier', brokerCol: 'Pension Broker' },
  { dateCol: 'Benefits Renewal', type: 'Benefits', carrierCol: 'Benefits Carrier', brokerCol: 'Benefits Broker' },
  { dateCol: 'General Liability X-Date Prediction', type: 'General Liability' },
  { dateCol: 'Commercial Auto X-Date Prediction', type: 'Commercial Auto' },
  { dateCol: 'BIPD/Primary X-Date', type: 'BIPD Primary', carrierCol: 'BIPD/Primary Carrier' },
  { dateCol: 'BIPD/Excess X-Date', type: 'BIPD Excess', carrierCol: 'BIPD/Excess Carrier' },
  { dateCol: 'CARGO X-Date', type: 'Cargo', carrierCol: 'CARGO Carrier' },
  { dateCol: 'Surety X-Date', type: 'Surety', carrierCol: 'Surety Carrier' },
];

/** Everything non-empty that wasn't explicitly mapped — guarantees no vendor data is ever dropped. */
function collectExtras(row: Row, consumedKeys: Set<string>, skipPredicate?: (key: string, value: string) => boolean): Record<string, string> {
  const extras: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(row)) {
    if (consumedKeys.has(normKey(key))) continue;
    const value = text(rawValue);
    if (!value) continue;
    if (skipPredicate && skipPredicate(key, value)) continue;
    extras[key] = value;
  }
  return extras;
}

function commercialProspects(rows: Row[]): StagedProspect[] {
  const groups = new Map<string, Row[]>();
  const contractsByKey = new Map<string, string[]>();
  for (const row of rows) {
    const n = normRow(row);
    const rawCompany = pick(n, ['prospect name', 'company', 'company name']) ?? 'Unknown company';
    // Contract-award variants ("CPX2024X... - ACME INC") belong to the parent company.
    const { name: company, contract } = stripContractPrefix(rawCompany);
    const zip = pick(n, ['zip']) ?? '';
    const key = `${company.toLowerCase()}|${zip}`;
    if (contract) {
      contractsByKey.set(key, [...(contractsByKey.get(key) ?? []), contract]);
    }
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const prospects: StagedProspect[] = [];
  for (const [groupKey, groupRows] of groups.entries()) {
    const firstRaw = normRow(groupRows[0]);
    const rawName = pick(firstRaw, ['prospect name', 'company', 'company name']) ?? 'Unknown company';
    const company = stripContractPrefix(rawName).name;
    const contractAwards = [...new Set(contractsByKey.get(groupKey) ?? [])];

    const contacts: ProspectContact[] = [];
    const seenContacts = new Set<string>();
    for (const row of groupRows) {
      const n = normRow(row);
      const firstName = pick(n, ['contact first name']);
      const lastName = pick(n, ['contact last name']);
      const email = pick(n, ['contact email', 'email'])?.toLowerCase() ?? null;
      const phone = normPhone(pick(n, ['contact phone', 'phone']));
      // Keep nameless rows that still carry contact data — never drop an email or phone.
      const name = [firstName, lastName].filter(Boolean).join(' ').trim() || (email || phone ? 'Primary contact' : '');
      if (!name) continue;
      const contactKey = `${name.toLowerCase()}|${email ?? ''}`;
      if (seenContacts.has(contactKey)) continue;
      seenContacts.add(contactKey);
      contacts.push({
        name,
        position: pick(n, ['contact position', 'title']),
        email,
        phone,
      });
    }

    // Merge the group into one dense row: first non-empty value per column wins.
    // Contact rows and contract-award variants often carry data the first row lacks.
    const row0: Row = {};
    for (const row of groupRows) {
      for (const [key, value] of Object.entries(row)) {
        if (text(row0[key])) continue;
        if (text(value)) row0[key] = value;
      }
    }

    // Renewals: union across all rows (variants may carry different coverage lines).
    const renewals: RenewalSignal[] = [];
    const seenRenewals = new Set<string>();
    for (const row of groupRows) {
      for (const spec of RENEWAL_COLUMNS) {
        const date = parseVendorDate(row[spec.dateCol]);
        if (!date) continue;
        const carrier = spec.carrierCol ? text(row[spec.carrierCol]) : null;
        const renewalKey = `${spec.type}|${date}|${carrier ?? ''}`;
        if (seenRenewals.has(renewalKey)) continue;
        seenRenewals.add(renewalKey);
        renewals.push({
          type: spec.type,
          date,
          carrier,
          broker: spec.brokerCol ? text(row[spec.brokerCol]) : null,
        });
      }
    }

    // DOT narrative signals, collected across all rows in the group.
    const dotSignals: string[] = [];
    const seenSignals = new Set<string>();
    for (const row of groupRows) {
      for (const [key, value] of Object.entries(row)) {
        const str = text(value);
        if (!str || !key.startsWith('DOT:')) continue;
        const signal = str.toLowerCase() === 'yes' ? key.replace('DOT: ', '') : str;
        if (seenSignals.has(signal)) continue;
        seenSignals.add(signal);
        dotSignals.push(signal);
      }
    }

    const first = normRow(row0);

    // Insurance intelligence domains — formatted first-class, not buried in extras.
    const workersComp = {
      renewal: parseVendorDate(row0['WC Renewal']),
      carrier: text(row0['WC Carrier']),
      broker: text(row0['WC Broker']),
    };
    const pension = {
      renewal: parseVendorDate(row0['Pension Renewal']),
      participants: text(row0['Pension Participants']),
      carrier: text(row0['Pension Carrier']),
      broker: text(row0['Pension Broker']),
    };
    const benefits = {
      renewal: parseVendorDate(row0['Benefits Renewal']),
      participants: text(row0['Benefits Participants']),
      carrier: text(row0['Benefits Carrier']),
      broker: text(row0['Benefits Broker']),
    };
    const liability = {
      gl_xdate: parseVendorDate(row0['General Liability X-Date Prediction']),
      commercial_auto_xdate: parseVendorDate(row0['Commercial Auto X-Date Prediction']),
      fidelity_bond: text(row0['Fidelity Bond']),
    };
    const osha = {
      safety_violations: text(row0['OSHA Safety Violations']),
      health_violations: text(row0['OSHA Health Violations']),
    };
    const dot = {
      units: text(row0['DOT Units']),
      drivers: text(row0['DOT Drivers']),
      violations: text(row0['DOT Violations']),
      intrastate: text(row0['DOT Intrastate']),
      interstate: text(row0['DOT Interstate']),
      bipd_primary: { xdate: parseVendorDate(row0['BIPD/Primary X-Date']), carrier: text(row0['BIPD/Primary Carrier']) },
      bipd_excess: { xdate: parseVendorDate(row0['BIPD/Excess X-Date']), carrier: text(row0['BIPD/Excess Carrier']) },
      cargo: { xdate: parseVendorDate(row0['CARGO X-Date']), carrier: text(row0['CARGO Carrier']) },
      surety: { xdate: parseVendorDate(row0['Surety X-Date']), carrier: text(row0['Surety Carrier']) },
      signals: dotSignals.slice(0, 30),
    };
    const financials990 = {
      report_type: text(row0['990 Report Type']),
      report_year: text(row0['990 Report Year']),
      revenue: text(row0['990 Revenue']),
      expenses: text(row0['990 Expenses']),
      net_assets: text(row0['990 Net Assets']),
      insurance_expenses: text(row0['990 Insurance Expenses']),
    };

    const primaryContact = contacts.find((contact) => contact.email) ?? contacts[0] ?? null;
    const addressParts = [pick(first, ['address']), pick(first, ['city']), pick(first, ['state']), pick(first, ['zip'])].filter(Boolean);

    const consumed = new Set(
      [
        'prospect name', 'company', 'company name', 'state', 'city', 'zip', 'address',
        'contact first name', 'contact last name', 'contact position', 'contact email', 'contact phone',
        'industry', 'primary naics', 'naics list', 'sales range', 'hq phone', 'ein', 'employees',
        'website', 'company linkedin', 'fidelity bond',
        'pension participants', 'benefits participants',
        'osha safety violations', 'osha health violations',
        'dot units', 'dot drivers', 'dot violations', 'dot intrastate', 'dot interstate',
        '990 report type', '990 report year', '990 revenue', '990 expenses', '990 net assets', '990 insurance expenses',
        ...RENEWAL_COLUMNS.flatMap((spec) => [spec.dateCol, spec.carrierCol ?? '', spec.brokerCol ?? '']),
      ]
        .filter(Boolean)
        .map(normKey),
    );
    const extras = collectExtras(row0, consumed, (key) => key.startsWith('DOT:'));

    prospects.push({
      full_name: company,
      email: primaryContact?.email ?? null,
      phone: primaryContact?.phone ?? normPhone(pick(first, ['hq phone'])),
      address: addressParts.join(', ') || null,
      line_of_business: 'Commercial',
      profile: {
        kind: 'commercial',
        company: {
          name: company,
          industry: pick(first, ['industry']),
          naics: pick(first, ['primary naics']),
          naics_list: pick(first, ['naics list']),
          sales_range: pick(first, ['sales range']),
          employees: pick(first, ['employees'])?.replace(/"/g, ''),
          ein: pick(first, ['ein']),
          website: pick(first, ['website']),
          linkedin: pick(first, ['company linkedin']),
          hq_phone: normPhone(pick(first, ['hq phone'])),
        },
        contacts,
        renewals,
        workers_comp: workersComp,
        pension,
        benefits,
        liability,
        osha,
        dot,
        financials_990: financials990,
        contract_awards: contractAwards,
        extras,
      },
      raw: groupRows,
    });
  }

  return prospects;
}

// ---------- Personal auto (person-grained) ----------

function personalProspects(rows: Row[]): StagedProspect[] {
  return rows.map((row) => {
    const n = normRow(row);
    const firstName = pick(n, ['first_name', 'first name']);
    const lastName = pick(n, ['last_name', 'last name']);
    const name =
      [firstName, lastName].filter(Boolean).join(' ').trim() ||
      pick(n, ['applicant_name', 'applicant name', 'name']) ||
      'Unknown applicant';

    const phone = normPhone(
      pick(n, ['cell_phone', 'cell phone']) ??
        pick(n, ['landline']) ??
        pick(n, ['cell_combo', 'landline_cell_combo', 'phone']),
    );
    const email = (pick(n, ['email']) ?? pick(n, ['email_combo', 'recent_email_1']))?.toLowerCase() ?? null;

    const addressParts = [
      pick(n, ['address', 'street address']),
      pick(n, ['city']),
      pick(n, ['state']),
      pick(n, ['zip_plus_four', 'zip']),
    ].filter(Boolean);

    const vehicle = {
      make: pick(n, ['car1_make']),
      model: pick(n, ['car1_model']),
      year: pick(n, ['car1_model_year']),
      trim: pick(n, ['car1_trim']),
      ownership: pick(n, ['car1_ownership']),
      annual_mileage: pick(n, ['car1_annual_mileage']),
      main_use: pick(n, ['car1_main_use']),
    };
    const hasVehicle = Object.values(vehicle).some(Boolean);

    const consumed = new Set(
      [
        'first_name', 'last_name', 'applicant_name', 'name', 'address', 'city', 'state', 'zip_plus_four', 'zip',
        'cell_phone', 'landline', 'cell_combo', 'landline_cell_combo', 'phone',
        'email', 'email_combo', 'recent_email_1', 'recent_email_2',
        'car1_make', 'car1_model', 'car1_model_year', 'car1_trim', 'car1_ownership', 'car1_annual_mileage', 'car1_main_use', 'car1_storage',
        'dob', 'gender', 'marital_status', 'homeowner', 'coverage', 'carrier_name',
        'jornaya_lead_id', 'trusted_form', 'ip_address', 'date_requested', 'lead_id',
      ].map(normKey),
    );
    const extras = collectExtras(row, consumed);

    return {
      full_name: name,
      email,
      phone,
      address: addressParts.join(', ') || null,
      line_of_business: 'Personal Auto',
      profile: {
        kind: 'personal_auto',
        demographics: {
          dob: parseVendorDate(row['dob']),
          gender: pick(n, ['gender']),
          marital_status: pick(n, ['marital_status']),
          homeowner: pick(n, ['homeowner']),
        },
        vehicles: hasVehicle ? [vehicle] : [],
        coverage: pick(n, ['coverage']),
        current_carrier: pick(n, ['carrier_name', 'current carrier']),
        alternate_contacts: {
          landline: normPhone(pick(n, ['landline'])),
          cell: normPhone(pick(n, ['cell_phone'])),
          recent_emails: [pick(n, ['recent_email_1']), pick(n, ['recent_email_2'])].filter(Boolean),
        },
        compliance: {
          jornaya_lead_id: pick(n, ['jornaya_lead_id']),
          trusted_form: pick(n, ['trusted_form']),
          ip_address: pick(n, ['ip_address']),
          requested_at: parseVendorDate(row['date_requested']),
          vendor_lead_id: pick(n, ['lead_id']),
        },
        extras,
      },
      raw: [row],
    };
  });
}

// ---------- Generic fallback ----------

function genericProspects(rows: Row[]): StagedProspect[] {
  return rows.map((row, index) => {
    const n = normRow(row);
    const combinedName = [pick(n, ['first name', 'first_name']), pick(n, ['last name', 'last_name'])]
      .filter(Boolean)
      .join(' ')
      .trim();
    const name =
      pick(n, ['full_name', 'full name', 'name', 'applicant name']) ||
      combinedName ||
      pick(n, ['company', 'company name', 'business name', 'prospect name']) ||
      `Imported lead ${index + 1}`;

    const consumed = new Set(
      [
        'full_name', 'full name', 'name', 'applicant name', 'first name', 'first_name', 'last name', 'last_name',
        'company', 'company name', 'business name', 'prospect name',
        'email', 'work email', 'contact email', 'phone', 'phone number', 'mobile', 'telephone', 'cell',
        'address', 'street address', 'location', 'line of business', 'lob',
      ].map(normKey),
    );

    return {
      full_name: name,
      email: pick(n, ['email', 'work email', 'contact email'])?.toLowerCase() ?? null,
      phone: normPhone(pick(n, ['phone', 'phone number', 'mobile', 'telephone', 'cell'])),
      address: pick(n, ['address', 'street address', 'location']),
      line_of_business: pick(n, ['line of business', 'lob']) ?? 'General',
      profile: { kind: 'generic', extras: collectExtras(row, consumed) },
      raw: [row],
    };
  });
}

export function parseImport(buffer: Buffer, fileName: string): ParsedImport {
  const rows = parseFileRows(buffer, fileName);
  const vendorProfile = detectVendorProfile(rows);
  return { vendorProfile, rowCount: rows.length, prospects: buildProspects(rows, vendorProfile) };
}

/** Rebuilds prospects from already-captured raw rows (staging re-parse, lead repair). */
export function buildProspects(rows: Row[], vendorProfile: VendorProfile): StagedProspect[] {
  if (vendorProfile === 'commercial') return commercialProspects(rows);
  if (vendorProfile === 'personal_auto') return personalProspects(rows);
  return genericProspects(rows);
}

export type { Row as ImportRow };
