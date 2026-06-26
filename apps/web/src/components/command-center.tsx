"use client";

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';

interface CommandItem {
  label: string;
  hint: string;
  action: () => void;
}

export function CommandCenter(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commands = useMemo<CommandItem[]>(
    () => [
      { label: 'Go to Accounts', hint: 'Jump to household profiles', action: () => console.log('accounts') },
      { label: 'Create Deal', hint: 'Open quick create', action: () => console.log('create deal') },
      { label: 'Open Renewal Pipeline', hint: 'Switch board', action: () => console.log('renewals') },
      { label: 'Sync Outlook Mailbox', hint: 'Run Graph sync', action: () => console.log('sync mailbox') },
    ],
    [],
  );

  const filtered = commands.filter((item) =>
    `${item.label} ${item.hint}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/35 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[22%] w-[92vw] max-w-xl -translate-x-1/2 rounded-2xl border border-white/70 bg-white p-4 shadow-panel">
          <Dialog.Title className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-tide">Command Center</Dialog.Title>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-frost bg-base px-4 py-3 text-sm outline-none ring-tide/50 focus:ring"
            placeholder="Search commands, records, workflows..."
          />
          <ul className="mt-3 space-y-2">
            {filtered.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  className="w-full rounded-xl border border-transparent bg-frost/55 px-3 py-2 text-left transition hover:border-tide/30 hover:bg-frost"
                  onClick={() => {
                    item.action();
                    setOpen(false);
                  }}
                >
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="text-xs text-ink/65">{item.hint}</p>
                </button>
              </li>
            ))}
            {filtered.length === 0 ? <li className="px-2 py-4 text-sm text-ink/60">No matching commands.</li> : null}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
