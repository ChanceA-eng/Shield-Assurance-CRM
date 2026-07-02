'use client';

import Link from 'next/link';
import type { Route } from 'next';
import React, { useEffect, useMemo, useState } from 'react';

interface KnowledgeAsset {
  id: string;
  title: string;
  type: string;
  category: string;
  url: string | null;
  indexed: boolean;
  internal: boolean;
  updatedAt: string;
}

type FilterKey = 'all' | 'carrier_appetite' | 'state_manual' | 'training_video';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function typeBadgeClasses(type: string): string {
  if (type === 'video') return 'bg-rose-50 text-rose-700';
  if (type === 'pdf') return 'bg-sky-50 text-sky-700';
  if (type === 'manual') return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

export default function RashiKnowledgeCenter(): JSX.Element {
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAssets = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/assets/list', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Failed to load assets.');
        }

        const payload = (await response.json()) as { assets?: KnowledgeAsset[] };
        setAssets(payload.assets ?? []);
      } catch {
        setError('Could not load Knowledge Center assets.');
      } finally {
        setLoading(false);
      }
    };

    void loadAssets();
  }, []);

  const filteredAssets = useMemo(() => {
    if (selectedFilter === 'all') {
      return assets;
    }

    return assets.filter((asset) => asset.category === selectedFilter);
  }, [assets, selectedFilter]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 bg-white">
      <section className="mb-2 flex items-center justify-between border-b border-gray-100 pb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-950">Knowledge Center</h2>
          <p className="mt-0.5 text-xs text-gray-500">Firm wide underwriting assets, guidelines, and manuals.</p>
        </div>

        <Link
          href={'/rashi/knowledge' as Route}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-gray-800"
        >
          Open Knowledge Manager & Sheets
        </Link>
      </section>

      <section className="space-y-6">
        <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-3 text-xs">
            <button
              type="button"
              onClick={() => setSelectedFilter('all')}
              className={`rounded-full px-3 py-1 font-medium ${selectedFilter === 'all' ? 'bg-gray-950 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              All Assets
            </button>
            <button
              type="button"
              onClick={() => setSelectedFilter('carrier_appetite')}
              className={`rounded-full px-3 py-1 font-medium ${selectedFilter === 'carrier_appetite' ? 'bg-gray-950 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              Carrier Appetites
            </button>
            <button
              type="button"
              onClick={() => setSelectedFilter('state_manual')}
              className={`rounded-full px-3 py-1 font-medium ${selectedFilter === 'state_manual' ? 'bg-gray-950 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              State Manuals
            </button>
            <button
              type="button"
              onClick={() => setSelectedFilter('training_video')}
              className={`rounded-full px-3 py-1 font-medium ${selectedFilter === 'training_video' ? 'bg-gray-950 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              Training Videos
            </button>
        </div>

        {loading ? <p className="text-sm text-gray-500">Loading assets...</p> : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {!loading && !error ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredAssets.map((asset) => (
              <div
                key={asset.id}
                className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 transition-all hover:border-gray-300"
              >
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${typeBadgeClasses(asset.type)}`}>
                      {asset.type}
                    </span>
                    <span className={`text-[10px] font-medium ${asset.indexed ? 'text-emerald-600' : 'text-gray-400'}`}>
                      {asset.indexed ? 'Indexed' : 'Pending'}
                    </span>
                  </div>
                  <h3 className="truncate text-sm font-semibold text-gray-950">{asset.title}</h3>
                  <p className="mt-0.5 text-xs text-gray-400">Updated {formatDate(asset.updatedAt)}</p>
                </div>

                <Link
                  href={`/rashi/document/${asset.id}` as Route}
                  className="mt-4 inline-block text-left text-xs font-medium text-blue-600 hover:underline"
                >
                  View Document
                </Link>
              </div>
            ))}
          </div>
        ) : null}

        {!loading && !error && filteredAssets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
            No assets found for this filter yet.
          </div>
        ) : null}
      </section>
    </div>
  );
}
