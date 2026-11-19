import type { AssetDetails } from '@crm/shared';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';

export interface VehicleOption { id: string; name: string }
const origin = 'https://vpic.nhtsa.dot.gov/api/vehicles';

async function catalog(path: string, cache = true): Promise<Record<string, unknown>[]> {
  let response: Response;
  try { response = await fetch(`${origin}/${path}${path.includes('?') ? '&' : '?'}format=json`, {
    ...(cache ? { next: { revalidate: 86400 } } : { cache: 'no-store' as const }), signal: AbortSignal.timeout(15000),
  }); }
  catch { throw new WorkspaceError('Vehicle lookup is temporarily unavailable. Retry or choose manual vehicle entry.', 503); }
  if (!response.ok) throw new WorkspaceError('Vehicle lookup is temporarily unavailable. Retry or choose manual vehicle entry.', 503);
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new WorkspaceError('Vehicle lookup returned an invalid response. Retry or choose manual vehicle entry.', 503); }
  if (!isRecord(data) || !Array.isArray(data.Results) || !data.Results.every(isRecord)) {
    throw new WorkspaceError('Vehicle lookup returned an invalid response. Retry or choose manual vehicle entry.', 503);
  }
  return data.Results;
}

export async function vehicleLookup(params: URLSearchParams): Promise<{ options: VehicleOption[] } | { details: AssetDetails }> {
  const vin = params.get('vin');
  if (vin !== null) {
    const normalized = vin.trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) throw new WorkspaceError('Enter a 17-character VIN without I, O or Q.', 400);
    const rows = await catalog(`DecodeVinValues/${normalized}`, false), row = rows[0];
    if (!row || String(row.ErrorCode).split(',').some((code) => code.trim() !== '0')
      || !row.ModelYear || !row.Make || !row.Model) throw new WorkspaceError('The VIN could not be fully verified. Check it or enter this vehicle manually.', 422);
    return { details: { vin: normalized, year: String(row.ModelYear), make: String(row.Make), model: String(row.Model),
      ...(typeof row.VehicleType === 'string' && row.VehicleType ? { vehicle_type: row.VehicleType } : {}) } };
  }
  const type = params.get('type') ?? 'car', year = params.get('year'), make = params.get('make');
  if (!['car', 'mpv', 'truck', 'motorcycle', 'bus', 'trailer'].includes(type)) throw new WorkspaceError('Choose a supported vehicle category.', 400);
  if (make !== null) {
    if (!/^[1-9]\d{0,8}$/.test(make) || !year || !/^\d{4}$/.test(year)
      || Number(year) < 1900 || Number(year) > new Date().getFullYear() + 1) throw new WorkspaceError('Choose a valid year and make before loading models.', 400);
  }
  const rows = await catalog(make
    ? `GetModelsForMakeIdYear/makeId/${make}/modelyear/${year}/vehicleType/${type}`
    : `GetMakesForVehicleType/${type}`);
  const values = rows.map((row) => ({ id: String(make ? row.Model_ID : row.MakeId), name: String(make ? row.Model_Name : row.MakeName) }));
  if (values.some((row) => !/^\d+$/.test(row.id) || !row.name || row.name === 'undefined')) throw new WorkspaceError('Vehicle lookup returned invalid choices. Retry or enter the vehicle manually.', 503);
  return { options: [...new Map(values.map((row) => [row.name, row])).values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
