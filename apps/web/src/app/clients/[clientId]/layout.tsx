'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AccountTab, AccountWorkspaceContext } from './account-workspace-context';

const accountTabs: Array<{ value: AccountTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'policies', label: 'Policies' },
  { value: 'details', label: 'Details' },
  { value: 'submissions', label: 'Submissions' },
  { value: 'quotes', label: 'Quotes' },
  { value: 'leadInfo', label: 'Lead Info' },
  { value: 'documents', label: 'Documents' },
  { value: 'certificates', label: 'Certificates' },
];

interface AccountClient {
  id: string;
  full_name: string;
  address?: string | null;
  account_type?: 'unknown' | 'personal' | 'commercial' | null;
  assigned_producer?: string | null;
  csr?: string | null;
  since_date?: string | null;
  email?: string | null;
  preferred_channel?: string | null;
  created_at?: string | null;
}

function formatDate(value?: string | null): string {
  if (!value) return '--';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';

  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export default function AccountWorkspaceLayout({ children }: { children: React.ReactNode }): JSX.Element {
  const params = useParams<{ clientId: string }>();
  const clientId = params?.clientId;
  const [activeTab, setActiveTab] = useState<AccountTab>('overview');
  const [client, setClient] = useState<AccountClient | null>(null);

  useEffect(() => {
    if (!clientId) return;

    const loadAccount = async (): Promise<void> => {
      const response = await fetch(`/api/clients/${clientId}/workspace`, { cache: 'no-store' });
      if (!response.ok) {
        setClient(null);
        return;
      }

      const payload = (await response.json()) as { client?: AccountClient | null };
      setClient(payload.client ?? null);
    };

    void loadAccount();
  }, [clientId]);

  const accountType = client?.account_type ?? 'unknown';
  const accountTypeLabel = accountType.charAt(0).toUpperCase() + accountType.slice(1);
  const agencyName = 'Shield Assurance';
  const addressQuery = encodeURIComponent(client?.address ?? '');
  const addressLinks = [
    { label: 'Map', href: `https://www.google.com/maps/search/?api=1&query=${addressQuery}` },
    { label: 'Zillow', href: `https://www.zillow.com/homes/${addressQuery}_rb/` },
    { label: 'Google Earth', href: `https://earth.google.com/web/search/${addressQuery}` },
    { label: 'Google Search', href: `https://www.google.com/search?q=${addressQuery}` },
    { label: 'County Assessor', href: `https://www.google.com/search?q=${addressQuery}+county+assessor` },
  ];

  const contextValue = useMemo(() => ({ activeTab, setActiveTab }), [activeTab]);

  return (
    <AccountWorkspaceContext.Provider value={contextValue}>
      <div className="flex h-full w-full overflow-hidden bg-slate-50 text-slate-900">
        {/* Account Details Left Panel - Fixed Width */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white shadow-sm p-4">
          <div className="border-b border-slate-200 pb-4">
            <h2 className="text-[22px] font-bold tracking-tight text-[#23282c]">{client?.full_name ?? 'Account'}</h2>
            <div className="mt-4 grid grid-cols-6 gap-2">
              {['★', '@', 'M', 'C', 'P', 'S'].map((icon, index) => (
                <button
                  key={`${icon}-${index}`}
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-[#d8e4f2] bg-[#f7fbff] text-xs font-bold text-[#1f4f7c] transition hover:bg-[#ebf5ff]"
                  aria-label={`Account action ${icon}`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 pt-4 text-sm text-[#415669]">
            <dl className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#73818f]">Type:</dt>
                <dd className="font-semibold text-[#23282c]">{accountTypeLabel}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#73818f]">Since:</dt>
                <dd>{formatDate(client?.since_date ?? client?.created_at)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#73818f]">Assigned Producer:</dt>
                <dd>{client?.assigned_producer || '--'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#73818f]">CSR:</dt>
                <dd>{client?.csr || '--'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#73818f]">Agency:</dt>
                <dd>{agencyName}</dd>
              </div>
            </dl>

            <section className="border-t border-[#eaf0f6] pt-4">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#73818f]">Address</h3>
              <p className="mt-2 leading-relaxed text-[#2f4054]">{client?.address || '--'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {addressLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                      client?.address
                        ? 'border-[#cfe0f4] bg-[#f7fbff] text-[#0f5f9d] hover:bg-[#ebf5ff]'
                        : 'pointer-events-none border-[#edf1f5] bg-[#f8fafc] text-[#a7b3c1]'
                    }`}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </section>

            <section className="border-t border-[#eaf0f6] pt-4">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#73818f]">Business Info</h3>
              <p className="mt-2 text-[#2f4054]">{client?.preferred_channel ? `Preferred channel: ${client.preferred_channel}` : 'No business details available yet.'}</p>
            </section>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden">
          <div className="flex h-full flex-col">
            <header className="border-b border-[#e1e6ea] bg-white px-5 py-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#73818f]">Account Workspace</p>
                  <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#23282c]">{client?.full_name ?? 'Account'}</h1>
                </div>
                <div className="flex flex-wrap gap-2 text-xs font-semibold text-[#5c6873]">
                  <span className="rounded-full bg-[#e3f2ff] px-3 py-1 text-[#0a4f8f]">Email {client?.email ? 'On' : 'Off'}</span>
                  <span className="rounded-full bg-[#ecf8f1] px-3 py-1 text-[#1f7a47]">SMS {client?.preferred_channel === 'sms' || client?.preferred_channel === 'both' ? 'On' : 'Off'}</span>
                </div>
              </div>

              <nav className="mt-4">
                <div className="flex flex-wrap gap-1">
                  {accountTabs.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      onClick={() => setActiveTab(tab.value)}
                      className={`border-b-2 px-3 py-2 text-sm font-semibold transition ${
                        activeTab === tab.value
                          ? 'border-[#167495] text-[#0f4f84]'
                          : 'border-transparent text-[#536980] hover:border-[#cfdfe9] hover:text-[#173a5a]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </nav>
            </header>

            <div className="flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
          </div>
        </main>
      </div>
    </AccountWorkspaceContext.Provider>
  );
}
