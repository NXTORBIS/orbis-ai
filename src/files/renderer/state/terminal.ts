import { createStore } from './store';
import { call, on } from '../api';
import { app, confirm, toast, toastError } from './app';
import { activePane, currentLocation, navigate, ws } from './workspace';
import { custom } from './custom';
import {
  cdCommand, clearLineKeys, folderLabel, isMultiline, QuoteError, quotePaths, safeWebLink, TERM_WRITE_MAX,
  type ShellFlavor, type ShellInfo, type TermCwd, type TermSessionInfo, type TermStatus,
} from '../../shared/terminal';
import { isRemoteRef } from '../../shared/remote';
import type { TermHandle, TermLook, TermTheme, TerminalKit } from '../terminal/kit';

/**
 * Built-in terminal (renderer side): the dock's tabs, one xterm.js instance per tab
 * (kept outside React so output keeps arriving while the dock is hidden), output
 * acknowledgement for flow control, and the actions (go to the pane's folder, show
 * the shell's folder, follow the pane, paste, drop, links, find, clear, restart).
 */

export interface TermInfo {
  available: boolean;
  reason?: string;
  platform: string;
  shells: ShellInfo[];
  current?: { label: string; path: string; source: string };
  problem?: string;
  cwdSupported: boolean;
  foregroundSupported: boolean;
}

export interface TermTab {
  /** Stable for the tab (a restart starts a new session in the same tab). */
  key: string;
  /** Session id while one exists. */
  id?: string;
  shell: string;
  flavor: ShellFlavor;
  /** Folder last known for the shell (start folder, our own cd, or read from the system). */
  cwd: string;
  status: 'starting' | 'running' | 'exited' | 'failed';
  exitCode?: number;
  signal?: number;
  error?: string;
  startNote?: string;
  follow: boolean;
  /** Why "Follow pane" did not change the folder last time (shown in the dock). */
  followNote?: string;
}

export interface FindState { open: boolean; query: string; caseSensitive: boolean; regex: boolean; wholeWord: boolean; result?: { index: number; count: number }; notFound?: boolean }

export interface TerminalState {
  open: boolean;
  tabs: TermTab[];
  active?: string;
  height: number;
  info?: TermInfo;
  find: FindState;
  /** Changes whenever a tab's terminal element is created or removed (the dock re-attaches them). */
  surfaces: number;
}

const HEIGHT_KEY = 'orbis.terminal.height';
function savedHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(v) && v >= 120 && v <= 2000 ? v : 280;
  } catch {
    return 280;
  }
}

export const terminal = createStore<TerminalState>({
  open: false,
  tabs: [],
  height: savedHeight(),
  surfaces: 0,
  find: { open: false, query: '', caseSensitive: false, regex: false, wholeWord: false },
});

export function setDockHeight(h: number, persist: boolean): void {
  terminal.set({ height: h });
  if (!persist) return;
  try {
    localStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
  } catch {
    /* per-window convenience only */
  }
}

interface Runtime {
  handle: TermHandle;
  el: HTMLDivElement;
  sessionId?: string;
  /** The user typed on the command line since the last Enter, Ctrl+C or Ctrl+U. */
  lineDirty: boolean;
  lastOutputMs: number;
  pendingAck: number;
  acking: boolean;
  writes: Promise<unknown>;
}

const runtimes = new Map<string, Runtime>();
const keyBySession = new Map<string, string>();
let seq = 0;

const isMac = () => window.orbis.platform === 'darwin';
const tabOf = (key?: string) => terminal.get().tabs.find((t) => t.key === (key ?? terminal.get().active));
function patchTab(key: string, patch: Partial<TermTab>): void {
  terminal.set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)) }));
}

/** The visible text of a tab's terminal (tests and diagnostics). */
export function terminalText(key?: string, lines?: number): string {
  const k = key ?? terminal.get().active;
  return (k && runtimes.get(k)?.handle.text(lines)) ?? '';
}

// ------------------------------------------------------------------ the terminal bundle
let kitPromise: Promise<TerminalKit> | undefined;
export function loadTermKit(): Promise<TerminalKit> {
  if (window.orbisTerminalKit) return Promise.resolve(window.orbisTerminalKit);
  kitPromise ??= new Promise<TerminalKit>((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = './terminal.css';
    document.head.appendChild(css);
    const el = document.createElement('script');
    el.src = './terminal.js';
    el.onload = () => (window.orbisTerminalKit ? resolve(window.orbisTerminalKit) : reject(new Error('The terminal component did not start.')));
    el.onerror = () => {
      kitPromise = undefined;
      el.remove();
      reject(new Error('The terminal component could not be loaded.'));
    };
    document.head.appendChild(el);
  });
  return kitPromise;
}

// ------------------------------------------------------------------ look (design tokens → xterm colours)
let probe: CanvasRenderingContext2D | null | undefined;
/** Any CSS colour (hex, rgb(), color-mix()…) as [r, g, b, a] through a 1×1 canvas. */
function rgba(value: string): [number, number, number, number] | undefined {
  if (!value) return undefined;
  probe ??= (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.getContext('2d', { willReadFrequently: true });
  })();
  if (!probe) return undefined;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#010203';
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
function toHex(value: string, fallback: string, over?: [number, number, number, number]): string {
  const c = rgba(value);
  if (!c) return fallback;
  let [r, g, b, a] = c;
  if (over && a < 255) {
    const f = a / 255;
    r = r * f + over[0] * (1 - f);
    g = g * f + over[1] * (1 - f);
    b = b * f + over[2] * (1 - f);
    a = 255;
  }
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 255 ? hex2(a) : ''}`;
}

/** Terminal colours from the app's tokens (so presets, light/dark, accent and high contrast apply). */
export function themeFromTokens(): TermTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const bgRaw = v('--bg-surface') || '#111419';
  const bg = rgba(bgRaw) ?? [17, 20, 25, 255];
  const c = (name: string, fb: string) => toHex(v(name), fb, bg);
  const ca = (name: string, fb: string) => toHex(v(name), fb);
  return {
    background: c('--bg-surface', '#111419'),
    foreground: c('--text', '#e3e8ee'),
    cursor: c('--accent', '#5caae8'),
    cursorAccent: c('--bg-surface', '#111419'),
    selectionBackground: ca('--bg-selected-focus', '#5caae83d'),
    selectionInactiveBackground: ca('--bg-selected', '#5caae826'),
    scrollbarSliderBackground: ca('--scrollbar-thumb', '#ffffff22'),
    scrollbarSliderHoverBackground: ca('--scrollbar-thumb-hover', '#ffffff44'),
    scrollbarSliderActiveBackground: ca('--scrollbar-thumb-hover', '#ffffff55'),
    black: c('--text-disabled', '#47505a'),
    red: c('--error', '#ef6f6f'),
    green: c('--success', '#4cc28f'),
    yellow: c('--warning', '#e2b450'),
    blue: c('--accent', '#5caae8'),
    magenta: c('--hue-image', '#c79bf0'),
    cyan: c('--accent-2', '#8fd0c8'),
    white: c('--text-2', '#a4aeb9'),
    brightBlack: c('--text-3', '#8792a0'),
    brightRed: c('--hue-video', '#f0909f'),
    brightGreen: c('--hue-code', '#7fd3b0'),
    brightYellow: c('--hue-audio', '#e9b46a'),
    brightBlue: c('--hue-doc', '#8fb7f2'),
    brightMagenta: c('--hue-image', '#c79bf0'),
    brightCyan: c('--hue-folder', '#6fb2e6'),
    brightWhite: c('--text', '#e3e8ee'),
    matchBackground: c('--warning-soft', '#3a3320'),
    matchBorder: c('--warning', '#e2b450'),
    activeMatchBackground: c('--accent-soft', '#1d3346'),
    activeMatchBorder: c('--accent', '#5caae8'),
  };
}

function look(): TermLook {
  const css = getComputedStyle(document.documentElement);
  const s = app.get().settings;
  const appSize = parseFloat(css.getPropertyValue('--fs-md')) || 13;
  return {
    fontFamily: css.getPropertyValue('--font-mono').trim() || 'monospace',
    fontSize: s.terminalFontSize || appSize,
    scrollback: s.terminalScrollback,
    theme: themeFromTokens(),
  };
}

let lastLookKey = '';
function restyle(): void {
  if (!runtimes.size) return;
  const l = look();
  const key = JSON.stringify(l);
  if (key === lastLookKey) return;
  lastLookKey = key;
  for (const r of runtimes.values()) r.handle.setLook(l);
  // A new font size changes the number of rows and columns.
  requestAnimationFrame(() => fitActive());
}

// ------------------------------------------------------------------ sessions
async function info(force = false): Promise<TermInfo> {
  const cur = terminal.get().info;
  if (cur && !force) return cur;
  const i = await call<TermInfo>('term:info');
  terminal.set({ info: i });
  return i;
}
export const refreshTerminalInfo = () => info(true);

/** The folder a new terminal starts in: the given one, else the active pane's folder (on this computer). */
function paneFolder(): string | undefined {
  const loc = currentLocation(activePane());
  return loc.kind === 'fs' ? loc.path : undefined;
}

/** Open the dock with a new terminal in `cwd` (default: the active pane's folder). */
export async function newTerminal(cwd?: string): Promise<void> {
  const i = await info().catch((err) => {
    toastError(err, 'The terminal is not available');
    return undefined;
  });
  if (!i) return;
  const key = `k${++seq}`;
  const start = cwd ?? paneFolder() ?? '';
  terminal.set((s) => ({ open: true, active: key, tabs: [...s.tabs, { key, shell: i.current?.label ?? 'Shell', flavor: 'posix', cwd: start, status: 'starting', follow: false }] }));
  if (!i.available) {
    patchTab(key, { status: 'failed', error: i.reason ?? 'The terminal is not available on this system.' });
    return;
  }
  await startSession(key, start || undefined);
}

/**
 * Ctrl+`: shows the dock (starting a terminal in the active pane's folder the first time) and puts the keyboard in
 * it; when the dock is open but the keyboard is elsewhere it moves the keyboard into the terminal; from inside the
 * dock it hides the dock (terminals keep running) and gives the keyboard back to the files.
 */
export async function toggleDock(): Promise<void> {
  const s = terminal.get();
  if (s.open) {
    const inDock = !!document.activeElement?.closest?.('.term-dock');
    if (!inDock && s.tabs.length) {
      focusActive();
      return;
    }
    hideDock();
    return;
  }
  if (!s.tabs.length) return newTerminal();
  terminal.set({ open: true });
  requestAnimationFrame(() => focusActive());
}

export function hideDock(): void {
  if (!terminal.get().open) return;
  terminal.set({ open: false });
  returnFocusToPane();
}

function returnFocusToPane(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('.pane.is-active .fileview') ?? document.querySelector<HTMLElement>('.pane.is-active [tabindex="0"]');
    el?.focus({ preventScroll: true });
  });
}

async function startSession(key: string, cwd?: string): Promise<void> {
  let kit: TerminalKit;
  try {
    kit = await loadTermKit();
    await document.fonts?.load(`13px ${getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'}`).catch(() => undefined);
  } catch (err) {
    patchTab(key, { status: 'failed', error: (err as Error).message });
    return;
  }
  let r = runtimes.get(key);
  if (!r) {
    const el = document.createElement('div');
    el.className = 'term-surface';
    el.dataset.termKey = key;
    const handle = kit.create({ ...look(), onLink: (uri) => void openLink(uri), macOptionIsMeta: false });
    r = { handle, el, lineDirty: false, lastOutputMs: 0, pendingAck: 0, acking: false, writes: Promise.resolve() };
    runtimes.set(key, r);
    wireRuntime(key, r);
    lastLookKey = '';
    terminal.set((st) => ({ surfaces: st.surfaces + 1 }));
  }
  // The element is attached by the dock; wait for it so the size can be measured.
  const size = await measured(key);
  try {
    const s = await call<TermSessionInfo>('term:create', { cwd, cols: size.cols, rows: size.rows });
    if (!runtimes.has(key)) {
      // The tab was closed while the shell started.
      void call('term:kill', { id: s.id }).catch(() => undefined);
      return;
    }
    r.sessionId = s.id;
    r.lineDirty = false;
    keyBySession.set(s.id, key);
    patchTab(key, { id: s.id, shell: s.shell, flavor: s.flavor, cwd: s.startCwd, status: 'running', startNote: s.startNote, exitCode: undefined, signal: undefined, error: undefined });
    if (s.startNote) toast({ level: 'warning', title: 'The terminal started in your home folder', detail: s.startNote });
    if (terminal.get().active === key && terminal.get().open) requestAnimationFrame(() => r.handle.focus());
  } catch (err) {
    patchTab(key, { status: 'failed', error: (err as Error).message });
  }
}

/** Wait until the tab's element is in the document and has a size (at most ~2 s), then fit. */
async function measured(key: string): Promise<{ cols: number; rows: number }> {
  for (let i = 0; i < 40; i++) {
    const r = runtimes.get(key);
    if (r?.el.isConnected && r.el.clientWidth > 0 && r.el.clientHeight > 0) {
      if (!r.handle.opened) r.handle.open(r.el);
      const s = r.handle.fit();
      if (s) return s;
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  return { cols: 80, rows: 24 };
}

function wireRuntime(key: string, r: Runtime): void {
  r.handle.onData((d) => sendInput(key, d));
  r.handle.onBell(() => undefined);
  r.handle.setKeyHandler((e) => terminalKey(key, e));
  r.handle.onSearchResults((res) => {
    if (terminal.get().active === key) setFind({ result: res, notFound: res.count === 0 });
  });
  r.el.addEventListener('paste', (e) => {
    // Native paste (e.g. from the Edit menu) goes through the same multi-line check.
    const text = e.clipboardData?.getData('text/plain');
    e.preventDefault();
    e.stopPropagation();
    if (text) void pasteText(text, key);
  }, true);
}

/** Keys the terminal leaves to the app, and its own copy/paste/find keys. Returns false when xterm must not handle the key. */
function terminalKey(key: string, e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return !isAppKey(e);
  const mac = isMac();
  const primary = mac ? e.metaKey && !e.ctrlKey && !e.altKey : e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
  const k = e.key.toLowerCase();
  const swallow = () => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };
  if (primary && k === 'c') {
    const r = runtimes.get(key);
    if (r?.handle.hasSelection()) void call('fs:copyText', { text: r.handle.getSelection() }).catch(toastError);
    return swallow();
  }
  if (primary && k === 'v') {
    void pasteFromClipboard(key);
    return swallow();
  }
  if (primary && k === 'f') {
    openFind();
    return swallow();
  }
  if (mac && primary && k === 'k') {
    clearTerminal(key);
    return swallow();
  }
  if (mac && primary && k === 'a') {
    runtimes.get(key)?.handle.selectAll();
    return swallow();
  }
  return !isAppKey(e);
}

/** Commands whose shortcut works while the terminal has the keyboard (everything else goes to the shell). */
const TERMINAL_APP_COMMANDS = new Set(['terminal.toggle', 'terminal.new', 'app.palette']);
let appKeyLookup: ((e: KeyboardEvent) => string | undefined) | undefined;
/** commands.ts registers how a key event maps to a command (avoids an import cycle). */
export function setTerminalKeyLookup(fn: (e: KeyboardEvent) => string | undefined): void {
  appKeyLookup = fn;
}
export function isAppKey(e: KeyboardEvent): boolean {
  const id = appKeyLookup?.(e);
  if (!id || !TERMINAL_APP_COMMANDS.has(id)) return false;
  // The palette only through a Shift combination (Ctrl+K is "kill line" in shells).
  if (id === 'app.palette') return e.shiftKey || (isMac() && e.metaKey);
  return true;
}

function sendInput(key: string, data: string): void {
  const r = runtimes.get(key);
  const t = tabOf(key);
  if (!r?.sessionId || t?.status !== 'running') return;
  // Focus reports are not typing.
  const typed = data.replace(/\x1b\[[IO]/g, '');
  if (typed) {
    const cut = Math.max(typed.lastIndexOf('\r'), typed.lastIndexOf('\x03'), typed.lastIndexOf('\x15'), typed.lastIndexOf('\x04'));
    r.lineDirty = typed.slice(cut + 1).length > 0;
    if (cut >= 0 && /\r/.test(typed)) scheduleCwdRefresh(key);
  }
  const id = r.sessionId;
  for (let i = 0; i < data.length; ) {
    let end = Math.min(data.length, i + TERM_WRITE_MAX);
    // Never split a surrogate pair between two writes.
    if (end < data.length && /[\ud800-\udbff]/.test(data[end - 1]!)) end--;
    const chunk = data.slice(i, end);
    i = end;
    r.writes = r.writes.then(() => call('term:write', { id, data: chunk })).catch(() => undefined);
  }
}

/** Write to the shell as if typed (commands we send ourselves). */
function writeRaw(key: string, data: string): Promise<unknown> {
  const r = runtimes.get(key);
  if (!r?.sessionId) return Promise.resolve();
  const id = r.sessionId;
  r.writes = r.writes.then(() => call('term:write', { id, data })).catch(() => undefined);
  return r.writes;
}

function ack(r: Runtime): void {
  if (r.acking || !r.pendingAck || !r.sessionId) return;
  const chars = r.pendingAck;
  r.pendingAck = 0;
  r.acking = true;
  void call('term:ack', { id: r.sessionId, chars })
    .catch(() => undefined)
    .finally(() => {
      r.acking = false;
      if (r.pendingAck) ack(r);
    });
}

const cwdTimers = new Map<string, number>();
/** After Enter, read the shell's folder again (for the tab title) once the command had time to run. */
function scheduleCwdRefresh(key: string): void {
  if (!terminal.get().info?.cwdSupported) return;
  window.clearTimeout(cwdTimers.get(key));
  cwdTimers.set(key, window.setTimeout(() => void refreshCwd(key), 500));
}
async function refreshCwd(key: string): Promise<TermCwd | undefined> {
  const t = tabOf(key);
  if (!t?.id || t.status !== 'running') return undefined;
  const c = await call<TermCwd>('term:cwd', { id: t.id }).catch(() => undefined);
  if (c?.ok && c.path !== tabOf(key)?.cwd) patchTab(key, { cwd: c.path });
  return c;
}

let eventsStarted = false;
/** Output, exits and close requests from the main process; theme and setting changes. Called once at start. */
export function startTerminal(): void {
  if (eventsStarted) return;
  eventsStarted = true;
  on<{ id: string; data: string }>('term:data', ({ id, data }) => {
    const key = keyBySession.get(id);
    const r = key ? runtimes.get(key) : undefined;
    if (!r || r.sessionId !== id) return;
    r.lastOutputMs = Date.now();
    r.handle.write(data, () => {
      r.pendingAck += data.length;
      ack(r);
    });
  });
  on<{ id: string; exitCode: number; signal?: number }>('term:exit', ({ id, exitCode, signal }) => {
    const key = keyBySession.get(id);
    if (!key) return;
    keyBySession.delete(id);
    const r = runtimes.get(key);
    if (r?.sessionId === id) r.sessionId = undefined;
    // The session is over; the main process forgets it.
    void call('term:kill', { id }).catch(() => undefined);
    if (tabOf(key)?.id === id) patchTab(key, { status: 'exited', exitCode, signal, id: undefined });
  });
  on<{ quit: boolean; running: Array<{ id: string; shell: string; program?: string; unknown?: boolean }> }>('term:closeRequest', (req) => void answerCloseRequest(req));
  custom.subscribe(() => requestAnimationFrame(restyle));
  let lastSettings = app.get().settings;
  app.subscribe(() => {
    const s = app.get().settings;
    if (s === lastSettings) return;
    const shellChanged = s.terminalShell !== lastSettings.terminalShell || s.terminalCustomPath !== lastSettings.terminalCustomPath || s.terminalCustomArgs !== lastSettings.terminalCustomArgs;
    lastSettings = s;
    restyle();
    if (shellChanged && terminal.get().info) void info(true).catch(() => undefined);
  });
  followPane();
}

function describeRunning(running: Array<{ shell: string; program?: string; unknown?: boolean }>): string[] {
  return running.map((r) => (r.unknown ? `${r.shell}: Orbis Files cannot tell whether a program is running (Windows)` : `${r.shell}: ${r.program ? `“${r.program}”` : 'a program'} is running`));
}

async function answerCloseRequest(req: { quit: boolean; running: Array<{ shell: string; program?: string; unknown?: boolean }> }): Promise<void> {
  const ok = await confirm({
    title: req.quit ? 'Quit while programs run in the terminal?' : 'Close the window while programs run in the terminal?',
    body: `${req.running.length === 1 ? 'A terminal still runs a program' : `${req.running.length} terminals still run programs`}. ${req.quit ? 'Quitting' : 'Closing the window'} ends ${req.running.length === 1 ? 'it' : 'them'}; anything they have not saved is lost.`,
    detail: describeRunning(req.running),
    confirmLabel: req.quit ? 'End programs and quit' : 'End programs and close',
    destructive: true,
  });
  if (ok) await call('term:allowClose', { quit: req.quit }).catch(toastError);
}

// ------------------------------------------------------------------ tabs
export function activateTab(key: string): void {
  terminal.set({ active: key });
  requestAnimationFrame(() => {
    fitActive();
    focusActive();
  });
}

export function focusActive(): void {
  const k = terminal.get().active;
  const r = k ? runtimes.get(k) : undefined;
  r?.handle.focus();
}

/** Close one terminal tab (asks first when a program runs in it). */
export async function closeTab(key?: string): Promise<boolean> {
  const t = tabOf(key);
  if (!t) return false;
  if (t.id && t.status === 'running') {
    const st = await call<TermStatus>('term:status', { id: t.id }).catch(() => undefined);
    if (st && st.busy !== false) {
      const ok = await confirm({
        title: 'Close this terminal?',
        body: st.busy ? `${st.program ? `“${st.program}”` : 'A program'} is still running in it. Closing the terminal ends it.` : 'Orbis Files cannot tell on this system whether a program is still running in it. Closing the terminal ends anything that runs.',
        confirmLabel: 'Close terminal',
        destructive: true,
      });
      if (!ok) return false;
    }
  }
  dispose(t.key);
  const s = terminal.get();
  const idx = s.tabs.findIndex((x) => x.key === t.key);
  const tabs = s.tabs.filter((x) => x.key !== t.key);
  const next = s.active === t.key ? tabs[Math.min(idx, tabs.length - 1)]?.key : s.active;
  terminal.set({ tabs, active: next, open: s.open && tabs.length > 0 });
  if (!tabs.length) returnFocusToPane();
  else requestAnimationFrame(() => {
    fitActive();
    focusActive();
  });
  return true;
}

function dispose(key: string): void {
  const r = runtimes.get(key);
  const t = tabOf(key);
  const id = r?.sessionId ?? t?.id;
  if (id) {
    keyBySession.delete(id);
    void call('term:kill', { id }).catch(() => undefined);
  }
  if (r) {
    r.handle.dispose();
    r.el.remove();
    runtimes.delete(key);
    terminal.set((st) => ({ surfaces: st.surfaces + 1 }));
  }
}

/** Close the panel: every terminal ends (asks first when programs run). */
export async function closeAllTerminals(): Promise<boolean> {
  const s = terminal.get();
  if (!s.tabs.length) {
    terminal.set({ open: false });
    return true;
  }
  const running = await call<Array<{ id: string; shell: string; program?: string; unknown?: boolean }>>('term:running').catch(() => []);
  if (running.length) {
    const ok = await confirm({
      title: 'Close the terminal panel?',
      body: `${running.length === 1 ? 'A terminal still runs a program' : `${running.length} terminals still run programs`}. Closing the panel ends every terminal and what runs in it.`,
      detail: describeRunning(running),
      confirmLabel: 'End programs and close',
      destructive: true,
    });
    if (!ok) return false;
  }
  for (const t of s.tabs) dispose(t.key);
  terminal.set({ tabs: [], active: undefined, open: false, find: { ...terminal.get().find, open: false, result: undefined } });
  returnFocusToPane();
  return true;
}

export async function restartTerminal(key?: string): Promise<void> {
  const t = tabOf(key);
  if (!t || t.status === 'running' || t.status === 'starting') return;
  const r = runtimes.get(t.key);
  r?.handle.write('\r\n\x1b[2m── restarted ──\x1b[0m\r\n', () => undefined);
  patchTab(t.key, { status: 'starting', error: undefined });
  await startSession(t.key, t.cwd || undefined);
}

export function clearTerminal(key?: string): void {
  const t = tabOf(key);
  const r = t ? runtimes.get(t.key) : undefined;
  if (!r) return;
  r.handle.clear();
  r.handle.focus();
}

export function fitActive(): void {
  const k = terminal.get().active;
  const r = k ? runtimes.get(k) : undefined;
  const t = tabOf(k);
  if (!r?.el.isConnected) return;
  if (!r.handle.opened) r.handle.open(r.el);
  const before = { cols: r.handle.cols, rows: r.handle.rows };
  const s = r.handle.fit();
  if (s && t?.id && t.status === 'running' && (s.cols !== before.cols || s.rows !== before.rows || !fittedOnce.has(t.id))) {
    fittedOnce.add(t.id);
    void call('term:resize', { id: t.id, cols: s.cols, rows: s.rows }).catch(() => undefined);
  }
}
const fittedOnce = new Set<string>();

/** The dock attaches every tab's element into its body (only the active one is shown). */
export function attachSurfaces(host: HTMLElement): void {
  for (const [key, r] of runtimes) {
    if (r.el.parentElement !== host) host.appendChild(r.el);
    r.el.hidden = key !== terminal.get().active;
  }
}

// ------------------------------------------------------------------ actions
/** "Go to pane folder": a correctly quoted cd typed into the shell (asks first when a program runs). */
export async function cdToPaneFolder(key?: string): Promise<void> {
  const t = tabOf(key);
  const dir = paneFolder();
  if (!t?.id || t.status !== 'running') return;
  if (!dir) {
    toast({ level: 'info', title: 'The active pane does not show a folder on this computer.' });
    return;
  }
  const st = await call<TermStatus>('term:status', { id: t.id }).catch(() => undefined);
  let clear = true;
  if (st && st.busy !== false) {
    const ok = await confirm({
      title: st.busy ? `${st.program ? `“${st.program}”` : 'A program'} is running in this terminal` : 'Send the folder change anyway?',
      body: st.busy
        ? `The cd command would be typed into ${st.program ? `“${st.program}”` : 'the running program'}, not into the shell. Send it anyway?`
        : 'Orbis Files cannot tell on this system whether the shell is waiting at its prompt. If a program is running, the cd command is typed into that program.',
      confirmLabel: 'Send cd',
    });
    if (!ok) return;
    clear = false;
  }
  let line: string;
  try {
    line = cdCommand(dir, t.flavor);
  } catch (err) {
    toast({ level: 'error', title: 'This folder cannot be typed into this shell', detail: (err as QuoteError).message });
    return;
  }
  await sendCd(t.key, line, clear);
  patchTab(t.key, { cwd: dir, followNote: undefined });
  focusActive();
}

async function sendCd(key: string, line: string, clearLine: boolean): Promise<void> {
  const r = runtimes.get(key);
  const t = tabOf(key);
  if (!r || !t) return;
  // An unsent command line is emptied first (bash and zsh keep it: Ctrl+Y brings it back).
  await writeRaw(key, `${clearLine && r.lineDirty ? clearLineKeys(t.flavor, window.orbis.platform) : ''}${line}\r`);
  r.lineDirty = false;
}

/** "Show terminal folder in pane": read the shell's folder and open it in the active pane. */
export async function showTerminalFolder(key?: string): Promise<void> {
  const t = tabOf(key);
  if (!t?.id || t.status !== 'running') return;
  const c = await call<TermCwd>('term:cwd', { id: t.id }).catch((err) => ({ ok: false as const, reason: (err as Error).message }));
  if (!c.ok) {
    toast({ level: 'warning', title: 'The terminal’s folder is not available', detail: c.reason });
    return;
  }
  patchTab(t.key, { cwd: c.path });
  await navigate(activePane().id, { kind: 'fs', path: c.path });
}

export function toggleFollow(key?: string): void {
  const t = tabOf(key);
  if (!t) return;
  const on = !t.follow;
  patchTab(t.key, { follow: on, followNote: undefined });
  if (on) void followTo(t.key, paneFolder());
}

/**
 * Follow pane. The cd is sent only when the shell is idle at its prompt, which is
 * decided like this (all must hold):
 *  1. the terminal's foreground process group is the shell's own (Linux: /proc tpgid
 *     equals the shell's pgrp; macOS: node-pty's foreground process is the shell);
 *  2. on Linux the shell process itself is not running (state not R);
 *  3. nothing was typed on the command line since the last Enter, Ctrl+C, Ctrl+D or Ctrl+U;
 *  4. no output arrived in the last 300 ms (checked again once after waiting);
 *  5. the shell is not already in that folder.
 * Otherwise nothing is sent and the dock says why. Not offered on Windows (1 cannot be checked).
 */
const followGen = new Map<string, number>();
async function followTo(key: string, dir: string | undefined): Promise<void> {
  const t = tabOf(key);
  const r = runtimes.get(key);
  if (!t?.follow || !t.id || t.status !== 'running' || !r || !dir) return;
  // Only the newest pane change counts: an older check still waiting must not send its (stale) folder.
  const gen = (followGen.get(key) ?? 0) + 1;
  followGen.set(key, gen);
  const stale = () => followGen.get(key) !== gen || !tabOf(key)?.follow || paneFolder() !== dir;
  const note = (followNote: string) => {
    if (!stale()) patchTab(key, { followNote });
  };
  if (r.lineDirty) return note('Not followed: there is unsent text on the command line.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const st = await call<TermStatus>('term:status', { id: t.id }).catch(() => undefined);
    if (!st || st.busy === null) return note('Not followed: this system cannot tell whether the shell is idle.');
    if (st.busy) return note(`Not followed: ${st.program ? `“${st.program}”` : 'a program'} is running.`);
    if (st.shellState === 'R') return note('Not followed: the shell is busy.');
    if (Date.now() - r.lastOutputMs >= 300) break;
    if (attempt === 1) return note('Not followed: the terminal is still printing.');
    await new Promise((res) => setTimeout(res, 350));
    if (stale()) return;
  }
  if (stale()) return;
  if (runtimes.get(key)?.lineDirty) return note('Not followed: there is unsent text on the command line.');
  const c = await call<TermCwd>('term:cwd', { id: t.id }).catch(() => undefined);
  if (stale()) return;
  if (c?.ok && c.path === dir) {
    patchTab(key, { cwd: dir, followNote: undefined });
    return;
  }
  let line: string;
  try {
    line = cdCommand(dir, t.flavor);
  } catch (err) {
    return note(`Not followed: ${(err as Error).message}`);
  }
  await sendCd(key, line, false);
  patchTab(key, { cwd: dir, followNote: undefined });
}

function followPane(): void {
  let last = paneFolder();
  ws.subscribe(() => {
    const dir = paneFolder();
    if (dir === last) return;
    last = dir;
    for (const t of terminal.get().tabs) if (t.follow) void followTo(t.key, dir);
  });
}

/** Paste with the multi-line check (bracketed-paste aware; Settings → Built-in terminal). */
export async function pasteText(text: string, key?: string): Promise<void> {
  const t = tabOf(key);
  const r = t ? runtimes.get(t.key) : undefined;
  if (!t || !r || t.status !== 'running') return;
  // A paste can never end bracketed paste early or start another one.
  const clean = text.replace(/\x1b\[20[01]~/g, '');
  if (!clean) return;
  if (clean.length > 4 * 1024 * 1024) {
    toast({ level: 'warning', title: 'This text is too large to paste into a terminal (over 4 MB).' });
    return;
  }
  const mode = app.get().settings.terminalMultilinePaste;
  const bracketed = r.handle.bracketedPaste;
  if (isMultiline(clean) && (mode === 'always' || (mode === 'auto' && !bracketed))) {
    const lines = clean.replace(/(\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/);
    const ok = await confirm({
      title: `Paste ${lines.length} lines into the terminal?`,
      body: bracketed
        ? 'The program in the terminal receives the text as one paste; it runs nothing until you press Enter.'
        : 'The program in the terminal did not ask for bracketed paste, so each line may run as soon as it arrives.',
      detail: [...lines.slice(0, 8).map((l) => (l.length > 120 ? `${l.slice(0, 120)}…` : l || ' ')), ...(lines.length > 8 ? [`… ${lines.length - 8} more lines`] : [])],
      confirmLabel: 'Paste',
    });
    if (!ok) return;
  }
  r.handle.paste(clean);
  r.handle.focus();
}

export async function pasteFromClipboard(key?: string): Promise<void> {
  const res = await call<{ text: string }>('term:clipboard').catch((err) => {
    toastError(err);
    return undefined;
  });
  if (res?.text) await pasteText(res.text, key);
}

export function copySelection(key?: string): void {
  const t = tabOf(key);
  const r = t ? runtimes.get(t.key) : undefined;
  if (r?.handle.hasSelection()) void call('fs:copyText', { text: r.handle.getSelection() }).catch(toastError);
}

export function selectAllText(key?: string): void {
  const t = tabOf(key);
  if (t) runtimes.get(t.key)?.handle.selectAll();
}

export function hasSelectionIn(key?: string): boolean {
  const t = tabOf(key);
  return !!(t && runtimes.get(t.key)?.handle.hasSelection());
}

/** Files or folders dropped on the terminal: their paths, quoted for this shell, typed at the cursor. */
export async function dropPaths(paths: string[], key?: string): Promise<void> {
  const t = tabOf(key);
  if (!t || t.status !== 'running') return;
  const local = paths.filter((p) => !isRemoteRef(p));
  if (!local.length) {
    toast({ level: 'info', title: 'Items on a server have no path on this computer.', detail: 'Download them first, then drop the copies.' });
    return;
  }
  let text: string;
  try {
    text = quotePaths(local, t.flavor);
  } catch (err) {
    toast({ level: 'error', title: `These names cannot be typed into ${t.shell}`, detail: (err as QuoteError).message });
    return;
  }
  await pasteText(text, t.key);
}

/** Web links from the output open in the browser only after the user agrees (http and https only). */
export async function openLink(uri: string): Promise<void> {
  const url = safeWebLink(uri);
  if (!url) {
    toast({ level: 'info', title: 'Only web links (http, https) open from the terminal.', detail: uri.slice(0, 200) });
    return;
  }
  const ok = await confirm({ title: 'Open this link in your browser?', body: 'The link comes from the terminal output. Open it only if you trust where it points.', detail: [url], confirmLabel: 'Open link' });
  if (ok) await call('term:openLink', { url }).catch(toastError);
}

// ------------------------------------------------------------------ find
export function openFind(): void {
  if (!terminal.get().open) terminal.set({ open: true });
  terminal.set((s) => ({ find: { ...s.find, open: true } }));
  requestAnimationFrame(() => {
    const i = document.querySelector<HTMLInputElement>('.term-find input');
    i?.focus();
    i?.select();
  });
}
export function closeFind(): void {
  const k = terminal.get().active;
  if (k) runtimes.get(k)?.handle.clearSearch();
  terminal.set((s) => ({ find: { ...s.find, open: false, result: undefined, notFound: false } }));
  focusActive();
}
export function setFind(patch: Partial<FindState>): void {
  terminal.set((s) => ({ find: { ...s.find, ...patch } }));
}
export function findInTerminal(dir: 'next' | 'prev', incremental = false): void {
  const s = terminal.get();
  const r = s.active ? runtimes.get(s.active) : undefined;
  if (!r) return;
  if (!s.find.query) {
    r.handle.clearSearch();
    setFind({ result: undefined, notFound: false });
    return;
  }
  const o = { caseSensitive: s.find.caseSensitive, regex: s.find.regex, wholeWord: s.find.wholeWord };
  let found: boolean;
  try {
    found = dir === 'next' ? r.handle.findNext(s.find.query, o) : r.handle.findPrevious(s.find.query, o);
  } catch {
    found = false;
  }
  void incremental;
  setFind({ notFound: !found, ...(found ? {} : { result: { index: -1, count: 0 } }) });
}
/** Tab title: shell and folder ("bash · project"). */
export function tabTitle(t: TermTab): string {
  const home = app.get().known.find((k) => k.id === 'home')?.path;
  return t.cwd ? `${t.shell} · ${folderLabel(t.cwd, home)}` : t.shell;
}
