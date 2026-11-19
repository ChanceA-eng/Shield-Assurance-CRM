import type { SupabaseClient } from '@supabase/supabase-js';
import { arizonaDateTimeInput } from './arizona-time';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';

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
  const result = await supabase.rpc('home_premium_summary', { p_first_month: `${buckets[0]!.key}-01` });
  if (result.error) throw databaseError(result.error);
  const data: unknown = result.data;
  if (!isRecord(data) || !Array.isArray(data.months) || data.months.length !== 12
    || (typeof data.total !== 'number' && typeof data.total !== 'string') || !Number.isFinite(Number(data.total))) {
    throw new Error('Policy premium data returned an invalid summary.');
  }
  for (const [index, bucket] of buckets.entries()) {
    const month: unknown = data.months[index];
    if (!isRecord(month) || month.month !== bucket.key
      || (typeof month.premium !== 'number' && typeof month.premium !== 'string') || !Number.isFinite(Number(month.premium))) {
      throw new Error('Policy premium data returned an invalid month.');
    }
    bucket.premium = Number(month.premium);
  }
  return {
    total_written_premium: Math.round(Number(data.total)),
    written_premium_series: buckets.map(({ month: label, premium }) => ({ month: label, premium: Math.round(premium) })),
  };
}
