import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../../lib/api-auth';
import { scheduleIntakeTask } from '../../../../lib/intake-task';

type IntakePayload = {
  name?: string;
  full_name?: string;
  business_name?: string;
  industry?: string;
  category?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  est_employees?: string;
  est_revenue?: string;
  risk_exposure?: string;
  line_of_business?: string;
  source?: string;
  status?: string;
  notes?: string;
};

function normalizeText(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStatus(input: unknown): string {
  const value = normalizeText(input)?.toLowerCase();

  if (!value) {
    return 'new';
  }

  if (value === 'lead') {
    return 'new';
  }

  return value;
}

function normalizeSource(input: unknown): string {
  return normalizeText(input) ?? 'agent_intake';
}

function normalizeWebsite(input: unknown): string | null {
  const text = normalizeText(input);
  if (!text) {
    return null;
  }

  if (text.startsWith('http://') || text.startsWith('https://')) {
    return text;
  }

  return `https://${text}`;
}

function buildSnapshotNote(input: {
  industry: string | null;
  category: string | null;
  address: string | null;
  website: string | null;
  estEmployees: string | null;
  estRevenue: string | null;
  riskExposure: string | null;
}): string {
  return [
    'PROSPECT DISCOVERY NOTES',
    '--------------------------------------------------',
    `Industry/Category : ${input.industry ?? '-'} / ${input.category ?? '-'}`,
    `Risk Location     : ${input.address ?? '-'}`,
    `Web Presence      : ${input.website ?? '-'}`,
    `Business Scale    : ${(input.estEmployees ?? '-') + ' Employees'} | ${input.estRevenue ?? '-'} Rev`,
    '',
    'UNDERWRITING RISK EXPOSURES NOTED BY AGENT:',
    input.riskExposure ?? 'No notes added yet.',
  ].join('\n');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as IntakePayload;

  const fullName =
    normalizeText(body.full_name) ??
    normalizeText(body.name) ??
    normalizeText(body.business_name);

  if (!fullName) {
    return NextResponse.json({ message: 'Business Name is required.' }, { status: 400 });
  }

  const industry = normalizeText(body.industry);
  const category = normalizeText(body.category);
  const address = normalizeText(body.address);
  const website = normalizeWebsite(body.website);
  const estEmployees = normalizeText(body.est_employees);
  const estRevenue = normalizeText(body.est_revenue);
  const riskExposure = normalizeText(body.risk_exposure);

  const lineOfBusiness = normalizeText(body.line_of_business) ?? category ?? industry ?? 'Commercial';
  const details = normalizeText(body.notes);

  const { data: newLead, error: leadError } = await supabase
    .from('leads')
    .insert([
      {
        full_name: fullName,
        business: normalizeText(body.business_name) ?? fullName,
        industry,
        category,
        phone: normalizeText(body.phone),
        email: normalizeText(body.email),
        address,
        website,
        est_employees: estEmployees,
        est_revenue: estRevenue,
        risk_exposure: riskExposure,
        line_of_business: lineOfBusiness,
        source: normalizeSource(body.source),
        status: normalizeStatus(body.status),
        details,
        form_payload: body,
      },
    ])
    .select('id')
    .single<{ id: string }>();

  if (leadError || !newLead) {
    return NextResponse.json({ message: leadError?.message ?? 'Failed to create intake lead.' }, { status: 500 });
  }

  const snapshot = buildSnapshotNote({
    industry,
    category,
    address,
    website,
    estEmployees,
    estRevenue,
    riskExposure,
  });

  const { error: interactionError } = await supabase.from('interactions').insert([
    {
      lead_id: newLead.id,
      content: snapshot,
      note_type: 'underwriting',
      author_id: session.user.id,
      author_name: apiActorName(session.user),
      follow_up_completed: true,
    },
  ]);

  if (interactionError) {
    return NextResponse.json({ message: interactionError.message, leadId: newLead.id }, { status: 500 });
  }

  await scheduleIntakeTask(supabase, { leadId: newLead.id, name: fullName, warm: true });

  return NextResponse.json({ success: true, leadId: newLead.id }, { status: 201 });
}
