import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { requireAgencyReportsAccess } from '../../../../lib/agency-access';
import { getAgencyTimeZone } from '../../../../lib/automation-settings';
import { agencyDateTimeInput, type AgencyTimeZone } from '../../../../lib/agency-time';
import { getReportDateRange, isReportRangeKey } from '../../../../lib/reporting-range';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { friendlyErrorMessage, workspaceApiError } from '../../../../lib/workspace-api';

type ReportSlug = 'production' | 'renewals' | 'claims' | 'endorsements' | 'leads' | 'carriers';

interface ReportDetailRow {
  id: string;
  account_id: string | null;
  insured_name: string | null;
  carrier: string | null;
  premium: number | null;
  effective_date: string | null;
  renewal_date: string | null;
  status: string | null;
  type: string | null;
  date_of_loss: string | null;
  full_name: string | null;
  line_of_business: string | null;
  source: string | null;
  count: number | null;
}

interface RawPolicy {
  id: string;
  client_id: string | null;
  insured_name: string | null;
  carrier: string | null;
  premium: number | null;
  effective_date: string | null;
  renewal_date: string | null;
  status: string | null;
}

interface RawClaim {
  id: string;
  client_id: string;
  type: string | null;
  status: string | null;
  date_of_loss: string | null;
  policies: { insured_name: string | null; carrier: string | null } | Array<{ insured_name: string | null; carrier: string | null }>;
}

interface RawEndorsement {
  id: string;
  client_id: string;
  type: string | null;
  status: string | null;
  effective_date: string | null;
  policies: { insured_name: string | null; carrier: string | null } | Array<{ insured_name: string | null; carrier: string | null }>;
}

interface RawLead {
  id: string;
  account_id: string | null;
  full_name: string | null;
  status: string | null;
  line_of_business: string | null;
  source: string | null;
}

interface RawSummary {
  carrierMix: Array<{ carrier: string; count: number; premium: number | string }>;
}

interface LoadedRows {
  rows: ReportDetailRow[];
  count: number;
}

const pageSize = 25;
const exportBatchSize = 500;
const reportSlugs = new Set<ReportSlug>(['production', 'renewals', 'claims', 'endorsements', 'leads', 'carriers']);

function isReportSlug(value: string): value is ReportSlug {
  return reportSlugs.has(value as ReportSlug);
}

function asRelation<T>(relation: T | T[]): T {
  return Array.isArray(relation) ? relation[0] : relation;
}

function dateAfter(date: string, days = 1): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function databaseErrorDetails(error: unknown): { message: string; code?: string } | null {
  if (typeof error !== 'object' || error === null || !('message' in error) || typeof error.message !== 'string') return null;
  return {
    message: error.message,
    ...('code' in error && typeof error.code === 'string' ? { code: error.code } : {}),
  };
}

function normalizePolicy(row: RawPolicy): ReportDetailRow {
  return {
    id: row.id,
    account_id: row.client_id,
    insured_name: row.insured_name,
    carrier: row.carrier,
    premium: row.premium,
    effective_date: row.effective_date,
    renewal_date: row.renewal_date,
    status: row.status,
    type: null,
    date_of_loss: null,
    full_name: null,
    line_of_business: null,
    source: null,
    count: null,
  };
}

function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvResponse(slug: ReportSlug, rows: ReportDetailRow[]): NextResponse {
  const columns: Array<[keyof ReportDetailRow, string]> = slug === 'production'
    ? [['insured_name', 'Insured'], ['carrier', 'Carrier'], ['premium', 'Premium'], ['effective_date', 'Effective date'], ['status', 'Status']]
    : slug === 'renewals'
      ? [['insured_name', 'Insured'], ['carrier', 'Carrier'], ['renewal_date', 'Renewal date'], ['premium', 'Premium'], ['status', 'Status']]
      : slug === 'claims'
        ? [['insured_name', 'Insured'], ['carrier', 'Carrier'], ['type', 'Type'], ['status', 'Status'], ['date_of_loss', 'Loss date']]
        : slug === 'endorsements'
          ? [['insured_name', 'Insured'], ['carrier', 'Carrier'], ['type', 'Type'], ['status', 'Status'], ['effective_date', 'Effective date']]
          : slug === 'leads'
            ? [['full_name', 'Name'], ['status', 'Stage'], ['line_of_business', 'Line of business'], ['source', 'Source']]
            : [['carrier', 'Carrier'], ['count', 'Policies'], ['premium', 'Premium']];
  const lines = [
    columns.map(([, label]) => csvCell(label)).join(','),
    ...rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(',')),
  ];
  return new NextResponse(`\uFEFF${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="crm-${slug}-report.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reportSlug: string }> },
): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const { reportSlug } = await context.params;
  if (!isReportSlug(reportSlug)) return NextResponse.json({ message: 'Choose a valid report.' }, { status: 404 });

  const params = request.nextUrl.searchParams;
  const rangeValue = params.get('range') ?? 'ytd';
  if (!isReportRangeKey(rangeValue)) return NextResponse.json({ message: 'Choose a valid reporting period.' }, { status: 400 });
  const carrier = (params.get('carrier') ?? 'all').trim();
  if (!carrier || carrier.length > 200) return NextResponse.json({ message: 'Choose a valid carrier filter.' }, { status: 400 });
  const rawPage = Number(params.get('page') ?? '1');
  if (!Number.isInteger(rawPage) || rawPage < 1 || rawPage > 100000) {
    return NextResponse.json({ message: 'Choose a valid report page.' }, { status: 400 });
  }
  const exporting = params.get('format') === 'csv';
  if (params.has('format') && !exporting) return NextResponse.json({ message: 'Choose a valid report format.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
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
  const now = new Date();
  const { start, end } = getReportDateRange(rangeValue, now, timeZone);
  const endExclusive = dateAfter(end);
  const renewalStart = agencyDateTimeInput(now, timeZone).slice(0, 10);
  const renewalEnd = dateAfter(renewalStart, 90);

  const loadRows = async (offset: number, limit: number): Promise<LoadedRows> => {
    if (reportSlug === 'production' || reportSlug === 'renewals') {
      let query = supabase.from('policies')
        .select('id,client_id,insured_name,carrier,premium,effective_date,renewal_date,status', { count: 'exact' });
      if (reportSlug === 'production') {
        query = query.gte('effective_date', start).lt('effective_date', endExclusive);
      } else {
        query = query.gte('renewal_date', renewalStart).lte('renewal_date', renewalEnd);
      }
      if (carrier !== 'all') query = query.eq('carrier', carrier);
      const { data, error, count } = await query.order(reportSlug === 'production' ? 'effective_date' : 'renewal_date', { ascending: true })
        .order('id', { ascending: true }).range(offset, offset + limit - 1).returns<RawPolicy[]>();
      if (error) throw error;
      return { rows: (data ?? []).map(normalizePolicy), count: count ?? 0 };
    }

    if (reportSlug === 'claims') {
      let query = supabase.from('claims')
        .select('id,client_id,type,status,date_of_loss,policies!inner(insured_name,carrier)', { count: 'exact' })
        .gte('created_at', `${start}T00:00:00.000Z`)
        .lt('created_at', `${endExclusive}T00:00:00.000Z`);
      if (carrier !== 'all') query = query.eq('policies.carrier', carrier);
      const { data, error, count } = await query.order('created_at', { ascending: false })
        .order('id', { ascending: true }).range(offset, offset + limit - 1).returns<RawClaim[]>();
      if (error) throw error;
      return {
        rows: (data ?? []).map((row) => {
          const policy = asRelation(row.policies);
          return {
            id: row.id, account_id: row.client_id, insured_name: policy.insured_name, carrier: policy.carrier, premium: null,
            effective_date: null, renewal_date: null, status: row.status, type: row.type,
            date_of_loss: row.date_of_loss, full_name: null, line_of_business: null, source: null, count: null,
          };
        }),
        count: count ?? 0,
      };
    }

    if (reportSlug === 'endorsements') {
      let query = supabase.from('endorsements')
        .select('id,client_id,type,status,effective_date,policies!inner(insured_name,carrier)', { count: 'exact' })
        .gte('created_at', `${start}T00:00:00.000Z`)
        .lt('created_at', `${endExclusive}T00:00:00.000Z`);
      if (carrier !== 'all') query = query.eq('policies.carrier', carrier);
      const { data, error, count } = await query.order('created_at', { ascending: false })
        .order('id', { ascending: true }).range(offset, offset + limit - 1).returns<RawEndorsement[]>();
      if (error) throw error;
      return {
        rows: (data ?? []).map((row) => {
          const policy = asRelation(row.policies);
          return {
            id: row.id, account_id: row.client_id, insured_name: policy.insured_name, carrier: policy.carrier, premium: null,
            effective_date: row.effective_date, renewal_date: null, status: row.status, type: row.type,
            date_of_loss: null, full_name: null, line_of_business: null, source: null, count: null,
          };
        }),
        count: count ?? 0,
      };
    }

    if (reportSlug === 'leads') {
      const { data, error, count } = await supabase.from('leads')
        .select('id,account_id,full_name,status,line_of_business,source', { count: 'exact' })
        .is('archived_at', null)
        .gte('created_at', `${start}T00:00:00.000Z`)
        .lt('created_at', `${endExclusive}T00:00:00.000Z`)
        .order('created_at', { ascending: false }).order('id', { ascending: true })
        .range(offset, offset + limit - 1).returns<RawLead[]>();
      if (error) throw error;
      return {
        rows: (data ?? []).map((row) => ({
          id: row.id, account_id: row.account_id, insured_name: null, carrier: null, premium: null, effective_date: null,
          renewal_date: null, status: row.status, type: null, date_of_loss: null, full_name: row.full_name,
          line_of_business: row.line_of_business, source: row.source, count: null,
        })),
        count: count ?? 0,
      };
    }

    const { data, error } = await supabase.rpc('crm_reporting_summary', {
      p_range_start: start,
      p_range_end: end,
      p_month_start: start,
      p_year_start: start,
      p_carrier: carrier,
    });
    if (error) throw error;
    const summary = data as unknown as RawSummary;
    const rows = summary.carrierMix.map((row) => ({
      id: row.carrier, account_id: null, insured_name: null, carrier: row.carrier, premium: Number(row.premium),
      effective_date: null, renewal_date: null, status: null, type: null, date_of_loss: null,
      full_name: null, line_of_business: null, source: null, count: row.count,
    }));
    return { rows: rows.slice(offset, offset + limit), count: rows.length };
  };

  try {
    if (exporting) {
      const allRows: ReportDetailRow[] = [];
      let offset = 0;
      let total = 0;
      while (true) {
        const result = await loadRows(offset, exportBatchSize);
        total = result.count;
        allRows.push(...result.rows);
        offset += result.rows.length;
        if (result.rows.length < exportBatchSize || offset >= total) break;
      }
      if (allRows.length !== total) {
        return NextResponse.json({ message: 'The full report could not be exported because records changed during export. Retry the export.' }, { status: 409 });
      }
      return csvResponse(reportSlug, allRows);
    }

    const result = await loadRows((rawPage - 1) * pageSize, pageSize);
    return NextResponse.json({
      rows: result.rows,
      page: rawPage,
      pageSize,
      total: result.count,
      pageCount: Math.ceil(result.count / pageSize),
      filters: { range: rangeValue, carrier, start, end, ...(reportSlug === 'renewals' ? { renewalStart, renewalEnd } : {}) },
    });
  } catch (error) {
    console.error('[reports/details]', reportSlug, error);
    return NextResponse.json({ message: friendlyErrorMessage(databaseErrorDetails(error)) }, { status: 500 });
  }
}
