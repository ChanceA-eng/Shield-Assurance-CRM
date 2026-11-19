import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Enrichment = typeof import('./enrichment');
let osha: Enrichment['oshaInspectionsByName'];
beforeEach(async () => { vi.resetModules(); osha = (await import('./enrichment')).oshaInspectionsByName; vi.stubEnv('DOL_API_KEY', 'dol-key'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const inspection = (activity: number, street = '1 MAIN ST') => ({ activity_nr: activity, estab_name: 'DESERT PLUMBING', site_state: 'AZ', site_address: street,
  site_zip: '85705', open_date: '2024-02-01T00:00:00', close_case_date: null, insp_type: 'B' });

describe('OSHA enrichment', () => {
  it('authenticates with the query key and totals violations from the violation dataset', async () => {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input); urls.push(url);
      expect(new Headers(init?.headers).has('X-API-KEY')).toBe(false);
      const data = url.pathname.endsWith('/inspection/json')
        ? [inspection(101), { ...inspection(102), open_date: '2020-02-01T00:00:00', close_case_date: '2020-05-01T00:00:00' }]
        : [{ activity_nr: 101, viol_type: 'S', current_penalty: 1200 }, { activity_nr: 101, viol_type: 'O', current_penalty: null, initial_penalty: 300 },
          { activity_nr: 101, viol_type: 'S', current_penalty: 999, delete_flag: 'X' }];
      return new Response(JSON.stringify({ data }), { status: 200 });
    }));
    const record = await osha('Desert Plumbing', 'AZ');
    expect(urls.map((url) => url.pathname)).toEqual(['/v4/get/OSHA/inspection/json', '/v4/get/OSHA/violation/json']);
    expect(urls.every((url) => url.searchParams.get('X-API-KEY') === 'dol-key')).toBe(true);
    expect(JSON.parse(urls[1].searchParams.get('filter_object') ?? '')).toEqual({ field: 'activity_nr', operator: 'in', value: ['101', '102'] });
    expect(record.inspections[0]).toMatchObject({ case_status: 'Open', violations_serious: 1, violations_other: 1, total_penalty: 1500 });
    expect(record.inspections[1]).toMatchObject({ case_status: 'Closed', violations_serious: 0, total_penalty: 0 });
    expect(record.total_penalties).toBe(1500);
  });

  it('searches name variants as substrings with the larger documented inspection page size', async () => {
    let requestUrl: URL | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      requestUrl = new URL(input);
      return new Response(null, { status: 204 });
    }));
    await osha(['Berkshire Hathaway Homestate', 'BHHC'], 'AZ');
    const filter = JSON.parse(requestUrl?.searchParams.get('filter_object') ?? '');
    expect(requestUrl?.searchParams.get('limit')).toBe('200');
    expect(filter).toEqual({ and: [{ or: [
      { field: 'estab_name', operator: 'like', value: '%BERKSHIRE HATHAWAY HOMESTATE%' },
      { field: 'estab_name', operator: 'like', value: '%BHHC%' },
    ] }, { field: 'site_state', operator: 'eq', value: 'AZ' }] });
  });

  it('treats the DOL no-content response as no inspections', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(osha('No Record Co', 'AZ')).resolves.toMatchObject({ total_inspections: 0, inspections: [] });
  });

  it('fetches violations only for matched inspections and caches the inspection lookup', async () => {
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input); urls.push(url);
      return new Response(JSON.stringify({ data: url.pathname.endsWith('/inspection/json') ? [inspection(201), inspection(202, '9 OTHER RD')] : [] }), { status: 200 });
    }));
    const match = (item: { street?: string | null }) => item.street === '1 MAIN ST';
    await osha('Desert Plumbing', 'AZ', { match });
    expect(JSON.parse(urls[1].searchParams.get('filter_object') ?? '')).toMatchObject({ value: ['201'] });
    await osha('Desert Plumbing', 'AZ', { match: () => false });
    expect(urls.filter((url) => url.pathname.endsWith('/inspection/json'))).toHaveLength(1);
  });

  it('paces background lookups and tells the producer the check is queued', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await osha('First Co', 'AZ', { priority: false });
    await expect(osha('Second Co', 'AZ', { priority: false })).rejects.toThrow(/OSHA check queued/);
    await osha('Opened Profile Co', 'AZ', { priority: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('runs an open profile lookup ahead of queued background lookups', async () => {
    const order: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      order.push(JSON.parse(new URL(input).searchParams.get('filter_object') ?? '').value.replace(/%/g, '').slice(0, 1));
      return new Response(null, { status: 204 });
    }));
    const first = osha('A Co', null), background = osha('B Co', null, { priority: false }), opened = osha('C Co', null, { priority: true });
    await Promise.all([first, background, opened]);
    expect(order).toEqual(['A', 'C', 'B']);
  }, 10000);

  it('cools down after a repeated rate limit instead of calling DOL for every queued job', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 429, headers: { 'retry-after': '1' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(osha('Busy Co', 'AZ')).rejects.toThrow(/OSHA check queued: the Department of Labor is limiting lookups/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(osha('Next Co', 'AZ')).rejects.toThrow(/OSHA check queued/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);
});