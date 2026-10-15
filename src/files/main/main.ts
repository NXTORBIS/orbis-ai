import { app, BrowserWindow, dialog, Menu, nativeImage, nativeTheme, Notification, protocol, safeStorage, session, screen } from 'electron';
import { electronSecretBox } from './remote/secrets';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServices, type Services } from './services';
import { registerIpc, handleHostRequest, type HandlerContext } from './ipcHandlers';
import { cancelAllPicksSync, restoreFeeds } from './hostBridge';
import { electronPlatformOps, knownLocations, systemTrash } from './platform';
import { Logger } from './log';
import { parseHostRequestArg, parseProfileArg } from '../shared/integration/host-contract';
import { mediaResponse, thumbResponse } from './mediaProtocol';
import { configureSevenZip } from './tools/sevenZip';
import { scratchRoot } from './tools/archives';
import { ElectronRasterizer } from './ocr/rasterView';
import { applyCustomizationToElectron, interfaceScale } from './customization/ipc';
import { TERMINAL_STATES } from '../shared/operations';
import type { EventChannel } from '../shared/ipc';
import type { ImageCodec } from './media/imageTools';
import { POWER_OPERATION_LABELS } from '../shared/powerTools';

/**
 * Orbis Files — Electron main process.
 * Security posture: sandboxed, context-isolated renderers with no Node access;
 * navigation and new windows blocked; all permission requests denied; local
 * files reach the UI only through validated IPC or the read-only preview
 * protocols below.
 */

app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  { scheme: 'orbis-media', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false, corsEnabled: true } },
  { scheme: 'orbis-thumb', privileges: { standard: false, secure: true, supportFetchAPI: true, stream: false, bypassCSP: false } },
]);

const profileId = parseProfileArg(process.argv) ?? 'default';
if (process.env.ORBIS_USER_DATA) app.setPath('userData', process.env.ORBIS_USER_DATA);
const profileDir = path.join(app.getPath('userData'), 'profiles', profileId);
const logDir = path.join(app.getPath('userData'), 'logs');
const log = new Logger(logDir);
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const RENDERER_INDEX = path.join(RENDERER_DIR, 'index.html');
const rendererDirUrl = pathToFileURL(RENDERER_DIR + path.sep).href;

// One running instance per profile; later launches forward their request.
if (!app.requestSingleInstanceLock({ profileId })) {
  app.quit();
}

let services: Services | undefined;
let handlerCtx: HandlerContext | undefined;
let quitting = false;
const windows = new Set<BrowserWindow>();

function broadcast(channel: EventChannel, payload: unknown): void {
  for (const w of windows) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
}

interface SavedBounds { x?: number; y?: number; width: number; height: number; maximized: boolean }

function restoreBounds(): SavedBounds {
  const saved = services?.catalog.getKv<SavedBounds | null>('window.bounds', null);
  const fallback: SavedBounds = { width: 1360, height: 860, maximized: false };
  if (!saved || typeof saved.width !== 'number') return fallback;
  // Only reuse a position that is still on a connected display.
  const visible = saved.x !== undefined && saved.y !== undefined && screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return saved.x! >= b.x - 50 && saved.y! >= b.y - 50 && saved.x! < b.x + b.width - 100 && saved.y! < b.y + b.height - 100;
  });
  return { width: Math.max(760, saved.width), height: Math.max(520, saved.height), maximized: !!saved.maximized, ...(visible ? { x: saved.x, y: saved.y } : {}) };
}

function openWindow(initialPath?: string): BrowserWindow {
  const bounds = windows.size === 0 ? restoreBounds() : { width: 1200, height: 800, maximized: false };
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d10' : '#f4f6f8',
    title: 'Orbis Files',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      plugins: true, // Chromium's built-in PDF viewer for PDF previews
      additionalArguments: initialPath ? [`--orbis-initial-path=${Buffer.from(initialPath).toString('base64')}`] : [],
    },
  });
  windows.add(win);
  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Interface scale (Customization → Accessibility, Ctrl +/-/0), applied to every page load.
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(services ? interfaceScale(services) : 1));
  // A crashed interface is reloaded (a few times at most); operations run in this process and continue.
  const crashes: number[] = [];
  win.webContents.on('render-process-gone', (_e, d) => {
    log.error('renderer.gone', { reason: d.reason, exitCode: d.exitCode });
    if (d.reason === 'clean-exit' || win.isDestroyed()) return;
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0]! > 60000) crashes.shift();
    if (crashes.length > 3) {
      dialog.showErrorBox('Orbis Files', 'The window stopped responding repeatedly and was not reloaded again. File operations continue; close and reopen the window to try again.');
      return;
    }
    services?.notices.push({ level: 'warning', message: `The window's interface stopped unexpectedly (${d.reason}) and was reloaded.`, detail: 'File operations kept running in the background; check Operations for their results.' });
    // Reload into the saved session only; the window's original start folder is not reopened.
    void win.loadFile(RENDERER_INDEX, { query: { reloaded: '1' } });
  });
  if (process.env.ORBIS_LOG_STDOUT) {
    win.webContents.on('console-message', (_e, level, message, line, source) => log.info('renderer.console', { level, message: message.slice(0, 500), line, source: path.basename(source) }));
    win.webContents.on('did-fail-load', (_e, code, desc) => log.error('renderer.load_failed', { code, desc }));
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const sendState = () => !win.webContents.isDestroyed() && win.webContents.send('win:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused(), platform: process.platform });
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur'] as const) win.on(ev as 'maximize', sendState);

  // Built-in terminal sessions belong to this page: they end when the window closes or its page reloads.
  const wcId = win.webContents.id;
  win.webContents.on('did-navigate', () => {
    terminalCloseApproved.delete(wcId);
    services?.terminals.killOwner(wcId);
  });
  win.on('close', (e) => {
    // Programs running in the window's terminals: the window asks in the app and closes itself when allowed.
    if (terminalsBlockClose(win, false)) {
      e.preventDefault();
      return;
    }
    if (windows.size === 1) {
      saveBounds(win);
      if (!quitting && !confirmQuit(win)) e.preventDefault();
    }
  });
  // The window kept itself open (unsaved changes in the editor: it asks Save / Don't save / Cancel itself),
  // so a quit that was under way is called off; the window closes again on its own when the user decides.
  win.webContents.on('will-prevent-unload', () => {
    quitting = false;
  });
  win.on('closed', () => {
    windows.delete(win);
    terminalCloseApproved.delete(wcId);
    services?.terminals.killOwner(wcId);
  });
  void win.loadFile(RENDERER_INDEX, initialPath ? { query: { path: initialPath } } : undefined);
  return win;
}

function saveBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const b = win.getNormalBounds();
  services?.catalog.setKv('window.bounds', { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
}

/** Windows (WebContents ids) whose user agreed to end the programs running in their terminals. */
const terminalCloseApproved = new Set<number>();
let terminalQuitApproved = false;

/**
 * Closing a window (or quitting) while a program runs in one of its terminals:
 * the window is asked (`term:closeRequest`) and answers with `term:allowClose`,
 * which closes it or quits again. Returns true when the close must wait.
 */
function terminalsBlockClose(win: BrowserWindow, quit: boolean): boolean {
  if (!services || quitting || win.isDestroyed() || win.webContents.isDestroyed()) return false;
  const id = win.webContents.id;
  if (quit ? terminalQuitApproved : terminalCloseApproved.has(id)) return false;
  let running: ReturnType<Services['terminals']['running']>;
  try {
    running = services.terminals.running(id);
  } catch {
    return false;
  }
  if (!running.length) return false;
  win.webContents.send('term:closeRequest', { quit, running });
  if (win.isMinimized()) win.restore();
  win.focus();
  return true;
}

/** Never silently drop running operations when the last window closes. */
function confirmQuit(win: BrowserWindow): boolean {
  const active = services?.ops.list().filter((r) => !TERMINAL_STATES.has(r.state)) ?? [];
  if (!active.length) return true;
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Keep Orbis Files open', 'Cancel operations and quit'],
    defaultId: 0,
    cancelId: 0,
    title: 'Operations in progress',
    message: `${active.length} file operation${active.length === 1 ? ' is' : 's are'} still running.`,
    detail: 'Quitting cancels them. Items already finished stay finished; partial files are removed.',
  });
  if (choice !== 1) return false;
  void shutdownOperations().then(() => {
    quitting = true;
    app.quit();
  });
  return false;
}

async function shutdownOperations(): Promise<void> {
  if (!services) return;
  const active = services.ops.list().filter((r) => !TERMINAL_STATES.has(r.state));
  for (const r of active) {
    try {
      services.ops.cancel(r.id);
    } catch {
      /* already finished */
    }
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && services.ops.list().some((r) => !TERMINAL_STATES.has(r.state))) await new Promise((res) => setTimeout(res, 100));
}

function registerProtocols(): void {
  // Read-only access to previewable media (and fonts) for previews and thumbnails drawn by the window.
  // Paths are absolute and normalized, must be regular files, and only known types are served (see mediaProtocol.ts).
  protocol.handle('orbis-media', (request) => mediaResponse(request.url, request.headers.get('range')));

  // Cached JPEG thumbnails. Keyed by path + size + mtime (+ drawing version) so a changed file gets a new thumbnail.
  const thumbDir = path.join(profileDir, 'thumbs');
  protocol.handle('orbis-thumb', (request) => thumbResponse(request.url, thumbDir, async (p, size) => {
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty() && process.platform !== 'linux') {
      img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size }).catch(() => nativeImage.createEmpty());
    }
    if (img.isEmpty()) return undefined;
    const { width, height } = img.getSize();
    const scale = Math.min(1, size / Math.max(width, height));
    return img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }).toJPEG(82);
  }));
}

/** Bound the thumbnail cache (oldest first) so it never grows without limit. */
async function pruneThumbs(maxBytes = 256 * 1024 * 1024): Promise<void> {
  const dir = path.join(profileDir, 'thumbs');
  const files = await fsp.readdir(dir).catch(() => [] as string[]);
  const stats = await Promise.all(files.map(async (f) => ({ f, st: await fsp.stat(path.join(dir, f)).catch(() => undefined) })));
  let total = stats.reduce((a, x) => a + (x.st?.size ?? 0), 0);
  for (const x of stats.filter((x) => x.st).sort((a, b) => a.st!.mtimeMs - b.st!.mtimeMs)) {
    if (total <= maxBytes) break;
    await fsp.unlink(path.join(dir, x.f)).catch(() => undefined);
    total -= x.st!.size;
  }
}

/**
 * System notification when a longer operation finishes while no Orbis Files
 * window is focused (setting: notifyWhenUnfocused). The text states the real
 * outcome; clicking it brings the window back.
 */
function notifyFinishedOperations(): void {
  const LABEL: Record<string, string> = { copy: 'Copy', move: 'Move', trash: 'Move to Trash', delete: 'Permanent delete', duplicate: 'Duplicate', 'rename-batch': 'Rename', extract: 'Extraction', compress: 'Compression', 'edit-metadata': 'Metadata edit', convert: 'Conversion', 'trash-restore': 'Restore from Trash', 'trash-delete': 'Delete from Trash', sync: 'Synchronization', dedupe: 'Duplicate clean-up', 'checksum-create': 'Checksum file', 'pdf-tools': 'PDF tools', 'find-replace': 'Find and replace', 'text-fix': 'Text fixes', 'snapshot-restore': 'Restore from snapshots', encrypt: 'Encryption', decrypt: 'Decryption', 'share-receive': 'Receiving files', 'image-batch': 'Image processing', backup: 'Backup', 'backup-restore': 'Restore from backup', 'organize-date': 'Organize by date' };
  Object.assign(LABEL, POWER_OPERATION_LABELS);
  const show = (title: string, body: string, silent: boolean) => {
    const n = new Notification({ title, body, silent });
    n.on('click', () => {
      const w = [...windows][0];
      if (w) {
        if (w.isMinimized()) w.restore();
        w.focus();
      }
    });
    n.show();
  };
  // One notification per automatic batch (same setting), with the real outcome.
  services!.automation.on('activity', (a: import('./tools/automation').AutomationActivity) => {
    if (a.state === 'started') return;
    if (!services!.settings.get('notifyWhenUnfocused') || BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
    const verb = { move: 'moved', copy: 'copied', tag: 'tagged', collect: 'added to a collection' }[a.action];
    const body = a.state === 'failed' ? `Failed: ${a.message ?? 'see the rule history.'}` : `${a.done ?? 0} file${a.done === 1 ? '' : 's'} ${verb}${a.skipped ? `, ${a.skipped} skipped` : ''}${a.failed ? `, ${a.failed} failed` : ''}. Undo from the rule's activity.`;
    show(`Rule “${a.ruleName}” ran automatically`, body, a.state !== 'failed' && !a.failed);
  });
  // One notification per backup run (manual or scheduled) and per scheduled synchronization, with the real outcome.
  const unfocused = () => services!.settings.get('notifyWhenUnfocused') && !BrowserWindow.getFocusedWindow() && Notification.isSupported();
  services!.backups.on('run', (ev: import('./backup/BackupService').BackupRunEvent) => {
    if (!unfocused()) return;
    const verb = ev.state === 'completed' ? 'finished' : ev.state === 'cancelled' ? 'stopped' : ev.state === 'failed' ? 'failed' : 'finished with problems';
    show(`${ev.scheduled ? 'Scheduled backup' : 'Backup'} “${ev.jobName}” ${verb}`, ev.message, ev.level === 'success');
  });
  services!.syncSchedules.on('activity', (ev: import('./sync/SyncSchedules').SyncScheduleEvent) => {
    if (!unfocused() || ev.outcome === 'nothing') return;
    const title = ev.outcome === 'synced' ? 'Scheduled sync finished' : ev.outcome === 'failed' ? 'Scheduled sync failed' : 'Scheduled sync needs you';
    show(`${title}: “${ev.pairName}”`, ev.message, ev.outcome === 'synced');
  });
  services!.ops.on('update', (rec: import('../shared/operations').OperationRecord) => {
    if (!TERMINAL_STATES.has(rec.state) || !rec.startedMs || !rec.finishedMs) return;
    if (rec.origin.startsWith('rule-auto:')) return; // reported per batch above
    if (rec.type === 'backup' || rec.origin.startsWith('sync-schedule:')) return; // reported per run below
    if (rec.finishedMs - rec.startedMs < 3000) return;
    if (!services!.settings.get('notifyWhenUnfocused') || BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
    const s = rec.summary ?? { done: 0, skipped: 0, failed: 0, cancelled: 0 };
    const what = LABEL[rec.type] ?? 'Operation';
    const body =
      rec.state === 'completed' ? `${s.done} item${s.done === 1 ? '' : 's'} done${s.skipped ? `, ${s.skipped} skipped` : ''}.`
        : rec.state === 'completed_with_errors' ? `${s.done} done, ${s.failed} failed. Open Operations for details.`
          : rec.state === 'cancelled' ? 'Cancelled.' : `Failed: ${rec.error?.message ?? 'see Operations for details.'}`;
    show(`${what} ${rec.state === 'completed' ? 'finished' : rec.state === 'cancelled' ? 'cancelled' : rec.state === 'failed' ? 'failed' : 'finished with problems'}`, body, rec.state === 'completed');
  });
}

/**
 * The platform codec for batch image tools: decodes PNG/JPEG to premultiplied
 * 32-bit pixels (EXIF orientation is NOT applied by nativeImage; the runner
 * applies it) and encodes PNG/JPEG. WebP is not offered here (the window does it).
 */
const nativeImageCodec: ImageCodec = {
  async decode(p) {
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return undefined;
    const { width, height } = img.getSize();
    const bmp = img.toBitmap();
    if (bmp.length !== width * height * 4) return undefined;
    return { data: new Uint8Array(bmp.buffer, bmp.byteOffset, bmp.length), width, height, premultiplied: true };
  },
  async encode(img, format, quality) {
    if (format === 'webp') return undefined;
    const n = nativeImage.createFromBitmap(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { width: img.width, height: img.height });
    if (n.isEmpty()) return undefined;
    return format === 'png' ? n.toPNG() : n.toJPEG(Math.max(1, Math.min(100, quality)));
  },
};

/** Image conversion with the platform codec (PNG and JPEG on every platform). */
async function nativeEncodeImage(p: string, opts: { format: 'png' | 'jpeg'; quality: number; maxDimension?: number }): Promise<Buffer | undefined> {
  let img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return undefined;
  const { width, height } = img.getSize();
  if (opts.maxDimension && Math.max(width, height) > opts.maxDimension) {
    const scale = opts.maxDimension / Math.max(width, height);
    img = img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' });
  }
  return opts.format === 'png' ? img.toPNG() : img.toJPEG(Math.max(1, Math.min(100, opts.quality)));
}

/** 9×8 bitmap for perceptual hashing; undefined for formats the platform codec cannot read. */
async function nativeDecodeSmall(p: string): Promise<{ data: Uint8Array; width: number; height: number; order: 'bgra' } | undefined> {
  const img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return undefined;
  const small = img.resize({ width: 9, height: 8, quality: 'good' });
  const bmp = small.toBitmap();
  if (bmp.length < 9 * 8 * 4) return undefined;
  return { data: new Uint8Array(bmp.buffer, bmp.byteOffset, bmp.length), width: 9, height: 8, order: 'bgra' };
}

async function applyPendingRestore(dbPath: string): Promise<void> {
  const pending = `${dbPath}.restore-pending`;
  if (fs.existsSync(pending)) {
    await fsp.rename(pending, dbPath);
    log.info('db.restored_from_backup');
  }
}

app.on('second-instance', (_e, argv) => {
  const { request, error } = parseHostRequestArg(argv);
  const target = [...windows][0];
  const cliPath = argv.find((a) => !a.startsWith('-') && path.isAbsolute(a) && fs.existsSync(a) && !a.endsWith('.cjs') && !/electron/i.test(path.basename(a)));
  if (cliPath && !request) {
    openWindow(cliPath);
    return;
  }
  if (error) log.warn('host.invalid_request', { error });
  if (request && handlerCtx) handleHostRequest(request, handlerCtx, target);
  else if (target) {
    if (target.isMinimized()) target.restore();
    target.focus();
  }
});

app.whenReady().then(async () => {
  // No default menu on Windows/Linux (its reload/devtools shortcuts would bypass the app's own);
  // a minimal standard menu on macOS for Quit, Edit and Window roles.
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      : null,
  );
  // Deny every permission (camera, notifications, geolocation…) — none are needed.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  void log.prune();
  log.info('app.start', { version: app.getVersion(), electron: process.versions.electron, platform: process.platform, profile: profileId });
  const dbPath = path.join(profileDir, 'orbis-files.db');
  await fsp.mkdir(profileDir, { recursive: true });
  await applyPendingRestore(dbPath);
  configureSevenZip({ wasmPath: path.join(__dirname, '..', 'wasm', '7zz.wasm'), workerScript: path.join(__dirname, 'sevenzip-worker.cjs') });
  try {
    services = await createServices({
      profileId,
      profileDir,
      wasmDir: path.join(__dirname, '..', 'wasm'),
      platform: electronPlatformOps,
      log,
      appVersion: app.getVersion(),
      media: { encodeImage: nativeEncodeImage, decodeSmallImage: nativeDecodeSmall, imageCodec: nativeImageCodec },
      trash: systemTrash,
      secrets: electronSecretBox(safeStorage),
      ocr: { defaultFolders: async () => (await knownLocations()).filter((k) => k.id === 'pictures' || k.id === 'documents').map((k) => k.path) },
    });
    // Text recognition renders PDF pages in a hidden, sandboxed page of its own (created on first use).
    services.ocr.rasterizer = new ElectronRasterizer({ html: path.join(__dirname, '..', 'raster', 'raster.html'), preload: path.join(__dirname, '..', 'preload', 'raster.cjs'), log: (event, fields) => log.info(event, fields) });
  } catch (err) {
    const id = log.error('app.startup_failed', { message: (err as Error).message });
    dialog.showErrorBox('Orbis Files could not start', `${(err as Error).message}\n\nError ${id}. Logs: ${logDir}`);
    app.exit(1);
    return;
  }
  log.verbose = services.settings.get('diagnosticsVerbose');
  restoreFeeds(services);
  applyCustomizationToElectron(services);
  registerProtocols();
  void pruneThumbs();
  handlerCtx = {
    services,
    rendererDirUrl,
    openWindow,
    broadcast,
    host: { status: 'standalone' },
    logPath: path.join(logDir, `orbis-files-${new Date().toISOString().slice(0, 10)}.log`),
    dbPath,
    terminalClose: {
      allowClose: (e, quit) => {
        const w = BrowserWindow.fromWebContents(e.sender);
        if (quit) {
          terminalQuitApproved = true;
          app.quit();
          return;
        }
        terminalCloseApproved.add(e.sender.id);
        w?.close();
      },
    },
  };
  registerIpc(handlerCtx);
  notifyFinishedOperations();
  services.indexer.start();
  // Rule automation runs only while the app is open; it starts watching now (unless paused).
  services.automation.refresh();
  // A folder or file path on the command line opens there (e.g. "Open with Orbis Files").
  const cliPath = process.argv.slice(app.isPackaged ? 1 : 2).find((a) => !a.startsWith('-') && path.isAbsolute(a) && fs.existsSync(a));
  const first = openWindow(cliPath);
  // Scheduled backups and sync pairs run only while the app is open: "on start" tasks and missed runs
  // (catch-up) start once the first window has loaded.
  first.webContents.once('did-finish-load', () => void services!.scheduler.start());
  // "Make text in images searchable" (opt-in) starts its first run a little after start-up.
  first.webContents.once('did-finish-load', () => services!.ocr.index.start());
  const { request, error } = parseHostRequestArg(process.argv);
  if (error) services.notices.push({ level: 'warning', message: error });
  if (request) first.webContents.once('did-finish-load', () => handleHostRequest(request, handlerCtx!, first));

  // End-to-end UI automation hook. Development builds only: never active in a packaged app.
  if (!app.isPackaged && process.env.ORBIS_E2E_SCRIPT) {
    first.webContents.once('did-finish-load', () => {
      void (async () => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const run = require(process.env.ORBIS_E2E_SCRIPT!) as (h: unknown) => Promise<void>;
          await run({ win: first, app, services, log, windows });
        } catch (err) {
          log.error('e2e.failed', { message: (err as Error).message, stack: (err as Error).stack?.split('\n').slice(0, 4).join(' | ') });
        } finally {
          quitting = true;
          app.quit();
        }
      })();
    });
  }

  if (process.env.ORBIS_SMOKE_SCREENSHOT) {
    // Used by scripts/smoke.mjs: capture the window after it renders, then exit.
    first.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const img = await first.webContents.capturePage();
        await fsp.writeFile(process.env.ORBIS_SMOKE_SCREENSHOT!, img.toPNG());
        log.info('smoke.captured', { bytes: img.toPNG().length });
        quitting = true;
        app.quit();
      }, Number(process.env.ORBIS_SMOKE_DELAY ?? 2500)),
    );
  }
});

app.on('activate', () => {
  if (services && windows.size === 0) openWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitting) app.quit();
});

app.on('before-quit', (e) => {
  if (quitting) return;
  for (const w of windows) {
    if (terminalsBlockClose(w, true)) {
      e.preventDefault();
      return;
    }
  }
  const win = [...windows][0];
  if (win && !confirmQuit(win)) {
    e.preventDefault();
    terminalQuitApproved = false;
  }
  else quitting = true;
});

app.on('will-quit', () => {
  services?.indexer.stop();
  // Local-network shares never outlive the app: their ports are closed now.
  services?.shares.stopAll('quit');
  services?.automation.stop();
  services?.scheduler.stop();
  // Built-in terminal sessions are never kept or restored: their shells end now.
  services?.terminals.killAll();
  // Text recognition threads and the hidden PDF page renderer end with the app.
  services?.ocr.stop();
  (services?.ocr.rasterizer as ElectronRasterizer | undefined)?.dispose();
  // Remote connections close; opened copies without unsaved edits are deleted.
  services?.remote.closeAll();
  services?.remote.cleanupCopiesSync();
  // A host waiting on a pick request gets a "cancelled" answer rather than silence.
  cancelAllPicksSync();
  // Private scratch copies (nested archives, listings) never outlive the session.
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  try {
    services?.db.flushSync();
  } catch (err) {
    log.error('db.flush_failed', { message: (err as Error).message });
  }
  log.info('app.quit');
  log.close();
});

process.on('uncaughtException', (err) => {
  log.error('main.uncaught', { message: err.message, stack: err.stack?.split('\n').slice(0, 6).join(' | ') });
});
process.on('unhandledRejection', (err) => {
  log.error('main.unhandled_rejection', { message: (err as Error)?.message ?? String(err) });
});
