'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PremiumMonth } from '../../lib/home-metrics';

interface PremiumChartProps {
  series: PremiumMonth[];
}

function currency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function PremiumChart({ series }: PremiumChartProps): JSX.Element {
  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="premiumFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#20a8d8" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#20a8d8" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e5e6" />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#73818f' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 12, fill: '#73818f' }} tickLine={false} axisLine={false} tickFormatter={currency} width={64} />
          <Tooltip formatter={(value) => [currency(numeric(value)), 'Premium']} />
          <Area type="monotone" dataKey="premium" stroke="#20a8d8" strokeWidth={2} fill="url(#premiumFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
