import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

interface TaskCandidate {
  subject: string;
  description: string;
  due_date: string;
  priority: 'low' | 'medium' | 'high';
}

function isMissingRelationError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("could not find the table") ||
    lower.includes('relation') ||
    lower.includes('schema cache') ||
    lower.includes('does not exist')
  );
}

function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function uniqueBySubject(candidates: TaskCandidate[]): TaskCandidate[] {
  return Array.from(new Map(candidates.map((item) => [item.subject, item])).values());
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('clientId')?.trim();
  if (!clientId) {
    return NextResponse.json({ message: 'clientId is required.' }, { status: 400 });
  }

  const [clientRes, policiesRes, openClientTasksRes] = await Promise.all([
    supabase.from('clients').select('id,full_name').eq('id', clientId).maybeSingle(),
    supabase.from('policies').select('id,renewal_date').eq('client_id', clientId).limit(50),
    supabase
      .from('client_tasks')
      .select('subject,status')
      .eq('client_id', clientId)
      .neq('status', 'completed')
      .limit(200),
  ]);

  if (clientRes.error) return NextResponse.json({ message: clientRes.error.message }, { status: 500 });
  if (policiesRes.error) return NextResponse.json({ message: policiesRes.error.message }, { status: 500 });
  if (!clientRes.data) return NextResponse.json({ message: 'Client not found.' }, { status: 404 });

  const useLegacyTasks = Boolean(openClientTasksRes.error && isMissingRelationError(openClientTasksRes.error.message));
  if (openClientTasksRes.error && !useLegacyTasks) {
    return NextResponse.json({ message: openClientTasksRes.error.message }, { status: 500 });
  }

  const openLegacyTasksRes = useLegacyTasks
    ? await supabase
        .from('tasks')
        .select('subject,status')
        .eq('related_type', 'client')
        .eq('related_id', clientId)
        .neq('status', 'completed')
        .limit(200)
    : { data: [], error: null };

  if (openLegacyTasksRes.error) {
    return NextResponse.json({ message: openLegacyTasksRes.error.message }, { status: 500 });
  }

  const clientName = clientRes.data.full_name;

  const candidates: TaskCandidate[] = [
    {
      subject: `Follow up with ${clientName} on the latest conversation`,
      description: 'Confirm outstanding questions and close the loop on recent communication.',
      due_date: daysFromNow(1),
      priority: 'high',
    },
    {
      subject: `Review account service items for ${clientName}`,
      description: 'Check current policies, tasks, and pending items to keep this account on track.',
      due_date: daysFromNow(3),
      priority: 'medium',
    },
  ];

  const hasRenewal = (policiesRes.data ?? []).some((policy) => {
    if (!policy.renewal_date) return false;
    const days = Math.floor((new Date(policy.renewal_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 90;
  });

  if (hasRenewal) {
    candidates.push({
      subject: `Prepare renewal strategy for ${clientName}`,
      description: 'Build renewal options and required documentation ahead of the upcoming policy window.',
      due_date: daysFromNow(5),
      priority: 'high',
    });
  }

  const existingRows = useLegacyTasks ? openLegacyTasksRes.data ?? [] : openClientTasksRes.data ?? [];
  const existingSubjects = new Set(existingRows.map((row) => row.subject?.trim().toLowerCase()).filter(Boolean));
  const newCandidates = uniqueBySubject(candidates)
    .filter((item) => !existingSubjects.has(item.subject.trim().toLowerCase()))
    .slice(0, 3);

  let createdCount = 0;
  if (newCandidates.length > 0) {
    const insertRes = useLegacyTasks
      ? await supabase
          .from('tasks')
          .insert(
            newCandidates.map((item) => ({
              subject: item.subject,
              description: item.description,
              due_date: item.due_date,
              status: 'open',
              priority: item.priority,
              related_type: 'client',
              related_id: clientId,
            })),
          )
          .select('id,subject')
      : await supabase
          .from('client_tasks')
          .insert(
            newCandidates.map((item) => ({
              client_id: clientId,
              subject: item.subject,
              description: item.description,
              due_date: item.due_date,
              status: 'open',
              priority: item.priority,
            })),
          )
          .select('id,subject');

    if (insertRes.error) {
      return NextResponse.json({ message: insertRes.error.message }, { status: 500 });
    }
    createdCount = insertRes.data?.length ?? 0;
  }

  await supabase.from('client_activities').insert([
    {
      client_id: clientId,
      activity_type: 'ai_tasks',
      title: createdCount > 0 ? 'Generated AI follow-up tasks' : 'AI follow-up tasks already covered',
      body:
        createdCount > 0
          ? newCandidates.map((item) => item.subject).join(' | ')
          : 'No new tasks were created because matching open tasks already exist.',
      metadata: {
        source: 'api.ai.generate-tasks',
        created: createdCount,
        skipped: Math.max(0, candidates.length - createdCount),
        task_store: useLegacyTasks ? 'tasks' : 'client_tasks',
      },
      occurred_at: new Date().toISOString(),
    },
  ]);

  return NextResponse.json(
    {
      ok: true,
      created: createdCount,
      skipped: Math.max(0, candidates.length - createdCount),
      tasks: newCandidates,
    },
    { status: 200 },
  );
}
