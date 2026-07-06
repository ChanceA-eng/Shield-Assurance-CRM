import { NextResponse } from 'next/server';
import { parse as parseCsv } from 'csv-parse/sync';
import pdf from 'pdf-parse';
import * as XLSX from 'xlsx';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

export const runtime = 'nodejs';

interface LeadInsert {
  full_name: string;
  business: string | null;
  industry: string | null;
  category: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  line_of_business: string;
  source: string;
  status: string;
  website: string | null;
  est_employees: string | null;
  est_revenue: string | null;
  risk_exposure: string | null;
  details: string | null;
  form_payload: Record<string, unknown>;
}

type GenericRow = Record<string, unknown>;

const ROW_BATCH_SIZE = 300;
const MAX_RISK_EXPOSURE_LENGTH = 2000;

function normalizeText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeRow(row: GenericRow): Record<string, string | null> {
  const output: Record<string, string | null> = {};

  for (const [key, rawValue] of Object.entries(row)) {
    output[normalizeKey(key)] = normalizeText(rawValue);
  }

  return output;
}

function pickValue(row: Record<string, string | null>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const value = row[normalizeKey(alias)];
    if (value) {
      return value;
    }
  }

  return null;
}

function inferLineOfBusiness(value: string | null): string {
  const normalized = value?.toLowerCase() ?? '';

  if (normalized.includes('personal') || normalized.includes('auto') || normalized.includes('home')) {
    return 'Personal';
  }

  if (normalized.includes('commercial') || normalized.includes('business') || normalized.includes('workers')) {
    return 'Commercial';
  }

  return value?.trim() || 'Commercial';
}

function normalizeWebsite(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  const cleaned = rawValue.replace(/[),.;]+$/g, '').trim();
  if (!cleaned) {
    return null;
  }

  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    return cleaned;
  }

  return `https://${cleaned}`;
}

function toRiskExposure(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, MAX_RISK_EXPOSURE_LENGTH);
}

function toLeadInsert(row: GenericRow, index: number, fileName: string, importType: 'csv' | 'excel'): LeadInsert {
  const normalized = normalizeRow(row);

  const name =
    pickValue(normalized, ['full_name', 'full name', 'name']) ??
    pickValue(normalized, ['company', 'company_name', 'company name', 'business name']) ??
    `Prospect ${index + 1}`;

  const phone = pickValue(normalized, ['phone', 'phone number', 'mobile', 'telephone']);
  const email = pickValue(normalized, ['email', 'public email', 'work email']);
  const industry = pickValue(normalized, ['industry', 'naics industry', 'sector']);
  const category = pickValue(normalized, ['category', 'class', 'segment']);
  const address = pickValue(normalized, ['address', 'street address', 'location']);
  const website = normalizeWebsite(pickValue(normalized, ['website', 'web site', 'domain', 'url']));
  const estEmployees = pickValue(normalized, ['est employees', 'estimated employees', 'employees', 'employee count']);
  const estRevenue = pickValue(normalized, ['est revenue', 'estimated revenue', 'annual revenue', 'revenue']);
  const riskExposure =
    pickValue(normalized, ['risk exposure', 'risk', 'risk notes']) ??
    pickValue(normalized, ['address', 'location']) ??
    pickValue(normalized, ['notes', 'description']);

  const lineOfBusiness = inferLineOfBusiness(pickValue(normalized, ['line of business', 'lob', 'category', 'segment']));

  return {
    full_name: name,
    business: name,
    industry,
    category,
    phone,
    email,
    address,
    line_of_business: lineOfBusiness,
    source: 'prospect_import',
    status: 'new',
    website,
    est_employees: estEmployees,
    est_revenue: estRevenue,
    risk_exposure: toRiskExposure(riskExposure),
    details: normalizeText(`Imported from ${fileName}`),
    form_payload: {
      import_type: importType,
      imported_from: fileName,
      row,
    },
  };
}

function parseCsvRows(contents: string): GenericRow[] {
  return parseCsv(contents, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as GenericRow[];
}

function parseExcelRows(buffer: Buffer): GenericRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<GenericRow>(sheet, { defval: null });
}

function extractWebsite(block: string): string | null {
  const match = block.match(/((?:https?:\/\/|www\.)[^\s]+)/i);
  if (!match) {
    return null;
  }

  return normalizeWebsite(match[1] ?? null);
}

function extractEmail(block: string): string | null {
  const match = block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractPhone(block: string): string | null {
  const match = block.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return match ? match[0] : null;
}

function extractName(block: string): string | null {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const firstLine = lines[0];
  if (firstLine.length > 3 && firstLine.length <= 90) {
    return firstLine;
  }

  return null;
}

function parsePdfProspects(text: string, fileName: string): LeadInsert[] {
  const chunks = text
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 30)
    .slice(0, 150);

  const prospects = chunks.map((chunk, index) => {
    const name = extractName(chunk) ?? `${fileName.replace(/\.pdf$/i, '')} Prospect ${index + 1}`;
    const website = extractWebsite(chunk);
    const email = extractEmail(chunk);
    const phone = extractPhone(chunk);

    return {
      full_name: name,
      business: name,
      industry: null,
      category: null,
      phone,
      email,
      address: null,
      line_of_business: inferLineOfBusiness(chunk),
      source: 'prospect_import',
      status: 'new',
      website,
      est_employees: null,
      est_revenue: null,
      risk_exposure: toRiskExposure(chunk),
      details: `Imported from PDF ${fileName}`,
      form_payload: {
        import_type: 'pdf',
        imported_from: fileName,
      },
    };
  });

  if (prospects.length > 0) {
    return prospects;
  }

  return [
    {
      full_name: fileName.replace(/\.pdf$/i, '') || 'PDF Prospect',
      business: fileName.replace(/\.pdf$/i, '') || 'PDF Prospect',
      industry: null,
      category: null,
      phone: null,
      email: null,
      address: null,
      line_of_business: 'Commercial',
      source: 'prospect_import',
      status: 'new',
      website: null,
      est_employees: null,
      est_revenue: null,
      risk_exposure: toRiskExposure(text),
      details: `Imported from PDF ${fileName}`,
      form_payload: {
        import_type: 'pdf',
        imported_from: fileName,
      },
    },
  ];
}

async function parseFileToLeads(file: File): Promise<LeadInsert[]> {
  const fileName = file.name;
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.csv')) {
    const csvText = await file.text();
    const rows = parseCsvRows(csvText);
    return rows.map((row, index) => toLeadInsert(row, index, fileName, 'csv'));
  }

  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseExcelRows(buffer);
    return rows.map((row, index) => toLeadInsert(row, index, fileName, 'excel'));
  }

  if (lowerName.endsWith('.pdf')) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await pdf(buffer);
    return parsePdfProspects(parsed.text || '', fileName);
  }

  throw new Error('Unsupported file type. Upload CSV, Excel (.xlsx/.xls), or PDF.');
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
    }

    const formData = await request.formData();
    const uploadedFile = formData.get('file');

    if (!(uploadedFile instanceof File)) {
      return NextResponse.json({ message: 'No file provided.' }, { status: 400 });
    }

    const leads = await parseFileToLeads(uploadedFile);
    const validLeads = leads.filter((lead) => lead.full_name.trim().length > 0);

    if (validLeads.length === 0) {
      return NextResponse.json({ message: 'No prospect rows could be extracted from this file.' }, { status: 400 });
    }

    for (let start = 0; start < validLeads.length; start += ROW_BATCH_SIZE) {
      const batch = validLeads.slice(start, start + ROW_BATCH_SIZE);
      const { error } = await supabase.from('leads').insert(batch);
      if (error) {
        return NextResponse.json({ message: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, count: validLeads.length }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import file.';
    return NextResponse.json({ message }, { status: 500 });
  }
}
