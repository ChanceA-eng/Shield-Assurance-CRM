import { afterEach, describe, expect, it, vi } from 'vitest';
import { vehicleLookup } from './vehicle-catalog';

afterEach(() => vi.unstubAllGlobals());
describe('vehicle lookup adapter', () => {
  it('requests the selected category and sorts/deduplicates real manufacturer choices', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ Results: [{ MakeId: 2, MakeName: 'TOYOTA' }, { MakeId: 1, MakeName: 'HONDA' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await vehicleLookup(new URLSearchParams('type=mpv'))).toEqual({ options: [{ id: '1', name: 'HONDA' }, { id: '2', name: 'TOYOTA' }] });
    expect(fetcher.mock.calls[0]![0]).toContain('GetMakesForVehicleType/mpv?format=json');
  });
  it('filters models by make/year/category rather than showing every model ever made', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ Results: [{ Model_ID: 1863, Model_Name: 'Civic' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await vehicleLookup(new URLSearchParams('type=car&year=2024&make=474'))).toEqual({ options: [{ id: '1863', name: 'Civic' }] });
    expect(fetcher.mock.calls[0]![0]).toContain('/makeId/474/modelyear/2024/vehicleType/car');
  });
  it('does not cache VIN requests and applies only a complete valid decode', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ Results: [{ ErrorCode: '0', ModelYear: '2011', Make: 'BMW', Model: 'X3', VehicleType: 'MPV' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await vehicleLookup(new URLSearchParams('vin=5uxwx7c58bl123456'))).toMatchObject({ details: { vin: '5UXWX7C58BL123456', make: 'BMW', year: '2011' } });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ cache: 'no-store' });
  });
  it.each(['vin=too-short', 'vin=IIIIIIIIIIIIIIIII', 'type=unknown', 'make=abc&year=2024', 'make=474&year=1899'])('rejects invalid input before external requests (%s)', async (query) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(vehicleLookup(new URLSearchParams(query))).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([null, { Results: [{}] }, { Results: [{ ErrorCode: '1', Make: 'BMW', Model: 'X3', ModelYear: '2011' }] }])('surfaces malformed/partial decodes without fabricated success (%j)', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
    await expect(vehicleLookup(new URLSearchParams('vin=5UXWX7C58BL123456'))).rejects.toThrow();
  });
  it('surfaces provider failure with actionable manual entry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(vehicleLookup(new URLSearchParams())).rejects.toThrow('manual vehicle entry');
  });
});
