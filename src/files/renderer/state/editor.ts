import { createStore } from './store';
import { confirm, openDialog, toast, toastError } from './app';
import { call, errorShape, on } from '../api';
import {
  activateTab, activePane, activeTab, currentLocation, isSplit, leaveHooks, navigate, openTab, otherPane, paneCount, replaceLocation, setActivePane, toggleSplit, ws,
} from './workspace';
import type { EditorKit, KitCursor, KitState, KitText, KitView } from '../editor/kit';
import { countsWords, countWords, detectIndent, languageForName, type EditorDoc, type EditorOpenResult, type EditorSaveResult, type EditorStamp, type EolKind } from '../../shared/editor';
import type { TextEncodingName } from '../../shared/docTools';
import type { OrbisErrorShape } from '../../shared/errors';

/**
 * Built-in editor sessions, one per pane that shows an `editor` location.
 * A session keeps the CodeMirror state (document, selection, undo history)
 * while its pane is hidden or its tab is in the background, so each tab has
 * its own undo history; it ends when the pane leaves the file or its tab
 * closes, after asking about unsaved changes. Files are read and written by
 * the main process (editor:* channels); the text never leaves the window
 * otherwise and is never stored by the app.
 */

export type EditorMeta = Omit<EditorDoc, 'text'>;

export interface EditorUi {
  paneId: string;
  status: 'loading' | 'ready' | 'refused' | 'error';
  refusal?: { reason: string; message: string; size?: number };
  error?: OrbisErrorShape;
  meta?: EditorMeta;
  /** How the next save writes the file (the file's own encoding, BOM and line endings unless the user changes them). */
  save: { encoding: TextEncodingName; bom: boolean; eol: EolKind };
  language: string;
  wrap: boolean;
  useTabs: boolean;
  tabSize: number;
  preview: boolean;
  /** The user chose to edit a read-only file anyway (saving then goes to Save as…). */
  editAnyway: boolean;
  dirty: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  cursor: KitCursor;
  words?: { words: number; chars: number };
  /** The file changed on disk (or vanished) while there were unsaved changes here. */
  external?: 'changed' | 'deleted';
  /** A short message shown in the editor (and read out): saved, reloaded… */
  notice?: { text: string; tone: 'info' | 'success' | 'warning'; at: number };
  /** Increases with every change of the text (the Markdown preview follows it). */
  version: number;
}

interface Session {
  paneId: string;
  /** The path the pane's location names (the file itself may be a link's target: meta.path). */
  path: string;
  kit?: EditorKit;
  state?: KitState;
  saved?: KitText;
  view?: KitView;
  watched?: string;
  offWatch?: () => void;
  loadSeq: number;
  focusOnReady?: boolean;
  wordsTimer?: ReturnType<typeof setTimeout>;
  checking?: boolean;
  recheck?: boolean;
}

const sessions = new Map<string, Session>();
const focusRequests = new Set<string>();
export const editorUi = createStore<Record<string, EditorUi>>({});

const EMPTY_CURSOR: KitCursor = { line: 1, col: 1, selections: 1, selectedChars: 0, lines: 1, head: 0 };
const basename = (p: string) => p.split(/[\\/]/).pop() || p;
const dirname = (p: string) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i <= 0 ? p.slice(0, i + 1) || '/' : p.slice(0, i);
};

// ------------------------------------------------------------------ preferences (this window's browser storage)
interface Prefs { wrapProse: boolean; wrapCode: boolean; preview: boolean }
const PREFS_KEY = 'orbis.editor.v1';
function prefs(): Prefs {
  const d: Prefs = { wrapProse: true, wrapCode: false, preview: true };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return d;
  }
}
function savePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), ...patch }));
  } catch {
    /* per-window convenience only */
  }
}
const isProse = (lang: string) => lang === 'markdown' || lang === 'plain';

// ------------------------------------------------------------------ the editor bundle
let kitPromise: Promise<EditorKit> | undefined;
/** Load dist/renderer/editor.js (CodeMirror and its languages) once, the first time an editor opens. */
export function loadKit(): Promise<EditorKit> {
  if (window.orbisEditorKit) return Promise.resolve(window.orbisEditorKit);
  kitPromise ??= new Promise<EditorKit>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = './editor.js';
    el.onload = () => (window.orbisEditorKit ? resolve(window.orbisEditorKit) : reject(new Error('The editor component did not start.')));
    el.onerror = () => {
      kitPromise = undefined;
      el.remove();
      reject(new Error('The editor component could not be loaded.'));
    };
    document.head.appendChild(el);
  });
  return kitPromise;
}

// ------------------------------------------------------------------ ui state
function setUi(paneId: string, patch: Partial<EditorUi> | ((u: EditorUi) => Partial<EditorUi>)): void {
  editorUi.set((s) => {
    const cur = s[paneId];
    if (!cur) return {};
    return { [paneId]: { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) } };
  });
}
export const uiOf = (paneId: string): EditorUi | undefined => editorUi.get()[paneId];

function notice(paneId: string, text: string, tone: 'info' | 'success' | 'warning' = 'info'): void {
  const at = Date.now();
  setUi(paneId, { notice: { text, tone, at } });
  setTimeout(() => setUi(paneId, (u) => (u.notice?.at === at ? { notice: undefined } : {})), tone === 'warning' ? 9000 : 5000);
}

function recomputeDirty(paneId: string): void {
  const s = sessions.get(paneId);
  const u = uiOf(paneId);
  if (!s?.kit || !s.state || !s.saved || !u?.meta) return;
  const textDirty = !s.kit.sameText(s.kit.docOf(s.state), s.saved);
  const m = u.meta;
  const formatDirty = u.save.encoding !== m.encoding || u.save.eol !== m.eol || (u.save.bom !== m.bom && ['utf8', 'utf16le', 'utf16be'].includes(u.save.encoding));
  const dirty = textDirty || formatDirty;
  if (dirty !== u.dirty) setUi(paneId, { dirty });
}

function scheduleWords(paneId: string): void {
  const s = sessions.get(paneId);
  const u = uiOf(paneId);
  if (!s?.kit || !s.state || !u || !countsWords(u.language)) return;
  clearTimeout(s.wordsTimer);
  const len = s.kit.cursor(s.state).lines;
  s.wordsTimer = setTimeout(() => {
    const cur = sessions.get(paneId);
    if (cur?.kit && cur.state) setUi(paneId, { words: countWords(cur.kit.textOf(cur.state)) });
  }, len > 20000 ? 800 : 250);
}

// ------------------------------------------------------------------ sessions
/** The pane shows `path` in the editor: start (or keep) its session. */
export function ensureSession(paneId: string, path: string): void {
  const s = sessions.get(paneId);
  if (s && s.path === path) return;
  if (s) {
    // Same pane, new path: the file was renamed or moved by Orbis Files (navigation ends a session first).
    s.path = path;
    void recheckPath(paneId);
    return;
  }
  const session: Session = { paneId, path, loadSeq: 0, focusOnReady: focusRequests.delete(paneId) };
  sessions.set(paneId, session);
  const pr = prefs();
  editorUi.set({
    [paneId]: {
      paneId, status: 'loading', save: { encoding: 'utf8', bom: false, eol: 'lf' }, language: 'plain', wrap: pr.wrapProse, useTabs: false, tabSize: 4, preview: pr.preview,
      editAnyway: false, dirty: false, saving: false, canUndo: false, canRedo: false, cursor: EMPTY_CURSOR, version: 0,
    },
  });
  void load(paneId, path);
}

async function recheckPath(paneId: string): Promise<void> {
  const s = sessions.get(paneId);
  const u = uiOf(paneId);
  if (!s || !u?.meta) return;
  const real = await call<EditorStamp | null>('editor:stat', { path: s.path }).catch(() => null);
  if (!real) return;
  setUi(paneId, (x) => (x.meta ? { meta: { ...x.meta, path: s.path, requestedPath: s.path, name: basename(s.path) } } : {}));
  s.view?.setLabel(`Editing ${basename(s.path)}`);
  void watchDir(s, dirname(s.path));
}

/** Read (or re-read) the file. `keep` reloads in place: cursor, language and view settings stay. */
async function load(paneId: string, path: string, opts: { keep?: boolean; encoding?: TextEncodingName; reason?: string } = {}): Promise<boolean> {
  const s = sessions.get(paneId);
  if (!s) return false;
  const seq = ++s.loadSeq;
  if (!opts.keep) setUi(paneId, { status: 'loading', error: undefined, refusal: undefined });
  let kit: EditorKit;
  let r: EditorOpenResult;
  try {
    [kit, r] = await Promise.all([loadKit(), call<EditorOpenResult>('editor:open', { path, encoding: opts.encoding })]);
  } catch (err) {
    if (sessions.get(paneId) === s && seq === s.loadSeq) {
      if (opts.keep) toastError(err, `${basename(path)} could not be read again`);
      else setUi(paneId, { status: 'error', error: errorShape(err, 'editor.open') });
    }
    return false;
  }
  if (sessions.get(paneId) !== s || seq !== s.loadSeq) return false;
  s.kit = kit;
  if (r.status === 'refused') {
    setUi(paneId, { status: 'refused', refusal: { reason: r.reason, message: r.message, size: r.size } });
    return false;
  }
  const doc = r.doc;
  const prev = uiOf(paneId)!;
  const language = opts.keep ? prev.language : languageForName(doc.name).id;
  const indent = opts.keep ? { useTabs: prev.useTabs, size: prev.tabSize } : detectIndent(doc.text);
  const pr = prefs();
  const wrap = opts.keep ? prev.wrap : isProse(language) ? pr.wrapProse : pr.wrapCode;
  const editAnyway = opts.keep ? prev.editAnyway : false;
  const cursorAt = opts.keep && s.state ? kit.cursor(s.state).head : undefined;
  const scrollTop = s.view?.scrollDOM.scrollTop;
  const state = kit.createState({ doc: doc.text, language, readOnly: doc.readOnly && !editAnyway, wrap, useTabs: indent.useTabs, tabSize: indent.size, label: `Editing ${doc.name}`, cursor: cursorAt });
  s.state = state;
  s.saved = kit.docOf(state);
  if (s.view) {
    s.view.setState(state);
    if (scrollTop !== undefined) s.view.scrollDOM.scrollTop = scrollTop;
  }
  const { text: _text, ...meta } = doc;
  void _text;
  setUi(paneId, (u) => ({
    status: 'ready', meta, save: { encoding: doc.encoding, bom: doc.bom, eol: doc.eol }, language, wrap, useTabs: indent.useTabs, tabSize: indent.size, editAnyway,
    dirty: false, external: undefined, canUndo: false, canRedo: false, cursor: kit.cursor(state), version: u.version + 1,
    words: countsWords(language) ? countWords(doc.text) : undefined,
  }));
  if (opts.reason) notice(paneId, opts.reason, 'info');
  void watchDir(s, dirname(doc.path));
  return true;
}

/** Show the session's editor in `el` (the pane's editor area); returns the cleanup for when it is hidden. */
export function attachView(paneId: string, el: HTMLElement): () => void {
  const s = sessions.get(paneId);
  if (!s?.kit || !s.state) return () => undefined;
  const kit = s.kit;
  const view = kit.mount(el, s.state, (u, v) => {
    s.state = v.state;
    if (u.docChanged) {
      recomputeDirty(paneId);
      scheduleWords(paneId);
    }
    if (u.docChanged || u.selectionSet) {
      const st = v.state;
      setUi(paneId, (x) => ({ cursor: kit.cursor(st), canUndo: kit.canUndo(st), canRedo: kit.canRedo(st), version: u.docChanged ? x.version + 1 : x.version }));
    }
  });
  s.view = view;
  if (s.focusOnReady) {
    s.focusOnReady = false;
    requestAnimationFrame(() => view.focus());
  }
  return () => {
    if (s.view === view) {
      s.state = view.state;
      s.view = undefined;
    }
    view.destroy();
  };
}

export function viewOf(paneId: string): KitView | undefined {
  return sessions.get(paneId)?.view;
}
export function textOf(paneId: string): string {
  const s = sessions.get(paneId);
  return s?.kit && s.state ? s.kit.textOf(s.state) : '';
}

/** End sessions of panes that no longer show their file (after any question about unsaved changes). */
export function disposeSessions(paneIds: string[]): void {
  for (const id of paneIds) {
    const s = sessions.get(id);
    if (!s) continue;
    s.loadSeq++;
    s.offWatch?.();
    if (s.watched) void call('fs:unwatch', { path: s.watched }).catch(() => undefined);
    clearTimeout(s.wordsTimer);
    sessions.delete(id);
    editorUi.set((st) => {
      const next = { ...st };
      delete next[id];
      return next;
    });
  }
}

function applyToState(paneId: string, o: Parameters<EditorKit['reconfigure']>[1]): void {
  const s = sessions.get(paneId);
  if (!s?.kit || !s.state) return;
  if (s.view) {
    if (o.language !== undefined) s.view.setLanguage(o.language);
    if (o.wrap !== undefined) s.view.setWrap(o.wrap);
    if (o.useTabs !== undefined || o.tabSize !== undefined) s.view.setIndent(o.useTabs ?? uiOf(paneId)!.useTabs, o.tabSize ?? uiOf(paneId)!.tabSize);
    if (o.readOnly !== undefined) s.view.setReadOnly(o.readOnly);
    if (o.label !== undefined) s.view.setLabel(o.label);
    s.state = s.view.state;
  } else s.state = s.kit.reconfigure(s.state, o);
}

// ------------------------------------------------------------------ settings shown in the status bar
export function setWrap(paneId: string, wrap: boolean): void {
  const u = uiOf(paneId);
  if (!u) return;
  applyToState(paneId, { wrap });
  setUi(paneId, { wrap });
  savePrefs(isProse(u.language) ? { wrapProse: wrap } : { wrapCode: wrap });
}
export function setPreview(paneId: string, preview: boolean): void {
  setUi(paneId, { preview });
  savePrefs({ preview });
}
export function setIndent(paneId: string, useTabs: boolean, tabSize: number): void {
  applyToState(paneId, { useTabs, tabSize });
  setUi(paneId, { useTabs, tabSize });
}
export function setLanguage(paneId: string, language: string): void {
  applyToState(paneId, { language });
  setUi(paneId, { language });
  scheduleWords(paneId);
  if (!countsWords(language)) setUi(paneId, { words: undefined });
}
export function setSaveFormat(paneId: string, patch: Partial<EditorUi['save']>): void {
  setUi(paneId, (u) => ({ save: { ...u.save, ...patch } }));
  recomputeDirty(paneId);
}
export function editReadOnlyAnyway(paneId: string): void {
  applyToState(paneId, { readOnly: false });
  setUi(paneId, { editAnyway: true });
  sessions.get(paneId)?.view?.focus();
}
export function focusEditor(paneId: string): void {
  const s = sessions.get(paneId);
  if (s?.view) s.view.focus();
  else if (s) s.focusOnReady = true;
  else focusRequests.add(paneId);
}

/** Re-read the file in another encoding (asks first when there are unsaved changes). */
export async function reopenWithEncoding(paneId: string, encoding: TextEncodingName): Promise<void> {
  const s = sessions.get(paneId);
  const u = uiOf(paneId);
  if (!s || !u?.meta) return;
  if (u.dirty && !(await confirm({ title: 'Reopen and discard your changes?', body: `Reopening ${u.meta.name} as ${encoding} reads it from disk again; your unsaved changes are lost.`, confirmLabel: 'Reopen', destructive: true }))) return;
  await load(paneId, s.path, { keep: true, encoding, reason: 'Reopened from disk with the chosen encoding.' });
}

/** Reload from disk (Refresh): asks first when there are unsaved changes. */
export async function reloadFromDisk(paneId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  const s = sessions.get(paneId);
  const u = uiOf(paneId);
  if (!s || !u) return false;
  if (u.status !== 'ready') return load(paneId, s.path);
  if (u.dirty && !opts.force && !(await confirm({ title: 'Reload and discard your changes?', body: `${u.meta?.name ?? 'The file'} is read from disk again. Your unsaved changes are lost.`, confirmLabel: 'Reload', destructive: true }))) return false;
  return load(paneId, s.path, { keep: true, reason: 'Reloaded from disk.' });
}

// ------------------------------------------------------------------ saving
function adoptSaved(paneId: string, sent: KitState, r: Extract<EditorSaveResult, { status: 'saved' }>): void {
  const s = sessions.get(paneId);
  const u = uiOf(paneId);
  if (!s?.kit || !u?.meta) return;
  s.saved = s.kit.docOf(sent);
  const ro = r.readOnly && !u.editAnyway;
  setUi(paneId, {
    meta: { ...u.meta, path: r.path, name: basename(r.path), stamp: r.stamp, encoding: u.save.encoding, bom: u.save.bom, eol: u.save.eol, mixedEol: false, readOnly: r.readOnly, readOnlyReason: r.readOnlyReason },
    external: undefined,
  });
  if (!ro) applyToState(paneId, { readOnly: false });
  recomputeDirty(paneId);
}

/** Save (Ctrl+S). Resolves true when the file on disk now has the editor's text. */
export async function save(paneId: string, opts: { expected?: EditorStamp | null } = {}): Promise<boolean> {
  const s = sessions.get(paneId);
  const u = uiOf(paneId);
  if (!s?.kit || !s.state || u?.status !== 'ready' || !u.meta) return false;
  if (u.meta.readOnly) return saveAs(paneId);
  if (u.saving) return false;
  const sent = s.state;
  const name = u.meta.name;
  setUi(paneId, { saving: true });
  try {
    const r = await call<EditorSaveResult>('editor:save', { path: u.meta.path, text: s.kit.textOf(sent), ...u.save, expected: opts.expected !== undefined ? opts.expected : u.meta.stamp });
    if (r.status === 'saved') {
      adoptSaved(paneId, sent, r);
      notice(paneId, r.snapshotId ? `Saved. The previous version is kept as a snapshot.` : 'Saved.', 'success');
      return true;
    }
    setUi(paneId, { saving: false });
    if (r.status === 'conflict') return await resolveConflict(paneId, r.current);
    return false;
  } catch (err) {
    toastError(err, `${name} was not saved`);
    return false;
  } finally {
    setUi(paneId, { saving: false });
    if (s.recheck) {
      s.recheck = false;
      void checkDisk(paneId);
    }
  }
}

export type ConflictChoice = 'reload' | 'overwrite' | 'copy' | 'cancel';

/** The file changed on disk since it was loaded: ask what to do (dialog), resolve whether the editor is now saved/clean. */
function resolveConflict(paneId: string, current: EditorStamp | null): Promise<boolean> {
  return new Promise((resolve) => openDialog('editorConflict', { paneId, current, resolve }));
}

export async function runConflictChoice(paneId: string, choice: ConflictChoice, current: EditorStamp | null): Promise<boolean> {
  switch (choice) {
    case 'reload':
      return reloadFromDisk(paneId, { force: true });
    case 'overwrite':
      return save(paneId, { expected: current });
    case 'copy':
      return saveCopyAndSwitch(paneId);
    default:
      return false;
  }
}

/** Keep the editor's version as "name (copy).ext" beside the file and continue editing that copy. */
async function saveCopyAndSwitch(paneId: string): Promise<boolean> {
  const s = sessions.get(paneId);
  const u = uiOf(paneId);
  if (!s?.kit || !s.state || !u?.meta) return false;
  const sent = s.state;
  const original = u.meta.name;
  try {
    const r = await call<EditorSaveResult>('editor:saveCopy', { path: u.meta.path, text: s.kit.textOf(sent), ...u.save });
    if (r.status !== 'saved') return false;
    switchToSaved(paneId, sent, r);
    toast({ level: 'success', title: `Your version was saved as “${basename(r.path)}”`, detail: `“${original}” keeps the other program's changes.` });
    return true;
  } catch (err) {
    toastError(err, 'Your version could not be saved as a copy');
    return false;
  }
}

/** After Save as / Save as copy the pane edits the new file (same undo history). */
function switchToSaved(paneId: string, sent: KitState, r: Extract<EditorSaveResult, { status: 'saved' }>): void {
  const s = sessions.get(paneId);
  if (!s) return;
  s.path = r.path;
  replaceLocation(paneId, { kind: 'editor', path: r.path });
  adoptSaved(paneId, sent, r);
  setUi(paneId, (u) => (u.meta ? { meta: { ...u.meta, requestedPath: r.path } } : {}));
  const lang = languageForName(basename(r.path)).id;
  if (lang !== uiOf(paneId)?.language) setLanguage(paneId, lang);
  applyToState(paneId, { label: `Editing ${basename(r.path)}` });
  void watchDir(s, dirname(r.path));
}

/** Save as… (dialog). Resolves true when saved. */
export function saveAs(paneId: string): Promise<boolean> {
  const u = uiOf(paneId);
  if (u?.status !== 'ready' || !u.meta) return Promise.resolve(false);
  return new Promise((resolve) => openDialog('editorSaveAs', { paneId, resolve }));
}

/** The Save as dialog's write: 'exists' asks the dialog to confirm replacing (it then passes `replace`). */
export async function saveAsTo(paneId: string, dir: string, name: string, format: EditorUi['save'], replace?: EditorStamp): Promise<EditorSaveResult | null> {
  const s = sessions.get(paneId);
  if (!s?.kit || !s.state) return null;
  const sent = s.state;
  setUi(paneId, { save: format });
  const r = await call<EditorSaveResult>('editor:saveAs', { dir, name, text: s.kit.textOf(sent), ...format, replace });
  if (r.status === 'saved') {
    switchToSaved(paneId, sent, r);
    notice(paneId, r.snapshotId ? `Saved as ${basename(r.path)}. The file it replaced is kept as a snapshot.` : `Saved as ${basename(r.path)}.`, 'success');
  }
  return r;
}

export function diffWithDisk(paneId: string): Promise<{ hunks: Array<{ kind: 'same' | 'added' | 'removed'; lines: string[] }>; added: number; removed: number; identical: boolean; leftHash: string; rightHash: string; missing: boolean }> {
  const u = uiOf(paneId);
  return call('editor:diff', { path: u?.meta?.path ?? sessions.get(paneId)!.path, text: textOf(paneId) });
}

// ------------------------------------------------------------------ changes on disk
async function watchDir(s: Session, dir: string): Promise<void> {
  if (s.watched === dir) return;
  s.offWatch?.();
  s.offWatch = undefined;
  if (s.watched) void call('fs:unwatch', { path: s.watched }).catch(() => undefined);
  s.watched = undefined;
  const ok = await call<boolean>('fs:watch', { path: dir }).catch(() => false);
  if (!ok) return;
  if (sessions.get(s.paneId) !== s || s.watched) {
    void call('fs:unwatch', { path: dir }).catch(() => undefined);
    return;
  }
  s.watched = dir;
  s.offWatch = on<{ path: string }>('fs:changed', (e) => {
    if (e.path === dir) void checkDisk(s.paneId);
  });
}

/** Compare the file on disk with what the editor loaded: reload quietly when there are no changes here, else show a banner. */
export async function checkDisk(paneId: string): Promise<void> {
  const s = sessions.get(paneId);
  const u = uiOf(paneId);
  if (!s || u?.status !== 'ready' || !u.meta) return;
  if (u.saving || s.checking) {
    s.recheck = true;
    return;
  }
  s.checking = true;
  try {
    const cur = await call<EditorStamp | null>('editor:stat', { path: u.meta.path }).catch(() => undefined);
    const now = uiOf(paneId);
    if (cur === undefined || sessions.get(paneId) !== s || !now?.meta || now.saving) return;
    if (cur && cur.sha256 === now.meta.stamp.sha256) {
      if (now.external || cur.mtimeMs !== now.meta.stamp.mtimeMs) setUi(paneId, { external: undefined, meta: { ...now.meta, stamp: cur } });
      return;
    }
    if (!cur) {
      if (now.external !== 'deleted') setUi(paneId, { external: 'deleted' });
      return;
    }
    if (!now.dirty) {
      await load(paneId, s.path, { keep: true, reason: 'Reloaded: another program changed this file.' });
      return;
    }
    if (now.external !== 'changed') setUi(paneId, { external: 'changed' });
  } finally {
    s.checking = false;
    if (s.recheck && !uiOf(paneId)?.saving) {
      s.recheck = false;
      setTimeout(() => void checkDisk(paneId), 200);
    }
  }
}

// ------------------------------------------------------------------ unsaved changes
export const dirtyPanes = (paneIds?: string[]): string[] => Object.values(editorUi.get()).filter((u) => u.dirty && (!paneIds || paneIds.includes(u.paneId))).map((u) => u.paneId);

let pendingConfirm: Promise<boolean> | undefined;
/** Save / Don't save / Cancel for panes with unsaved changes. True when the action may go ahead. */
export function confirmUnsaved(paneIds: string[], action: string): Promise<boolean> {
  const dirty = dirtyPanes(paneIds);
  if (!dirty.length) return Promise.resolve(true);
  if (pendingConfirm) return pendingConfirm;
  pendingConfirm = new Promise<boolean>((resolve) => openDialog('editorUnsaved', { paneIds: dirty, action, resolve })).finally(() => {
    pendingConfirm = undefined;
  });
  return pendingConfirm;
}

export async function saveAll(paneIds: string[]): Promise<boolean> {
  for (const id of paneIds) if (uiOf(id)?.dirty && !(await save(id))) return false;
  return true;
}

export const nameOf = (paneId: string): string => uiOf(paneId)?.meta?.name ?? basename(sessions.get(paneId)?.path ?? '');

// ------------------------------------------------------------------ opening files
/** Open a file in the editor: beside the file list (other pane, splitting the tab if needed), in a new tab, or here. */
export async function openInEditor(path: string, mode: 'beside' | 'tab' | 'here' = 'beside'): Promise<void> {
  void call('cat:recordRecent', { path, kind: 'file' }).catch(() => undefined);
  // Already open in this window: show that editor rather than a second copy of the same file.
  for (const t of ws.get().tabs) {
    for (let i = 0; i < paneCount(t); i++) {
      const loc = currentLocation(t.panes[i]!);
      if (loc.kind === 'editor' && loc.path === path) {
        activateTab(t.id);
        setActivePane(t.id, i);
        focusEditor(t.panes[i]!.id);
        return;
      }
    }
  }
  const loc = { kind: 'editor' as const, path };
  if (mode === 'tab') {
    const t = openTab(loc);
    focusRequests.add(t.panes[0]!.id);
    return;
  }
  if (mode === 'here') {
    const id = activePane().id;
    focusRequests.add(id);
    await navigate(id, loc);
    return;
  }
  let tab = activeTab();
  let target = otherPane(activePane().id);
  if (!isSplit(tab) || !target) {
    toggleSplit(tab.id);
    tab = ws.get().tabs.find((x) => x.id === tab.id)!;
    target = tab.panes[tab.activePane];
  }
  if (!target) return;
  focusRequests.add(target.id);
  const ok = await navigate(target.id, loc);
  if (!ok) {
    focusRequests.delete(target.id);
    return;
  }
  const t = ws.get().tabs.find((x) => x.id === tab.id);
  const idx = t?.panes.findIndex((p) => p.id === target!.id) ?? -1;
  if (t && idx >= 0) setActivePane(t.id, idx);
}

// ------------------------------------------------------------------ wiring
let unloadApproved = false;
let installed = false;
/** Install the workspace hooks and the window-close guard (once, at start). */
export function installEditorGuards(): void {
  if (installed) return;
  installed = true;
  leaveHooks.needsConfirm = (ids) => dirtyPanes(ids).length > 0;
  leaveHooks.confirm = (ids, action) => confirmUnsaved(ids, action);
  leaveHooks.left = (ids) => disposeSessions(ids);
  leaveHooks.refresh = (id) => void reloadFromDisk(id);
  window.addEventListener('beforeunload', (e) => {
    if (unloadApproved) return;
    const dirty = dirtyPanes();
    if (!dirty.length) return;
    // Keep the window open and ask in the app; it closes itself when the user has decided.
    e.preventDefault();
    e.returnValue = false;
    setTimeout(() => {
      void confirmUnsaved(dirty, 'close the window').then((ok) => {
        if (!ok) return;
        unloadApproved = true;
        void call('win:close');
      });
    }, 0);
  });
  // Changes made while the window was in the background are picked up when it is focused again.
  window.addEventListener('focus', () => {
    for (const id of sessions.keys()) void checkDisk(id);
  });
}
