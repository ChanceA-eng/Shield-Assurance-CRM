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
  phone: string;
  email: string;
  line_of_business: string;
  source: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  full_name: '',
  business: '',
  phone: '',
  email: '',
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
      business: form.business,
      phone: form.phone,
      email: form.email,
      line_of_business: selectedLob,
      source: form.source,
      notes: form.notes,
      status: 'new',
      script_hook: scriptData?.hook ?? '',
      script_checklist: scriptData?.checklist ?? [],
      discovery_flags: Object.fromEntries(
        (scriptData?.checklist ?? []).map((item) => [`${item.id}_checked`, item.checked]),
      ),
    };

    const res = await fetch('/api/leads', {
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
      <div className="w-full max-w-5xl rounded border border-[#dddbda] bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f3f2f1] px-5 py-3">
          <h2 className="text-lg font-bold text-[#080707]">New Lead</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-[#e5e5e5] px-3 py-1 text-xs font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
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
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#6a6a6a]">Capture Lead Details</h3>

              <input
                required
                type="text"
                placeholder="Full Name / Business Owner *"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm focus:border-[#0176d3] focus:outline-none"
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
              />

              <input
                type="text"
                placeholder="Legal Business Name"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm focus:border-[#0176d3] focus:outline-none"
                value={form.business}
                onChange={(e) => set('business', e.target.value)}
              />

              <input
                type="tel"
                placeholder="Phone Number *"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm focus:border-[#0176d3] focus:outline-none"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />

              <input
                type="email"
                placeholder="Email Address"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm focus:border-[#0176d3] focus:outline-none"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />

              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm focus:border-[#0176d3] focus:outline-none"
                value={form.line_of_business}
                onChange={(e) => set('line_of_business', e.target.value)}
              >
                <option value="commercial">Commercial Lines</option>
                <option value="personal">Personal Lines</option>
              </select>

              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm focus:border-[#0176d3] focus:outline-none"
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
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm focus:border-[#0176d3] focus:outline-none"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />

              <button
                type="submit"
                disabled={isSaving}
                className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60"
              >
                {isSaving ? 'Creating Lead...' : 'Create Lead'}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
              >
                Cancel
              </button>
            </div>

            {/* RIGHT — Live Script */}
            <div className="border-l border-[#f3f2f1] bg-[#fafaf9] p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#6a6a6a]">
                Live Call Script — {form.line_of_business === 'commercial' ? 'Commercial' : 'Personal'} Lines
              </h3>
              <p className="mb-3 text-xs text-[#6a6a6a]">
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
