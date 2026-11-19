import { afterEach, describe, expect, it, vi } from 'vitest';
import { PbfWriter } from 'pbf';
import { osmDirectoryBatch } from './business-research-osm-index';

afterEach(() => vi.unstubAllGlobals());
function message(write: (writer: PbfWriter) => void): Buffer {
  const writer = new PbfWriter(); write(writer); return Buffer.from(writer.finish());
}
function block(type: string, raw: Buffer): Buffer {
  const body = message((writer) => writer.writeBytesField(1, raw));
  const header = message((writer) => { writer.writeStringField(1, type); writer.writeVarintField(3, body.length); });
  const length = Buffer.alloc(4); length.writeUInt32BE(header.length);
  return Buffer.concat([length, header, body]);
}
const header = block('OSMHeader', message((writer) => {
  writer.writeStringField(4, 'OsmSchema-V0.6'); writer.writeStringField(4, 'DenseNodes');
}));
function node(id: number, padded = false): Buffer {
  const strings = ['', 'name', 'Synthetic Accountant', 'office', 'accountant', 'Synthetic Contributor'];
  const table = message((writer) => strings.forEach((value) => writer.writeStringField(1, value)));
  const dense = message((writer) => {
    writer.writePackedSVarint(1, [id]); writer.writePackedSVarint(8, [322226000]); writer.writePackedSVarint(9, [-1109747000]);
    writer.writePackedVarint(10, [1, 2, 3, 4, 0]);
  });
  const group = message((writer) => writer.writeBytesField(2, dense));
  return block('OSMData', message((writer) => {
    writer.writeBytesField(1, table); writer.writeBytesField(2, group);
    if (padded) writer.writeBytesField(100, Buffer.alloc(4 * 1024 * 1024));
  }));
}
function source(file: Buffer, version = 'Wed, 11 Nov 2026 01:00:00 GMT'): void {
  vi.stubGlobal('fetch', vi.fn(async (_input, init: RequestInit) => {
    const request = new Headers(init.headers), range = request.get('Range')?.match(/^bytes=(\d+)-(\d+)$/);
    if (!range) throw new Error('Expected a bounded byte range.');
    const start = Number(range[1]), end = Math.min(Number(range[2]), file.length - 1);
    if (request.has('If-Unmodified-Since')) expect(request.get('If-Unmodified-Since')).toBe(version);
    return new Response(Uint8Array.from(file.subarray(start, end + 1)), { status: 206, headers: {
      'Last-Modified': version, 'Content-Range': `bytes ${start}-${end}/${file.length}`,
    } });
  }));
}
describe('bounded open-map extract indexing', () => {
  it('retains mapped business points without contributor metadata or an inferred address state', async () => {
    source(Buffer.concat([header, node(100)]));
    const batch = await osmDirectoryBatch({ state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000));
    expect(batch.complete).toBe(true);
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toMatchObject({ source: 'osm', record_id: 'node/100', index_partition: 'AZ', source_as_of: null,
      values: { state: null, classification: 'mapped', naics: null, map_tags: { office: 'accountant' } } });
    expect(batch.items[0].values.latitude).toBeCloseTo(32.2226);
    expect(batch.items[0].values.longitude).toBeCloseTo(-110.9747);
    expect(JSON.stringify(batch.items)).not.toContain('Synthetic Contributor');
  });
  it('resumes only at complete blob boundaries and resets when the source version changes', async () => {
    const first = node(100, true), last = node(101, true), file = Buffer.concat([header, first, last]);
    source(file);
    const batch = await osmDirectoryBatch({ state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000));
    expect(batch.cursor).toBe(header.length + first.length);
    expect(batch.complete).toBe(false);
    expect(batch.items.map((item) => item.record_id)).toEqual(['node/100']);
    const resumed = await osmDirectoryBatch({ state: 'AZ', cursor: batch.cursor, building_version: batch.version }, AbortSignal.timeout(10000));
    expect(resumed.cursor).toBe(file.length);
    expect(resumed.complete).toBe(true);
    expect(resumed.items.map((item) => item.record_id)).toEqual(['node/101']);
    source(Buffer.concat([header, node(102)]), 'Thu, 12 Nov 2026 01:00:00 GMT');
    const reset = await osmDirectoryBatch({ state: 'AZ', cursor: batch.cursor, building_version: batch.version }, AbortSignal.timeout(10000));
    expect(reset.complete).toBe(true);
    expect(reset.items.map((item) => item.record_id)).toEqual(['node/102']);
  });
  it('rejects unrestricted downloads and truncated source tails instead of completing an empty index', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unbounded', { status: 200 })));
    await expect(osmDirectoryBatch({ state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000))).rejects.toThrow('HTTP 200');
    const file = Buffer.concat([header, node(100)]);
    source(file.subarray(0, file.length - 1));
    await expect(osmDirectoryBatch({ state: 'AZ', cursor: 0, building_version: null }, AbortSignal.timeout(10000))).rejects.toThrow('incomplete blob');
  });
});
