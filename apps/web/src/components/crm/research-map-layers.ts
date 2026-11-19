import type * as Leaflet from 'leaflet';

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Google Maps base tiles through the CRM proxy, with OpenStreetMap as a switchable layer and automatic fallback. */
export function addResearchBaseLayers(L: typeof Leaflet, map: Leaflet.Map, onError: (message: string) => void): void {
  const google = L.tileLayer('/api/intelligence/map-tiles/{z}/{x}/{y}', {
    attribution: `Map data &copy;${new Date().getFullYear()} Google`, maxZoom: 20, updateWhenIdle: true, keepBuffer: 1,
  });
  const osm = L.tileLayer(process.env.NEXT_PUBLIC_RESEARCH_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: OSM_ATTRIBUTION, maxZoom: 19, updateWhenIdle: true, keepBuffer: 1,
  });
  let failures = 0;
  google.on('tileerror', () => {
    if (++failures < 3 || !map.hasLayer(google)) return;
    map.removeLayer(google); osm.addTo(map);
    onError('Google Maps tiles are unavailable; showing OpenStreetMap.');
  });
  osm.on('tileerror', () => { if (!map.hasLayer(google)) onError('Map tiles could not be loaded. List search remains available.'); });
  google.addTo(map);
  L.control.layers({ 'Google Maps': google, OpenStreetMap: osm }, undefined, { position: 'topright' }).addTo(map);
}
