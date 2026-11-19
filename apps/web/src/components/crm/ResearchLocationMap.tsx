'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { addResearchBaseLayers } from './research-map-layers';

export default function ResearchLocationMap({ latitude, longitude, label }: { latitude: number; longitude: number; label: string }): JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true, remove: (() => void) | undefined;
    void import('leaflet').then((L) => {
      if (!active || !container.current) return;
      const map = L.map(container.current, { scrollWheelZoom: false }).setView([latitude, longitude], 16);
      addResearchBaseLayers(L, map, (message) => { if (active) setError(message); });
      L.circleMarker([latitude, longitude], { radius: 9, color: '#e55353', fillOpacity: 0.9 }).bindTooltip(label).addTo(map);
      remove = () => map.remove();
    }).catch(() => { if (active) setError('Location map could not be loaded.'); });
    return () => { active = false; remove?.(); };
  }, [latitude, longitude, label]);
  return <div className="space-y-1">
    <div ref={container} aria-label="Business location map" className="relative z-0 h-56 w-full rounded border border-cui-border" />
    {error ? <p className="text-xs text-cui-muted">{error}</p> : null}
  </div>;
}
