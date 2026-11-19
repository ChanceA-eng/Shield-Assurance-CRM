import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { WorkspaceError } from '../../../lib/record-scope';
import { renewalTermDate } from '../../../lib/renewal-review';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { databaseError, workspaceApiError } from '../../../lib/workspace-api';

type RenewalWindow = '30' | '60' | '90' | 'overdue';
type RenewalBucket = '0-30' | '31-60' | '61-90' | 'overdue';

interface RenewalReviewRow {
  id: string;
  policy_id: string;
  account_id: string;
  renewal_term: string;
  status: string;
  assigned_to: string | null;
  notes: string | null;
  follow_up_date: string | null;
  next_policy_id: string | null;
  version: number;
  updated_at: string;
  created_at: string;
}

function normalizePremium(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new WorkspaceError('A renewal premium value is invalid. Correct the policy record and retry.', 500);
  return parsed;
}

function windowToBucket(window: RenewalWindow): RenewalBucket {
  if (window === '60') return '31-60';
  if (window === '90') return '61-90';
  if (window === 'overdue') return 'overdue';
  return '0-30';
}

async function getWindowCount(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  window: RenewalWindow,
): Promise<number> {
  const { count, error } = await supabase.from('renewals').select('id', { count: 'exact', head: true })
    .eq('renewal_bucket', windowToBucket(window));
  if (error) throw databaseError(error);
  return count ?? 0;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  try {
    const rawWindow = request.nextUrl.searchParams.get('window') ?? '30';
    if (rawWindow !== '30' && rawWindow !== '60' && rawWindow !== '90' && rawWindow !== 'overdue') {
      throw new WorkspaceError('Choose a valid renewal window.', 400);
    }
    const window: RenewalWindow = rawWindow;
    const bucket = windowToBucket(window);
    const queryRenewals = () => supabase.from('renewals')
      .select('id,client_id,account_id,insured_name,carrier,line_of_business,sub_type,premium,renewal_date,expiration_date,status,billing_type,prior_policy_id,renewal_bucket')
      .eq('renewal_bucket', bucket);
    const [datedRenewals, expirationRenewals, count30, count60, count90, countOverdue] = await Promise.all([
      queryRenewals().not('renewal_date', 'is', null).order('renewal_date', { ascending: true }).limit(250),
      queryRenewals().is('renewal_date', null).order('expiration_date', { ascending: true }).limit(250),
      getWindowCount(supabase, '30'),
      getWindowCount(supabase, '60'),
      getWindowCount(supabase, '90'),
      getWindowCount(supabase, 'overdue'),
    ]);
    if (datedRenewals.error) throw databaseError(datedRenewals.error);
    if (expirationRenewals.error) throw databaseError(expirationRenewals.error);
    const items = [...(datedRenewals.data ?? []), ...(expirationRenewals.data ?? [])]
      .map((policy) => {
        const renewalOn = renewalTermDate(policy.renewal_date, policy.expiration_date);
        if (!renewalOn) throw new WorkspaceError('A renewal record is missing a renewal or expiration date.', 500);
        return { ...policy, renewal_on: renewalOn, premium: normalizePremium(policy.premium) };
      })
      .sort((left, right) => left.renewal_on.localeCompare(right.renewal_on))
      .slice(0, 250);
    const reviewsResult = items.length
      ? await supabase.from('renewal_reviews')
        .select('id,policy_id,account_id,renewal_term,status,assigned_to,notes,follow_up_date,next_policy_id,version,updated_at,created_at')
        .in('policy_id', items.map((item) => item.id))
        .order('renewal_term', { ascending: false })
      : { data: [], error: null };
    if (reviewsResult.error) throw databaseError(reviewsResult.error);
    const relevantReviews = ((reviewsResult.data ?? []) as RenewalReviewRow[])
      .filter((review) => items.some((item) => item.id === review.policy_id && item.renewal_on === review.renewal_term));
    const eventsResult = relevantReviews.length
      ? await supabase.from('renewal_review_events')
        .select('id,review_id,actor_id,event_type,from_status,to_status,snapshot,created_at')
        .in('review_id', relevantReviews.map((review) => review.id))
        .order('created_at', { ascending: false })
      : { data: [], error: null };
    if (eventsResult.error) throw databaseError(eventsResult.error);
    const assigneeIds = Array.from(new Set(relevantReviews.flatMap((review) => review.assigned_to ? [review.assigned_to] : [])));
    const membersResult = assigneeIds.length
      ? await supabase.from('agency_members').select('user_id,email').in('user_id', assigneeIds)
      : { data: [], error: null };
    if (membersResult.error) throw databaseError(membersResult.error);
    const memberEmails = new Map((membersResult.data ?? []).map((member) => [member.user_id, member.email]));
    const enrichedReviews = relevantReviews.map((review) => ({
      ...review,
      assigned_email: review.assigned_to ? memberEmails.get(review.assigned_to) ?? null : null,
      events: (eventsResult.data ?? []).filter((event) => event.review_id === review.id),
    }));
    const reviewsByPolicy = new Map(enrichedReviews.map((review) => [review.policy_id, review]));
    return NextResponse.json({
      window,
      counts: { '30': count30, '60': count60, '90': count90, overdue: countOverdue },
      items: items.map((policy) => ({ ...policy, review: reviewsByPolicy.get(policy.id) ?? null })),
    }, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'renewals');
  }
}
