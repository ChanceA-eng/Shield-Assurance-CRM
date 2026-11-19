'use client';

import { useRef, useState } from 'react';
import { documentFromText, emailDocumentHtml, type EmailBlock, type EmailRow } from '@crm/shared';
import EmailTextEditor from './EmailTextEditor';
import EmailImageUpload from './EmailImageUpload';

function TextPreview({ block }: { block: EmailBlock }): JSX.Element | null {
  if (!block.document) return null;
  try { return <div className="pointer-events-none break-words text-sm" dangerouslySetInnerHTML={{ __html: emailDocumentHtml(block.document) }} />; }
  catch (error) { return <p role="alert" className="text-sm text-cui-danger">{error instanceof Error ? error.message : 'Review this text block.'}</p>; }
}

export function newEmailBlock(type: EmailBlock['type']): EmailBlock {
  return { id: crypto.randomUUID(), type, color: type === 'button' ? '#ffffff' : '#263238',
    background: type === 'button' ? '#087ca1' : '#ffffff', padding: 12, border: 0, radius: 0, align: 'left',
    ...(type === 'text' ? { document: documentFromText('Write your text here.') } : {}),
    ...(type === 'image' ? { alt: '', url: '' } : {}),
    ...(type === 'button' ? { text: 'Learn more', href: 'https://' } : {}) };
}
export function initialEmailRows(): EmailRow[] {
  return [{ id: crypto.randomUUID(), background: '#ffffff', columns: [[newEmailBlock('body')]] }];
}

export default function EmailBlockWorkspace({ rows, onChange, onBusy, imageEndpoint, bodyLabel = 'Personalized message' }: {
  rows: EmailRow[]; onChange: (rows: EmailRow[]) => void; onBusy?: (busy: boolean) => void; imageEndpoint?: string; bodyLabel?: string;
}): JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<EmailRow[][]>([]);
  const [future, setFuture] = useState<EmailRow[][]>([]);
  const currentRows = useRef(rows);
  currentRows.current = rows;
  const update = (next: EmailRow[]): void => {
    setHistory((values) => [...values.slice(-29), currentRows.current]); setFuture([]); onChange(next);
  };
  const block = rows.flatMap((row) => row.columns.flat()).find((value) => value.id === selected);
  const changeBlock = (patch: Partial<EmailBlock>): void => update(rows.map((row) => ({
    ...row, columns: row.columns.map((col) => col.map((value) => value.id === selected ? { ...value, ...patch } : value)),
  })));
  const move = (id: string, rowId: string, column: number, index?: number): void => {
    const moving = rows.flatMap((row) => row.columns.flat()).find((value) => value.id === id);
    if (!moving) return;
    update(rows.map((row) => ({ ...row, columns: row.columns.map((col, colIndex) => {
      const clean = col.filter((value) => value.id !== id);
      if (row.id === rowId && colIndex === column) clean.splice(index ?? clean.length, 0, moving);
      return clean;
    }) })));
  };
  return <section aria-label="Email layout builder" className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <button type="button" className="crm-button" disabled={!history.length} onClick={() => {
        const previous = history.at(-1); if (!previous) return; setFuture([rows, ...future]); setHistory(history.slice(0, -1)); onChange(previous);
      }}>Undo layout</button>
      <button type="button" className="crm-button" disabled={!future.length} onClick={() => {
        const next = future[0]; if (!next) return; setHistory([...history, rows]); setFuture(future.slice(1)); onChange(next);
      }}>Redo layout</button>
      {[1, 2, 3].map((count) => <button type="button" className="crm-button" key={count} disabled={rows.length >= 30}
        onClick={() => update([...rows, { id: crypto.randomUUID(), background: '#ffffff', columns: Array.from({ length: count }, () => []) }])}>Add {count}-column row</button>)}
    </div>
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3 rounded border border-cui-border bg-cui-body p-3">
        {rows.map((row, rowIndex) => <section key={row.id} aria-label={`Row ${rowIndex + 1}`} className="rounded border border-cui-border p-2" style={{ background: row.background }}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <span>Row {rowIndex + 1}</span>
            <button type="button" className="crm-button px-2 py-1 text-xs" disabled={rowIndex === 0} onClick={() => {
              const next = [...rows]; next.splice(rowIndex, 1); next.splice(rowIndex - 1, 0, row); update(next);
            }}>Row up</button>
            <button type="button" className="crm-button px-2 py-1 text-xs" disabled={rowIndex === rows.length - 1} onClick={() => {
              const next = [...rows]; next.splice(rowIndex, 1); next.splice(rowIndex + 1, 0, row); update(next);
            }}>Row down</button>
            <button type="button" className="crm-button px-2 py-1 text-xs" disabled={row.columns.flat().some((value) => value.type === 'body')}
              onClick={() => update(rows.filter((value) => value.id !== row.id))}>Delete row</button>
            <label>Background <input type="color" value={row.background} onChange={(event) => update(rows.map((value) =>
              value.id === row.id ? { ...value, background: event.target.value } : value))} /></label>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${row.columns.length}, minmax(0, 1fr))` }}>
            {row.columns.map((column, columnIndex) => <div key={columnIndex} className="min-h-24 min-w-0 space-y-2 rounded border border-dashed border-cui-border p-2"
              aria-label={`Row ${rowIndex + 1} column ${columnIndex + 1}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData('text/plain');
                if (id) move(id, row.id, columnIndex);
              }}>
              {column.map((item, index) => <div key={item.id} className={`rounded border p-2 ${selected === item.id ? 'border-cui-primary' : 'border-cui-border'}`}
                style={{ background: item.background, color: item.type === 'button' ? '#263238' : item.color }} draggable
                onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id); }}>
                <button type="button" aria-pressed={selected === item.id} className="mb-2 block w-full text-left text-xs font-semibold capitalize" onClick={() => setSelected(item.id)}>
                  {item.type === 'body' ? bodyLabel : item.type} - edit
                </button>
                {item.type === 'text' ? <TextPreview block={item} /> : null}
                {item.type === 'image' && item.url ? <img src={item.url} alt={item.alt ?? ''} className="max-h-40 w-full object-contain" /> : null}
                {item.type === 'button' ? <span className="block rounded p-2 text-center text-sm" style={{ background: item.background, color: item.color }}>{item.text}</span> : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  <button type="button" className="crm-button px-1 py-0.5 text-xs" disabled={!index} aria-label={`Move ${item.type} up`}
                    onClick={() => move(item.id, row.id, columnIndex, index - 1)}>Up</button>
                  <button type="button" className="crm-button px-1 py-0.5 text-xs" disabled={index === column.length - 1} aria-label={`Move ${item.type} down`}
                    onClick={() => move(item.id, row.id, columnIndex, index + 1)}>Down</button>
                  <select aria-label={`Move ${item.type} to column`} className="crm-input w-auto py-0.5 text-xs" value=""
                    onChange={(event) => { const [targetRow, targetColumn] = event.target.value.split(':'); move(item.id, targetRow, Number(targetColumn)); }}>
                    <option value="">Move to...</option>{rows.flatMap((target, targetIndex) => target.columns.map((_, i) =>
                      <option key={`${target.id}:${i}`} value={`${target.id}:${i}`}>Row {targetIndex + 1}, column {i + 1}</option>))}
                  </select>
                  {item.type !== 'body' ? <button type="button" className="crm-button px-1 py-0.5 text-xs" onClick={() =>
                    update(rows.map((value) => ({ ...value, columns: value.columns.map((col) => col.filter((b) => b.id !== item.id)) })))}>Delete</button> : null}
                </div>
              </div>)}
              <select aria-label={`Add block to row ${rowIndex + 1} column ${columnIndex + 1}`} className="crm-input text-xs" value="" disabled={column.length >= 15}
                onChange={(event) => {
                  const type = event.target.value;
                  if (type !== 'text' && type !== 'image' && type !== 'button' && type !== 'divider' && type !== 'spacer') return;
                  const created = newEmailBlock(type); update(rows.map((value) => value.id === row.id ? {
                    ...value, columns: value.columns.map((col, i) => i === columnIndex ? [...col, created] : col),
                  } : value)); setSelected(created.id);
                }}>
                <option value="">Add block...</option>{['text', 'image', 'button', 'divider', 'spacer'].map((type) => <option key={type}>{type}</option>)}
              </select>
            </div>)}
          </div>
        </section>)}
      </div>
      <aside aria-label="Block properties" className="space-y-3 rounded border border-cui-border bg-cui-panel p-3 xl:sticky xl:top-3">
        {block ? <>
          <h3 className="font-semibold capitalize">{block.type === 'body' ? bodyLabel : block.type} properties</h3>
          {block.type === 'text' ? <EmailTextEditor value={block.document} onChange={(document) => changeBlock({ document })} /> : null}
          {block.type === 'body' ? <p className="text-sm text-cui-muted">The message you write or personalize is inserted here.</p> : null}
          {block.type === 'image' ? <>
            <EmailImageUpload key={block.id} endpoint={imageEndpoint} onBusy={onBusy} onUploaded={(url) => update(currentRows.current.map((row) => ({
              ...row, columns: row.columns.map((column) => column.map((item) => item.id === block.id ? { ...item, url } : item)),
            })))} />
            <label className="block text-xs">Description<input className="crm-input" maxLength={200} value={block.alt ?? ''} onChange={(event) => changeBlock({ alt: event.target.value })} /></label>
          </> : null}
          {block.type === 'button' ? <label className="block text-xs">Button text<input className="crm-input" maxLength={100} value={block.text ?? ''} onChange={(event) => changeBlock({ text: event.target.value })} /></label> : null}
          {block.type === 'button' || block.type === 'image' ? <label className="block text-xs">When clicked, go to<input className="crm-input" value={block.href ?? ''} maxLength={2000}
            placeholder="https://, mailto:, tel:" onChange={(event) => changeBlock({ href: event.target.value })} /></label> : null}
          <div className="grid grid-cols-2 gap-2">
            {(['color', 'background'] as const).map((field) => <label key={field} className="text-xs capitalize">{field}
              <input aria-label={`Block ${field}`} type="color" className="block" value={block[field]} onChange={(event) => changeBlock({ [field]: event.target.value })} /></label>)}
            {([['padding', 60], ['border', 8], ['radius', 40]] as const).map(([field, max]) => <label key={field} className="text-xs capitalize">{field} (px)
              <input type="number" className="crm-input" min={0} max={max} value={block[field]} onChange={(event) => changeBlock({ [field]: Number(event.target.value) })} /></label>)}
            <label className="text-xs">Align<select className="crm-input" value={block.align} onChange={(event) => {
              const align = event.target.value; if (align === 'left' || align === 'center' || align === 'right') changeBlock({ align });
            }}><option>left</option><option>center</option><option>right</option></select></label>
          </div>
        </> : <p className="text-sm text-cui-muted">Select a block to edit it. Drag blocks between columns or use their move controls.</p>}
      </aside>
    </div>
  </section>;
}
