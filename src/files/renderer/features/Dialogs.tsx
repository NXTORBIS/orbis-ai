// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { call, on } from '../api';
import { app, closeDialog, dismissToast, prompt as promptDialog, toast, toastError, type DialogRequest } from '../state/app';
import { useStore } from '../state/store';
import { activePane, navigate, normalizeTab, parentPath, ws } from '../state/workspace';
import { Button, Dialog, Pill, Segmented, TextField } from '../ui/components';
import { Icon } from '../ui/Icon';
import { formatBytes } from '../ui/format';
import { COMMANDS, availability, bindingsFor, getContext, keyLabel, runCommand } from '../commands';
import { applyCustom, custom } from '../state/custom';
import { openStudio } from './studio/studioState';
import { BulkRenameDialog } from './BulkRename';
import { CompareView, FileCompare, TextDiffBody, type TextDiff } from './views/DuplicatesCompare';
import { Markdown } from './Preview';
import { ConvertDialog, ImageCompareDialog } from './views/MediaTools';
import { AddToProjectDialog, ArchivePasswordDialog, CompressDialog, EditEmbeddedDialog, OpenWithDialog, type EmbeddedEditKind } from './FileDialogs';
import { PermissionsEditorDialog } from './PermissionsEditor';
import { FileNotePanel, NoteSearchPanel } from './FileNotes';
import { TemplatePickerDialog } from './TemplateDialog';
import { ChecksumVerifyDialog, SelectPatternDialog, TemplatesDialog } from './EverydayDialogs';
import { PdfToolsDialog, type PdfTab } from './PdfTools';
import { TextFixDialog } from './TextFixDialog';
import { ActionOutputDialog } from './CustomActions';
import { DecryptDialog, EncryptDialog, ShareStartDialog } from './ShareCryptoDialogs';
import { ImageToolsDialog } from './views/ImageTools';
import { EditorConflictDialog, EditorDiffDialog, EditorSaveAsDialog, EditorUnsavedDialog } from './EditorDialogs';
import type { EditorStamp } from '../../shared/editor';
import { OrganizeByDateDialog } from './OrganizeByDate';
import type { FileEntry } from '../../shared/model';
import { RemoteConnectionsDialog, RemoteEditDialog, RemoteHostKeyDialog, RemoteSecretDialog } from './RemoteDialogs';
import { ContactSheetDialog, ExtractAudioDialog, JoinVideosDialog, RotateVideoDialog, SavePlaylistDialog, VideoGifDialog, VideoTrimDialog } from './MediaDialogs';
import type { RemoteConnectionInfo, RemoteConnectResult } from '../../shared/remote';
import { PowerToolsDialog } from './PowerTools';
import { OcrExtractDialog } from './ocr/OcrExtractDialog';
import { ArchiveConvertDialog } from './ArchiveConvert';
import { S3EditDialog } from './S3Dialogs';
import { ScreenshotSourcePickerDialog } from './ScreenshotSourcePickerDialog';
import type { CaptureSource } from '../../shared/screenshot';

export function DialogHost() {
  const d = useStore(app, (s) => s.dialog);
  if (!d) return null;
  if (d.kind === 'confirm') return <ConfirmDialog d={d} />;
  if (d.kind === 'prompt') return <PromptDialog d={d} />;
  const props = d.props ?? {};
  if (d.id.startsWith('pt.')) return <PowerToolsDialog id={d.id} props={props} />;
  switch (d.id) {
    case 'bulkRename': return <BulkRenameDialog paths={props.paths as string[]} />;
    case 'tag': return <TagDialog paths={props.paths as string[]} />;
    case 'collect': return <CollectDialog paths={props.paths as string[]} />;
    case 'compare': return <CompareDialog left={props.left as string} right={props.right as string} bothDirs={!!props.bothDirs} />;
    case 'tabSets': return <TabSetsDialog />;
    case 'workspaceSwitcher': return <WorkspaceSwitcherDialog />;
    case 'workspaceLoader': return <WorkspaceLoaderDialog />;
    case 'smartFolder': return <SmartFolderDialog />;
    case 'ai': return <AiTaskDialog kind={props.kind as string} paths={props.paths as string[]} share={props.share as 'metadata' | 'content' | undefined} />;
    case 'editEmbedded': return <EditEmbeddedDialog path={props.path as string} kind={props.kind as EmbeddedEditKind} />;
    case 'imageCompare': return <ImageCompareDialog left={props.left as string} right={props.right as string} onClose={closeDialog} />;
    case 'convert': return <ConvertDialog paths={props.paths as string[]} dir={props.dir as string} />;
    case 'addToProject': return <AddToProjectDialog paths={props.paths as string[]} />;
    case 'compress': return <CompressDialog paths={props.paths as string[]} dir={props.dir as string} />;
    case 'openWith': return <OpenWithDialog path={props.path as string} />;
    case 'archivePassword': return <ArchivePasswordDialog name={props.name as string} attempt={props.attempt as (pw: string) => Promise<unknown>} resolve={props.resolve as (r: { password: string; value: unknown } | null) => void} wrong={!!props.wrong} />;
    case 'archiveConvert': return <ArchiveConvertDialog archivePath={props.archivePath as string} currentFormat={props.currentFormat as string} password={props.password as string | undefined} />;
    case 'permissions': return <PermissionsEditorDialog entry={props.entry as FileEntry} onDone={props.onDone as (() => void) | undefined} />;
    case 'selectPattern': return <SelectPatternDialog paneId={props.paneId as string} />;
    case 'checksumVerify': return <ChecksumVerifyDialog path={props.path as string} />;
    case 'templates': return <TemplatesDialog paneId={props.paneId as string} />;
    case 'pdfTools': return <PdfToolsDialog paths={props.paths as string[]} dir={props.dir as string} tab={props.tab as PdfTab | undefined} />;
    case 'textFix': return <TextFixDialog paths={props.paths as string[]} />;
    case 'actionOutput': return <ActionOutputDialog opId={props.opId as string} />;
    case 'shareStart': return <ShareStartDialog paths={props.paths as string[]} dir={props.dir as string | undefined} folders={Number(props.folders ?? 0)} />;
    case 'encrypt': return <EncryptDialog paths={props.paths as string[]} folders={Number(props.folders ?? 0)} />;
    case 'decrypt': return <DecryptDialog paths={props.paths as string[]} wrong={!!props.wrong} />;
    case 'imageTools': return <ImageToolsDialog paths={props.paths as string[]} />;
    case 'editorUnsaved': return <EditorUnsavedDialog paneIds={props.paneIds as string[]} action={props.action as string} resolve={props.resolve as (ok: boolean) => void} />;
    case 'editorConflict': return <EditorConflictDialog paneId={props.paneId as string} current={props.current as EditorStamp | null} resolve={props.resolve as (ok: boolean) => void} />;
    case 'editorSaveAs': return <EditorSaveAsDialog paneId={props.paneId as string} resolve={props.resolve as (ok: boolean) => void} />;
    case 'editorDiff': return <EditorDiffDialog paneId={props.paneId as string} />;
    case 'organizeDate': return <OrganizeByDateDialog paths={props.paths as string[]} destination={props.destination as string} folders={Number(props.folders ?? 0)} />;
    case 'remoteEdit': return <RemoteEditDialog key={String(props.id ?? 'new')} id={props.id as string | undefined} returnTo={props.returnTo as string | undefined} />;
    case 'remoteConnections': return <RemoteConnectionsDialog />;
    // Music player and video tools (features/MediaDialogs.tsx)
    case 'playerSavePlaylist': return <SavePlaylistDialog dir={props.dir as string | undefined} />;
    case 'videoTrim': return <VideoTrimDialog path={props.path as string} />;
    case 'videoGif': return <VideoGifDialog path={props.path as string} />;
    case 'videoExtractAudio': return <ExtractAudioDialog paths={props.paths as string[]} />;
    case 'videoContactSheet': return <ContactSheetDialog paths={props.paths as string[]} />;
    case 'videoJoin': return <JoinVideosDialog paths={props.paths as string[]} />;
    case 'videoRotate': return <RotateVideoDialog paths={props.paths as string[]} />;
    // Text recognition (OCR)
    case 'ocrExtract': return <OcrExtractDialog paths={props.paths as string[]} dir={props.dir as string} folders={Number(props.folders ?? 0)} />;
    case 'remoteSecret': return <RemoteSecretDialog connection={props.connection as RemoteConnectionInfo | undefined} kind={props.kind as 'password' | 'passphrase'} wrong={!!props.wrong} resolve={props.resolve as (v: string | null) => void} />;
    case 'remoteHostKey': return <RemoteHostKeyDialog connection={props.connection as RemoteConnectionInfo | undefined} info={props.info as Extract<RemoteConnectResult, { status: 'hostKeyUnknown' | 'hostKeyChanged' }>} resolve={props.resolve as (ok: boolean) => void} />;
    // S3 cloud storage
    case 's3Secret': return <S3SecretPrompt connectionName={props.connectionName as string} resolve={props.resolve as (v: string | null) => void} />;
    case 's3Edit': return <S3EditDialog id={props.id as string | undefined} returnTo={props.returnTo as string | undefined} />;
    // Screenshot
    case 'screenshotSourcePicker': return <ScreenshotSourcePickerDialog sources={props.sources as CaptureSource[]} />;
    case 'fileNote': return <FileNoteDialog path={props.path as string} />;
    case 'noteSearch': return <NoteSearchDialog />;
    case 'templatePicker': return <TemplatePickerDialog />;
    default: return null;
  }
}

function ConfirmDialog({ d }: { d: Extract<DialogRequest, { kind: 'confirm' }> }) {
  const done = (v: boolean) => {
    closeDialog();
    d.resolve(v);
  };
  return (
    <Dialog title={d.title} onClose={() => done(false)} footer={
      <>
        <Button onClick={() => done(false)} data-autofocus={d.destructive ? true : undefined}>Cancel</Button>
        <Button variant={d.destructive ? 'danger' : 'primary'} onClick={() => done(true)}>{d.confirmLabel}</Button>
      </>
    }>
      <p>{d.body}</p>
      {d.detail?.length ? <ul className="confirm-detail mono">{d.detail.map((x) => <li key={x}>{x}</li>)}</ul> : null}
    </Dialog>
  );
}

function PromptDialog({ d }: { d: Extract<DialogRequest, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(d.initial);
  const [error, setError] = useState<string | undefined>();
  const [checking, setChecking] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the name without its extension so typing replaces the stem only.
    const dot = d.selectStem ? d.initial.lastIndexOf('.') : -1;
    el.setSelectionRange(0, dot > 0 ? dot : d.initial.length);
  }, [d.initial, d.selectStem]);
  useEffect(() => {
    if (!d.validate) return;
    let live = true;
    const t = setTimeout(async () => {
      setChecking(true);
      const r = await d.validate!(value);
      if (live) {
        setError(r);
        setChecking(false);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [value, d]);
  const done = (v: string | null) => {
    closeDialog();
    d.resolve(v);
  };
  const submit = async () => {
    const v = value.trim();
    if (!v.trim()) return setError('Enter a name.');
    const r = d.validate ? await d.validate(v) : undefined;
    if (r) return setError(r);
    done(v);
  };
  return (
    <Dialog title={d.title} onClose={() => done(null)} footer={
      <>
        <Button onClick={() => done(null)}>Cancel</Button>
        <Button variant="primary" disabled={!!error || checking || !value.trim()} onClick={() => void submit()}>{d.confirmLabel}</Button>
      </>
    }>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className={`field ${error ? 'has-error' : ''}`}>
          <span className="field-label">{d.label}</span>
          <input ref={ref} className="input" value={value} spellCheck={false} aria-invalid={!!error} onChange={(e) => setValue(e.target.value)} />
          {error && <span className="field-error" role="alert">{error}</span>}
        </label>
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- S3 secret prompt */

function S3SecretPrompt({ connectionName, resolve }: { connectionName: string; resolve: (v: string | null) => void }) {
  const [value, setValue] = useState('');
  const done = (v: string | null) => {
    closeDialog();
    resolve(v);
  };
  return (
    <Dialog title={`Connect to ${connectionName}`} width={440} onClose={() => done(null)} footer={
      <>
        <Button onClick={() => done(null)}>Cancel</Button>
        <Button variant="primary" disabled={!value} onClick={() => done(value)}>Connect</Button>
      </>
    }>
      <form onSubmit={(e) => { e.preventDefault(); if (value) done(value); }}>
        <label className="field">
          <span className="field-label">Secret Access Key</span>
          <input className="input" type="password" autoFocus value={value} spellCheck={false} onChange={(e) => setValue(e.target.value)} />
        </label>
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- tags / collections */

const TAG_COLORS = ['#5caae8', '#4cc28f', '#e2b450', '#c79bf0', '#f0909f', '#7fd3b0', '#e9b46a', '#8a95a1'];

function TagDialog({ paths }: { paths: string[] }) {
  const tags = useStore(app, (s) => s.tags);
  const [current, setCurrent] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const load = () => void call<Record<string, Array<{ id: string }>>>('cat:tagsFor', { paths }).then((m) => {
    const counts: Record<string, number> = {};
    for (const list of Object.values(m)) for (const t of list) counts[t.id] = (counts[t.id] ?? 0) + 1;
    setCurrent(counts);
  });
  useEffect(load, [paths]);
  const toggle = async (id: string) => {
    const all = current[id] === paths.length;
    await call(all ? 'cat:untagItems' : 'cat:tagItems', { tagId: id, paths }).catch(toastError);
    load();
  };
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const existing = tags.find((t) => t.name.toLowerCase() === n.toLowerCase());
    const tag = existing ?? (await call<{ id: string }>('cat:createTag', { name: n, color: TAG_COLORS[tags.length % TAG_COLORS.length] }).catch((e) => { toastError(e); return null; }));
    if (!tag) return;
    const r = await call<{ tagged: number; failed: string[] }>('cat:tagItems', { tagId: tag.id, paths }).catch((e) => { toastError(e); return null; });
    if (r?.failed.length) toast({ level: 'warning', title: `${r.failed.length} item(s) could not be tagged`, detail: 'They may have been moved or deleted.' });
    setName('');
    load();
  };
  return (
    <Dialog title={`Tags for ${paths.length === 1 ? paths[0]!.split(/[\\/]/).pop() : `${paths.length} items`}`} onClose={closeDialog} footer={<Button variant="primary" onClick={closeDialog}>Done</Button>}>
      <p className="muted small">Tags are kept by Orbis Files. They are not written into the files, and deleting a tag never deletes files.</p>
      <form className="input-row" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <input className="input" placeholder="New or existing tag" value={name} aria-label="Tag name" onChange={(e) => setName(e.target.value)} data-autofocus />
        <Button type="submit" disabled={!name.trim()}>Add</Button>
      </form>
      <div className="tag-pick">
        {tags.map((t) => {
          const n = current[t.id] ?? 0;
          return (
            <label key={t.id} className="check">
              <input type="checkbox" checked={n === paths.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < paths.length; }} onChange={() => void toggle(t.id)} />
              <i className="dot" style={{ background: t.color ?? 'var(--accent)' }} /> {t.name} <span className="muted tabular">{t.count}</span>
            </label>
          );
        })}
        {!tags.length && <p className="muted">No tags yet.</p>}
      </div>
    </Dialog>
  );
}

function CollectDialog({ paths }: { paths: string[] }) {
  const collections = useStore(app, (s) => s.collections);
  const [name, setName] = useState('');
  const add = async (id: string, label: string) => {
    const r = await call<{ added: number; failed: string[] }>('cat:addToCollection', { id, paths }).catch((e) => { toastError(e); return null; });
    if (!r) return;
    closeDialog();
    toast({ level: r.failed.length ? 'warning' : 'success', title: `Added ${r.added} to “${label}”${r.added < paths.length - r.failed.length ? ' (some were already there)' : ''}`, detail: r.failed.length ? `${r.failed.length} could not be added.` : 'Files stay where they are; the collection only references them.' });
  };
  return (
    <Dialog title="Add to collection" onClose={closeDialog}>
      <div className="choice-list">
        {collections.map((c) => (
          <button key={c.id} type="button" className="choice" onClick={() => void add(c.id, c.name)}>
            <strong>{c.name}</strong><span>{c.count} item{c.count === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>
      <form className="input-row" onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const c = await call<{ id: string; name: string }>('cat:createCollection', { name }).catch((err) => { toastError(err); return null; });
        if (c) await add(c.id, c.name);
      }}>
        <input className="input" placeholder="New collection name" value={name} aria-label="New collection name" onChange={(e) => setName(e.target.value)} data-autofocus={!collections.length} />
        <Button type="submit" disabled={!name.trim()}>Create and add</Button>
      </form>
    </Dialog>
  );
}

function CompareDialog({ left, right, bothDirs }: { left: string; right: string; bothDirs: boolean }) {
  return (
    <Dialog title={bothDirs ? 'Compare folders' : 'Compare files'} width={1100} onClose={closeDialog}>
      {bothDirs ? <CompareView initialLeft={left} initialRight={right} embedded /> : <FileCompare left={left} right={right} />}
    </Dialog>
  );
}

/** Saved tab sets: open tabs, panes and folders under a name (distinct from interface workspaces). */
function TabSetsDialog() {
  const [list, setList] = useState<Array<{ id: string; name: string; state: { tabs: unknown[]; groups: unknown[]; activeTabId: string }; updatedMs: number }> | null>(null);
  const load = () => void call<NonNullable<typeof list>>('cat:workspaces').then(setList, toastError);
  useEffect(load, []);
  const open = async (w: NonNullable<typeof list>[number]) => {
    const tabs = (w.state.tabs as ReturnType<typeof ws.get>['tabs']).map((t) => normalizeTab(t));
    // Revalidate saved locations; missing ones open at Home.
    for (const t of tabs) for (const p of t.panes) {
      const loc = p.history[p.index];
      if (loc?.kind === 'fs') {
        const ok = await call<{ exists: boolean }>('fs:resolve', { input: loc.path }).then((r) => r.exists, () => false);
        if (!ok) {
          p.history = [{ kind: 'home' }];
          p.index = 0;
        }
      }
    }
    ws.set({ tabs, groups: w.state.groups as ReturnType<typeof ws.get>['groups'], activeTabId: tabs.some((t) => t.id === w.state.activeTabId) ? w.state.activeTabId : tabs[0]!.id });
    closeDialog();
  };
  return (
    <Dialog title="Tab sets" onClose={closeDialog} footer={<Button onClick={() => void runCommand('app.saveTabSet')}>Save current tabs…</Button>}>
      <p className="muted small">A tab set stores open tabs, panes and their folders — never copies of files. To change the interface itself (layout, views, toolbar), use workspaces in the Customization Studio.</p>
      {!list ? null : !list.length ? <p className="muted">No saved tab sets.</p> : (
        <div className="choice-list">
          {list.map((w) => (
            <div key={w.id} className="choice-row">
              <button type="button" className="choice" onClick={() => void open(w)}><strong>{w.name}</strong><span>{(w.state.tabs ?? []).length} tabs</span></button>
              <Button size="sm" variant="ghost" onClick={() => void call('cat:deleteWorkspace', { id: w.id }).then(load, toastError)}>Delete</Button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Quick workspace switcher (Ctrl+Alt+W): type to filter, Enter to switch. Never touches files. */
function WorkspaceSwitcherDialog() {
  const cfg = useStore(custom, (s) => s.server.config);
  const [q, setQ] = useState('');
  const list = cfg.workspaces.filter((w) => w.name.toLowerCase().includes(q.trim().toLowerCase()));
  const [idx, setIdx] = useState(Math.max(0, list.findIndex((w) => w.id === cfg.activeWorkspaceId)));
  const pick = async (id: string) => {
    closeDialog();
    await applyCustom({ op: 'activateWorkspace', id });
  };
  return (
    <Dialog title="Switch workspace" onClose={closeDialog} footer={<Button variant="ghost" onClick={() => { closeDialog(); openStudio('workspaces'); }}>Manage workspaces…</Button>}>
      <p className="muted small">Switching changes the interface only — layout, views, toolbar and navigation. Open folders stay open and no files are touched.</p>
      <TextField label="Filter" value={q} data-autofocus onChange={(e) => { setQ(e.target.value); setIdx(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(Math.min(list.length - 1, idx + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(Math.max(0, idx - 1)); }
          if (e.key === 'Enter' && list[idx]) void pick(list[idx]!.id);
        }} />
      <div className="choice-list" role="listbox" aria-label="Workspaces">
        {list.map((w, i) => (
          <button key={w.id} type="button" role="option" aria-selected={i === idx} className={`choice ${i === idx ? 'is-active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => void pick(w.id)}>
            <strong>{w.name}</strong>
            <span>{w.id === cfg.activeWorkspaceId ? 'Active' : describeOverrides(w.overrides)}</span>
          </button>
        ))}
        {!list.length && <p className="muted">No workspace matches.</p>}
      </div>
    </Dialog>
  );
}

export function describeOverrides(o: Record<string, unknown>): string {
  const parts = Object.keys(o).filter((k) => o[k] !== undefined).map((k) => ({ appearance: 'appearance', layout: 'layout', view: 'views', accessibility: 'accessibility', navigation: 'navigation', toolbar: 'toolbar' } as Record<string, string>)[k] ?? k);
  return parts.length ? `Own ${parts.join(', ')}` : 'Uses your general settings';
}

/* ---------------------------------------------------------------- workspace loader */

interface CatWorkspace { id: string; name: string; state: unknown; updatedMs: number }

function WorkspaceLoaderDialog() {
  const [list, setList] = useState<CatWorkspace[]>([]);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    void call<CatWorkspace[]>('cat:workspaces').then(setList, (e) => { toastError(e); setList([]); });
  }, []);
  const load = async (w: CatWorkspace) => {
    closeDialog();
    if (!w.state || typeof w.state !== 'object') { toast({ level: 'warning', title: 'This workspace has no saved state.' }); return; }
    const state = w.state as { tabs?: unknown[]; groups?: unknown[]; activeTabId?: string };
    if (Array.isArray(state.tabs) && state.tabs.length) {
      const s = ws.get();
      // Apply the saved state by restoring tabs/groups
      const tabs = state.tabs.map((t) => normalizeTab(t as Parameters<typeof normalizeTab>[0]));
      ws.set({ ...s, tabs, groups: Array.isArray(state.groups) ? state.groups as typeof s.groups : s.groups, activeTabId: typeof state.activeTabId === 'string' ? state.activeTabId : tabs[0]!.id });
      toast({ level: 'success', title: `Loaded workspace "${w.name}"` });
    } else {
      toast({ level: 'warning', title: 'This workspace has no tabs to restore.' });
    }
  };
  const del = async (id: string) => {
    await call('cat:deleteWorkspace', { id }).catch(toastError);
    setList((l) => l.filter((w) => w.id !== id));
  };
  return (
    <Dialog title="Load workspace" onClose={closeDialog} footer={<Button variant="ghost" onClick={closeDialog}>Cancel</Button>}>
      <p className="muted small">Loading a workspace replaces the current tabs and layout. Your current session is auto-saved.</p>
      {!list.length ? <p className="muted">No saved workspaces yet. Use Save workspace (Ctrl+Shift+S) first.</p> : (
        <div className="choice-list" role="listbox" aria-label="Saved workspaces">
          {list.map((w, i) => (
            <div key={w.id} className={`choice ${i === idx ? 'is-active' : ''}`} onMouseEnter={() => setIdx(i)}>
              <button type="button" role="option" aria-selected={i === idx} className="grow" onClick={() => void load(w)} style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, color: 'inherit' }}>
                <strong>{w.name}</strong>
                <span className="muted small"> saved {new Date(w.updatedMs).toLocaleDateString()}</span>
              </button>
              <Button size="sm" variant="ghost" onClick={() => void del(w.id)}>Delete</Button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- smart folder creator */

const _SMART_TAG_COLORS = ['#e85c5c', '#e89a5c', '#e8d35c', '#5ce87a', '#5caae8', '#8a5ce8', '#e85caa', '#8a95a1'];
const _SMART_COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Gray'];

function SmartFolderDialog() {
  const tags = useStore(app, (s) => s.tags);
  const [name, setName] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [extensions, setExtensions] = useState('');
  const [minSize, setMinSize] = useState('');
  const [maxSize, setMaxSize] = useState('');
  const [modifiedDays, setModifiedDays] = useState('');

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const query: Record<string, unknown> = {};
    if (selectedTags.length) query.tags = selectedTags;
    const exts = extensions.split(',').map((e) => e.trim().replace(/^\./, '')).filter(Boolean);
    if (exts.length) query.extensions = exts;
    const minBytes = parseSize(minSize);
    if (minBytes !== undefined) query.minSize = minBytes;
    const maxBytes = parseSize(maxSize);
    if (maxBytes !== undefined) query.maxSize = maxBytes;
    if (modifiedDays.trim()) {
      const days = parseInt(modifiedDays, 10);
      if (days > 0) query.modifiedAfter = Date.now() - days * 86400000;
    }
    if (!Object.keys(query).length) { toast({ level: 'warning', title: 'Add at least one criterion.' }); return; }

    await call('cat:createSmartFolder', { name: n, query }).then(() => {
      closeDialog();
      toast({ level: 'success', title: `Smart folder "${n}" created` });
    }, toastError);
  };

  return (
    <Dialog title="Create smart folder" onClose={closeDialog} footer={
      <>
        <Button variant="ghost" onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim()} onClick={() => void create()}>Create</Button>
      </>
    }>
      <p className="muted small">A smart folder shows all files matching its criteria. It does not move or copy files.</p>
      <TextField label="Name" value={name} data-autofocus onChange={(e) => setName(e.target.value)} />
      <fieldset style={{ border: 'none', padding: 0, margin: '8px 0' }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Tags</legend>
        <div className="tag-pick">
          {tags.map((t) => (
            <label key={t.id} className="check">
              <input type="checkbox" checked={selectedTags.includes(t.id)} onChange={() => setSelectedTags((s) => s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id])} />
              <i className="dot" style={{ background: t.color ?? 'var(--accent)' }} /> {t.name}
            </label>
          ))}
          {!tags.length && <span className="muted small">No tags defined yet.</span>}
        </div>
      </fieldset>
      <TextField label="Extensions (comma-separated)" placeholder="jpg, png, pdf" value={extensions} onChange={(e) => setExtensions(e.target.value)} />
      <div className="input-row">
        <TextField label="Min size" placeholder="e.g. 1MB" value={minSize} onChange={(e) => setMinSize(e.target.value)} />
        <TextField label="Max size" placeholder="e.g. 100MB" value={maxSize} onChange={(e) => setMaxSize(e.target.value)} />
      </div>
      <TextField label="Modified within (days)" placeholder="e.g. 30" value={modifiedDays} onChange={(e) => setModifiedDays(e.target.value)} />
    </Dialog>
  );
}

function parseSize(s: string): number | undefined {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
  return Math.round(n * (units[(m[2] ?? 'b').toLowerCase()] ?? 1));
}

/* ---------------------------------------------------------------- Orbis AI task */

interface TaskSnap {
  taskId: string; kind: string; state: string; progress?: { fraction?: number; message?: string };
  context: Array<{ ref: string; name: string; share: string; included: boolean; reason?: string }>;
  result?: { answer?: string; observations?: Array<{ ref: string; text: string }>; inferences?: string[]; skipped?: Array<{ ref: string; reason: string }>; searchPlan?: { query: string; scope: string[]; explanation: string } };
  proposals?: Array<{ index: number; op: Record<string, unknown> & { op: string }; permission: string; validation?: string }>;
  error?: { message: string };
}

interface EditPreview { path: string; baseMatches: boolean; beforeBytes?: number; afterBytes: number; binary: boolean; diff?: TextDiff; note?: string; currentSha256?: string }

const TASK_TITLE: Record<string, string> = {
  explain_file: 'Explain', summarize_document: 'Summarize', organize_suggestions: 'Suggest organisation', compare_interpret: 'Interpret differences',
  extract_structured: 'Extract data', folder_analysis: 'Analyse folder', nl_search_plan: 'Search in plain language', generate_file: 'Create a file', edit_file: 'Edit file',
};
/** Tasks that need instructions from the user to mean anything. */
const NEEDS_PROMPT = new Set(['nl_search_plan', 'generate_file', 'edit_file', 'extract_structured']);
const PROMPT_LABEL: Record<string, string> = {
  nl_search_plan: 'What are you looking for?', generate_file: 'What should the new file contain?', edit_file: 'What should change?', extract_structured: 'What should be extracted?',
};

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'avif', 'heic', 'heif', 'ico', 'tif', 'tiff']);
/** Rough content family from the name, for the consent text. The main process decides from the bytes. */
function contentFamily(p: string): 'image' | 'pdf' | undefined {
  const ext = /\.([^.\\/]+)$/.exec(p)?.[1]?.toLowerCase() ?? '';
  return ext === 'pdf' ? 'pdf' : IMAGE_EXTS.has(ext) ? 'image' : undefined;
}

function AiTaskDialog({ kind, paths, share }: { kind: string; paths: string[]; share?: 'metadata' | 'content' }) {
  const [refs, setRefs] = useState(paths.map((p) => ({ path: p, share: share ?? ('content' as 'metadata' | 'content') })));
  const [prompt, setPrompt] = useState('');
  const [task, setTask] = useState<TaskSnap | null>(null);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [previews, setPreviews] = useState<Record<number, EditPreview | { error: string }>>({});
  const [status, setStatus] = useState<{ provider?: { providerName: string; processing: string }; capabilities?: string[] } | null>(null);
  useEffect(() => {
    void call<typeof status>('ai:status').then(setStatus);
    return on<TaskSnap>('ai:taskUpdate', (t) => setTask((cur) => (cur && cur.taskId === t.taskId ? t : cur)));
  }, []);
  const remote = status?.provider?.processing !== 'local';
  const needsPrompt = NEEDS_PROMPT.has(kind);
  // Image and PDF contents go only to providers that declare they understand them (checked again in the main process).
  const nameOnly = refs.filter((r) => r.share === 'content').map((r) => ({ r, family: contentFamily(r.path) })).filter(({ family }) => (family === 'image' && !status?.capabilities?.includes('image_understanding')) || (family === 'pdf' && !status?.capabilities?.includes('pdf_understanding')));
  const start = async () => {
    try {
      const t = await call<TaskSnap>('ai:runTask', { kind, prompt: prompt || undefined, refs });
      setTask(t);
    } catch (err) {
      toastError(err);
    }
  };
  const loadPreview = async (index: number) => {
    try {
      const pv = await call<EditPreview>('ai:proposalPreview', { taskId: task!.taskId, index });
      setPreviews((cur) => ({ ...cur, [index]: pv }));
    } catch (err) {
      setPreviews((cur) => ({ ...cur, [index]: { error: (err as Error).message } }));
    }
  };
  // Edits are reviewed before they can be approved: load their previews as soon as the result arrives.
  useEffect(() => {
    for (const p of task?.proposals ?? []) if (p.op.op === 'edit_file' && !p.validation && !previews[p.index]) void loadPreview(p.index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.proposals]);
  const apply = async () => {
    const r = await call<Array<{ index: number; ok: boolean; message: string; snapshotId?: string }>>('ai:applyProposals', { taskId: task!.taskId, approvedIndexes: [...approved] }).catch((e) => { toastError(e); return null; });
    if (!r) return;
    const failed = r.filter((x) => !x.ok);
    const edits = r.filter((x) => x.ok && x.snapshotId).length;
    toast({
      level: failed.length ? 'warning' : 'success',
      title: `${r.length - failed.length} change(s) applied or started through the normal operation engine${failed.length ? `; ${failed.length} refused` : ''}`,
      detail: [failed.map((f) => f.message).join(' · '), edits ? `${edits} edited file(s) can be restored from Snapshots.` : ''].filter(Boolean).join(' ') || undefined,
    });
    closeDialog();
  };
  /** Save the result as a new Markdown file next to the first source, with links back to every source. */
  const saveAnswer = async () => {
    const first = refs[0]?.path;
    if (!first) return;
    const st = await call<FileEntry>('fs:stat', { path: first }).catch(() => null);
    const parent = st?.kind === 'directory' ? first : first.replace(/[\\/][^\\/]+$/, '') || first;
    const base = first.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
    const name = await promptDialog({ title: 'Save the result', label: `File name (saved in ${parent})`, initial: `${base} — ${TASK_TITLE[kind] ?? 'Orbis AI'}.md`, confirmLabel: 'Save', selectStem: true });
    if (!name) return;
    await call<{ path: string }>('ai:saveAnswer', { taskId: task!.taskId, parent, name }).then((r) => {
      toast({ level: 'success', title: `Saved ${name}`, detail: 'Listed under AI-generated, with links to its sources.', actions: [{ label: 'Show', run: () => void showPath(r.path) }] });
    }, toastError);
  };
  const approvable = (p: NonNullable<TaskSnap['proposals']>[number]) => {
    if (p.validation) return false;
    if (p.op.op !== 'edit_file') return true;
    const pv = previews[p.index];
    return !!pv && !('error' in pv) && pv.baseMatches;
  };
  const running = task && (task.state === 'running' || task.state === 'preparing');
  return (
    <Dialog className="ai-dialog" title={`AI · ${TASK_TITLE[kind] ?? kind}`} width={820} onClose={() => { if (running) void call('ai:cancelTask', { taskId: task!.taskId }); closeDialog(); }} footer={
      !task ? (
        <>
          <span className="grow muted small">{status?.provider ? `Provider: ${status.provider.providerName} · processing ${status.provider.processing === 'local' ? 'on this computer' : status.provider.processing === 'remote' ? 'on a remote service' : status.provider.processing}` : ''}</span>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="primary" disabled={!refs.length || (needsPrompt && !prompt.trim())} onClick={() => void start()}>{refs.some((r) => r.share === 'content') && remote ? 'Send and run' : 'Run'}</Button>
        </>
      ) : running ? (
        <Button onClick={() => void call('ai:cancelTask', { taskId: task.taskId })}>Cancel task</Button>
      ) : task.proposals?.length ? (
        <>
          <span className="grow muted small">Nothing changes until you apply. Approved changes run through the same checks as manual ones.</span>
          <Button onClick={closeDialog}>Close</Button>
          <Button variant="primary" disabled={!approved.size} onClick={() => void apply()}>Apply {approved.size} change{approved.size === 1 ? '' : 's'}</Button>
        </>
      ) : (
        <>
          {task.result?.answer && <Button onClick={() => void saveAnswer()}>Save as Markdown…</Button>}
          <Button variant="primary" onClick={closeDialog}>Done</Button>
        </>
      )
    }>
      {!task ? (
        <>
          <h3>What the AI provider will receive</h3>
          <p className="muted small">Only the items below are shared. Choose “name only” to send just the file name and size. Folders are shared as a list of their first 500 entries (names, kinds and sizes){app.get().settings.showHidden ? '' : ', without hidden items'}; their files' contents are not sent.</p>
          <div className="ctx-list">
            {refs.map((r, i) => (
              <div key={r.path} className="ctx-row">
                <Icon name="file" size={14} />
                <span className="mono ellipsis" title={r.path}>{r.path.split(/[\\/]/).pop()}</span>
                <select className="input narrow" value={r.share} aria-label={`What to share for ${r.path}`} onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, share: e.target.value as 'metadata' | 'content' } : x)))}>
                  <option value="content">Name and contents</option>
                  <option value="metadata">Name only</option>
                </select>
                <button type="button" className="icon-btn" aria-label="Remove from context" onClick={() => setRefs(refs.filter((_, j) => j !== i))}><Icon name="close" size={13} /></button>
              </div>
            ))}
          </div>
          {nameOnly.length > 0 && <div className="callout"><span>Sent by name and size only, because the provider does not declare that it understands {nameOnly.some((x) => x.family === 'image') ? 'images' : ''}{nameOnly.some((x) => x.family === 'image') && nameOnly.some((x) => x.family === 'pdf') ? ' or ' : ''}{nameOnly.some((x) => x.family === 'pdf') ? 'PDF documents' : ''}: {nameOnly.map((x) => x.r.path.split(/[\\/]/).pop()).join(', ')}.</span></div>}
          {kind === 'edit_file' && refs.some((r) => r.share !== 'content') && <div className="callout"><span>An edit can only be proposed for a file whose contents are shared.</span></div>}
          {remote && refs.some((r) => r.share === 'content') && <div className="callout warning"><Icon name="warning" size={14} /><span>This provider does not declare local-only processing. File contents you include may leave this computer.</span></div>}
          <TextField label={PROMPT_LABEL[kind] ?? 'Instructions (optional)'} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </>
      ) : (
        <>
          {running && <p className="muted">{task.progress?.message ?? 'Working…'}{task.progress?.fraction !== undefined ? ` ${Math.round(task.progress.fraction * 100)}%` : ''}</p>}
          {task.context.some((c) => c.included && c.reason) && (
            <div className="callout"><span>{task.context.filter((c) => c.included && c.reason).map((c) => `${c.name}: ${c.reason}`).join(' ')}</span></div>
          )}
          {task.context.some((c) => !c.included) && (
            <div className="callout"><span>Not included: {task.context.filter((c) => !c.included).map((c) => `${c.name} (${c.reason})`).join('; ')}</span></div>
          )}
          {task.error && <p className="error-text">{task.error.message}</p>}
          {kind === 'compare_interpret' && refs.length === 2 && !running && (
            <details className="exact-diff" open>
              <summary>Exact differences, computed on this computer (not by AI)</summary>
              <FileCompare left={refs[0]!.path} right={refs[1]!.path} />
            </details>
          )}
          {task.result?.answer && <>{kind === 'compare_interpret' && <h3>Orbis AI's interpretation</h3>}<div className="ai-answer"><Markdown source={task.result.answer} /></div></>}
          {task.result?.observations?.length ? (<><h3>Found in the files</h3><ul>{task.result.observations.map((o, i) => <li key={i}><button type="button" className="linklike mono small" title={`Show ${o.ref}`} onClick={() => { closeDialog(); void showPath(o.ref); }}>{o.ref.split(/[\\/]/).pop()}</button>: {o.text}</li>)}</ul></>) : null}
          {task.result?.inferences?.length ? (<><h3>Interpretation (not verified)</h3><ul>{task.result.inferences.map((t, i) => <li key={i}>{t}</li>)}</ul></>) : null}
          {task.result?.skipped?.length ? <p className="warning-text">The provider could not process: {task.result.skipped.map((s) => `${s.ref.split(/[\\/]/).pop()} (${s.reason})`).join('; ')}</p> : null}
          {task.result?.searchPlan && <SearchPlanEditor plan={task.result.searchPlan} fallbackScope={refs.map((r) => r.path)} />}
          {task.proposals?.length ? (
            <>
              <h3>Proposed changes</h3>
              <table className="table compact">
                <thead><tr><th style={{ width: 28 }} /><th>Change</th><th>Kind</th></tr></thead>
                <tbody>
                  {task.proposals.map((p) => {
                    const pv = previews[p.index];
                    return (
                      <tr key={p.index} className={p.validation ? 'is-missing' : ''}>
                        <td><input type="checkbox" disabled={!approvable(p)} checked={approved.has(p.index)} aria-label={`Approve change ${p.index + 1}`} onChange={(e) => { const n = new Set(approved); if (e.target.checked) n.add(p.index); else n.delete(p.index); setApproved(n); }} /></td>
                        <td className="small">
                          {describeOp(p.op)}
                          {p.validation && <div className="error-text">Refused: {p.validation}</div>}
                          {typeof p.op.reason === 'string' && <div className="muted">{p.op.reason}</div>}
                          {p.op.op === 'edit_file' && !p.validation && <EditReview preview={pv} />}
                        </td>
                        <td><Pill tone={p.permission === 'catalog_change' ? 'neutral' : p.permission === 'overwrite' ? 'error' : 'warning'}>{p.permission === 'catalog_change' ? 'Orbis data only' : p.permission === 'overwrite' ? 'replaces contents · snapshot first' : 'changes files'}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}
        </>
      )}
    </Dialog>
  );
}

/** The exact change an AI edit would make, read fresh from disk. */
function EditReview({ preview }: { preview?: EditPreview | { error: string } }) {
  const [layout, setLayout] = useState<'unified' | 'split'>('unified');
  if (!preview) return <div className="muted">Loading the change…</div>;
  if ('error' in preview) return <div className="error-text">{preview.error}</div>;
  return (
    <div className="edit-review">
      {!preview.baseMatches && <div className="error-text">The file on disk is not the version Orbis AI edited. This change cannot be applied.</div>}
      <div className="muted">
        {formatBytes(preview.beforeBytes ?? 0)} → {formatBytes(preview.afterBytes)}
        {preview.diff && ` · ${preview.diff.added} line${preview.diff.added === 1 ? '' : 's'} added, ${preview.diff.removed} removed`}
        {preview.note && ` · ${preview.note}`}
      </div>
      {preview.diff && !preview.diff.identical && (
        <>
          <Segmented<'unified' | 'split'> label="Layout" value={layout} onChange={setLayout} options={[{ value: 'unified', label: 'Unified' }, { value: 'split', label: 'Side by side' }]} />
          <div className="edit-diff"><TextDiffBody text={preview.diff} layout={layout} /></div>
        </>
      )}
      {preview.diff?.identical && <div className="muted">The proposed content is identical to the file.</div>}
    </div>
  );
}

/**
 * A plain-language search turned into a structured query by the provider. It
 * is shown for review, validated by the local query parser, and run by the
 * local search engine — the provider never searches the disk itself.
 */
function SearchPlanEditor({ plan, fallbackScope }: { plan: { query: string; scope: string[]; explanation: string }; fallbackScope: string[] }) {
  const [query, setQuery] = useState(plan.query);
  const [scope, setScope] = useState((plan.scope.length ? plan.scope : fallbackScope).join('\n'));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      void call<{ ok: boolean; message?: string }>('search:parse', { query }).then((r) => setProblem(r.ok ? null : r.message ?? 'The query is not valid.'), () => setProblem('The query could not be checked.'));
    }, 150);
    return () => clearTimeout(t);
  }, [query]);
  const run = async () => {
    const dirs = scope.split('\n').map((x) => x.trim()).filter(Boolean);
    const valid: string[] = [];
    for (const d of dirs) {
      const st = await call<FileEntry>('fs:stat', { path: d }).catch(() => null);
      if (st?.kind === 'directory') valid.push(d);
    }
    if (!valid.length) {
      setProblem('None of the folders to search exist. Edit the list of folders.');
      return;
    }
    if (valid.length < dirs.length) toast({ level: 'warning', title: `${dirs.length - valid.length} folder(s) in the plan do not exist and were skipped` });
    closeDialog();
    await navigate(activePane().id, { kind: 'search', query: query.trim(), scope: valid.slice(0, 64) });
  };
  return (
    <section className="search-plan">
      <h3>Search plan</h3>
      <p className="muted small">{plan.explanation}</p>
      <TextField label="Query (Orbis search syntax)" mono value={query} onChange={(e) => setQuery(e.target.value)} error={problem ?? undefined} hint={problem ? undefined : 'Checked by the local search parser. You can edit it before running.'} />
      <label className="field">
        <span className="field-label">Folders to search (one per line)</span>
        <textarea className="input mono" rows={Math.min(5, Math.max(2, scope.split('\n').length))} value={scope} onChange={(e) => setScope(e.target.value)} />
      </label>
      <Button variant="primary" disabled={!!problem || !query.trim()} onClick={() => void run()}>Run this search</Button>
    </section>
  );
}

function describeOp(op: Record<string, unknown> & { op: string }): string {
  const n = (p: unknown) => String(p).split(/[\\/]/).pop();
  switch (op.op) {
    case 'rename': return `Rename ${n(op.from)} → ${op.toName}`;
    case 'move': return `Move ${n(op.from)} → ${op.toDir}`;
    case 'copy': return `Copy ${n(op.from)} → ${op.toDir}`;
    case 'mkdir': return `Create folder ${op.path}`;
    case 'trash': return `Move ${n(op.path)} to Trash`;
    case 'tag': return `Tag ${n(op.path)} with ${(op.tags as string[]).join(', ')}`;
    case 'collect': return `Add ${n(op.path)} to collection “${op.collection}”`;
    case 'write_new': return `Save new file ${op.name} in ${op.toDir} (${formatBytes(String(op.data).length)})`;
    case 'edit_file': return `Edit ${n(op.path)}`;
    default: return op.op;
  }
}

/* ---------------------------------------------------------------- command palette */

export function CommandPalette() {
  const open = useStore(app, (s) => s.paletteOpen);
  if (!open) return null;
  return <PaletteBody />;
}

function PaletteBody() {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const ctx = useMemo(() => getContext(), []);
  const list = useMemo(() => {
    const t = q.toLowerCase().trim();
    return COMMANDS.map((c) => ({ c, a: availability(c, ctx) }))
      .filter(({ c }) => !t || `${c.category} ${c.title}`.toLowerCase().includes(t) || t.split(/\s+/).every((w) => `${c.category} ${c.title}`.toLowerCase().includes(w)))
      .sort((x, y) => Number(y.a.enabled) - Number(x.a.enabled));
  }, [q, ctx]);
  const close = () => app.set({ paletteOpen: false });
  const run = (id: string) => {
    close();
    setTimeout(() => void runCommand(id, ctx), 0);
  };
  return (
    <div className="scrim palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="command" size={15} />
          <input
            autoFocus
            value={q}
            placeholder="Type a command…"
            aria-label="Command"
            aria-controls="palette-list"
            aria-activedescendant={list[idx] ? `pc-${list[idx]!.c.id}` : undefined}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(Math.min(list.length - 1, idx + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(Math.max(0, idx - 1)); }
              if (e.key === 'Enter' && list[idx]?.a.enabled) run(list[idx]!.c.id);
            }}
          />
        </div>
        <div className="palette-list" id="palette-list" role="listbox">
          {list.map(({ c, a }, i) => (
            <div key={c.id} id={`pc-${c.id}`} role="option" aria-selected={i === idx} aria-disabled={!a.enabled} className={`palette-item ${i === idx ? 'is-active' : ''} ${a.enabled ? '' : 'is-disabled'}`} onMouseEnter={() => setIdx(i)} onClick={() => a.enabled && run(c.id)}>
              <span className="menu-icon">{c.icon && <Icon name={c.icon} size={14} />}</span>
              <span className="palette-cat">{c.category}</span>
              <span className="palette-title">{c.title}</span>
              {!a.enabled && a.reason && <span className="palette-reason">{a.reason}</span>}
              {bindingsFor(c.id)[0] && <kbd className="kbd">{keyLabel(bindingsFor(c.id)[0]!)}</kbd>}
            </div>
          ))}
          {!list.length && <div className="muted pad">No matching commands.</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */

export function Toasts() {
  const toasts = useStore(app, (s) => s.toasts);
  // The operations panel floats in the same corner: toasts move to the top so they never cover it.
  const opsOpen = useStore(app, (s) => s.opsPanelOpen);
  // With operations docked (or the shelf shown) under the file area, toasts sit above them so they never cover their actions.
  const [above, setAbove] = useState<number | undefined>();
  useLayoutEffect(() => {
    const tops = [document.getElementById('ops-dock'), document.querySelector('.shelf')].filter((x): x is HTMLElement => !!x).map((x) => x.getBoundingClientRect().top);
    setAbove(tops.length ? Math.max(0, window.innerHeight - Math.min(...tops)) + 12 : undefined);
  }, [toasts]);
  return (
    <div className={`toasts ${opsOpen ? 'beside-ops' : ''}`} style={above !== undefined && !opsOpen ? { bottom: above } : undefined} role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.level}`} role={t.level === 'error' ? 'alert' : 'status'}>
          <Icon name={t.level === 'success' ? 'success' : t.level === 'error' ? 'error' : t.level === 'warning' ? 'warning' : 'info'} size={16} />
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
            {t.errorId && <div className="toast-detail mono">Reference {t.errorId}</div>}
            {t.actions?.length ? (
              <div className="toast-actions">
                {t.actions.map((a) => <button key={a.label} type="button" className="link-btn" onClick={() => { a.run(); dismissToast(t.id); }}>{a.label}</button>)}
              </div>
            ) : null}
          </div>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><Icon name="close" size={13} /></button>
        </div>
      ))}
    </div>
  );
}

void activePane;

/** Open the folder containing a path and select it. */
function FileNoteDialog({ path }: { path: string }) {
  return (
    <Dialog title="File Note" onClose={closeDialog}>
      <FileNotePanel path={path} onClose={closeDialog} />
    </Dialog>
  );
}

function NoteSearchDialog() {
  return (
    <Dialog title="File Notes" onClose={closeDialog} width={600}>
      <NoteSearchPanel />
    </Dialog>
  );
}

async function showPath(p: string): Promise<void> {
  const parent = parentPath(p);
  if (parent) await navigate(activePane().id, { kind: 'fs', path: parent }, { select: p });
}
