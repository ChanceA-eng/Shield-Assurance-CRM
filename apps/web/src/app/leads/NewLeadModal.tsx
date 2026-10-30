'use client';

import { useCallback, useState } from 'react';
import CommercialScript, { type ScriptData } from './scripts/CommercialScript';
import PersonalScript from './scripts/PersonalScript';

interface NewLeadModalProps {
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  full_name: string;
  business: string;
  industry: string;
  category: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  est_employees: string;
  est_revenue: string;
  risk_exposure: string;
  line_of_business: string;
  source: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  full_name: '',
  business: '',
  industry: '',
  category: '',
  phone: '',
  email: '',
  address: '',
  website: '',
  est_employees: '',
  est_revenue: '',
  risk_exposure: '',
  line_of_business: 'commercial',
  source: 'cold_outreach',
  notes: '',
};

export default function NewLeadModal({ onClose, onSaved }: NewLeadModalProps): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScriptChange = useCallback((data: ScriptData) => {
    setScriptData(data);
  }, []);

  function set(field: keyof FormState, value: string): void {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    const selectedLob = form.line_of_business;

    const payload = {
      full_name: form.full_name,
      business_name: form.business,
      industry: form.industry,
      category: form.category,
      phone: form.phone,
      email: form.email,
      address: form.address,
      website: form.website,
      est_employees: form.est_employees,
      est_revenue: form.est_revenue,
      risk_exposure: form.risk_exposure,
      line_of_business: selectedLob,
      source: 'agent_intake',
      notes: form.notes,
      status: 'new',
      script_hook: scriptData?.hook ?? '',
      script_checklist: scriptData?.checklist ?? [],
      discovery_flags: Object.fromEntries(
        (scriptData?.checklist ?? []).map((item) => [`${item.id}_checked`, item.checked]),
      ),
    };

    const res = await fetch('/api/leads/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ message: 'Failed to create lead.' }))) as { message?: string };
      setError(body.message ?? 'Failed to create lead.');
      setIsSaving(false);
      return;
    }

    const created = (await res.json().catch(() => null)) as { id?: string } | null;
    const leadId = created?.id;

    if (leadId) {
      const basePath = selectedLob === 'commercial' ? '/commercial/intake' : '/personal/intake';
      window.location.assign(`${basePath}?lead=${encodeURIComponent(leadId)}`);
      return;
    }

    setIsSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10">
      <div className="w-full max-w-5xl rounded border border-[#c8ced3] bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f0f3f5] px-5 py-3">
          <h2 className="text-lg font-bold text-[#23282c]">New Lead</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-[#e4e5e6] px-3 py-1 text-xs font-semibold text-[#5c6873] hover:bg-[#c8ced3]"
          >
            Close
          </button>
        </div>

        {error ? (
          <div className="mx-5 mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {/* Two-column body */}
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
            {/* LEFT — Data Entry */}
            <div className="space-y-2 p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#73818f]">Capture Lead Details</h3>

              <input
                required
                type="text"
                placeholder="Full Name / Business Owner *"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
              />

              <input
                type="text"
                placeholder="Legal Business Name"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.business}
                onChange={(e) => set('business', e.target.value)}
              />

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <input
                  type="text"
                  placeholder="Industry"
                  className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                  value={form.industry}
                  onChange={(e) => set('industry', e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Category"
                  className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                  value={form.category}
                  onChange={(e) => set('category', e.target.value)}
                />
              </div>

              <input
                type="tel"
                placeholder="Phone Number *"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />

              <input
                type="email"
                placeholder="Email Address"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />

              <input
                type="text"
                placeholder="Address"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
              />

              <input
                type="text"
                placeholder="Website"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.website}
                onChange={(e) => set('website', e.target.value)}
              />

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <input
                  type="text"
                  placeholder="Est. Employees"
                  className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                  value={form.est_employees}
                  onChange={(e) => set('est_employees', e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Est. Revenue"
                  className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                  value={form.est_revenue}
                  onChange={(e) => set('est_revenue', e.target.value)}
                />
              </div>

              <textarea
                placeholder="Risk Exposure"
                rows={3}
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.risk_exposure}
                onChange={(e) => set('risk_exposure', e.target.value)}
              />

              <select
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.line_of_business}
                onChange={(e) => set('line_of_business', e.target.value)}
              >
                <option value="commercial">Commercial Lines</option>
                <option value="personal">Personal Lines</option>
              </select>

              <select
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.source}
                onChange={(e) => set('source', e.target.value)}
              >
                <option value="cold_outreach">Cold Outreach</option>
                <option value="website">Website Contact</option>
                <option value="referral">Referral</option>
                <option value="Phone Call">Phone Call</option>
                <option value="Facebook">Facebook</option>
                <option value="Google">Google</option>
              </select>

              <textarea
                placeholder="Live call notes..."
                rows={4}
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm focus:border-[#20a8d8] focus:outline-none"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />

              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7] disabled:opacity-60"
              >
                {isSaving ? 'Creating Lead...' : 'Create Lead'}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full rounded bg-[#e4e5e6] px-3 py-2 text-sm font-semibold text-[#5c6873] hover:bg-[#c8ced3]"
              >
                Cancel
              </button>
            </div>

            {/* RIGHT — Live Script */}
            <div className="border-l border-[#f0f3f5] bg-[#fafaf9] p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#73818f]">
                Live Call Script — {form.line_of_business === 'commercial' ? 'Commercial' : 'Personal'} Lines
              </h3>
              <p className="mb-3 text-xs text-[#73818f]">
                Edit hooks and checklist items inline. Saved with the lead. Mention a Zoom audit only when it fits the conversation.
              </p>

              {form.line_of_business === 'commercial' ? (
                <CommercialScript onChange={handleScriptChange} />
              ) : (
                <PersonalScript onChange={handleScriptChange} />
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
