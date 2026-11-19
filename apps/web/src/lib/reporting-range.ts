import { agencyDateTimeInput, DEFAULT_AGENCY_TIME_ZONE } from './agency-time';

export type ReportRangeKey = 'mtd' | 'ytd' | 'qtd' | '12m';

export function isReportRangeKey(value: unknown): value is ReportRangeKey {
  return value === 'mtd' || value === 'ytd' || value === 'qtd' || value === '12m';
}

function dateAtUTC(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function getReportDateRange(key: ReportRangeKey, now = new Date(), timeZone = DEFAULT_AGENCY_TIME_ZONE): { start: string; end: string } {
  const [yearText, monthText, dayText] = agencyDateTimeInput(now, timeZone).slice(0, 10).split('-');
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const end = dateAtUTC(year, month, day);
  if (key === 'ytd') return { start: dateAtUTC(year, 0, 1), end };
  if (key === 'qtd') return { start: dateAtUTC(year, Math.floor(month / 3) * 3, 1), end };
  if (key === '12m') {
    const start = new Date(Date.UTC(year, month - 11, 1));
    return { start: start.toISOString().slice(0, 10), end };
  }
  return { start: dateAtUTC(year, month, 1), end };
}

export function getReportPeriodStarts(now = new Date(), timeZone = DEFAULT_AGENCY_TIME_ZONE): { month: string; year: string } {
  const [yearText, monthText] = agencyDateTimeInput(now, timeZone).slice(0, 10).split('-');
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  return {
    month: dateAtUTC(year, month, 1),
    year: dateAtUTC(year, 0, 1),
  };
}
