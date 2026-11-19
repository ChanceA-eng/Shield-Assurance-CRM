'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { addResearchBaseLayers } from './research-map-layers';

export interface MapBusiness { id: string; name: string; latitude: number; longitude: number; google: boolean }
export interface MapCenter { latitude: number; longitude: number; radius_miles: number | null }

export default function BusinessSearchMap({ businesses, center, selected, onSelect, onSearchArea }: {
  businesses: MapBusiness[]; center: MapCenter | null; selected: string | null; onSelect: (id: string) => void; onSearchArea: (bounds: string) => void;
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null), map = useRef<Map | null>(null);
  const markers = useRef<LayerGroup | null>(null), area = useRef<LayerGroup | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const select = useRef(onSelect);
  select.current = onSelect;
  useEffect(() => {
    let active = true;
    void import('leaflet').then((L) => {
      if (!active || !container.current) return;
      const instance = L.map(container.current).setView([39, -98], 4);
      map.current = instance;
      addResearchBaseLayers(L, instance, (message) => { if (active) setError(message); });
      area.current = L.layerGroup().addTo(instance);
      markers.current = L.layerGroup().addTo(instance);
      setReady(true);
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Map could not be loaded.'); });
    return () => { active = false; map.current?.remove(); map.current = null; markers.current = null; area.current = null; };
  }, []);
  const centerKey = center ? `${center.latitude},${center.longitude},${center.radius_miles ?? ''}` : '';
  useEffect(() => {
    let active = true;
    if (!ready) return;
    void import('leaflet').then((L) => {
      if (!active || !area.current || !map.current) return;
      area.current.clearLayers();
      if (center?.radius_miles) {
        const circle = L.circle([center.latitude, center.longitude], { radius: center.radius_miles * 1609.344, color: '#321fdb', weight: 2,
          fillOpacity: 0.05, interactive: false }).addTo(area.current);
        map.current.fitBounds(circle.getBounds(), { padding: [12, 12] });
      } else if (businesses.length) {
        map.current.fitBounds(L.latLngBounds(businesses.map((item) => [item.latitude, item.longitude])), { padding: [24, 24], maxZoom: 15 });
      } else if (center) map.current.setView([center.latitude, center.longitude], 11);
    }).catch(() => undefined);
    return () => { active = false; };
    // Re-fit only when the searched area or result set changes, not on selection.
  }, [ready, centerKey, businesses]);
  useEffect(() => {
    let active = true;
    if (!ready) return;
    void import('leaflet').then((L) => {
      if (!active || !markers.current) return;
      markers.current.clearLayers();
      for (const business of businesses) {
        const chosen = selected === business.id;
        const marker = L.circleMarker([business.latitude, business.longitude], { radius: chosen ? 10 : 7,
          color: chosen ? '#2f353a' : business.google ? '#2eb85c' : '#3399ff', fillOpacity: 0.85 }).addTo(markers.current);
        const label = document.createElement('span'); label.textContent = business.name;
        marker.bindTooltip(label).on('click', () => select.current(business.id));
      }
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Map markers could not be loaded.'); });
    return () => { active = false; };
  }, [ready, businesses, selected]);
  return <div aria-label="Business map" className="space-y-2">
    <div ref={container} className="relative z-0 h-[28rem] w-full rounded border border-cui-border" />
    {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="flex flex-wrap items-center gap-3">
        <span>{businesses.length} mapped businesses</span>
        <span className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-[#3399ff]" />Public record</span>
        <span className="flex items-center gap-1"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-[#2eb85c]" />Google Maps listing</span>
      </span>
      <button type="button" disabled={!ready} className="rounded border border-cui-border bg-white px-3 py-2 text-cui-primary"
        onClick={() => {
          const bounds = map.current?.getBounds();
          if (bounds) onSearchArea([bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()].map((value) => value.toFixed(6)).join(','));
        }}>Search this map area</button>
    </div>
  </div>;
}