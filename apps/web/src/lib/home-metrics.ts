import type { SupabaseClient } from '@supabase/supabase-js';
import { arizonaDateTimeInput } from './arizona-time';
import { databaseError } from './workspace-api';

export interface PremiumMonth {
  month: string;
  premium: number;
}

export interface HomeMetrics {
  total_written_premium: number;
  written_premium_series: PremiumMonth[];
  active_leads: number;
  lead_conversion_rate: number;
  renewals_30_days: number;
  open_claims: number;
}

interface PremiumPolicy {
  premium: number | string | null;
  effective_date: string | null;
}

export async function loadHomePremiumMetrics(supabase: SupabaseClient, now = new Date()): Promise<{
  total_written_premium: number;
  written_premium_series: PremiumMonth[];
}> {
  const [year, month] = arizonaDateTimeInput(now).slice(0, 7).split('-').map(Number);
  const buckets = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 12 + index, 1));
    return {
      key: date.toISOString().slice(0, 7),
      month: date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      premium: 0,
    };
  });
  let total = 0;
  for (let offset = 0; ;) {
    const { data, error } = await supabase.from('policies').select('premium,effective_date')
      .order('id').range(offset, offset + 499).returns<PremiumPolicy[]>();
    if (error) throw databaseError(error);
    if (!data) throw new Error('Policy premium data was not returned.');
    if (!data.length) break;
    for (const policy of data) {
      const premium = policy.premium === null ? 0 : Number(policy.premium);
      if (!Number.isFinite(premium)) throw new Error('A policy has an invalid premium.');
      total += premium;
      const bucket = buckets.find((item) => item.key === policy.effective_date?.slice(0, 7));
      if (bucket) bucket.premium += premium;
    }
    // Advance by actual rows returned, including when the server enforces a smaller page cap.
    offset += data.length;
  }
  return {
    total_written_premium: Math.round(total),
    written_premium_series: buckets.map(({ month: label, premium }) => ({ month: label, premium: Math.round(premium) })),
  };
}
