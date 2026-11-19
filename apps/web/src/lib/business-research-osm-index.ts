import { inflateSync } from 'node:zlib';
import { PbfReader } from 'pbf';
import type { BusinessObservation } from '@crm/shared';
import { RESEARCH_OSM_EXTRACTS } from '../data/research-osm-extracts';
import { mappedBusinessObservation } from './business-research-sources';

const RANGE_BYTES = 8 * 1024 * 1024;
const MAX_BLOB = 32 * 1024 * 1024;
const ua = 'Shield-Assurance-CRM/1.0 (+https://shield-assurance-crm.vercel.app)';
type Fields = Map<number, Array<number | Uint8Array>>;
function fields(bytes: Uint8Array): Fields {
  const pbf = new PbfReader(bytes);
  const result = pbf.readFields((tag, values: Fields, reader) => {
    if (reader.type !== 0 && reader.type !== 2) return;
    const value = reader.type === 2 ? reader.readBytes() : reader.readVarint(true);
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('OSM integer exceeds safe precision.');
    const list = values.get(tag) ?? [];
    list.push(value); values.set(tag, list);
  }, new Map());
  if (pbf.pos > pbf.length) throw new Error('Truncated OSM protobuf field.');
  return result;
}
const bytes = (values: Fields, tag: number): Uint8Array[] => (values.get(tag) ?? []).filter((value): value is Uint8Array => value instanceof Uint8Array);
const scalar = (values: Fields, tag: number, fallback = 0): number => {
  const value = values.get(tag)?.[0];
  if (value === undefined) return fallback;
  if (typeof value !== 'number') throw new Error('OSM numeric field changed.');
  return value;
};
function packed(values: Fields, tag: number, signed = false): number[] {
  const result: number[] = [];
  for (const buffer of bytes(values, tag)) {
    const reader = new PbfReader(buffer);
    while (reader.pos < reader.length) {
      const value = signed ? reader.readSVarint() : reader.readVarint();
      if (!Number.isSafeInteger(value) || result.length >= 1000000) throw new Error('OSM packed field exceeds the bounded decoder.');
      result.push(value);
    }
  }
  return result;
}
function string(strings: string[], index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= strings.length) throw new Error('OSM string-table reference is invalid.');
  return strings[index];
}
function observations(block: Uint8Array, state: string): BusinessObservation[] {
  const primitive = fields(block), table = bytes(primitive, 1)[0];
  if (!table) throw new Error('OSM primitive block has no string table.');
  const strings = bytes(fields(table), 1).map((value) => Buffer.from(value).toString('utf8'));
  const granularity = scalar(primitive, 17, 100), latOffset = scalar(primitive, 19), lonOffset = scalar(primitive, 20);
  if (granularity <= 0) throw new Error('OSM coordinate granularity is invalid.');
  const items: BusinessObservation[] = [];
  const retain = (id: number, latitude: number, longitude: number, tags: Record<string, string>): void => {
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error('OSM node identity or location is invalid.');
    if (!tags.name || !['shop', 'craft', 'office', 'amenity', 'tourism'].some((key) => tags[key]) && tags.man_made !== 'works') return;
    if (tags['addr:state'] && tags['addr:state'].toUpperCase() !== state) return;
    const row = mappedBusinessObservation(`node/${id}`, tags, latitude, longitude, null);
    // An extract is buffered geography, not a reported business mailing state.
    row.index_partition = state;
    items.push(row);
  };
  for (const groupBytes of bytes(primitive, 2)) {
    const group = fields(groupBytes);
    for (const nodeBytes of bytes(group, 1)) {
      const node = fields(nodeBytes), keys = packed(node, 2), values = packed(node, 3);
      if (keys.length !== values.length) throw new Error('OSM node tag vectors disagree.');
      const tags = Object.fromEntries(keys.map((key, i) => [string(strings, key), string(strings, values[i])]));
      const id = scalar(node, 1), lat = scalar(node, 8), lon = scalar(node, 9);
      const unzig = (value: number): number => value % 2 ? -(value + 1) / 2 : value / 2;
      retain(unzig(id), (latOffset + granularity * unzig(lat)) * 1e-9, (lonOffset + granularity * unzig(lon)) * 1e-9, tags);
    }
    for (const denseBytes of bytes(group, 2)) {
      const dense = fields(denseBytes), ids = packed(dense, 1, true), lats = packed(dense, 8, true), lons = packed(dense, 9, true), tags = packed(dense, 10);
      if (ids.length > 100000 || ids.length !== lats.length || ids.length !== lons.length) throw new Error('OSM dense-node vectors disagree.');
      let id = 0, lat = 0, lon = 0, position = 0;
      for (let i = 0; i < ids.length; i++) {
        id += ids[i]; lat += lats[i]; lon += lons[i];
        const attributes: Record<string, string> = {};
        if (tags.length) {
          while (position < tags.length && tags[position] !== 0) {
            if (position + 1 >= tags.length) throw new Error('OSM dense tags are truncated.');
            attributes[string(strings, tags[position++])] = string(strings, tags[position++]);
          }
          if (tags[position++] !== 0) throw new Error('OSM dense tags have no node delimiter.');
        }
        retain(id, (latOffset + granularity * lat) * 1e-9, (lonOffset + granularity * lon) * 1e-9, attributes);
      }
      if (position !== tags.length) throw new Error('OSM dense tags exceed their node vector.');
    }
  }
  return items;
}
function blob(buffer: Buffer, offset: number): { end: number; type: string; data: Uint8Array } | null {
  if (offset + 4 > buffer.length) return null;
  const headerLength = buffer.readUInt32BE(offset);
  if (!headerLength || headerLength > 65536) throw new Error('OSM blob header exceeds its bounded decoder.');
  if (offset + 4 + headerLength > buffer.length) return null;
  const header = fields(buffer.subarray(offset + 4, offset + 4 + headerLength)), size = scalar(header, 3);
  const end = offset + 4 + headerLength + size;
  if (!size || size > RANGE_BYTES - 65540) throw new Error('OSM compressed blob exceeds the range budget.');
  if (end > buffer.length) return null;
  const body = fields(buffer.subarray(offset + 4 + headerLength, end)), rawSize = scalar(body, 2);
  const raw = bytes(body, 1)[0], compressed = bytes(body, 3)[0];
  if (rawSize > MAX_BLOB || raw && raw.length > MAX_BLOB) throw new Error('OSM expanded blob exceeds its memory budget.');
  if (!raw && !compressed) throw new Error('OSM blob compression is unsupported.');
  const data = raw ?? inflateSync(compressed, { maxOutputLength: MAX_BLOB });
  if (rawSize && data.length !== rawSize) throw new Error('OSM expanded blob size disagrees with its header.');
  return { end, type: Buffer.from(bytes(header, 1)[0] ?? []).toString('utf8'), data };
}
async function range(url: string, start: number, length: number, signal: AbortSignal, validator?: string): Promise<{
  data: Buffer; version: string; total: number;
}> {
  const response = await fetch(url, { signal, cache: 'no-store', headers: { 'User-Agent': ua, Range: `bytes=${start}-${start + length - 1}`,
    ...(validator ? { 'If-Unmodified-Since': validator } : {}) } });
  const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/), version = response.headers.get('last-modified');
  if (response.status !== 206 || !response.body || !match || Number(match[1]) !== start || Number(match[2]) - start + 1 > length
    || !version || validator && version !== validator || Number(match[3]) > 8 * 1024 * 1024 * 1024) {
    await response.body?.cancel(); throw new Error(`Public OSM extract cannot be read at its stable bounded checkpoint (HTTP ${response.status}).`);
  }
  const reader = response.body.getReader(), chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > length) throw new Error('OSM range body exceeds its declared budget.');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  if (size !== Number(match[2]) - start + 1) throw new Error('OSM range body is truncated.');
  return { data: Buffer.concat(chunks), version, total: Number(match[3]) };
}
export async function osmDirectoryBatch(part: { state: string; cursor: number; building_version: string | null }, signal: AbortSignal): Promise<{
  version: string; cursor: number; complete: boolean; items: BusinessObservation[];
}> {
  const url = RESEARCH_OSM_EXTRACTS[part.state];
  if (!url) throw new Error('No official public OSM extract is available for this state.');
  const first = await range(url, 0, 4096, signal), header = blob(first.data, 0);
  if (!header || header.type !== 'OSMHeader') throw new Error('OSM extract header is unsupported.');
  const required = bytes(fields(header.data), 4).map((value) => Buffer.from(value).toString('utf8'));
  if (!required.includes('OsmSchema-V0.6') || required.some((feature) => !['OsmSchema-V0.6', 'DenseNodes'].includes(feature))) throw new Error('OSM extract requires unsupported schema features.');
  const start = part.building_version === first.version ? part.cursor : 0;
  if (!Number.isSafeInteger(start) || start < 0 || start > first.total) throw new Error('OSM source no longer contains its saved checkpoint.');
  if (start === first.total) return { version: first.version, cursor: start, complete: true, items: [] };
  const next = await range(url, start, RANGE_BYTES, signal, first.version);
  let offset = 0, truncated = false;
  const items: BusinessObservation[] = [];
  while (offset < next.data.length) {
    const decoded = blob(next.data, offset);
    if (!decoded) { truncated = true; break; }
    if (!['OSMHeader', 'OSMData'].includes(decoded.type)) throw new Error('OSM extract contains an unsupported blob type.');
    const batch = decoded.type === 'OSMData' ? observations(decoded.data, part.state) : [];
    if (batch.length > 2500) throw new Error('OSM node block exceeds its retained-record budget.');
    if (items.length + batch.length > 2500) break;
    items.push(...batch); offset = decoded.end;
  }
  if (!offset) throw new Error('OSM checkpoint did not advance within its bounded range.');
  const cursor = start + offset, complete = cursor === first.total;
  if (truncated && next.data.length < RANGE_BYTES) throw new Error('OSM extract ended with an incomplete blob.');
  return { version: first.version, cursor, complete, items };
}
