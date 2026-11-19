import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { requireAgencyReportsAccess } from '../../../lib/agency-access';
import { getAgencyTimeZone } from '../../../lib/automation-settings';
import type { AgencyTimeZone } from '../../../lib/agency-time';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { getReportDateRange, getReportPeriodStarts, isReportRangeKey } from '../../../lib/reporting-range';

import { friendlyErrorMessage, workspaceApiError } from '../../../lib/workspace-api';

type ClaimsStatusRow = {
  status: string;
  value: number;
  color: string;
};

type LeadPipelineRow = {
  stage: string;
  value: number;
  color: string;
};

interface ReportCard {
  id: string;
  title: string;
  href: string;
  summary: string;
  accent: string;
}

function safeNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getColor(index: number): string {
  const colors = ['#38bdf8', '#818cf8', '#34d399', '#f59e0b', '#f43f5e', '#a78bfa'];
  return colors[index % colors.length];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }
  try {
    await requireAgencyReportsAccess(supabase, session.user.id);
  } catch (error) {
    return workspaceApiError(error, 'reports/access');
  }
  let timeZone: AgencyTimeZone;
  try {
    timeZone = await getAgencyTimeZone(supabase);
  } catch (error) {
    return workspaceApiError(error, 'reports/timezone');
  }

  const rangeValue = request.nextUrl.searchParams.get('range') ?? 'mtd';
  if (!isReportRangeKey(rangeValue)) return NextResponse.json({ message: 'Choose a valid reporting period.' }, { status: 400 });
  const range = rangeValue;
  const carrier = (request.nextUrl.searchParams.get('carrier') ?? 'all').trim();
  if (!carrier || carrier.length > 200) return NextResponse.json({ message: 'Choose a valid carrier filter.' }, { status: 400 });
  const now = new Date();
  const { start, end } = getReportDateRange(range, now, timeZone);
  const { month, year } = getReportPeriodStarts(now, timeZone);
  const result = await supabase.rpc('crm_reporting_summary', {
    p_range_start: start,
    p_range_end: end,
    p_month_start: month,
    p_year_start: year,
    p_carrier: carrier,
  });
  if (result.error) return NextResponse.json({ message: friendlyErrorMessage(result.error) }, { status: 500 });

  const summary = result.data as {
    metrics: Record<string, unknown>;
    premiumTrend: Array<{ month: string; premium: number | string }>;
    carrierMix: Array<{ carrier: string; count: number; premium: number | string }>;
    claimsStatus: Array<{ status: string; value: number }>;
    leadPipeline: Array<{ stage: string; value: number }>;
    carrierOptions: string[];
    drilldowns: {
      policies: Array<Record<string, unknown>>;
      claims: Array<Record<string, unknown>>;
      endorsements: Array<Record<string, unknown>>;
      leads: Array<Record<string, unknown>>;
    };
  };
  if (!summary || typeof summary !== 'object' || !summary.metrics || !summary.drilldowns) {
    return NextResponse.json({ message: 'The reporting summary response was invalid. Contact your administrator.' }, { status: 500 });
  }
  const leadColors: Record<string, string> = {
    new: '#38bdf8',
    contacted: '#818cf8',
    quoted: '#34d399',
    won: '#4dbd74',
    lost: '#f86c6b',
    inactive: '#c8ced3',
  };
  const leadNames: Record<string, string> = {
    new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost', inactive: 'Inactive',
  };
  const claimsStatus: ClaimsStatusRow[] = summary.claimsStatus.map((row, index) => ({
    status: row.status || 'unknown',
    value: safeNumber(row.value),
    color: getColor(index),
  }));
  const leadPipeline: LeadPipelineRow[] = summary.leadPipeline.map((row) => ({
    stage: leadNames[row.stage] ?? row.stage,
    value: safeNumber(row.value),
    color: leadColors[row.stage] ?? '#c8ced3',
  }));

  const reportCards: ReportCard[] = [
    { id: 'production', title: 'Production Report', href: '/reports/production', summary: 'Written premium and production by period.', accent: 'sky' },
    { id: 'renewals', title: 'Renewals Report', href: '/reports/renewals', summary: 'Policies coming due by window and carrier.', accent: 'amber' },
    { id: 'claims', title: 'Claims Report', href: '/reports/claims', summary: 'Open claims by status and recent activity.', accent: 'rose' },
    { id: 'endorsements', title: 'Endorsements Report', href: '/reports/endorsements', summary: 'Open service changes and completion rate.', accent: 'violet' },
    { id: 'leads', title: 'Leads Pipeline Report', href: '/reports/leads', summary: 'Lead velocity by stage and source.', accent: 'emerald' },
    { id: 'carriers', title: 'Carrier Mix Report', href: '/reports/carriers', summary: 'Distribution of premium and count by carrier.', accent: 'indigo' },
  ];

  return NextResponse.json(
    {
      filters: { range, carrier, start, end },
      metrics: Object.fromEntries(Object.entries(summary.metrics).map(([key, value]) => [key, safeNumber(value)])),
      premiumTrend: summary.premiumTrend.map((row) => ({ ...row, premium: safeNumber(row.premium) })),
      carrierMix: summary.carrierMix.map((row) => ({ ...row, premium: safeNumber(row.premium) })),
      carrierOptions: summary.carrierOptions,
      claimsStatus,
      leadPipeline,
      reportCards,
      drilldowns: {
        policies: summary.drilldowns.policies,
        claims: summary.drilldowns.claims.map((claim) => ({
          ...claim,
          policies: { insured_name: claim.insured_name, carrier: claim.carrier },
        })),
        endorsements: summary.drilldowns.endorsements.map((endorsement) => ({
          ...endorsement,
          policies: { insured_name: endorsement.insured_name, carrier: endorsement.carrier },
        })),
        leads: summary.drilldowns.leads,
      },
    },
    { status: 200 },
  );
}
