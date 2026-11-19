'use client';

import { useCallback, useEffect, useState } from 'react';
import SectionLayout from './SectionLayout';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { workspaceFetch } from '../../lib/workspace-fetch';

interface Campaign {
  id: string;
  name: string;
  status: string;
  daily_limit: number;
  sender_accounts: string[];
  last_error: string | null;
  created_at: string;
  instantly_campaign_leads?: Array<{ count: number }>;
}

interface CampaignResponse {
  campaigns: Campaign[];
}

const buttonClass = 'rounded border border-cui-border px-3 py-2 text-sm font-semibold text-cui-text hover:bg-cui-light disabled:cursor-not-allowed disabled:opacity-50';

function providerStateMessage(status: string): string {
  if (status === 'ready') return 'Staged and paused.';
  if (status === 'active') return 'Active.';
  if (status === 'paused') return 'Paused.';
  if (status === 'creation_unknown' || status === 'activation_unknown' || status === 'pause_unknown') {
    return 'Campaign state is unconfirmed. Check the connected service before taking another action; the CRM will not retry automatically.';
  }
  if (status === 'setup_failed') return 'Campaign preparation failed. Review the campaign and leads before retrying.';
  return `Campaign status: ${status.replace(/_/g, ' ')}.`;
}

export default function InstantlyCampaignWorkspace(): JSX.Element {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const campaignData = await workspaceFetch<CampaignResponse>('/api/instantly/campaigns');
      setCampaigns(campaignData.campaigns);
    } catch {
      setError('Campaign history could not be loaded. Refresh to retry, or contact support.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const pauseCampaign = async (campaign: Campaign): Promise<void> => {
    if (saving || !window.confirm('Pause this campaign now?')) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await workspaceFetch(`/api/instantly/campaigns/${encodeURIComponent(campaign.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      });
      setNotice('Campaign paused.');
      await refresh();
    } catch {
      await refresh();
      setError('Pausing could not be confirmed. Check the connected service before retrying.');
    } finally {
      setSaving(false);
    }
  };

  return <SectionLayout title="Campaigns">
    <div className="space-y-4">
      {error ? <p role="alert" className="rounded border border-cui-danger/40 bg-cui-danger/10 p-3 text-sm text-cui-danger">{error}</p> : null}
      {notice ? <p role="status" className="rounded border border-cui-success/40 bg-cui-success/10 p-3 text-sm text-cui-text">{notice}</p> : null}

      <Card>
        <CardHeader>Campaigns deferred</CardHeader>
        <CardBody>
          <p role="status" className="text-sm text-cui-muted">New campaigns are paused. Existing campaign history is preserved.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader actions={<button type="button" className={buttonClass} onClick={() => void refresh()} disabled={loading || saving}>{loading ? 'Loading...' : 'Refresh history'}</button>}>Recent campaigns</CardHeader>
        <CardBody className="space-y-3">
          {!campaigns.length ? <p className="text-sm text-cui-muted">{loading ? 'Loading campaign history...' : error ? 'Campaign history is unavailable.' : 'No campaigns have been staged.'}</p> : campaigns.map((campaign) => {
            const count = campaign.instantly_campaign_leads?.[0]?.count ?? 0;
            return <div key={campaign.id} className="rounded border border-cui-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-cui-text">{campaign.name}</p>
                  <p className="text-xs text-cui-muted">{count} leads · {campaign.daily_limit}/day · {campaign.sender_accounts.join(', ')}</p>
                  <p className="mt-1 text-sm text-cui-muted">{providerStateMessage(campaign.status)}</p>
                  {campaign.last_error ? <p role="alert" className="mt-1 text-sm text-cui-danger">This campaign needs attention. Review it before taking another action.</p> : null}
                </div>
                <div className="flex gap-2">
                  {campaign.status === 'active' ? <button type="button" className={buttonClass} disabled={saving || loading} onClick={() => void pauseCampaign(campaign)}>Pause</button> : null}
                </div>
              </div>
            </div>;
          })}
        </CardBody>
      </Card>
    </div>
  </SectionLayout>;
}
