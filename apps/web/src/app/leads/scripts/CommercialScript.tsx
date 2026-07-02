'use client';

import { useEffect, useState } from 'react';

export interface ScriptItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface ScriptData {
  hook: string;
  checklist: ScriptItem[];
}

interface CommercialScriptProps {
  onChange: (data: ScriptData) => void;
}

const DEFAULT_HOOK = `Hi [Name], I'm an independent commercial broker with Shield Assurance. I specialize in asset protection for local businesses. Rates and appetites shifted wildly this year—I'd love to grab a 10-minute call next Tuesday to run an independent audit on your deck pages. If it's airtight, I'll be the first to tell you.`;

const DEFAULT_CHECKLIST: ScriptItem[] = [
  { id: 'ops', label: 'Daily Operations & Halting Risks', checked: false },
  { id: 'w2', label: 'Employee Count / Hired & Non-Owned Autos', checked: false },
  { id: 'cyber', label: 'Data Storage & Server Security', checked: false },
];

export default function CommercialScript({ onChange }: CommercialScriptProps): JSX.Element {
  const [hook, setHook] = useState(DEFAULT_HOOK);
  const [checklist, setChecklist] = useState<ScriptItem[]>(DEFAULT_CHECKLIST);
  const [newItemLabel, setNewItemLabel] = useState('');

  useEffect(() => {
    onChange({ hook, checklist });
  }, [hook, checklist, onChange]);

  function toggleCheck(id: string): void {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)),
    );
  }

  function addItem(): void {
    const label = newItemLabel.trim();
    if (!label) return;
    const id = `item_${Date.now()}`;
    setChecklist((prev) => [...prev, { id, label, checked: false }]);
    setNewItemLabel('');
  }

  function removeItem(id: string): void {
    setChecklist((prev) => prev.filter((item) => item.id !== id));
  }

  function updateLabel(id: string, label: string): void {
    setChecklist((prev) => prev.map((item) => (item.id === id ? { ...item, label } : item)));
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1 text-sm font-semibold text-[#0176d3]">📞 Phase 1: Phone Hook</h4>
        <textarea
          className="w-full rounded border border-[#dddbda] p-2 text-sm leading-relaxed text-[#2f2f2f] focus:border-[#0176d3] focus:outline-none"
          rows={5}
          value={hook}
          onChange={(e) => setHook(e.target.value)}
        />
      </div>

      <hr className="border-[#f3f2f1]" />

      <div>
        <h4 className="mb-2 text-sm font-semibold text-[#0176d3]">💻 Phase 2: Discovery Checklist</h4>

        <div className="space-y-1">
          {checklist.map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => toggleCheck(item.id)}
                className="mt-0.5 shrink-0 accent-[#0176d3]"
              />
              <input
                type="text"
                value={item.label}
                onChange={(e) => updateLabel(item.id, e.target.value)}
                className="flex-1 rounded border border-transparent px-1 py-0.5 text-sm text-[#2f2f2f] hover:border-[#dddbda] focus:border-[#0176d3] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                className="text-xs text-[#c23934] hover:underline"
                title="Remove item"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-2">
          <input
            type="text"
            placeholder="Add checklist item..."
            value={newItemLabel}
            onChange={(e) => setNewItemLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
            className="flex-1 rounded border border-[#dddbda] px-2 py-1 text-sm focus:border-[#0176d3] focus:outline-none"
          />
          <button
            type="button"
            onClick={addItem}
            className="rounded border border-[#0176d3] px-2 py-1 text-xs font-semibold text-[#0176d3] hover:bg-[#e8f4fd]"
          >
            + Add
          </button>
        </div>
      </div>
    </div>
  );
}
