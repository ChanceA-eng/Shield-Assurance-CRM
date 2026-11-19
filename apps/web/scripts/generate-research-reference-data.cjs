const fs = require('node:fs/promises');
const path = require('node:path');
const XLSX = require('xlsx');

const naicsUrl = 'https://www.census.gov/naics/2022NAICS/2022_NAICS_Structure.xlsx';
const placesUrl = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_place_national.zip';
const extractsUrl = 'https://download.geofabrik.de/index-v1.json';

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Reference download returned HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  if (process.argv.includes('--osm-only')) {
    const catalogue = JSON.parse((await download(extractsUrl)).toString('utf8'));
    const extracts = {};
    for (const { properties } of catalogue.features) {
      if (!/^us\/[a-z-]+$/.test(properties.id) || properties['iso3166-2']?.length !== 1) continue;
      const state = properties['iso3166-2'][0].match(/^US-([A-Z]{2})$/)?.[1], url = properties.urls?.pbf;
      if (!state || typeof url !== 'string' || !/^https:\/\/download\.geofabrik\.de\/north-america\/us\/[a-z-]+-latest\.osm\.pbf$/.test(url)) continue;
      if (extracts[state]) throw new Error(`Duplicate official state extract: ${state}`);
      extracts[state] = url;
    }
    if (Object.keys(extracts).length < 50 || extracts.AZ !== 'https://download.geofabrik.de/north-america/us/arizona-latest.osm.pbf') {
      throw new Error('The official extract catalogue is missing expected U.S. coverage.');
    }
    await fs.writeFile(path.resolve(__dirname, '..', 'src', 'data', 'research-osm-extracts.ts'),
      `// Public, contributor-metadata-stripped Geofabrik extracts: ${extractsUrl}\nexport const RESEARCH_OSM_EXTRACTS: Record<string, string> = ${JSON.stringify(extracts)};\n`);
    console.log(`Generated ${Object.keys(extracts).length} official public state extract URLs.`);
    return;
  }
  const [workbookBytes, placesBytes] = await Promise.all([download(naicsUrl), download(placesUrl)]);
  const workbook = XLSX.read(workbookBytes);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['2022 NAICS Structure'], { header: 1 });
  const naics = rows.slice(3).map((row) => ({
    code: String(row[1] ?? '').trim(),
    title: String(row[2] ?? '').trim().replace(/T$/, '').trim(),
  })).filter((row) => /^\d{2,6}$|^(31-33|44-45|48-49)$/.test(row.code) && row.title);
  if (naics.length < 2000 || !naics.some((row) => row.code === '722511' && row.title === 'Full-Service Restaurants')) {
    throw new Error('The official NAICS workbook no longer matches the supported structure.');
  }
  const archive = XLSX.CFB.read(placesBytes, { type: 'buffer' });
  const file = archive.FileIndex.find((entry) => entry.name === '2026_Gaz_place_national.txt');
  if (!file?.content) throw new Error('The official places archive has an unsupported structure.');
  const lines = Buffer.from(file.content).toString('utf8').trim().split(/\r?\n/);
  const headers = lines.shift().split('|').map((value) => value.trim());
  const byState = {};
  for (const line of lines) {
    const row = Object.fromEntries(line.split('|').map((value, index) => [headers[index], value.trim()]));
    const latitude = Number(row.INTPTLAT), longitude = Number(row.INTPTLONG);
    if (!/^[A-Z]{2}$/.test(row.USPS) || !/^\d{7}$/.test(row.GEOID) || !row.NAME
      || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new Error('The official places file contains an unsupported record.');
    }
    const name = row.NAME.replace(/ (city and borough|consolidated government|metropolitan government|unified government|municipality|comunidad|zona urbana|borough|village|town|city|CDP)$/, '');
    (byState[row.USPS] ??= []).push({ id: row.GEOID, name, label: row.NAME, latitude, longitude });
  }
  if (Object.keys(byState).length !== 52 || !byState.AZ.some((row) => row.name === 'Tucson')) {
    throw new Error('The places file is missing expected state coverage.');
  }
  for (const places of Object.values(byState)) places.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const shared = path.resolve(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'data');
  const web = path.resolve(__dirname, '..', 'src', 'data');
  await Promise.all([fs.mkdir(shared, { recursive: true }), fs.mkdir(web, { recursive: true })]);
  await Promise.all([
    fs.writeFile(path.join(shared, 'naics-2022.ts'), `// Census NAICS 2022: ${naicsUrl}\nexport const NAICS_2022: Array<{ code: string; title: string }> = ${JSON.stringify(naics)};\n`),
    fs.writeFile(path.join(web, 'research-places-2026.js'), `// Census Gazetteer 2026: ${placesUrl}\nexport const RESEARCH_PLACES = ${JSON.stringify(byState)};\n`),
  ]);
  console.log(`Generated ${naics.length} official NAICS entries and ${Object.values(byState).reduce((sum, places) => sum + places.length, 0)} Census places across ${Object.keys(byState).length} states/territories.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
