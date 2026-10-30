import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession } from '../../../lib/api-auth';

interface InteractionPayload {
  id?: string;
  lead_id?: string;
  content?: string;
  follow_up_at?: string | null;
  follow_up_completed?: boolean;
}

function normalizeText(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIsoDate(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const leadId = normalizeText(request.nextUrl.searchParams.get('leadId'));
  const dueCount = request.nextUrl.searchParams.get('dueCount') === 'true';
  const dueList = request.nextUrl.searchParams.get('dueList') === 'true';

  if (dueCount) {
    const { count, error } = await supabase
      .from('interactions')
      .select('id', { count: 'exact', head: true })
      .eq('follow_up_completed', false)
      .lte('follow_up_at', new Date().toISOString());

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }

    return NextResponse.json({ count: count ?? 0 }, { status: 200 });
  }

  if (dueList) {
    const { data, error } = await supabase
      .from('interactions')
      .select('id,lead_id,content,follow_up_at,follow_up_completed,created_at,leads(full_name,source,status)')
      .eq('follow_up_completed', false)
      .lte('follow_up_at', new Date().toISOString())
      .order('follow_up_at', { ascending: true })
      .limit(300);

    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? [], { status: 200 });
  }

  if (!leadId) {
    return NextResponse.json({ message: 'leadId is required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('interactions')
    .select('id,lead_id,content,follow_up_at,follow_up_completed,created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as InteractionPayload;
  const leadId = normalizeText(body.lead_id);
  const content = normalizeText(body.content);

  if (!leadId || !content) {
    return NextResponse.json({ message: 'lead_id and content are required.' }, { status: 400 });
  }

  let followUpAt: string | null = null;
  if (body.follow_up_at === null) {
    followUpAt = null;
  } else if (typeof body.follow_up_at === 'string') {
    followUpAt = normalizeIsoDate(body.follow_up_at);
    if (!followUpAt) {
      return NextResponse.json({ message: 'Invalid follow_up_at value.' }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from('interactions')
    .insert([
      {
        lead_id: leadId,
        content,
        follow_up_at: followUpAt,
        follow_up_completed: false,
      },
    ])
    .select('id,lead_id,content,follow_up_at,follow_up_completed,created_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  await supabase
    .from('leads')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', leadId);

  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as InteractionPayload;
  const id = normalizeText(body.id);

  if (!id) {
    return NextResponse.json({ message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | boolean | null> = {};

  if (typeof body.content === 'string') {
    const content = normalizeText(body.content);
    if (!content) {
      return NextResponse.json({ message: 'content cannot be empty.' }, { status: 400 });
    }

    updates.content = content;
  }

  if (typeof body.follow_up_completed === 'boolean') {
    updates.follow_up_completed = body.follow_up_completed;
  }

  if (body.follow_up_at === null) {
    updates.follow_up_at = null;
  }

  if (typeof body.follow_up_at === 'string') {
    const parsed = normalizeIsoDate(body.follow_up_at);
    if (!parsed) {
      return NextResponse.json({ message: 'Invalid follow_up_at value.' }, { status: 400 });
    }

    updates.follow_up_at = parsed;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'No update fields provided.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('interactions')
    .update(updates)
    .eq('id', id)
    .select('id,lead_id,content,follow_up_at,follow_up_completed,created_at')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
