import { NextRequest, NextResponse } from 'next/server';
import { askRashi, analyzeRashiDocument } from '../../../../lib/rashi-server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { prisma } from '../../../../lib/prisma';

export const runtime = 'nodejs';
export const maxDuration = 60;

type AnalyzeAction = 'APPETITE' | 'ELIGIBILITY' | 'EXCLUSIONS' | 'DECISION';

type LeadRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  business: string | null;
  line_of_business: string | null;
  primary_coverage: string | null;
  bundles: unknown;
  details: string | null;
  vehicle_details: string | null;
  source: string | null;
  status: string | null;
};

type ClientRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  source: string | null;
};

type PolicyRow = {
  id: string;
  carrier: string | null;
  line_of_business: string | null;
};

type ClientAssetRow = {
  id: string;
  asset_type: string | null;
  metadata: unknown;
};

type ProspectType = 'LEAD' | 'CLIENT' | 'COMMERCIAL_ACCOUNT' | 'PERSONAL_ACCOUNT';

interface ProspectSnapshot {
  prospectType: ProspectType;
  prospectId: string;
  displayName: string;
  state: string | null;
  industry: string | null;
  naicsCode: string | null;
  estimatedRevenue: number | null;
  requestedLines: string[];
  currentCarriers: string[];
  riskSignals: string[];
  notes: string[];
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeArray(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function parseCurrencyNumber(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input;
  }

  if (typeof input === 'string') {
    const normalized = Number(input.replace(/[$,\s]/g, ''));
    return Number.isFinite(normalized) ? normalized : null;
  }

  return null;
}

function parseJsonObject(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }

  return input as Record<string, unknown>;
}

function parseStringArray(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => normalizeText(item))
      .filter((item): item is string => Boolean(item));
  }

  if (typeof input === 'string') {
    return input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function riskSignalsFromSnapshot(snapshot: Record<string, unknown>): string[] {
  const signals: string[] = [];

  const grossRevenue = parseCurrencyNumber(snapshot.gross_revenue);
  if (grossRevenue !== null && grossRevenue >= 5000000) {
    signals.push(`Reported gross revenue is ${grossRevenue.toLocaleString('en-US')}.`);
  }

  const maxHeight = parseCurrencyNumber(snapshot.max_height_feet);
  if (maxHeight !== null && maxHeight >= 25) {
    signals.push(`Operations include elevated work up to ${maxHeight} feet.`);
  }

  if (snapshot.performs_roofing === true) {
    signals.push('Operations include roofing exposure.');
  }

  const alcoholSales = parseCurrencyNumber(snapshot.alcohol_sales_percentage);
  if (alcoholSales !== null && alcoholSales > 30) {
    signals.push(`Alcohol sales exposure is ${alcoholSales}% of operations.`);
  }

  const employees = parseCurrencyNumber(snapshot.employees);
  if (employees !== null && employees > 50) {
    signals.push(`Employee count is ${employees.toLocaleString('en-US')}.`);
  }

  return signals;
}

async function loadLeadSnapshot(leadId: string): Promise<ProspectSnapshot> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const leadResult = await supabase
    .from('leads')
    .select('id,full_name,email,phone,state,business,line_of_business,primary_coverage,bundles,details,vehicle_details,source,status')
    .eq('id', leadId)
    .maybeSingle<LeadRow>();

  if (leadResult.error) {
    throw new Error(leadResult.error.message);
  }

  const lead = leadResult.data;
  if (!lead) {
    throw new Error('Lead not found.');
  }

  return {
    prospectType: 'LEAD',
    prospectId: lead.id,
    displayName: normalizeText(lead.full_name) ?? `Lead ${lead.id}`,
    state: normalizeText(lead.state),
    industry: normalizeText(lead.business),
    naicsCode: null,
    estimatedRevenue: null,
    requestedLines: normalizeArray([
      lead.line_of_business,
      lead.primary_coverage,
      ...parseStringArray(lead.bundles),
    ]),
    currentCarriers: [],
    riskSignals: [],
    notes: normalizeArray([lead.details, lead.vehicle_details, lead.source, lead.status]),
  };
}

async function loadClientSnapshot(clientId: string): Promise<ProspectSnapshot> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const clientResult = await supabase
    .from('clients')
    .select('id,full_name,email,phone,address,source')
    .eq('id', clientId)
    .maybeSingle<ClientRow>();

  if (clientResult.error) {
    throw new Error(clientResult.error.message);
  }

  const client = clientResult.data;
  if (!client) {
    throw new Error('Client not found.');
  }

  const [policiesResult, assetsResult] = await Promise.all([
    supabase
      .from('policies')
      .select('id,carrier,line_of_business')
      .eq('client_id', clientId)
      .limit(100),
    supabase
      .from('client_assets')
      .select('id,asset_type,metadata')
      .eq('client_id', clientId)
      .limit(100),
  ]);

  if (policiesResult.error) {
    throw new Error(policiesResult.error.message);
  }

  if (assetsResult.error) {
    throw new Error(assetsResult.error.message);
  }

  const policies = (policiesResult.data ?? []) as PolicyRow[];
  const assets = (assetsResult.data ?? []) as ClientAssetRow[];
  const commercialAsset = assets.find((asset) => normalizeText(asset.asset_type) === 'commercial_intake');
  const metadata = parseJsonObject(commercialAsset?.metadata);
  const riskSnapshot = parseJsonObject(metadata?.risk_snapshot);

  const inferredIndustry = normalizeText(metadata?.industry_group);
  const inferredNaics = normalizeText(metadata?.naics_code);
  const inferredRevenue = parseCurrencyNumber(riskSnapshot?.gross_revenue);
  const inferredState = normalizeText(metadata?.state);

  return {
    prospectType: 'CLIENT',
    prospectId: client.id,
    displayName: normalizeText(client.full_name) ?? `Client ${client.id}`,
    state: inferredState,
    industry: inferredIndustry,
    naicsCode: inferredNaics,
    estimatedRevenue: inferredRevenue,
    requestedLines: normalizeArray(policies.map((policy) => policy.line_of_business)),
    currentCarriers: normalizeArray(policies.map((policy) => policy.carrier)),
    riskSignals: riskSnapshot ? riskSignalsFromSnapshot(riskSnapshot) : [],
    notes: normalizeArray([client.address, client.source]),
  };
}

async function loadCommercialSnapshot(commercialAccountId: string): Promise<ProspectSnapshot> {
  const account = await prisma.commercialAccount.findUnique({
    where: { id: commercialAccountId },
    include: {
      quotes: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });

  if (!account) {
    throw new Error('Commercial account not found.');
  }

  const riskSnapshot = parseJsonObject(account.riskSnapshot);
  const quoteRequestedLines = account.quotes.flatMap((quote) => {
    const snapshot = parseJsonObject(quote.snapshot);
    return parseStringArray(snapshot?.requestedLines);
  });

  const inferredLines = normalizeArray([
    ...quoteRequestedLines,
    account.hasProperty ? 'PROPERTY' : null,
    account.hasAutos ? 'AUTO' : null,
    account.hasEmployees ? 'WORKERS_COMP' : null,
    'GENERAL_LIABILITY',
  ]);

  return {
    prospectType: 'COMMERCIAL_ACCOUNT',
    prospectId: account.id,
    displayName: account.legalName,
    state: normalizeText(riskSnapshot?.state),
    industry: account.industryGroup,
    naicsCode: account.naicsCode,
    estimatedRevenue: Number(account.grossRevenue),
    requestedLines: inferredLines,
    currentCarriers: normalizeArray(account.quotes.map((quote) => quote.carrier)),
    riskSignals: riskSnapshot ? riskSignalsFromSnapshot(riskSnapshot) : [],
    notes: normalizeArray([
      account.entityType,
      account.hasSubcontractors ? 'Uses subcontractors.' : null,
    ]),
  };
}

async function loadPersonalSnapshot(personalAccountId: string): Promise<ProspectSnapshot> {
  const account = await prisma.personalAccount.findUnique({
    where: { id: personalAccountId },
  });

  if (!account) {
    throw new Error('Personal account not found.');
  }

  const requestedLines = normalizeArray([
    account.autoSnapshot ? 'AUTO' : null,
    account.propertySnapshot ? 'PROPERTY' : null,
  ]);

  const notes = normalizeArray([
    account.creditScoreTier,
    account.currentPolicyExpiration ? `Current policy expiration: ${account.currentPolicyExpiration.toISOString().slice(0, 10)}` : null,
  ]);

  return {
    prospectType: 'PERSONAL_ACCOUNT',
    prospectId: account.id,
    displayName: `${account.firstName} ${account.lastName}`.trim(),
    state: account.state,
    industry: null,
    naicsCode: null,
    estimatedRevenue: null,
    requestedLines,
    currentCarriers: normalizeArray([account.currentCarrier]),
    riskSignals: [],
    notes,
  };
}

async function buildProspectSnapshot(input: {
  leadId?: string;
  clientId?: string;
  commercialAccountId?: string;
  personalAccountId?: string;
}): Promise<ProspectSnapshot> {
  if (input.commercialAccountId) {
    return loadCommercialSnapshot(input.commercialAccountId);
  }

  if (input.personalAccountId) {
    return loadPersonalSnapshot(input.personalAccountId);
  }

  if (input.clientId) {
    return loadClientSnapshot(input.clientId);
  }

  if (input.leadId) {
    return loadLeadSnapshot(input.leadId);
  }

  throw new Error('Provide one of leadId, clientId, commercialAccountId, or personalAccountId.');
}

function buildProspectProfile(snapshot: ProspectSnapshot): string {
  const lines: string[] = [
    `Prospect Type: ${snapshot.prospectType}`,
    `Prospect ID: ${snapshot.prospectId}`,
    `Name: ${snapshot.displayName}`,
    `State: ${snapshot.state ?? 'unknown'}`,
    `Industry: ${snapshot.industry ?? 'unknown'}`,
    `NAICS Code: ${snapshot.naicsCode ?? 'unknown'}`,
    `Estimated Revenue: ${snapshot.estimatedRevenue ?? 'unknown'}`,
    `Requested Lines: ${snapshot.requestedLines.join(', ') || 'unspecified'}`,
    `Current Carriers: ${snapshot.currentCarriers.join(', ') || 'none'}`,
    `Risk Signals: ${snapshot.riskSignals.join(' | ') || 'none captured'}`,
    `Additional Notes: ${snapshot.notes.join(' | ') || 'none'}`,
  ];

  return lines.join('\n');
}

function parseBulletLines(answer: string): string[] {
  const lines = answer
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(plans|appetite|eligibility|exclusions|coverage|regulatory|general)$/i.test(line))
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 0);

  return Array.from(new Set(lines)).slice(0, 8);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      action?: string;
      documentId?: string;
      leadId?: string;
      clientId?: string;
      commercialAccountId?: string;
      personalAccountId?: string;
      topK?: number;
    };

    const action = String(body.action ?? '').toUpperCase() as AnalyzeAction;

    if (body.documentId) {
      if (!['APPETITE', 'ELIGIBILITY', 'EXCLUSIONS', 'DECISION'].includes(action)) {
        return NextResponse.json({ message: 'Invalid action.' }, { status: 400 });
      }

      const payload = await analyzeRashiDocument(String(body.documentId), action);
      return NextResponse.json(payload, { status: 200 });
    }

    if (!body.leadId && !body.clientId && !body.commercialAccountId && !body.personalAccountId) {
      return NextResponse.json(
        { message: 'Provide one of leadId, clientId, commercialAccountId, or personalAccountId.' },
        { status: 400 },
      );
    }

    const snapshot = await buildProspectSnapshot({
      leadId: normalizeText(body.leadId) ?? undefined,
      clientId: normalizeText(body.clientId) ?? undefined,
      commercialAccountId: normalizeText(body.commercialAccountId) ?? undefined,
      personalAccountId: normalizeText(body.personalAccountId) ?? undefined,
    });

    const profileBlock = buildProspectProfile(snapshot);
    const topK = Number.isFinite(body.topK) ? Math.max(4, Math.min(Number(body.topK), 10)) : 6;

    const [riskAnalysis, bundleAnalysis] = await Promise.all([
      askRashi({
        question:
          `Analyze this prospect against all relevant carrier guidelines for underwriting risks, eligibility blockers, exclusions, and missing application data. `
          + `Prioritize actionable underwriting alerts.\n\nProspect profile:\n${profileBlock}`,
        topK,
        stateContext: snapshot.state ?? undefined,
        topic: snapshot.industry ?? undefined,
      }),
      askRashi({
        question:
          `Analyze this prospect across all relevant carrier guidelines for cross-line bundle opportunities and strategic upsell combinations. `
          + `Prioritize practical bundles tied to the prospect profile.\n\nProspect profile:\n${profileBlock}`,
        topK,
        stateContext: snapshot.state ?? undefined,
        topic: snapshot.industry ?? undefined,
      }),
    ]);

    return NextResponse.json(
      {
        prospect: snapshot,
        alerts: parseBulletLines(riskAnalysis.answer),
        bundles: parseBulletLines(bundleAnalysis.answer),
        riskAnalysis,
        bundleAnalysis,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to analyze Rashi document.' },
      { status: 500 },
    );
  }
}
