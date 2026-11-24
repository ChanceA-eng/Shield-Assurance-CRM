'use client';

import { useEffect, useState, type MutableRefObject } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { documentFromText, EMAIL_FONTS, emailLink, parseEmailDocument, type EmailDocument } from '@crm/shared';

export default function EmailTextEditor({ value, onChange, disabled = false, label = 'Formatted text', compact = false, insertTextRef }: {
  value?: EmailDocument; onChange: (value: EmailDocument) => void; disabled?: boolean; label?: string; compact?: boolean;
  insertTextRef?: MutableRefObject<((text: string) => void) | null>;
}): JSX.Element {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState('');
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ codeBlock: false, code: false, heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, protocols: ['https', 'mailto', 'tel'] } }),
      TextStyleKit, TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: value ?? documentFromText(''),
    editable: !disabled,
    editorProps: { attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': 'true',
      class: `min-h-28 max-h-96 overflow-y-auto p-3 outline-none [&_p]:mb-2 [&_h1]:text-3xl [&_h2]:text-2xl [&_h3]:text-xl [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-6 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3` } },
    onUpdate: ({ editor }) => {
      const current = editor.getJSON() as EmailDocument;
      onChange(current);
      try {
        parseEmailDocument(current); setError('');
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unsupported formatting.'); }
    },
  });
  useEffect(() => { editor?.setEditable(!disabled, false); }, [editor, disabled]);
  useEffect(() => {
    if (!insertTextRef || !editor) return;
    insertTextRef.current = (text) => { editor.chain().focus().insertContent({ type: 'text', text }).run(); };
    return () => { insertTextRef.current = null; };
  }, [editor, insertTextRef]);
  useEffect(() => {
    const doc = value ?? documentFromText('');
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(doc)) editor.commands.setContent(doc, { emitUpdate: false });
  }, [editor, value]);
  return <div className="rounded border border-cui-border bg-cui-panel">
    <div role="toolbar" aria-label={`${label} formatting`} className="flex flex-wrap items-center gap-1 border-b border-cui-border bg-cui-body p-2">
      {editor ? <>
        {([
          ['Bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run()],
          ['Italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run()],
          ['Underline', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run()],
          ['Strike', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run()],
          ['Bullets', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run()],
          ['Numbered list', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run()],
          ['Undo', false, () => editor.chain().focus().undo().run()],
          ['Redo', false, () => editor.chain().focus().redo().run()],
        ] as const).map(([name, active, action]) => <button key={name} type="button" disabled={disabled}
          aria-pressed={active} className="crm-button px-2 py-1 text-xs" onMouseDown={(event) => event.preventDefault()} onClick={action}>{name}</button>)}
        <button type="button" className="crm-button px-2 py-1 text-xs" disabled={disabled}
          onClick={() => setLink(String(editor.getAttributes('link').href ?? 'https://'))}>Link</button>
        <button type="button" className="crm-button px-2 py-1 text-xs" disabled={disabled}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>Clear style</button>
        <select aria-label={`${label} style`} className="crm-input w-auto py-1 text-xs" disabled={disabled}
          value={editor.isActive('heading', { level: 1 }) ? '1' : editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : '0'}
          onChange={(event) => {
            const level = Number(event.target.value);
            if (level === 1 || level === 2 || level === 3) editor.chain().focus().setHeading({ level }).run();
            else editor.chain().focus().setParagraph().run();
          }}>
          <option value="0">Paragraph</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
        </select>
        <select aria-label={`${label} font`} className="crm-input w-auto py-1 text-xs" disabled={disabled}
          value={editor.getAttributes('textStyle').fontFamily ?? 'Arial'} onChange={(event) => editor.chain().focus().setFontFamily(event.target.value).run()}>
          {EMAIL_FONTS.map((font) => <option key={font}>{font}</option>)}
        </select>
        <select aria-label={`${label} size`} className="crm-input w-auto py-1 text-xs" disabled={disabled}
          value={editor.getAttributes('textStyle').fontSize ?? '16px'} onChange={(event) => editor.chain().focus().setFontSize(event.target.value).run()}>
          {[10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64].map((size) => <option key={size} value={`${size}px`}>{size}px</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs">Text
          <input type="color" aria-label={`${label} color`} disabled={disabled} value={editor.getAttributes('textStyle').color ?? '#263238'}
            onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} />
        </label>
        {!compact ? <label className="flex items-center gap-1 text-xs">Highlight
          <input type="color" aria-label={`${label} highlight`} disabled={disabled} value={editor.getAttributes('textStyle').backgroundColor ?? '#ffffff'}
            onChange={(event) => editor.chain().focus().setBackgroundColor(event.target.value).run()} />
        </label> : null}
        <select aria-label={`${label} alignment`} className="crm-input w-auto py-1 text-xs" disabled={disabled}
          value={editor.getAttributes('paragraph').textAlign ?? 'left'} onChange={(event) => editor.chain().focus().setTextAlign(event.target.value).run()}>
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="justify">Justify</option>
        </select>
      </> : <span role="status" className="text-xs text-cui-muted">Loading editor...</span>}
    </div>
    {link !== null ? <div className="flex flex-wrap gap-2 border-b border-cui-border p-2">
      <label className="flex-1 text-xs">Link destination<input className="crm-input" value={link} maxLength={2000}
        onChange={(event) => setLink(event.target.value)} placeholder="https://, mailto:, or tel:" /></label>
      <button type="button" className="crm-button" onClick={() => {
        if (!link) editor?.chain().focus().extendMarkRange('link').unsetLink().run();
        else if (emailLink(link)) editor?.chain().focus().extendMarkRange('link').setLink({ href: link }).run();
        else { setError('Enter an HTTPS, mailto, or tel link.'); return; }
        setLink(null); setError('');
      }}>Apply link</button>
      <button type="button" className="crm-button" onClick={() => setLink(null)}>Cancel</button>
    </div> : null}
    {error ? <p role="alert" className="p-2 text-sm text-cui-danger">{error}</p> : null}
    <EditorContent editor={editor} />
  </div>;
}
