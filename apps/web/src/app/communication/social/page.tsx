'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { SocialDraft, SocialDraftRevision, SocialReviewEvent, SocialReviewCommand } from '@crm/shared';
import { SOCIAL_DRAFT_CAPTION_LIMIT, SOCIAL_DRAFT_TITLE_LIMIT, SOCIAL_REVIEW_LABELS } from '@crm/shared';
import SectionLayout from '../../../components/crm/SectionLayout';
import { Card, CardBody, CardHeader } from '../../../components/ui/Card';
import { workspaceFetch } from '../../../lib/workspace-fetch';
import { useUnsavedChanges } from '../../../context/WorkspaceNavigationContext';
import { useStaffWorkspace } from '../../../context/StaffWorkspaceContext';
import { formatArizonaDateTime } from '../../../lib/arizona-time';
import SocialMediaLibrary, { SocialImagePreview } from '../../../components/crm/SocialMediaLibrary';
import SocialCaptionHelp from '../../../components/crm/SocialCaptionHelp';
import SocialEngineWorkspace from '../../../components/crm/SocialEngineWorkspace';
import SocialConnectionsWorkspace from '../../../components/crm/SocialConnectionsWorkspace';
import { ArrowUpRight, Check, FileText, ImageIcon, LayoutGrid, List, Plus, Search, ShieldCheck, X, Link2 } from 'lucide-react';

interface DraftList { posts: SocialDraft[]; total: number; can_review?: boolean }
interface DraftDetail { post: SocialDraft; history: SocialDraftRevision[]; reviews: SocialReviewEvent[]; can_review: boolean }
interface Editor { id: string; title: string; caption: string; link_url: string; media_ids: string[]; saved: SocialDraft | null; history: SocialDraftRevision[]; reviews: SocialReviewEvent[]; can_review: boolean }
const endpoint = '/api/social-marketing/drafts';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-cui-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cui-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cui-primary disabled:opacity-50';
const secondaryClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cui-primary disabled:opacity-50';
const inputClass = 'mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none transition focus:border-cui-primary focus:ring-2 focus:ring-cui-primary/10';
const reviewColors = {
  not_submitted: 'bg-slate-100 text-slate-600',
  awaiting_review: 'bg-amber-50 text-amber-800',
  approved: 'bg-emerald-50 text-emerald-800',
  changes_requested: 'bg-red-50 text-red-800',
};

export default function SocialMarketingPage(): JSX.Element {
  const workspace = useStaffWorkspace();
  const full = workspace === 'full';
  const canEdit = full || workspace === 'social-editor';
  const [list, setList] = useState<DraftList>({ posts: [], total: 0 });
  const [status, setStatus] = useState('draft');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [archive, setArchive] = useState<SocialDraft | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [selectedSection, setSection] = useState<'posts' | 'media' | 'engine' | 'connections'>('posts');
  const section = full || selectedSection === 'media' ? selectedSection : 'posts';
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [showMedia, setShowMedia] = useState(false);
  const [showCaptionHelp, setShowCaptionHelp] = useState(false);
  const requestVersion = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const rows = await workspaceFetch<DraftList>(`${endpoint}?status=${status}&offset=${offset}`);
      if (version !== requestVersion.current) return;
      if (offset > 0 && rows.posts.length === 0) { setOffset(Math.max(0, offset - 50)); return; }
      setList(rows); setError('');
    } catch (failure) {
      if (version === requestVersion.current) { setList({ posts: [], total: 0 }); setError(failure instanceof Error ? failure.message : 'Could not load drafts.'); }
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, [status, offset]);
  useEffect(() => { void load(); return () => { requestVersion.current++; }; }, [load]);
  useEffect(() => {
    if (full && new URLSearchParams(window.location.search).has('connection')) setSection('connections');
  }, [full]);

  async function open(id: string): Promise<void> {
    setBusy(true); setError(''); setNotice('');
    try {
      const detail = await workspaceFetch<DraftDetail>(`${endpoint}?id=${id}`);
      setEditor({ id, title: detail.post.title, caption: detail.post.caption, link_url: detail.post.link_url ?? '', media_ids: detail.post.media_ids ?? [], saved: detail.post, history: detail.history,
        reviews: detail.reviews, can_review: detail.can_review });
      setReviewReason('');
      setShowMedia(false);
      setShowCaptionHelp(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open this draft.'); }
    finally { setBusy(false); }
  }
  async function review(action: SocialReviewCommand['action']): Promise<void> {
    if (!editor?.saved) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await workspaceFetch<SocialDraft>('/api/social-marketing/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editor.id, action, expected_revision: editor.saved.revision,
          expected_review_version: editor.saved.review_version, reason: action === 'request_changes' || action === 'approve' ? reviewReason : '' }),
      });
      setEditor(null);
      setNotice(action === 'approve' ? 'Content approved. Nothing was scheduled or published.' : action === 'request_changes' ? 'Changes requested.' : action === 'withdraw' ? 'Review request withdrawn.' : 'Revision submitted for review.');
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save this review.'); }
    finally { setBusy(false); }
  }
  async function save(): Promise<void> {
    if (!editor) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await workspaceFetch<SocialDraft>(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: editor.saved ? 'update' : 'create', id: editor.id, title: editor.title, caption: editor.caption, link_url: editor.link_url || null, media_ids: editor.media_ids,
          ...(editor.saved ? { expected_revision: editor.saved.revision } : {}) }),
      });
      setEditor(null); setNotice(`Draft saved (revision ${saved.revision}).`);
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save this draft.'); }
    finally { setBusy(false); }
  }
  async function confirmArchive(): Promise<void> {
    if (!archive) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await workspaceFetch<SocialDraft>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive', id: archive.id, expected_revision: archive.revision }) });
      setArchive(null); setNotice('Draft archived. Its revision history is retained.');
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not archive this draft.'); }
    finally { setBusy(false); }
  }
  const archived = editor?.saved?.status === 'archived';
  const readOnly = !canEdit || archived;
  const dirty = Boolean(editor?.saved && (editor.title !== editor.saved.title || editor.caption !== editor.saved.caption
    || editor.link_url !== (editor.saved.link_url ?? '')
    || JSON.stringify(editor.media_ids) !== JSON.stringify(editor.saved.media_ids ?? [])));
  const { confirmDiscard } = useUnsavedChanges(dirty || Boolean(editor && !editor.saved && (editor.title || editor.caption || editor.link_url || editor.media_ids.length)));
  const visiblePosts = list.posts.filter((post) => `${post.title} ${post.caption} ${post.link_url ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <SectionLayout title="Social Marketing">
    <div className="mx-auto max-w-[1440px] rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200/70 sm:p-6">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <nav aria-label="Social workspace" className="inline-flex flex-wrap gap-1 rounded-2xl bg-slate-200/60 p-1">
        <button aria-current={section === 'posts' ? 'page' : undefined} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary ${section === 'posts' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/60'}`} disabled={busy} onClick={() => setSection('posts')}><FileText size={16} aria-hidden />Posts</button>
        <button aria-current={section === 'media' ? 'page' : undefined} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary ${section === 'media' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/60'}`} disabled={busy} onClick={() => setSection('media')}><ImageIcon size={16} aria-hidden />Media library</button>
        {full ? <>
          <button aria-current={section === 'engine' ? 'page' : undefined} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${section === 'engine' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`} disabled={busy} onClick={() => setSection('engine')}>Publishing calendar</button>
          <button aria-current={section === 'connections' ? 'page' : undefined} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${section === 'connections' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`} disabled={busy} onClick={() => setSection('connections')}><Link2 size={15} aria-hidden />Connected accounts</button>
        </> : null}
      </nav>
      {canEdit && section === 'posts' ? <button className={buttonClass} disabled={busy || loading || Boolean(error)} onClick={() => {
        setError(''); setNotice(''); setShowMedia(false); setShowCaptionHelp(false); setEditor({ id: crypto.randomUUID(), title: '', caption: '', link_url: '', media_ids: [], saved: null, history: [], reviews: [], can_review: false });
      }}><Plus size={16} aria-hidden />New draft</button> : null}
    </div>
    {error && !editor && !archive ? <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {error}<button className="ml-3 underline" disabled={loading || busy} onClick={() => void load()}>Reload drafts</button>
    </div> : null}
    {notice ? <p role="status" className="mb-4 text-sm text-cui-success">{notice}</p> : null}
    {section === 'posts' ? <Card className="!rounded-none !border-0 !bg-transparent !shadow-none">
      <CardHeader className="flex-wrap !border-0 !bg-transparent !p-0 [&>h2]:text-xl [&>h2]:tracking-tight" actions={<div className="flex flex-wrap items-center gap-2"><select aria-label="Draft status" value={status} disabled={busy || loading} className="rounded-xl border-0 bg-white px-3 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200 focus:ring-2 focus:ring-cui-primary"
        onChange={(event) => { setStatus(event.target.value); setOffset(0); setNotice(''); }}>
        <option value="draft">All active posts</option><option value="awaiting_review">Awaiting review</option><option value="approved">Content approved</option>
        <option value="changes_requested">Changes requested</option><option value="archived">Archived</option>
      </select><div className="flex gap-1 rounded-xl bg-slate-200/60 p-1">
        <button aria-label="Grid view" aria-pressed={view === 'grid'} className={`rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary ${view === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`} onClick={() => setView('grid')}><LayoutGrid size={16} aria-hidden /></button>
        <button aria-label="List view" aria-pressed={view === 'list'} className={`rounded-lg p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary ${view === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`} onClick={() => setView('list')}><List size={16} aria-hidden /></button>
      </div></div>}>Your content</CardHeader>
      <CardBody className="!px-0 !pb-0 !pt-5">
        <label className="mb-6 flex max-w-md items-center gap-2 rounded-xl bg-white px-4 text-slate-500 ring-1 ring-slate-200 transition focus-within:ring-2 focus-within:ring-cui-primary/50"><Search size={16} aria-hidden /><span className="sr-only">Search this page of posts</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this page of posts" className="min-w-0 flex-1 bg-transparent py-3 text-sm text-cui-text outline-none" /></label>
        {loading ? <div role="status" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"><span className="sr-only">Loading drafts...</span>{[0,1,2].map((item) => <div key={item} aria-hidden className="motion-safe:animate-pulse overflow-hidden rounded-2xl bg-white p-3"><div className="aspect-[4/3] rounded-xl bg-slate-200" /><div className="mt-4 h-4 w-3/4 rounded bg-slate-200" /><div className="mb-3 mt-3 h-3 w-1/2 rounded bg-slate-100" /></div>)}</div> : <div className={view === 'grid' ? 'grid gap-5 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}>
          {visiblePosts.map((post) => <article key={post.id} className={`group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 transition duration-200 hover:shadow-md hover:ring-cui-primary/30 ${view === 'list' ? 'flex flex-wrap items-center gap-4 p-3' : 'flex flex-col p-2'}`}>
            <div className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 ${view === 'grid' ? 'aspect-[4/3] w-full' : 'h-24 w-28 shrink-0'}`}>
              {post.media_ids?.[0] ? <SocialImagePreview id={post.media_ids[0]} alt={`${post.title} image`} thumbnail className="h-full w-full object-contain" /> : <FileText size={36} strokeWidth={1} className="text-slate-400" aria-hidden />}
              <button type="button" aria-label={`Open ${post.title}`} disabled={busy} onClick={() => void open(post.id)} className="absolute bottom-3 right-3 rounded-full bg-white/95 p-2 text-slate-700 shadow-sm transition group-hover:bg-cui-primary group-hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary"><ArrowUpRight size={16} aria-hidden /></button>
            </div>
            <div className={`min-w-0 flex-1 ${view === 'grid' ? 'px-3 pb-3 pt-4' : ''}`}>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${post.status === 'archived' ? 'bg-slate-100 text-slate-600' : reviewColors[post.review_state]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{post.status === 'archived' ? 'Archived' : SOCIAL_REVIEW_LABELS[post.review_state]}</span>
              <button disabled={busy} className="mt-3 block break-words text-left text-base font-semibold tracking-tight text-slate-900 hover:text-cui-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary" onClick={() => void open(post.id)}>{post.title}</button>
              <p className="mt-2 line-clamp-2 min-h-10 whitespace-pre-wrap break-words text-sm text-cui-muted">{post.caption || 'No caption yet.'}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-xs text-cui-muted">Revision {post.revision}<br />{formatArizonaDateTime(post.updated_at)} AZ</p>
                {full && post.status === 'draft' ? <button className="rounded px-2 py-1 text-xs font-semibold text-cui-muted hover:bg-cui-light hover:text-cui-text" disabled={busy} onClick={() => { setError(''); setArchive(post); }}>Archive</button> : null}
              </div>
            </div>
          </article>)}
          {!visiblePosts.length && !error ? <div className="col-span-full flex flex-col items-center rounded-2xl bg-white px-6 py-20 text-center ring-1 ring-slate-200/60">
            <span className="mb-5 rounded-2xl bg-cui-primary/10 p-4"><FileText size={28} strokeWidth={1.5} className="text-cui-primary" aria-hidden /></span>
            <h3 className="font-semibold text-cui-text">{search ? 'No matching posts' : status === 'draft' ? 'Your next post starts here' : 'No posts in this view'}</h3>
            <p className="mt-2 text-sm text-cui-muted">{search ? 'Try another title or caption.' : status === 'draft' ? 'Create a draft, add an image, and send it for review.' : 'Choose another status to see your content.'}</p>
          </div> : null}
        </div>}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-xs text-cui-muted">{list.total} posts</span>
          <div className="flex gap-2"><button className={secondaryClass} disabled={busy || loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
            <button className={secondaryClass} disabled={busy || loading || offset + 50 >= list.total} onClick={() => setOffset(offset + 50)}>Next</button></div>
        </div>
      </CardBody>
    </Card> : !editor ? section === 'media' ? <SocialMediaLibrary canUpload={canEdit} disabled={busy} onBusyChange={setBusy} />
      : section === 'engine' ? <SocialEngineWorkspace disabled={busy} onBusyChange={setBusy} />
        : <SocialConnectionsWorkspace disabled={busy} onBusyChange={setBusy} /> : null}
    {section !== 'connections' ? <p className="mt-5 text-xs text-cui-muted">Real social publishing is not available yet.</p> : null}
    </div>
    {editor ? <Dialog.Root open onOpenChange={(value) => { if (!value && !busy && confirmDiscard()) { setEditor(null); setError(''); } }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[90] bg-slate-950/40 backdrop-blur-sm" /><Dialog.Content
        onPointerDownOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}
        className="fixed inset-0 z-[90] flex flex-col overflow-hidden bg-white shadow-2xl sm:inset-5 sm:rounded-3xl lg:inset-x-[5%]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
          <div><Dialog.Title className="text-lg font-semibold tracking-tight">{archived ? 'Archived post' : readOnly ? 'View draft' : editor.saved ? 'Edit draft' : 'New draft'}</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-cui-muted">Saving a draft does not schedule or publish it.</Dialog.Description></div>
          <button type="button" aria-label="Close composer" disabled={busy} className="rounded-full bg-slate-100 p-2.5 text-slate-600 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary" onClick={() => { if (confirmDiscard()) { setEditor(null); setError(''); } }}><X size={18} aria-hidden /></button>
        </div>
        {error ? <p role="alert" className="mx-5 mt-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); if (!readOnly && !busy) void save(); }}>
          <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-6 p-5 lg:p-8">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Internal title<input autoFocus required maxLength={SOCIAL_DRAFT_TITLE_LIMIT}
            placeholder="Give this post a name"
            disabled={busy || readOnly} className="mt-2 w-full rounded-lg border-0 bg-white py-2 text-2xl font-semibold tracking-tight text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 focus:ring-2 focus:ring-cui-primary/20" value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label>
          <div className="overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200/70 transition focus-within:ring-2 focus-within:ring-cui-primary/30">
            <label className="block px-5 pt-5 text-xs font-semibold uppercase tracking-wider text-slate-500">Caption<textarea rows={7} maxLength={SOCIAL_DRAFT_CAPTION_LIMIT} disabled={busy || readOnly}
              placeholder="What would you like to share?"
              className="mt-3 w-full resize-y border-0 bg-transparent text-base font-normal normal-case leading-relaxed tracking-normal text-slate-800 outline-none placeholder:text-slate-400" value={editor.caption} onChange={(event) => setEditor({ ...editor, caption: event.target.value })} /></label>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 pt-2">
              {!readOnly ? <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} aria-expanded={showMedia} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:text-cui-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary" onClick={() => setShowMedia(!showMedia)}><ImageIcon size={16} aria-hidden />{showMedia ? 'Hide image library' : 'Add image'}</button>
                <button type="button" disabled={busy} aria-expanded={showCaptionHelp} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:text-cui-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary" onClick={() => setShowCaptionHelp(!showCaptionHelp)}>{showCaptionHelp ? 'Hide caption help' : 'Caption help'}</button></div> : <span className="text-xs text-cui-muted">Archived content</span>}
              <span className="text-xs text-cui-muted">{editor.caption.length.toLocaleString()} / {SOCIAL_DRAFT_CAPTION_LIMIT.toLocaleString()}</span>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">Link preview (optional)
              <input type="url" inputMode="url" maxLength={2048} disabled={busy || readOnly}
                placeholder="https://example.com/coverage"
                className={inputClass} value={editor.link_url}
                onChange={(event) => setEditor({ ...editor, link_url: event.target.value })} />
              <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-slate-500">Only HTTPS links are accepted. Facebook uses this as the post link; Instagram posts use the caption and image.</span>
            </label>
            {!readOnly && showCaptionHelp ? <SocialCaptionHelp caption={editor.caption} disabled={busy} onBusyChange={setBusy} onUse={(caption) => setEditor((current) => current ? { ...current, caption } : current)} /> : null}
          </div>
          {editor.media_ids[0] ? <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 p-3">
            <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100"><SocialImagePreview id={editor.media_ids[0]} alt="Attached draft image" thumbnail className="h-full w-full object-contain" /></div>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Attached image</p>
            {!readOnly ? <button type="button" disabled={busy} className="mt-2 text-xs font-semibold text-cui-muted underline hover:text-cui-danger" onClick={() => setEditor({ ...editor, media_ids: [] })}>Remove image from draft</button> : null}</div>
          </div> : null}
          {!readOnly && showMedia ? <SocialMediaLibrary selected={editor.media_ids[0]} disabled={busy} onBusyChange={setBusy} onSelect={(asset) => setEditor((current) => current ? { ...current, media_ids: [asset.id] } : current)} /> : null}
          {full && editor.saved && !readOnly ? <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/70">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="inline-flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={17} className="text-cui-primary" aria-hidden />Content review</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${reviewColors[editor.saved.review_state]}`}>{SOCIAL_REVIEW_LABELS[editor.saved.review_state]}</span></div>
            <p className="mt-3 text-xs text-slate-500">Revision {editor.saved.revision}</p>
            <p className="mt-1 text-xs text-cui-muted">Approval covers this saved revision. Content changes require a new review.</p>
            {dirty ? <p className="mt-2 text-sm text-cui-warning">Save or discard your changes before reviewing.</p> : null}
            {editor.saved.review_state === 'awaiting_review' && editor.can_review ? <label className="mt-3 block text-sm font-semibold">
              Review note (required for changes)<textarea rows={2} maxLength={1000} className={inputClass} disabled={busy} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} />
            </label> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {['not_submitted','changes_requested'].includes(editor.saved.review_state) ? <button type="button" className={secondaryClass} disabled={busy || dirty || !editor.saved.caption.trim()} onClick={() => void review('submit')}>Request review</button> : null}
              {editor.saved.review_state === 'awaiting_review' ? <>
                <button type="button" className={secondaryClass} disabled={busy || dirty} onClick={() => void review('withdraw')}>Withdraw review</button>
                {editor.can_review ? <>
                  <button type="button" className={buttonClass} disabled={busy || dirty} onClick={() => void review('approve')}>Approve content</button>
                  <button type="button" className={secondaryClass} disabled={busy || dirty || !reviewReason.trim()} onClick={() => void review('request_changes')}>Request changes</button>
                </> : <p className="text-xs text-cui-muted">An active owner or administrator must review this revision.</p>}
              </> : null}
            </div>
          </div> : null}
          {full && editor.saved?.review_state === 'approved' && !readOnly ? <SocialEngineWorkspace post={editor.saved} disabled={busy || dirty} onBusyChange={setBusy} /> : null}
          {editor.reviews.length ? <details className="rounded-xl bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold">Review history (latest 50)</summary>
            {editor.reviews.map((event) => <div key={event.review_version} className="mt-3 border-t border-cui-border pt-2 text-sm">
              <p>Revision {event.revision} · {event.action.replaceAll('_',' ')} · {formatArizonaDateTime(event.recorded_at)} AZ</p>
              {event.reason ? <p className="mt-1 whitespace-pre-wrap break-words">{event.reason}</p> : null}
            </div>)}
          </details> : null}
          {editor.history.length ? <details className="rounded-xl bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-semibold">Revision history (latest 50)</summary>
            {editor.history.map((revision) => <div key={revision.revision} className="mt-3 border-t border-cui-border pt-2 text-sm">
              <p className="font-semibold">Revision {revision.revision} · {revision.action} · {formatArizonaDateTime(revision.recorded_at)} AZ</p>
              <p className="mt-1 break-words">{revision.title}</p><p className="mt-1 whitespace-pre-wrap break-words text-cui-muted">{revision.caption || 'No caption.'}</p>
              {revision.media_ids?.[0] ? <SocialImagePreview id={revision.media_ids[0]} alt={`Revision ${revision.revision} image`} thumbnail /> : null}
            </div>)}
          </details> : null}
          </div>
          <aside aria-label="Post preview" className="min-w-0 bg-gradient-to-b from-slate-100 to-slate-50 p-5 lg:p-7">
            <div className="mb-6 flex items-center justify-between"><h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Live preview</h2><span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-cui-primary" aria-hidden />Content only</span></div>
            <div className="overflow-hidden rounded-2xl bg-white shadow-lg shadow-slate-200/60 ring-1 ring-slate-200/60">
              <div className="flex items-center gap-3 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-cui-primary to-sky-700 text-sm font-bold text-white" aria-hidden>SA</span><div><p className="text-sm font-semibold">Shield Assurance</p><p className="text-xs text-cui-muted">Draft preview</p></div></div>
              {editor.media_ids[0] ? <div className="flex min-h-40 items-center justify-center bg-slate-100"><SocialImagePreview id={editor.media_ids[0]} alt="Post preview image" className="max-h-96 w-full object-contain" /></div> : null}
              {editor.link_url && /^https:\/\//i.test(editor.link_url) ? <a href={editor.link_url} target="_blank" rel="noreferrer" className="block break-all px-5 pt-4 text-xs font-semibold text-cui-primary">{editor.link_url}</a> : null}
              <p className="min-h-24 whitespace-pre-wrap break-words p-5 text-sm leading-relaxed text-cui-text">{editor.caption || 'Your caption will appear here as you write.'}</p>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-cui-muted">Platform formatting will be available after accounts are connected.</p>
          </aside>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-3 sm:px-7">
            <span role="status" className="inline-flex items-center gap-2 text-xs text-slate-500">{busy ? 'Working...' : archived ? 'Archived' : readOnly ? 'Read only' : dirty || !editor.saved ? 'Unsaved changes' : <><Check size={14} aria-hidden />Saved revision {editor.saved.revision}</>}</span>
            <div className="flex flex-wrap justify-end gap-2">
            {editor.saved ? <button type="button" className={secondaryClass} disabled={busy} onClick={() => void open(editor.id)}>Reload saved version</button> : null}
            <button type="button" className={secondaryClass} disabled={busy} onClick={() => { if (confirmDiscard()) { setEditor(null); setError(''); } }}>{readOnly ? 'Close' : 'Discard changes'}</button>
            {!readOnly ? <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'Saving...' : 'Save draft'}</button> : null}
            </div>
          </div>
        </form>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root> : null}
    {archive ? <Dialog.Root open onOpenChange={(value) => { if (!value && !busy) { setArchive(null); setError(''); } }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[90] bg-black/45" /><Dialog.Content
        onPointerDownOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        className="fixed left-1/2 top-1/2 z-[90] w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl">
        <Dialog.Title className="text-lg font-semibold">Archive draft?</Dialog.Title>
        <Dialog.Description className="mt-2 break-words text-sm">Move "{archive.title}" to Archived. Its content and history will be retained.</Dialog.Description>
        {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2"><button className={secondaryClass} disabled={busy} onClick={() => { setArchive(null); setError(''); }}>Cancel</button>
          <button className={buttonClass} disabled={busy} onClick={() => void confirmArchive()}>Archive draft</button></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root> : null}
  </SectionLayout>;
}
