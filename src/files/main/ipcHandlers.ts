import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, Notification, safeStorage, shell, webContents, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { InvokeSchemas, type InvokeChannel, type EventChannel } from '../shared/ipc';
import { makeError, OrbisError, toOrbisError, type Result } from '../shared/errors';
import type { Services } from './services';
import * as FS from './fs/FileSystemService';
import { childPath, expandUserInput, isWithin, requireAbsolute, uniqueName } from './fs/paths';
import { listVolumes } from './fs/volumes';
import { sniffFile } from './fs/sniff';
import { checkScope, isOrbisOnly, libraryRoot, setOrbisOnly } from './orbisScope';
import { canOpenSystemTrash, detectCapabilities, executableReason, knownLocations, openPath, openSystemTrash, reveal, systemTrashName } from './platform';
import type { TrashListing } from '../shared/trash';
import { parseQuery, QueryError } from './search/query';
import { runSearch } from './search/SearchEngine';
import { compareDirectories, diffStructured, diffText, findDuplicates, scanStorage } from './tools/analysis';
import { effectiveLimits, extractEntryToScratch, listArchive, scratchRoot, testArchive } from './tools/archives';
import { previewBulkRename } from './tools/bulkRename';
import { RenamePresetStore } from './tools/renamePresets';
import { listOpenAiModels } from './ai/OpenAiCompatAdapter';
import type { ProviderKind } from './ai/ProviderRegistry';
import { AI_CONTRACT_VERSION } from '../shared/integration/ai-contract';
import { HOST_CONTRACT_VERSION, type HostRequest } from '../shared/integration/host-contract';
import { MIGRATIONS } from './store/migrations';
import { isTrustedSenderUrl } from './protocolPaths';
import { ownerNames } from './fs/owners';
import { resolveShortcut } from './fs/shortcuts';
import { summarize } from '../shared/media';
import { launchWith, listOpenWith } from './launch/openWith';
import { officePreview } from './preview/office';
import { detectProject } from './library/projects';
import { applyRule, rollbackRuleRun } from './tools/rules';
import { recentChanges, TimelineWatcher } from './tools/timeline';
import { readMetadata } from './media/metadata';
import { outputName, planImage } from '../shared/imageTools';
import { storeRendererThumb } from './thumbs';
import { planOrganize } from './media/organize';
import { isFontExt, readFontInfo } from './media/fontInfo';
import { findSimilarImages } from './media/similar';
import { detectFfmpeg } from './media/convert';
import { PauseGate } from './jobs/PauseGate';
import type { AppInfo } from '../shared/model';
import type { ShareSnapshot, ShareUploadEvent } from '../shared/share';
import { checkPassword } from './tools/fileCrypto';
import { applyCustomizationToElectron, customizationHandlers } from './customization/ipc';
import { productivityHandlers } from './productivityIpc';
import { editorHandlers } from './editorIpc';
import { remoteHandlers } from './remote/ipc';
import { writeClipText } from './clip';
import { s3Handlers } from './remote/s3Ipc';
import { terminalHandlers, type TerminalCloseHooks } from './terminal/ipc';
import { powerToolsHandlers } from './powerToolsIpc';
import { mediaHandlers } from './mediaIpc';
import { ocrHandlers } from './ocr/ipc';
import { screenshotHandlers } from './screenshot/ipc';
import { viewerHandlers } from './viewerIpc';
import { archiveEditHandlers } from './archiveEditIpc';
import { downloadHandlers } from './downloadIpc';
import { playlistHandlers } from './playlistIpc';
import { cryptoHandlers } from './cryptoIpc';
import { dashboardHandlers } from './dashboardIpc';
import { enhancedViewerHandlers } from './enhancedViewerIpc';
import { scanDiskUsage } from './tools/diskUsage';
import { getQuickLookData } from './tools/quicklook';
import { sqliteHandlers } from './tools/sqliteViewer';
import { colorExtractHandlers } from './tools/colorExtractor';
import { hexEditorHandlers } from './tools/hexEditor';
import { searchFileContents } from './tools/contentSearch';
import { extractWaveform } from './tools/audioWaveform';
import { readFileMetadata, stripAllExif, updateDateTime } from './tools/metadataEditor';
import { getPermissions, setPermissions, changeOwner, setPermissionsRecursive } from './tools/permissionsEditor';
import { imageCropRotateHandlers } from './imageCropRotate';
import { videoTimelineHandlers } from './videoTimeline';
import { snippetHandlers } from './snippets';
import { conversionPipelineHandlers, runPipeline } from './conversionPipeline';
import { volumeMonitorHandlers } from './volumeMonitor';
import { colorTagHandlers, ensurePresets as ensureColorTagPresets } from './tools/colorTags';
import { bookmarkHandlers } from './tools/bookmarks';
import { recycleBinHandlers } from './tools/recycleBin';
import { spacesHandlers } from './tools/spaces';
import { recentFilesHandlers } from './tools/recentFiles';
import { cloudMountHandlers } from './tools/cloudMount';
import { clipboardHistoryHandlers, restorePinnedClipItems } from './tools/clipboardHistory';
import { archiveManagerHandlers } from './tools/archiveManager';
import { macroHandlers } from './tools/macroRecorder';
import { folderWatchHandlers } from './tools/folderWatcher';
import { fileVersionHandlers } from './tools/fileVersions';
import { universeHandlers } from './universe/universeHandlers';
import type { SmartFolderQuery } from './store/Catalog';
import { AiProviderOfferSchema, FILES_SETTINGS_ENTRY_POINTS } from './../shared/integration/host-adapters';
import { hashAndRecord } from './store/Checksums';
import { verifyChecksumFile } from './tools/checksumFiles';
import { pdfInfo, PDF_MAX_BYTES } from './tools/pdfTools';
import { previewReplacements, searchInFiles } from './tools/findReplace';
import { previewTextFixes } from './tools/textFixes';
import { createFromTemplate, resolveTemplatesFolder, templatesListing } from './fs/templates';
import { detectTerminal, openTerminal } from './launch/terminal';
import { rankCandidates } from '../shared/fuzzy';
import { checkCanSwitch, checkProfileId, createProfile, deleteProfile, listProfiles, relaunchArgs } from './profiles';
import { addPendingPick, answerPick, emitHostEvent, pendingPicks, registerEventSink, registerFeed, unregisterEventSink, unregisterFeed, writeReplyFile, writeStatus } from './hostBridge';

type Handler = (payload: never, event: IpcMainInvokeEvent) => unknown;

/** 16×16 drag image (accent-coloured document glyph). */
const DRAG_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAN0lEQVR4nGNgoCaIWfXiPzaMLkfIgCh0jCQfRZEBMDUUGUBMGGAYgIZJd8GoASPSAIIYpwHkAACTNUOylr+RAgAAAABJRU5ErkJggg==';

export interface HandlerContext {
  services: Services;
  rendererDirUrl: string;
  openWindow: (initialPath?: string) => BrowserWindow;
  broadcast: (channel: EventChannel, payload: unknown) => void;
  host: { status: 'standalone' | 'connected'; lastRequestMs?: number; lastRequestType?: string };
  logPath: string;
  dbPath: string;
  /** Closing a window or quitting after the user agreed to end running terminal programs. */
  terminalClose: TerminalCloseHooks;
}

/** Send an event to one renderer, ignoring destroyed senders. */
/** Events reach every frame of the window: the Files screen runs in a frame of its own. */
function sendFrames(wc: WebContents, channel: string, payload: unknown): void {
  if (wc.isDestroyed()) return;
  try {
    for (const f of wc.mainFrame.framesInSubtree) f.send(channel, payload);
  } catch {
    wc.send(channel, payload);
  }
}

function sendTo(wc: WebContents, channel: EventChannel, payload: unknown): void {
  sendFrames(wc, `${eventPrefix}${channel}`, payload);
}

let eventPrefix = '';

export function registerIpc(ctx: HandlerContext, channelPrefix = ''): void {
  eventPrefix = channelPrefix;
  const { services: s } = ctx;
  const listings = new Map<string, AbortController>();
  const searches = new Map<string, AbortController>();
  const jobs = new Map<string, { ac: AbortController; gate?: PauseGate }>();
  /** Latest quick-switcher request per window (older ones stop early). */
  const quickFindLatest = new Map<number, string>();
  /** Folder watchers per window, reference-counted: several tabs can show the same folder. */
  const watchers = new Map<number, Map<string, { w: fs.FSWatcher; timer?: NodeJS.Timeout; refs: number }>>();
  /** Recent changes timeline watchers, one per window. */
  const timelineWatchers = new Map<number, TimelineWatcher>();
  const timelineCleanup = new Set<number>();
  let sessionToken: string | undefined;
  const renamePresets = new RenamePresetStore(s.catalog);
  // Rule automation: status changes, batches and notices go to every window.
  s.automation.on('changed', () => ctx.broadcast('automation:changed', s.automation.status()));
  s.automation.on('activity', (a) => ctx.broadcast('automation:activity', a));
  s.automation.on('notice', (n) => ctx.broadcast('automation:activity', { notice: n }));
  // Backups and schedules: lists change, runs finish, scheduled work reports its outcome.
  s.backups.on('changed', () => ctx.broadcast('backup:changed', {}));
  s.backups.on('run', (ev) => ctx.broadcast('backup:activity', ev));
  s.scheduler.on('changed', (st) => ctx.broadcast('schedule:changed', st));
  s.syncSchedules.on('changed', () => ctx.broadcast('schedule:changed', s.scheduler.status()));
  s.syncSchedules.on('activity', (ev) => ctx.broadcast('schedule:activity', ev));
  // Download manager: wire progress and state change broadcasts.
  s.dl.onProgress = (ev) => ctx.broadcast('download:progress', ev);
  s.dl.onStateChange = (ev) => ctx.broadcast('download:state', ev);
  /** Where "Import a copy" puts files: the configured folder, or Documents/Orbis Library. */
  const importFolder = async (): Promise<string> => {
    return path.join(libraryRoot(), 'Imported');
  };
  /** Tell every window the Trash changed (debounced; from the watchers and from finished Trash operations). */
  let trashTimer: NodeJS.Timeout | undefined;
  const trashChanged = () => {
    clearTimeout(trashTimer);
    trashTimer = setTimeout(() => ctx.broadcast('trash:changed', {}), 300);
  };
  const searchCtx = () => ({ tagLookup: (n: string) => s.catalog.pathsWithTagName(n), catalog: s.catalog.searchLookups(), metaLookup: async (file: string) => summarize(await s.metadata.read(file)) });

  const handlers: { [C in InvokeChannel]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown } = {
    // ------------------------------------------------------------------ app / window
    'app:info': (): AppInfo => ({
      name: 'Orbis Files',
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      userDataPath: s.profileDir,
      dbPath: ctx.dbPath,
      logPath: ctx.logPath,
    }),
    'app:startupNotices': () => s.notices,
    'app:thumbCache': async () => {
      const dir = path.join(s.profileDir, 'thumbs');
      const files = await fsp.readdir(dir).catch(() => [] as string[]);
      let bytes = 0;
      for (const f of files) bytes += (await fsp.stat(path.join(dir, f)).catch(() => undefined))?.size ?? 0;
      return { files: files.length, bytes };
    },
    'app:clearThumbCache': async () => {
      const dir = path.join(s.profileDir, 'thumbs');
      const files = await fsp.readdir(dir).catch(() => [] as string[]);
      let removed = 0;
      for (const f of files) {
        if (!f.endsWith('.jpg')) continue;
        await fsp.unlink(path.join(dir, f)).then(() => removed++, () => undefined);
      }
      return { removed };
    },
    'win:minimize': (_p, e) => BrowserWindow.fromWebContents(e.sender)?.minimize(),
    'win:toggleMaximize': (_p, e) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (w?.isMaximized()) w.unmaximize();
      else w?.maximize();
      return w?.isMaximized();
    },
    'win:close': (_p, e) => BrowserWindow.fromWebContents(e.sender)?.close(),
    'win:state': (_p, e) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      return { maximized: !!w?.isMaximized(), fullscreen: !!w?.isFullScreen(), focused: !!w?.isFocused(), platform: process.platform };
    },
    'win:new': (p) => {
      ctx.openWindow(p.path);
    },
    'win:setFullScreen': (p, e) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w) throw makeError('unavailable', 'win.setFullScreen');
      w.setFullScreen(p.on);
      return { fullscreen: p.on };
    },

    // ------------------------------------------------------------------ filesystem
    'fs:capabilities': () => detectCapabilities(),
    'fs:owners': (p) => ownerNames(p.uids, p.gids),
    'fs:openWithApps': async (p) => {
      const target = requireAbsolute(p.path, 'fs.openWith');
      const sniffed = await sniffFile(target).catch(() => undefined);
      return listOpenWith(target, sniffed?.mime);
    },
    'fs:openWith': async (p) => {
      const target = requireAbsolute(p.path, 'fs.openWith');
      await fsp.access(target).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'fs.openWith', target, 'no'));
      });
      const sniffed = await sniffFile(target).catch(() => undefined);
      const r = await launchWith(target, p.appId, sniffed?.mime);
      s.log.info('fs.openWith', { app: r.app });
      // Temporary copies of archive entries are removed at quit; they are not remembered as recents.
      if (s.settings.all().rememberRecents && !isWithin(scratchRoot, target)) s.catalog.recordRecent(target, 'file');
      return r;
    },
    'fs:chmod': async (p) => {
      const target = requireAbsolute(p.path, 'fs.chmod');
      const st = await fsp.lstat(target).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'fs.chmod', target, 'no'));
      });
      if (st.isSymbolicLink()) throw makeError('unsupported', 'fs.chmod', { target, message: 'Permissions of a link are not changed; change them on the item it points to.' });
      await fsp.chmod(target, p.mode).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'fs.chmod', target, 'no'));
      });
      const after = await FS.statPath(target);
      if (process.platform !== 'win32' && ((after.mode ?? 0) & 0o7777) !== p.mode) throw makeError('io', 'fs.chmod', { target, message: 'The file system did not apply the requested permissions.' });
      s.log.info('fs.chmod', { target, mode: p.mode.toString(8) });
      return after;
    },
    'meta:read': (p) => s.metadata.read(requireAbsolute(p.path, 'meta.read'), p.includeLocation),
    'meta:summaries': (p) => s.metadata.summaries(p.paths),
    'thumb:store': async (p) => {
      await storeRendererThumb(path.join(s.profileDir, 'thumbs'), requireAbsolute(p.path, 'thumb.store'), p.size, Buffer.from(p.jpegBase64, 'base64')).catch((err) => {
        throw makeError('validation', 'thumb.store', { message: (err as Error).message });
      });
    },
    'tool:similarImages': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => findSimilarImages(p.roots.map((r) => requireAbsolute(r, 'tool.similar')), s.decodeSmallImage ?? (async () => undefined), { threshold: p.threshold, signal, onProgress: progress, gate })),
    'convert:capabilities': async () => ({ ffmpeg: await detectFfmpeg(), images: { input: ['png', 'jpg', 'jpeg'], rendererInput: ['gif', 'webp', 'bmp', 'avif', 'ico'], output: ['png', 'jpeg', 'webp'] } }),
    'preview:office': async (p) => {
      const target = requireAbsolute(p.path, 'preview.office');
      const st = await fsp.stat(target).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'preview.office', target, 'no'));
      });
      if (st.size > 200 * 1024 * 1024) throw makeError('unsupported', 'preview.office', { target, message: 'This document is too large to preview.' });
      return officePreview(target).catch((err) => {
        throw makeError('unsupported', 'preview.office', { target, message: `This document could not be previewed: ${(err as Error).message}` });
      });
    },
    'fs:knownLocations': () => knownLocations(),
    'fs:volumes': () => listVolumes(),
    'fs:resolve': async (p) => {
      const resolved = expandUserInput(p.input, p.base);
      try {
        const st = await fsp.stat(resolved);
        return { path: resolved, exists: true, kind: st.isDirectory() ? 'directory' : 'file' };
      } catch (err) {
        return { path: resolved, exists: false, error: toOrbisError(err, 'fs.resolve', resolved, 'no') };
      }
    },
    'fs:stat': (p) => FS.statPath(p.path),
    'fs:listStart': (p, e) => {
      const listingId = p.listingId ?? crypto.randomUUID();
      if (listings.has(listingId)) throw makeError('validation', 'fs.list', { message: 'This listing id is already in use.' });
      const ac = new AbortController();
      listings.set(listingId, ac);
      void (async () => {
        let count = 0;
        try {
          for await (const batch of FS.listDirectory(p.path, { showHidden: p.showHidden, signal: ac.signal })) {
            count += batch.length;
            sendTo(e.sender, 'fs:listBatch', { listingId, entries: batch, done: false });
          }
          sendTo(e.sender, 'fs:listBatch', { listingId, entries: [], done: true, count });
        } catch (err) {
          sendTo(e.sender, 'fs:listBatch', { listingId, entries: [], done: true, count, error: toOrbisError(err, 'fs.list', p.path, 'no') });
        } finally {
          listings.delete(listingId);
        }
      })();
      return { listingId };
    },
    'fs:listCancel': (p) => listings.get(p.listingId)?.abort(),
    'fs:mkdir': async (p) => {
      const entry = await FS.makeDirectory(p.parent, p.name);
      s.indexer.touch([entry.path]);
      return entry;
    },
    'fs:createFile': async (p) => {
      const entry = await FS.createFile(p.parent, p.name, p.template);
      s.indexer.touch([entry.path]);
      return entry;
    },
    'fs:rename': async (p) => {
      const before = requireAbsolute(p.path, 'fs.rename');
      const entry = await FS.renamePath(before, p.newName);
      s.catalog.onMoved(before, entry.path);
      s.shelf.onMoved(before, entry.path);
      s.indexer.touch([before, entry.path]);
      return entry;
    },
    'fs:validateName': (p) => FS.checkName(p.parent, p.name),
    'fs:open': async (p) => {
      const target = requireAbsolute(p.path, 'fs.open');
      const st = await fsp.stat(target).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'fs.open', target, 'no'));
      });
      if (st.isFile() && !p.allowExecutable) {
        const reason = await executableReason(target);
        if (reason) return { opened: false, needsConfirmation: true, reason };
      }
      await openPath(target);
      if (s.settings.all().rememberRecents && !isWithin(scratchRoot, target)) s.catalog.recordRecent(target, st.isDirectory() ? 'directory' : 'file');
      return { opened: true };
    },
    'fs:reveal': (p) => reveal(requireAbsolute(p.path, 'fs.reveal')),
    'fs:readText': (p) => FS.readText(p.path, Math.min(p.maxBytes ?? s.settings.get('previewMaxTextBytes'), 64 * 1024 * 1024), p.offset ?? 0),
    'fs:readHead': async (p) => (await FS.readHead(p.path, p.bytes)).toString('base64'),
    // SHA-256 results are stored (keyed by size and modification time) when the file did not change while it was read.
    'fs:hash': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => hashAndRecord(s.checksums, p.path, p.algorithm, (done, total) => progress({ done, total }), signal, gate)),
    'checksum:get': (p) => s.checksums.get(p.paths),
    'fs:folderSize': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => FS.folderSize(p.path, signal, (t) => progress(t), gate)),
    'fs:childFolderSizes': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => FS.childFolderSizes(requireAbsolute(p.path, 'fs.childFolderSizes'), signal, (x) => progress(x), gate, { skipHidden: p.skipHidden })),
    'fs:copyFileText': async (p) => {
      const r = await FS.readUtf8Text(p.path);
      await writeClipText(r.text);
      return { bytes: r.bytes, characters: r.text.length };
    },
    'fs:templates': () => templatesListing(s.settings.get('templatesFolder')),
    'fs:createFromTemplate': async (p) => {
      const where = await resolveTemplatesFolder(s.settings.get('templatesFolder'));
      const entry = await createFromTemplate(p.parent, p.name, p.template, where.folder);
      s.indexer.touch([entry.path]);
      return entry;
    },
    'fs:terminalInfo': async () => {
      const t = await detectTerminal();
      return t ? { label: t.label, via: t.via } : null;
    },
    'fs:openTerminal': async (p) => {
      const dir = requireAbsolute(p.path, 'fs.openTerminal');
      const t = await detectTerminal();
      if (!t) throw makeError('unavailable', 'fs.openTerminal', { message: 'No terminal application was found on this system (checked $TERMINAL, x-terminal-emulator and common terminals on PATH).' });
      await openTerminal(dir, t);
      s.log.info('fs.openTerminal', { terminal: t.label, via: t.via });
      return { label: t.label };
    },
    'fs:jobCancel': (p) => jobs.get(p.jobId)?.ac.abort(),
    'fs:jobPause': (p) => {
      const j = jobs.get(p.jobId);
      if (!j) throw makeError('not_found', 'job.pause', { message: 'This task has already finished.' });
      if (!j.gate) throw makeError('unsupported', 'job.pause', { message: 'This task cannot be paused; it can only be cancelled.' });
      j.gate.pause();
      return { paused: j.gate.isPaused };
    },
    'fs:jobResume': (p) => {
      const j = jobs.get(p.jobId);
      if (!j) throw makeError('not_found', 'job.resume', { message: 'This task has already finished.' });
      j.gate?.resume();
      return { paused: !!j.gate?.isPaused };
    },
    'fs:resolveShortcut': (p) => resolveShortcut(requireAbsolute(p.path, 'fs.resolveShortcut'), process.platform === 'win32' ? (f) => shell.readShortcutLink(f) : undefined).then((r) => r ?? null),
    'fs:sniff': (p) => sniffFile(requireAbsolute(p.path, 'fs.sniff')),
    'fs:watch': (p, e) => {
      const dir = requireAbsolute(p.path, 'fs.watch');
      const id = e.sender.id;
      let map = watchers.get(id);
      if (!map) {
        map = new Map();
        watchers.set(id, map);
        e.sender.once('destroyed', () => {
          for (const v of watchers.get(id)?.values() ?? []) v.w.close();
          watchers.delete(id);
        });
      }
      const existing = map.get(dir);
      if (existing) {
        existing.refs++;
        return true;
      }
      try {
        const entry: { w: fs.FSWatcher; timer?: NodeJS.Timeout; refs: number } = {
          refs: 1,
          w: fs.watch(dir, { persistent: false }, () => {
            clearTimeout(entry.timer);
            entry.timer = setTimeout(() => sendTo(e.sender, 'fs:changed', { path: dir }), 250);
          }),
        };
        entry.w.on('error', () => {
          entry.w.close();
          map.delete(dir);
          sendTo(e.sender, 'fs:changed', { path: dir, unavailable: true });
        });
        map.set(dir, entry);
        return true;
      } catch {
        return false; // watching unsupported here; the UI offers Refresh
      }
    },
    'fs:unwatch': (p, e) => {
      const map = watchers.get(e.sender.id);
      const entry = map?.get(p.path);
      if (!entry || --entry.refs > 0) return;
      entry.w.close();
      clearTimeout(entry.timer);
      map!.delete(p.path);
    },
    'fs:pickDirectory': async (p, e) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      const r = await dialog.showOpenDialog(w!, { title: p.title ?? 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    'fs:createSymlink': async (p) => {
      if (process.platform === 'win32') throw makeError('unsupported', 'fs.createSymlink', { message: 'Creating links on Windows requires Developer Mode or administrator rights and is not offered.' });
      const target = requireAbsolute(p.target, 'fs.createSymlink');
      const link = childPath(requireAbsolute(p.parent, 'fs.createSymlink'), p.name, 'fs.createSymlink');
      await fsp.symlink(target, link).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'fs.createSymlink', link, 'no'));
      });
      return FS.statPath(link);
    },
    'fs:copyText': (p) => writeClipText(p.text),
    'fs:startDrag': async (p, e) => {
      const files = p.paths.map((x) => requireAbsolute(x, 'fs.startDrag'));
      for (const f of files) await fsp.lstat(f); // only real, existing items can be dragged out
      const icon = nativeImage.createFromDataURL(DRAG_ICON);
      e.sender.startDrag({ file: files[0]!, files, icon });
    },

    // ------------------------------------------------------------------ system Trash
    'trash:list': async (): Promise<TrashListing> => {
      if (!s.trash) {
        const name = systemTrashName();
        return {
          supported: false,
          platform: process.platform,
          canOpenSystemTrash: canOpenSystemTrash(),
          systemTrashName: name,
          note: `Browsing the ${name} in Orbis Files is available on Linux only. Items you move to the ${name} can be restored from the ${name} in the system file manager.`,
        };
      }
      const r = await s.trash.list();
      s.trash.watch(r.dirs, trashChanged);
      return { supported: true, dirs: r.dirs.map((d) => ({ path: d.path, kind: d.kind, topdir: d.topdir })), items: r.items, problems: r.problems };
    },
    'trash:openSystem': () => openSystemTrash(),

    // ------------------------------------------------------------------ operations
    'ops:start': (p) => s.ops.start({ ...p, origin: p.origin ?? 'ui' }),
    'ops:list': () => s.ops.list(),
    'ops:cancel': (p) => s.ops.cancel(p.id),
    'ops:pause': (p) => s.ops.pause(p.id),
    'ops:resume': (p) => s.ops.resume(p.id),
    'ops:retry': (p) => s.ops.retry(p.id),
    'ops:dismiss': (p) => s.ops.dismiss(p.id),
    'ops:prioritize': (p) => s.ops.prioritize(p.id, p.to),
    'ops:resolveConflict': (p) => s.ops.resolveConflict(p.id, p.decision),
    'ops:undo': (p) => s.ops.undo(p.id),

    // ------------------------------------------------------------------ settings
    'settings:getAll': () => s.settings.all(),
    'settings:set': (p) => {
      const next = s.settings.set(p.key, p.value);
      applySettingSideEffects(p.key);
      return next;
    },
    'settings:reset': (p) => {
      const next = s.settings.reset(p.key);
      applySettingSideEffects(p.key);
      return next;
    },

    // ------------------------------------------------------------------ catalogue
    'cat:pins': () => s.catalog.pins(),
    'cat:pin': (p) => s.catalog.pin(requireAbsolute(p.path, 'cat.pin'), p.label),
    'cat:unpin': (p) => s.catalog.unpin(p.path),
    'cat:reorderPins': (p) => s.catalog.reorderPins(p.paths),
    'cat:recents': (p) => s.catalog.recents(p.limit),
    'cat:recordRecent': (p) => (s.settings.all().rememberRecents ? s.catalog.recordRecent(p.path, p.kind) : undefined),
    'cat:clearRecents': () => s.catalog.clearRecents(),
    'cat:tags': () => s.catalog.tags(),
    'cat:createTag': (p) => s.catalog.createTag(p.name, p.color),
    'cat:renameTag': (p) => s.catalog.renameTag(p.id, p.name),
    'cat:deleteTag': (p) => s.catalog.deleteTag(p.id),
    'cat:tagItems': (p) => s.catalog.tagItems(p.tagId, p.paths),
    'cat:untagItems': (p) => s.catalog.untagItems(p.tagId, p.paths),
    'cat:tagsFor': (p) => s.catalog.tagsFor(p.paths),
    'cat:itemsWithTag': (p) => s.catalog.itemsWithTag(p.tagId),
    'cat:collections': () => s.catalog.collections(),
    'cat:createCollection': (p) => s.catalog.createCollection(p.name),
    'cat:renameCollection': (p) => s.catalog.renameCollection(p.id, p.name),
    'cat:deleteCollection': (p) => s.catalog.deleteCollection(p.id),
    'cat:addToCollection': (p) => s.catalog.addToCollection(p.id, p.paths),
    'cat:removeFromCollection': (p) => s.catalog.removeFromCollection(p.id, p.itemIds),
    'cat:collectionItems': (p) => s.catalog.collectionItems(p.id),
    'cat:itemMeta': (p) => s.catalog.itemMeta(p.path),
    'cat:setItemMeta': (p) => s.catalog.setItemMeta(p.path, { description: p.description, rating: p.rating }),
    'cat:savedSearches': () => s.catalog.savedSearches(),
    'cat:saveSearch': (p) => {
      parseQuery(p.query);
      return s.catalog.saveSearch(p.name, p.query, p.scope);
    },
    'cat:deleteSavedSearch': (p) => s.catalog.deleteSavedSearch(p.id),
    'cat:sidebar': () => s.catalog.getKv('sidebar', { collapsed: {}, hidden: {} }),
    'cat:setSidebar': (p) => s.catalog.setKv('sidebar', p),
    'cat:session': () => s.catalog.getKv('session', null),
    'cat:saveSession': (p) => s.catalog.setKv('session', p.session),
    'cat:workspaces': () => s.catalog.workspaces(),
    'cat:saveWorkspace': (p) => s.catalog.saveWorkspace(p.name, p.state),
    'cat:deleteWorkspace': (p) => s.catalog.deleteWorkspace(p.id),
    'cat:downloads': () => s.catalog.downloads(),
    'cat:removeDownloadEntry': (p) => s.catalog.removeDownloadEntry(p.id),
    'cat:generated': () => s.catalog.generated(),
    'cat:removeGeneratedEntry': (p) => s.catalog.removeGeneratedEntry(p.id),
    'cat:backup': async (p) => {
      const dest = requireAbsolute(p.destination, 'cat.backup');
      if (await FS.exists(dest)) throw makeError('already_exists', 'cat.backup', { target: dest });
      await s.db.flush();
      await s.db.exportTo(dest);
      return { path: dest, bytes: (await fsp.stat(dest)).size };
    },
    'cat:restore': async (p) => {
      const src = requireAbsolute(p.source, 'cat.restore');
      const bytes = await fsp.readFile(src);
      const check = s.db.validateImage(bytes);
      if (!check.ok) throw makeError('validation', 'cat.restore', { message: `This is not a valid Orbis Files backup: ${check.reason}` });
      const latest = MIGRATIONS[MIGRATIONS.length - 1]!.version;
      if ((check.version ?? 0) > latest) throw makeError('validation', 'cat.restore', { message: 'This backup is from a newer version of Orbis Files.' });
      // Keep the current database, then swap in the backup and restart.
      await s.db.flush();
      const keep = `${ctx.dbPath}.before-restore-${Date.now()}.bak`;
      await fsp.copyFile(ctx.dbPath, keep);
      await fsp.writeFile(`${ctx.dbPath}.restore-pending`, bytes);
      setTimeout(() => {
        app.relaunch();
        app.quit();
      }, 300);
      return { previousSavedAs: keep, restarting: true };
    },

    // ------------------------------------------------------------------ search & index
    'search:start': (p, e) => {
      let q;
      try {
        q = parseQuery(p.query);
      } catch (err) {
        if (err instanceof QueryError) throw makeError('validation', 'search.parse', { message: err.message, cause: `position ${err.position}` });
        throw err;
      }
      const ac = new AbortController();
      searches.get(p.searchId)?.abort();
      searches.set(p.searchId, ac);
      void runSearch(q, p.scope, {
        showHidden: p.showHidden,
        signal: ac.signal,
        useIndex: p.useIndex,
        indexer: s.indexer,
        ctx: { tagLookup: (name) => s.catalog.pathsWithTagName(name), catalog: s.catalog.searchLookups(), metaLookup: async (file) => summarize(await s.metadata.read(file)), imageText: (file, size, mtime) => s.ocr.store.textFor(file, size, mtime) },
        onBatch: (entries) => sendTo(e.sender, 'search:results', { searchId: p.searchId, entries }),
      })
        .then((report) => sendTo(e.sender, 'search:done', { searchId: p.searchId, report }))
        .catch((err) => sendTo(e.sender, 'search:done', { searchId: p.searchId, error: toOrbisError(err, 'search.run') }))
        .finally(() => searches.delete(p.searchId));
      return { searchId: p.searchId };
    },
    'search:cancel': (p) => searches.get(p.searchId)?.abort(),
    'search:parse': (p) => {
      try {
        const q = parseQuery(p.query);
        return { ok: true, groups: q.groups.map((g) => g.map((c) => ({ field: c.field, negate: c.negate, value: c.value }))) };
      } catch (err) {
        if (err instanceof QueryError) return { ok: false, message: err.message, position: err.position };
        throw err;
      }
    },
    'index:quickFind': async (p, e) => {
      // A newer request from the same window supersedes this one: it stops checking hits on disk.
      quickFindLatest.set(e.sender.id, p.requestId);
      const roots = s.indexer.roots().length;
      if (!roots || !p.query.trim()) return { requestId: p.requestId, roots, items: [] };
      const rows = s.indexer.quickFind(p.query, { limit: 400, showHidden: s.settings.all().showHidden });
      const ranked = rankCandidates(p.query, rows.map((r) => ({ path: r.path, name: r.name, kind: r.kind === 'directory' ? 'directory' as const : 'file' as const, source: 'index' as const })), { limit: p.limit ?? 30 });
      const items: Array<{ path: string; name: string; kind: 'file' | 'directory' }> = [];
      for (const r of ranked) {
        if (quickFindLatest.get(e.sender.id) !== p.requestId) return { requestId: p.requestId, roots, items: [], superseded: true };
        // Index rows can be stale: only items that still exist are offered.
        const st = await fsp.stat(r.path).catch(() => undefined);
        if (st) items.push({ path: r.path, name: r.name, kind: st.isDirectory() ? 'directory' : 'file' });
      }
      return { requestId: p.requestId, roots, items };
    },
    'index:status': () => s.indexer.status(),
    'index:addRoot': (p) => s.indexer.addRoot(requireAbsolute(p.path, 'index.addRoot')),
    'index:removeRoot': (p) => s.indexer.removeRoot(p.path),
    'index:rebuild': () => s.indexer.rebuild(),
    'index:pause': () => s.indexer.pause(),
    'index:resume': () => s.indexer.resume(),
    'index:setExclusions': (p) => {
      s.indexer.setExclusions(p.patterns);
      s.indexer.rebuild();
    },

    // ------------------------------------------------------------------ tools
    'tool:storageScan': (p, e) => runJob(p.jobId, e.sender, async (signal, progress, gate) => {
      const r = await scanStorage(requireAbsolute(p.path, 'tool.storage'), signal, progress, gate, { oldMonths: p.oldMonths, maxEntries: p.maxEntries });
      // Keep a measurement history so trends can be shown; partial scans are marked as such.
      if (!r.cancelled) s.catalog.recordStorageScan({ root: r.root, bytes: r.bytes, files: r.files, directories: r.directories, complete: r.complete, byCategory: r.byCategory });
      return r;
    }),
    'tool:duplicates': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => findDuplicates({ roots: p.roots.map((r) => requireAbsolute(r, 'tool.duplicates')), minSize: p.minSize, maxSize: p.maxSize, include: p.include, exclude: p.exclude, skipHidden: p.skipHidden, mode: p.mode }, signal, progress, gate)),
    'tool:saveCsv': async (p, e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const base = p.suggestedName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\.csv$/i, '') || 'report';
      const docs = (await knownLocations()).find((k) => k.id === 'documents')?.path ?? os.homedir();
      const opts = { title: 'Save report', defaultPath: path.join(docs, `${base}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      const target = r.filePath.toLowerCase().endsWith('.csv') ? r.filePath : `${r.filePath}.csv`;
      // The save dialog already asked about replacing an existing file; write a temporary sibling, then rename.
      const tmp = path.join(path.dirname(target), `.orbis-part-${randomUUID()}`);
      await fsp.writeFile(tmp, p.csv, { flag: 'wx' });
      await fsp.rename(tmp, target).catch(async (err) => {
        await fsp.unlink(tmp).catch(() => undefined);
        throw new OrbisError(toOrbisError(err, 'tool.saveCsv', target, 'no'));
      });
      return { path: target, bytes: Buffer.byteLength(p.csv) };
    },
    'tool:compareDirs': (p, e) => runJob(p.jobId, e.sender, (signal, _progress, gate) => compareDirectories(requireAbsolute(p.left, 'tool.compare'), requireAbsolute(p.right, 'tool.compare'), p.verifyContent, signal, gate)),
    'tool:verifyChecksums': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => verifyChecksumFile(requireAbsolute(p.path, 'checksum.verify'), signal, (x) => progress(x), gate)),
    'tool:diffText': (p) => diffText(requireAbsolute(p.left, 'tool.diff'), requireAbsolute(p.right, 'tool.diff')),
    'tool:diffStructured': (p) => diffStructured(requireAbsolute(p.left, 'tool.diff'), requireAbsolute(p.right, 'tool.diff')),
    // Archive passwords arrive only in these requests and in extract/compress operation params;
    // they are passed straight to the archive code and never logged, stored or returned.
    'tool:archiveList': (p) => listArchive(requireAbsolute(p.path, 'tool.archive'), effectiveLimits(s.archiveLimits(), undefined), { password: p.password }),
    // Archive tests run inside the archive reader (and a 7-Zip worker); they can be cancelled but not paused.
    'tool:archiveTest': (p, e) => runJob(p.jobId, e.sender, (signal, progress) => testArchive(requireAbsolute(p.path, 'tool.archiveTest'), signal, (checked) => progress({ checked }), p.password), { pausable: false }),
    'tool:archiveNested': async (p) => {
      const max = s.settings.get('nestedArchiveDepth');
      if (p.depth >= max) throw makeError('validation', 'archive.nested', { message: `Archives nested more than ${max} levels deep are not opened (Settings → Archives).` });
      return extractEntryToScratch(requireAbsolute(p.archivePath, 'archive.nested'), p.entry, s.settings.get('nestedArchiveMaxMB') * 1024 * 1024, effectiveLimits(s.archiveLimits(), undefined), { password: p.password });
    },
    'tool:archiveEntry': async (p) => {
      const copy = await extractEntryToScratch(requireAbsolute(p.archivePath, 'archive.openEntry'), p.entry, s.settings.get('nestedArchiveMaxMB') * 1024 * 1024, effectiveLimits(s.archiveLimits(), undefined), { password: p.password, purpose: 'open' });
      return FS.statPath(copy);
    },
    'tool:bulkRenamePreview': (p) => previewBulkRename(p.paths.map((x) => requireAbsolute(x, 'tool.bulkRename')), p.spec, { readMeta: (f) => s.metadata.read(f) }),
    'rename:presets': () => renamePresets.list(),
    'rename:savePreset': (p) => {
      const preset = renamePresets.save(p.name, p.spec);
      return { preset, presets: renamePresets.list() };
    },
    'rename:deletePreset': (p) => ({ deleted: renamePresets.delete(p.id), presets: renamePresets.list() }),
    'rules:list': () => s.rules.list().map((r) => ({ ...r, approved: s.rules.isApproved(r), automationProblem: s.rules.automationProblem({ ...r, automatic: { ...r.automatic, folders: r.automatic.folders.length ? r.automatic.folders : [r.scope] } }) })),
    'rules:save': (p) => {
      const saved = s.rules.save(p.rule);
      s.automation.refresh();
      return saved;
    },
    'rules:delete': (p) => {
      s.rules.delete(p.id);
      s.automation.refresh();
    },
    'rules:dryRun': (p) => s.rules.dryRun(p.id, searchCtx(), new AbortController().signal),
    'rules:run': async (p) => {
      const rule = s.rules.get(p.id);
      const dry = await s.rules.dryRun(p.id, searchCtx(), new AbortController().signal);
      const approved = new Set(p.paths);
      const chosen = dry.items.filter((i) => approved.has(i.path) && i.status !== 'excluded');
      const { runId: _runId, ...result } = await applyRule({ rules: s.rules, ops: s.ops, catalog: s.catalog }, rule, chosen.map((c) => c.path));
      // Applying by hand may make the rule eligible for automation.
      s.automation.refresh();
      return result;
    },
    'rules:runs': (p) => s.rules.runs(p.id),
    'rules:rollback': (p) => rollbackRuleRun({ rules: s.rules, ops: s.ops, catalog: s.catalog }, p.ruleId, p.runId),
    'rules:setAutomatic': (p) => {
      const rule = s.rules.setAutomatic(p.id, p.enabled, p.folders?.map((f) => requireAbsolute(f, 'rules.setAutomatic')));
      s.automation.refresh();
      return rule;
    },
    'automation:status': () => s.automation.status(),
    'automation:setPaused': (p) => {
      s.automation.setPaused(p.paused);
      return s.automation.status();
    },
    'automation:activity': (p) => s.rules.automaticRuns(p.limit ?? 200),
    'timeline:query': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => recentChanges({
      folders: p.folders.map((f) => requireAbsolute(f, 'timeline')), sinceMs: p.sinceMs, indexer: s.indexer, useIndex: p.useIndex,
      maxDepth: p.maxDepth, maxEntries: p.maxEntries, limit: p.limit, showHidden: p.showHidden, signal, gate, progress,
    })),
    'timeline:watch': async (p, e) => {
      const id = e.sender.id;
      timelineWatchers.get(id)?.close();
      const w = new TimelineWatcher(p.folders.map((f) => requireAbsolute(f, 'timeline.watch')), () => p.sinceMs, (u) => sendTo(e.sender, 'timeline:changed', u));
      timelineWatchers.set(id, w);
      if (!timelineCleanup.has(id)) {
        timelineCleanup.add(id);
        e.sender.once('destroyed', () => {
          timelineWatchers.get(id)?.close();
          timelineWatchers.delete(id);
          timelineCleanup.delete(id);
        });
      }
      await w.start();
      return { watching: true, capped: w.capped };
    },
    'timeline:unwatch': (_p, e) => {
      timelineWatchers.get(e.sender.id)?.close();
      timelineWatchers.delete(e.sender.id);
    },
    'images:plan': async (p) => {
      const out = p.spec.outputFolder ? requireAbsolute(p.spec.outputFolder, 'images.plan') : undefined;
      const claimed = new Set<string>();
      const items = [];
      for (const src of p.paths.map((x) => requireAbsolute(x, 'images.plan'))) {
        const meta = await readMetadata(src).catch(() => undefined);
        const name = path.basename(src);
        const plan = planImage({ name, width: meta?.kind === 'image' ? meta.width : undefined, height: meta?.kind === 'image' ? meta.height : undefined, orientation: meta?.orientation }, p.spec);
        const dir = out ?? path.dirname(src);
        let target: string | undefined;
        if (!plan.error && !plan.unchanged) {
          const wanted = outputName(name, p.spec, plan.format);
          let final = wanted;
          const taken = async (q: string) => claimed.has(q) || (await FS.exists(q));
          if (await taken(path.join(dir, final))) final = await uniqueName(dir, wanted, taken);
          target = path.join(dir, final);
          claimed.add(target);
        }
        items.push({ path: src, name, width: meta?.width, height: meta?.height, orientation: meta?.orientation, format: meta?.format, plan, target, renamed: !!target && path.basename(target) !== outputName(name, p.spec, plan.format) });
      }
      return items;
    },
    'organize:plan': (p, e) => {
      const root = requireAbsolute(p.destination, 'organize.plan');
      const paths = p.paths.map((x) => requireAbsolute(x, 'organize.plan'));
      return runJob(p.jobId, e.sender, async (signal, progress, gate) => {
        const st = await fsp.stat(root).catch(() => undefined);
        if (!st?.isDirectory()) throw makeError('not_a_directory', 'organize.plan', { target: root, message: 'The destination folder does not exist.' });
        return planOrganize(paths, root, p.spec, (f) => s.metadata.read(f), { signal, wait: () => gate?.wait() ?? Promise.resolve(), onProgress: (done, total) => progress({ stage: 'Reading dates', items: done, total }) });
      });
    },
    'organize:presets': () => s.organizePresets.list(),
    'organize:savePreset': (p) => ({ preset: s.organizePresets.save(p.name, p.pattern), presets: s.organizePresets.list() }),
    'organize:deletePreset': (p) => ({ deleted: s.organizePresets.delete(p.id), presets: s.organizePresets.list() }),
    'font:info': (p) => {
      const target = requireAbsolute(p.path, 'font.info');
      if (!isFontExt(path.extname(target).slice(1))) throw makeError('unsupported', 'font.info', { target, message: 'Only .ttf, .otf, .woff and .woff2 files are described.' });
      return readFontInfo(target);
    },
    'images:presets': () => s.imagePresets.list(),
    'images:savePreset': (p) => ({ preset: s.imagePresets.save(p.name, p.spec), presets: s.imagePresets.list() }),
    'images:deletePreset': (p) => ({ deleted: s.imagePresets.delete(p.id), presets: s.imagePresets.list() }),
    'proj:list': async () => Promise.all(s.catalog.projects().map(async (pr) => ({ ...pr, rootExists: await FS.exists(pr.root) }))),
    'proj:detect': (p) => detectProject(requireAbsolute(p.path, 'proj.detect')),
    'proj:create': async (p) => {
      const root = requireAbsolute(p.root, 'proj.create');
      const st = await fsp.stat(root).catch(() => undefined);
      if (!st?.isDirectory()) throw makeError('not_a_directory', 'proj.create', { target: root, message: 'A project must be a folder.' });
      const detected = await detectProject(root);
      return s.catalog.createProject(root, p.name, p.kind ?? detected?.kind ?? 'Folder', detected?.markers ?? []);
    },
    'proj:rename': (p) => s.catalog.renameProject(p.id, p.name),
    'proj:delete': (p) => s.catalog.deleteProject(p.id),
    'proj:associate': (p) => s.catalog.associateWithProject(p.id, p.paths.map((x) => requireAbsolute(x, 'proj.associate'))),
    'proj:items': (p) => s.catalog.projectItems(p.id),
    'proj:removeItems': (p) => s.catalog.removeFromProject(p.id, p.itemIds),
    'proj:find': (p, e) => runJob(p.jobId, e.sender, async (signal, progress, gate) => {
      const root = requireAbsolute(p.path, 'proj.find');
      const found: Array<{ root: string; name: string; kind: string; markers: string[]; registered: boolean }> = [];
      const registered = new Set(s.catalog.projects().map((x) => x.root));
      const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
      let checked = 0;
      while (queue.length && found.length < 500) {
        if (gate?.isPaused) await gate.wait();
        if (signal.aborted) throw makeError('cancelled', 'proj.find');
        const { dir, depth } = queue.shift()!;
        checked++;
        const proj = await detectProject(dir);
        if (proj && !(proj.markers.length === 1 && proj.markers[0] === 'Makefile')) {
          found.push({ root: dir, ...proj, registered: registered.has(dir) });
          continue; // folders inside a project belong to it
        }
        if (depth >= 4) continue;
        for (const d of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
          if (d.isDirectory() && !d.name.startsWith('.') && !['node_modules', 'vendor', 'target', 'build', 'dist'].includes(d.name)) queue.push({ dir: path.join(dir, d.name), depth: depth + 1 });
        }
        progress({ checked, found: found.length });
      }
      return { found, checked, complete: !queue.length };
    }),
    'storage:history': (p) => s.catalog.storageHistory(requireAbsolute(p.root, 'storage.history')),
    'storage:clearHistory': (p) => s.catalog.clearStorageHistory(p.root),
    'lib:importFolder': () => importFolder(),
    'lib:import': async (p) => {
      const dest = await importFolder();
      await fsp.mkdir(dest, { recursive: true });
      const rec = s.ops.start({ type: 'copy', sources: p.paths.map((x) => requireAbsolute(x, 'lib.import')), destination: dest, conflictPolicy: 'ask', origin: 'import' });
      return { operation: rec, folder: dest };
    },
    'sync:pairs': () => s.sync.pairs(),
    'sync:savePair': (p) => {
      const saved = s.sync.savePair(p);
      s.syncSchedules.refresh(saved.id); // a changed pair needs a new approval before it runs on schedule
      return saved;
    },
    'sync:deletePair': (p) => {
      s.sync.deletePair(p.id);
      s.syncSchedules.remove(p.id);
    },
    'sync:forgetBaseline': (p) => s.sync.forgetBaseline(p.left, p.right),
    'sync:preview': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => s.sync.preview({ left: p.left, right: p.right, mode: p.mode, options: p.options, pairId: p.pairId }, signal, progress, gate)),
    'sync:run': (p) => {
      // Approval for scheduled runs is checked against the saved pair before anything starts.
      if (p.approveSchedule) {
        const stored = s.sync.getPlan(p.planId);
        if (!stored || !p.pairId) throw makeError('validation', 'sync.approve', { message: 'Only a preview of a saved, scheduled pair can be approved.' });
        s.syncSchedules.approve(p.pairId, stored.result);
      }
      return s.sync.run(p.planId, p.decisions, p.pairId);
    },
    'sync:schedules': () => s.syncSchedules.list(),
    'sync:approveSchedule': (p) => {
      const stored = s.sync.getPlan(p.planId);
      if (!stored) throw makeError('validation', 'sync.approve', { message: 'This preview is no longer available. Preview again.' });
      s.syncSchedules.approve(p.pairId, stored.result);
      return s.syncSchedules.get(p.pairId) ?? null;
    },
    'sync:setSchedule': (p) => s.syncSchedules.set(p.pairId, p.schedule, p.maxDeletes) ?? null,
    'backup:jobs': () => s.backups.jobs(),
    'backup:saveJob': (p) => s.backups.saveJob(p),
    'backup:deleteJob': (p) => s.backups.deleteJob(p.id),
    'backup:run': (p) => s.backups.run(p.id),
    'backup:versions': (p) => s.backups.versions(p.id),
    'backup:browse': (p) => s.backups.browse(p.id, p.version, p.dir),
    'backup:search': (p) => s.backups.search(p.id, p.query),
    'backup:fileVersions': (p) => s.backups.fileVersions(p.id, p.rel),
    'backup:restore': (p) => s.backups.restore(p),
    'backup:verify': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => s.backups.verify(p.id, p.version, signal, gate, progress)),
    'backup:activity': (p) => s.backups.activity(p.id, p.limit ?? 200),
    'schedule:status': () => s.scheduler.status(),
    'schedule:setPaused': (p) => {
      // Resuming may start runs that were missed while paused; they report through events.
      void s.scheduler.setPaused(p.paused);
      return s.scheduler.status();
    },
    'pdf:info': (p) => pdfInfo(requireAbsolute(p.path, 'pdf.info')),
    'pdf:bytes': async (p) => {
      const target = requireAbsolute(p.path, 'pdf.bytes');
      const st = await fsp.stat(target).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'pdf.bytes', target, 'no'));
      });
      if (!st.isFile()) throw makeError('unsupported', 'pdf.bytes', { target });
      if (st.size > Math.min(PDF_MAX_BYTES, 100 * 1024 * 1024)) throw makeError('unsupported', 'pdf.bytes', { target, message: 'This PDF is too large for page thumbnails (over 100 MB).' });
      const bytes = await fsp.readFile(target);
      if (!bytes.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw makeError('validation', 'pdf.bytes', { target, message: 'This is not a PDF file.' });
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },
    'find:search': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) => searchInFiles({ ...p, root: requireAbsolute(p.root, 'find.search') }, signal, (x) => progress(x), gate)),
    'find:preview': (p) => previewReplacements(p.query, p.replacement, p.files.map((f) => ({ ...f, path: requireAbsolute(f.path, 'find.preview') }))),
    'textfix:preview': (p) => previewTextFixes(p.paths.map((x) => requireAbsolute(x, 'textfix.preview')), p.spec),
    // The password is only used to derive the key in memory; it is not logged, stored or returned.
    'crypto:checkPassword': (p) => checkPassword(requireAbsolute(p.path, 'crypto.check'), p.password),
    // Share on local network: the main process validates paths, addresses and limits again (ShareService.start).
    'share:interfaces': () => s.shares.interfaces(),
    'share:start': (p) => s.shares.start(p),
    'share:list': () => s.shares.list(),
    'share:stop': (p) => s.shares.stop(p.id),
    'share:dismiss': (p) => s.shares.dismiss(p.id),
    'snap:list': (p) => s.snapshots.list(p.path),
    'snap:create': (p) => s.snapshots.create(requireAbsolute(p.path, 'snap.create')),
    'snap:restore': (p) => s.snapshots.restore(p.id, requireAbsolute(p.destination, 'snap.restore')),
    'snap:delete': (p) => s.snapshots.delete(p.id),
    'snap:diff': (p) => s.snapshots.diff(p.id),

    // ------------------------------------------------------------------ integrations
    'ai:status': () => s.ai.status(),
    'ai:configure': async (p) => {
      if (!p.endpoint) {
        s.catalog.setKv('ai.endpoint', null);
        s.catalog.setKv('ai.token', null);
        s.catalog.setKv('ai.kind', null);
        s.catalog.setKv('ai.model', null);
        s.catalog.setKv('ai.vision', null);
        sessionToken = undefined;
        s.ai.configure(undefined);
        return s.ai.status();
      }
      const kind: ProviderKind = p.kind ?? 'orbis';
      if (kind === 'openai-compatible' && !p.model) throw makeError('validation', 'ai.configure', { message: 'Choose a model for the OpenAI-compatible server (type its name or use Load models).' });
      // A stored key belongs to the server it was entered for: it is never sent to a different address or provider type.
      const previous = storedAiConfig();
      const keyMoved = p.token === undefined && !!previous && (previous.endpoint !== p.endpoint || previous.kind !== kind) && !!(sessionToken ?? loadToken());
      const token = p.token !== undefined ? (p.token ?? undefined) : keyMoved ? undefined : (sessionToken ?? loadToken());
      // Validates the address and model; nothing is stored if this throws.
      s.ai.configureProvider({ kind, endpoint: p.endpoint, token, model: p.model, vision: p.vision });
      let tokenNote: string | undefined = keyMoved ? 'The stored key was removed because the server address or provider type changed. Enter the key again if this server needs one.' : undefined;
      if (keyMoved || p.token === null) {
        s.catalog.setKv('ai.token', null);
        sessionToken = undefined;
      } else if (typeof p.token === 'string') {
        if (safeStorage.isEncryptionAvailable()) {
          s.catalog.setKv('ai.token', safeStorage.encryptString(p.token).toString('base64'));
          sessionToken = p.token;
        } else {
          s.catalog.setKv('ai.token', null);
          sessionToken = p.token;
          tokenNote = 'Secure credential storage is not available on this system; the key is kept for this session only.';
        }
      }
      s.catalog.setKv('ai.endpoint', p.endpoint);
      s.catalog.setKv('ai.kind', kind);
      s.catalog.setKv('ai.model', kind === 'openai-compatible' ? p.model : null);
      s.catalog.setKv('ai.vision', kind === 'openai-compatible' ? !!p.vision : null);
      const status = await s.ai.connect();
      return { ...status, tokenNote };
    },
    'ai:listModels': async (p) => {
      // Without a key in the request, the stored key is used only for the server it was saved for.
      const stored = storedAiConfig();
      const key = p.key || (stored?.kind === 'openai-compatible' && stored.endpoint === p.url ? (sessionToken ?? loadToken()) : undefined);
      try {
        return await listOpenAiModels(p.url, key);
      } catch (err) {
        throw makeError('unavailable', 'ai.listModels', { message: (err as Error).message, retryable: true });
      }
    },
    'ai:connect': () => s.ai.connect(),
    'ai:disconnect': () => s.ai.disconnect(),
    'ai:runTask': (p) => s.ai.runTask(p.kind, p.prompt, p.refs.map((r) => ({ path: requireAbsolute(r.path, 'ai.runTask'), share: r.share })), { showHidden: s.settings.all().showHidden }),
    'ai:cancelTask': (p) => s.ai.cancelTask(p.taskId),
    'ai:audit': (p) =>
      s.db
        .all<{ id: string; task_id: string; ms: number; event: string; kind: string | null; refs: string | null; detail: string | null }>('SELECT * FROM ai_audit ORDER BY ms DESC LIMIT ?', [p.limit ?? 200])
        .map((r) => ({ id: r.id, taskId: r.task_id, ms: r.ms, event: r.event, kind: r.kind, refs: r.refs ? JSON.parse(r.refs) : [], detail: r.detail ? JSON.parse(r.detail) : null })),
    'ai:applyProposals': (p) => s.ai.applyProposals(p.taskId, p.approvedIndexes),
    'ai:proposalPreview': (p) => s.ai.proposalPreview(p.taskId, p.index),
    'ai:saveAnswer': async (p) => {
      // The saved text comes from the task record in this process, not from the renderer.
      const t = s.ai.task(p.taskId);
      if (!t?.result) throw makeError('not_found', 'ai.saveAnswer', { message: 'This result is no longer available.' });
      const r = t.result;
      const provider = s.ai.status().provider;
      const lines = [
        `# Orbis AI · ${t.kind.replace(/_/g, ' ')}`,
        '',
        `- Created: ${new Date(t.createdMs).toISOString()}`,
        provider ? `- Provider: ${provider.providerName} ${provider.providerVersion} (processing: ${provider.processing})` : '',
        `- Sources: ${t.context.filter((c) => c.included).map((c) => `[${c.name}](${pathToFileURL(c.ref).href}) (${c.share === 'content' ? 'name and contents' : 'name only'})`).join(', ') || 'none'}`,
        '',
        r.answer ?? '',
        r.observations?.length ? `\n## Found in the files\n\n${r.observations.map((o) => `- **${path.basename(o.ref)}**: ${o.text}`).join('\n')}` : '',
        r.inferences?.length ? `\n## Interpretation (not verified)\n\n${r.inferences.map((x) => `- ${x}`).join('\n')}` : '',
      ].filter((x) => x !== '');
      const target = childPath(requireAbsolute(p.parent, 'ai.saveAnswer'), p.name, 'ai.saveAnswer');
      await fsp.writeFile(target, lines.join('\n') + '\n', { flag: 'wx', encoding: 'utf8' }).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'ai.saveAnswer', target, 'no'));
      });
      s.catalog.registerGenerated({ path: target, generator: 'orbis-ai', chatId: p.taskId });
      s.indexer.touch([target]);
      return { path: target };
    },
    'host:status': () => ({
      status: ctx.host.status,
      profileId: s.profileId,
      contractVersion: HOST_CONTRACT_VERSION,
      aiContractVersion: AI_CONTRACT_VERSION,
      lastRequestMs: ctx.host.lastRequestMs,
      lastRequestType: ctx.host.lastRequestType,
    }),
    'lib:providers': async () => {
      // List feed providers first so a broken feed reports its error state.
      const infos = s.content.infos();
      await Promise.all(infos.filter((i) => !i.builtIn && i.id !== 'orbis-native').map((i) => s.content.list(i.id, 1)));
      return s.content.infos();
    },
    'lib:list': (p) => s.content.list(p.providerId, p.limit),
    'lib:openItem': async (p) => {
      const item = await s.content.find(p.providerId, p.itemId);
      if (!item) throw makeError('not_found', 'lib.openItem', { message: 'This item is no longer listed by its provider.' });
      if (item.openUri && /^orbis(-[a-z0-9]+)?:/i.test(item.openUri)) {
        await shell.openExternal(item.openUri);
        return { opened: 'uri' as const };
      }
      if (item.path && item.present) {
        await openPath(item.path);
        return { opened: 'file' as const };
      }
      throw makeError('unavailable', 'lib.openItem', { message: 'The Orbis app has not said how to open this item, and it is not stored as a file.' });
    },
    'host:pendingPicks': () => pendingPicks(),
    'host:pickReply': async (p) => {
      const reply = await answerPick(p.token, p.paths);
      ctx.broadcast('host:pick', pendingPicks());
      return reply;
    },
    'orbis:scope': async (p) => {
      if (typeof p.orbisOnly === 'boolean') {
        setOrbisOnly(p.orbisOnly);
        await fs.promises.writeFile(path.join(path.dirname(libraryRoot()), 'scope.json'), JSON.stringify({ orbisOnly: p.orbisOnly }));
      }
      return { orbisOnly: isOrbisOnly() };
    },
    'orbis:addFiles': async (_p, e) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      const r = await dialog.showOpenDialog(w!, { title: 'Add to Orbis', properties: ['openFile', 'multiSelections'] });
      if (r.canceled || !r.filePaths.length) return { added: [] as string[] };
      const dir = path.join(libraryRoot(), 'Imported');
      await fs.promises.mkdir(dir, { recursive: true });
      const added: string[] = [];
      for (const from of r.filePaths) {
        const ext = path.extname(from);
        const stem = path.basename(from, ext);
        let target = path.join(dir, stem + ext);
        for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${stem} (${n})${ext}`);
        await fs.promises.copyFile(from, target);
        added.push(target);
      }
      s.log.info('orbis.add_files', { count: added.length });
      return { added };
    },
    'fs:pickFile': async (p, e) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      const r = await dialog.showOpenDialog(w!, { title: p.title ?? 'Choose a file', properties: ['openFile'] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    'profile:list': () => listProfiles(profilesRoot(s), s.profileId),
    'profile:create': async (p) => {
      const id = await createProfile(profilesRoot(s), p.id);
      s.log.info('profile.created', { id });
      return listProfiles(profilesRoot(s), s.profileId);
    },
    'profile:switch': async (p) => {
      const id = checkProfileId(p.id, 'profile.switch');
      if (id === s.profileId) throw makeError('validation', 'profile.switch', { message: `“${id}” is already the profile in use.` });
      if (!(await listProfiles(profilesRoot(s), s.profileId)).some((x) => x.id === id)) throw makeError('not_found', 'profile.switch', { message: `There is no profile named “${id}”.` });
      checkCanSwitch(s.ops.list(), id, 'profile.switch');
      s.log.info('profile.switch', { from: s.profileId, to: id, via: 'settings' });
      // Reply first, then restart on the chosen profile.
      setTimeout(() => restartOnProfile(id), 250);
      return { restarting: true };
    },
    'profile:delete': async (p) => {
      await deleteProfile(profilesRoot(s), p.id, s.profileId, p.confirm, (dir) => shell.trashItem(dir));
      s.log.info('profile.deleted', { id: p.id });
      return listProfiles(profilesRoot(s), s.profileId);
    },
    'diag:recent': (p) => s.log.recent(p.limit ?? 200),
    'diag:export': async (p) => {
      const dest = requireAbsolute(p.destination, 'diag.export');
      await s.log.exportTo(dest);
      return { path: dest };
    },
    'diag:rendererError': (p) => ({ errorId: s.log.error('renderer.panel_error', { where: p.where, message: p.message, stack: p.stack?.split('\n').slice(0, 8).join(' | ') }) }),
    'diag:openLogFolder': async () => {
      const err = await shell.openPath(path.dirname(ctx.logPath));
      if (err) throw makeError('unavailable', 'diag.openLogFolder', { message: err });
    },
    ...customizationHandlers(s),
    ...productivityHandlers(s, (channel, payload) => ctx.broadcast(channel, payload)),
    ...editorHandlers(s),
    ...remoteHandlers(s, runJob, (channel, payload) => ctx.broadcast(channel, payload)),
    ...s3Handlers(s.s3, runJob, (channel, payload) => ctx.broadcast(channel, payload)),
    ...terminalHandlers(s, ctx.terminalClose),
    ...powerToolsHandlers(s, runJob),
    ...mediaHandlers(s),
    ...ocrHandlers(s, runJob, (channel, payload) => ctx.broadcast(channel, payload)),
    ...screenshotHandlers(s.screenshot),
    ...viewerHandlers(s),
    ...archiveEditHandlers(s),
    ...downloadHandlers(s.dl),
    ...playlistHandlers(s),
    ...cryptoHandlers(s),

    // ---- Batch Rename tool view ----
    'rename:preview': async (p) => {
      const { applyRenamePattern } = await import('./tools/batchRenameService');
      return applyRenamePattern(p.paths, p.pattern, s.metadata);
    },
    'rename:execute': (p) => {
      return s.ops.start({ type: 'rename-batch', sources: p.renames.map((r) => r.from), renames: p.renames });
    },

    // ---- Checksum / Hash tool ----
    'hash:compute': (p, e) => runJob(p.jobId, e.sender, async (signal, progress, gate) => {
      const results: Array<{ path: string; hash: string; size: number }> = [];
      for (let i = 0; i < p.paths.length; i++) {
        if (signal.aborted) break;
        await gate?.wait();
        const target = requireAbsolute(p.paths[i]!, 'hash.compute');
        try {
          const r = await hashAndRecord(s.checksums, target, p.algorithm, (done, total) => progress({ index: i, total: p.paths.length, file: path.basename(target), done, fileTotal: total }), signal);
          results.push({ path: target, hash: r.digest, size: r.bytes });
        } catch (err) {
          if (signal.aborted) break;
          results.push({ path: target, hash: '', size: 0 });
        }
      }
      return results;
    }),

    // ---- Font glyph table ----
    'font:glyphs': async (p) => {
      const target = requireAbsolute(p.path, 'font.glyphs');
      const { readFontGlyphs } = await import('./media/fontGlyphs');
      return readFontGlyphs(target, p.offset, p.limit);
    },

    ...dashboardHandlers(s),
    ...enhancedViewerHandlers(),
    ...sqliteHandlers(),
    ...colorExtractHandlers(),

    // disk usage analyzer (a pausable background job)
    'disk:scan': (p, e) => runJob(p.jobId, e.sender, (signal, progress, gate) =>
      scanDiskUsage(requireAbsolute(p.path, 'disk.scan'), signal, progress, gate, { maxDepth: p.maxDepth }),
    ),
    // quick look preview
    'quicklook:data': async (p) => {
      const target = requireAbsolute(p.path, 'quicklook.data');
      return getQuickLookData(target);
    },

    'cat:loadWorkspace': (p) => s.catalog.loadWorkspace(p.id),

    // smart folders
    'cat:smartFolders': () => s.catalog.smartFolders(),
    'cat:createSmartFolder': (p) => s.catalog.createSmartFolder(p.name, p.query as SmartFolderQuery, p.icon, p.color),
    'cat:updateSmartFolder': (p) => s.catalog.updateSmartFolder(p.id, { name: p.name, query: p.query as SmartFolderQuery | undefined, icon: p.icon, color: p.color }),
    'cat:deleteSmartFolder': (p) => s.catalog.deleteSmartFolder(p.id),
    'cat:querySmartFolder': (p) => s.catalog.querySmartFolder(p.query as SmartFolderQuery),

    // ---- Hex editor ----
    ...hexEditorHandlers(),

    // ---- File notes ----
    'note:get': (p) => s.catalog.getNote(requireAbsolute(p.path, 'note:get')),
    'note:set': (p) => s.catalog.setNote(requireAbsolute(p.path, 'note:set'), p.note, p.color),
    'note:delete': (p) => { s.catalog.deleteNote(requireAbsolute(p.path, 'note:delete')); return { ok: true }; },
    'note:list': (p) => s.catalog.listNotes(p.query),
    'note:search': (p) => s.catalog.searchNotes(p.text),

    // ---- Content search ----
    'content:search': (p, e) => runJob(p.jobId, e.sender, (signal, progress) =>
      searchFileContents(requireAbsolute(p.dir, 'content:search'), p.pattern, p.isRegex, p.caseSensitive, p.fileFilter, p.maxResults, signal, progress),
    ),

    // audio waveform
    'audio:waveform': (p) => extractWaveform(requireAbsolute(p.path, 'audio.waveform')),

    // metadata editor
    'metadata:read': (p) => readFileMetadata(requireAbsolute(p.path, 'metadata.read')),
    'metadata:write': async (p) => {
      const target = requireAbsolute(p.path, 'metadata.write');
      if (p.edits['Date/Time']) await updateDateTime(target, p.edits['Date/Time']);
    },
    'metadata:strip': (p) => stripAllExif(requireAbsolute(p.path, 'metadata.strip')),

    // permissions editor
    'perm:get': (p) => getPermissions(requireAbsolute(p.path, 'perm.get')),
    'perm:set': (p) => setPermissions(requireAbsolute(p.path, 'perm.set'), p.mode),
    'perm:setRecursive': (p) => setPermissionsRecursive(requireAbsolute(p.path, 'perm.setRecursive'), p.mode),
    'perm:chown': (p) => changeOwner(requireAbsolute(p.path, 'perm.chown'), p.uid, p.gid),

    // ---- Symlink manager ----
    'symlink:scan': async (p) => {
      const { scanSymlinks } = await import('./tools/symlinkManager');
      return scanSymlinks(requireAbsolute(p.path, 'symlink.scan'), p.recursive ?? false);
    },
    'symlink:create': async (p) => {
      const { createSymlink } = await import('./tools/symlinkManager');
      return createSymlink(requireAbsolute(p.path, 'symlink.create'), requireAbsolute(p.target, 'symlink.create'), p.relative ?? false);
    },
    'symlink:retarget': async (p) => {
      const { retargetSymlink } = await import('./tools/symlinkManager');
      return retargetSymlink(requireAbsolute(p.path, 'symlink.retarget'), p.newTarget);
    },
    'symlink:delete': async (p) => {
      const { deleteSymlink } = await import('./tools/symlinkManager');
      await deleteSymlink(requireAbsolute(p.path, 'symlink.delete'));
    },
    'symlink:fixBroken': async (p) => {
      const { fixBrokenSymlink } = await import('./tools/symlinkManager');
      return fixBrokenSymlink(requireAbsolute(p.path, 'symlink.fixBroken'), p.newTarget);
    },
    'symlink:convert': async (p) => {
      const { convertSymlink } = await import('./tools/symlinkManager');
      return convertSymlink(requireAbsolute(p.path, 'symlink.convert'), p.toRelative);
    },

    // ---- Batch date modifier ----
    'date:preview': async (p) => {
      const { previewBatchDates } = await import('./tools/batchDate');
      return previewBatchDates(p.paths.map((x) => requireAbsolute(x, 'date.preview')), p.spec);
    },
    'date:modify': async (p) => {
      const { batchModifyDates } = await import('./tools/batchDate');
      return batchModifyDates(p.paths.map((x) => requireAbsolute(x, 'date.modify')), p.spec);
    },

    // ---- File templates (custom catalog) ----
    'template:list': async () => {
      const { listTemplates } = await import('./tools/fileTemplates');
      return listTemplates(s.catalog);
    },
    'template:create': async (p) => {
      const { createFromTemplateById } = await import('./tools/fileTemplates');
      const created = await createFromTemplateById(requireAbsolute(p.dir, 'template.create'), p.templateId, p.fileName, s.catalog);
      s.indexer.touch([created]);
      return { path: created };
    },
    'template:save': async (p) => {
      const { saveCustomTemplate } = await import('./tools/fileTemplates');
      return saveCustomTemplate(s.catalog, p.template);
    },
    'template:delete': async (p) => {
      const { deleteCustomTemplate } = await import('./tools/fileTemplates');
      return { deleted: deleteCustomTemplate(s.catalog, p.id) };
    },

    // Image crop & rotate, video timeline, snippets
    ...imageCropRotateHandlers(),
    ...videoTimelineHandlers(),
    ...snippetHandlers(s),

    // Conversion pipeline
    ...conversionPipelineHandlers(),
    'pipeline:run': (p, e) => runJob(p.jobId, e.sender, (signal, progress) =>
      runPipeline(p.sourcePaths.map((x: string) => requireAbsolute(x, 'pipeline.run')), p.steps, requireAbsolute(p.outputDir, 'pipeline.run'), signal, (pp) => progress(pp)),
    ),

    // Volumes monitor
    ...volumeMonitorHandlers(),

    // Color tags
    ...colorTagHandlers(s),

    // Bookmarks / favorites bar
    ...bookmarkHandlers(s),

    // Advanced Recycle Bin
    ...recycleBinHandlers(s),

    // Git integration (write operations)
    'git:stage': async (p) => {
      const { gitStage } = await import('./tools/gitIntegration');
      return gitStage(requireAbsolute(p.repoRoot, 'git.stage'), p.paths.map((x: string) => requireAbsolute(x, 'git.stage')));
    },
    'git:unstage': async (p) => {
      const { gitUnstage } = await import('./tools/gitIntegration');
      return gitUnstage(requireAbsolute(p.repoRoot, 'git.unstage'), p.paths.map((x: string) => requireAbsolute(x, 'git.unstage')));
    },
    'git:commit': async (p) => {
      const { gitCommit } = await import('./tools/gitIntegration');
      return gitCommit(requireAbsolute(p.repoRoot, 'git.commit'), p.message);
    },
    'git:diffSummary': async (p) => {
      const { gitDiffSummary } = await import('./tools/gitIntegration');
      return gitDiffSummary(requireAbsolute(p.repoRoot, 'git.diffSummary'));
    },

    // File hash comparator
    'hashCompare:compare': async (p) => {
      const { compareFileHashes } = await import('./tools/hashCompare');
      const ac = new AbortController();
      return compareFileHashes(
        requireAbsolute(p.pathA, 'hashCompare.compare'),
        requireAbsolute(p.pathB, 'hashCompare.compare'),
        p.algorithm,
        ac.signal,
      );
    },

    // Virtual workspaces / spaces
    ...spacesHandlers(s),

    // Recent files panel
    ...recentFilesHandlers(s),

    // ---- File links (aliases) ----
    'link:create': async (p) => {
      const { createFileLink } = await import('./tools/fileLinks');
      return createFileLink(s.db, { name: p.name, targetPath: requireAbsolute(p.targetPath, 'link.create'), parentPath: requireAbsolute(p.parentPath, 'link.create') });
    },
    'link:delete': async (p) => {
      const { deleteFileLink } = await import('./tools/fileLinks');
      return { deleted: deleteFileLink(s.db, p.id) };
    },
    'link:list': async (p) => {
      const { resolveFileLinks } = await import('./tools/fileLinks');
      return resolveFileLinks(s.db, requireAbsolute(p.parentPath, 'link.list'));
    },
    'link:resolve': async (p) => {
      const { resolveFileLink } = await import('./tools/fileLinks');
      return resolveFileLink(s.db, p.id);
    },
    'link:update': async (p) => {
      const { updateFileLink } = await import('./tools/fileLinks');
      return updateFileLink(s.db, p.id, { name: p.name, targetPath: p.targetPath ? requireAbsolute(p.targetPath, 'link.update') : undefined });
    },
    'link:all': async () => {
      const { allFileLinks } = await import('./tools/fileLinks');
      return allFileLinks(s.db);
    },

    // ---- Breadcrumb siblings ----
    'breadcrumb:siblings': async (p) => {
      const dir = requireAbsolute(p.path, 'breadcrumb.siblings');
      const st = await fsp.stat(dir).catch(() => undefined);
      if (!st?.isDirectory()) return [];
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      return entries.map((e) => ({
        name: e.name,
        path: path.join(dir, e.name),
        kind: e.isDirectory() ? 'directory' : 'file',
      })).sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    },

    // ---- Drag-drop preview info ----
    'dragdrop:preview': async (p) => {
      let fileCount = 0;
      let folderCount = 0;
      let totalSize = 0;
      const names: string[] = [];
      for (const fp of p.paths.slice(0, 100)) {
        const target = requireAbsolute(fp, 'dragdrop.preview');
        try {
          const st = await fsp.stat(target);
          if (st.isDirectory()) folderCount++;
          else { fileCount++; totalSize += st.size; }
          names.push(path.basename(target));
        } catch { /* skip unreadable */ }
      }
      if (p.paths.length > 100) {
        fileCount += p.paths.length - 100;
      }
      return { fileCount, folderCount, totalSize, names: names.slice(0, 5) };
    },

    // Cloud storage mount
    ...cloudMountHandlers(s),

    // Clipboard history
    ...clipboardHistoryHandlers(s),

    // Archive manager
    ...archiveManagerHandlers(s),

    // Macro recorder
    ...macroHandlers(s),

    // Folder watcher
    ...folderWatchHandlers(s, ctx.broadcast),

    // File version history
    ...fileVersionHandlers(s),

    // Universe
    ...universeHandlers(s),
  };

  // Ensure default color tag presets exist
  try { ensureColorTagPresets(s); } catch { /* migration may not have run yet */ }

  // Restore pinned clipboard items from database
  void restorePinnedClipItems(s);

  /** The provider configuration saved for this profile (stored configurations without a kind are Orbis AI). */
  function storedAiConfig(): { endpoint: string; kind: ProviderKind; model?: string; vision: boolean } | undefined {
    const endpoint = s.catalog.getKv<string | null>('ai.endpoint', null);
    if (!endpoint) return undefined;
    const kind = s.catalog.getKv<string | null>('ai.kind', null) === 'openai-compatible' ? 'openai-compatible' : 'orbis';
    return { endpoint, kind, model: s.catalog.getKv<string | null>('ai.model', null) ?? undefined, vision: s.catalog.getKv<boolean | null>('ai.vision', null) === true };
  }

  function loadToken(): string | undefined {
    const enc = s.catalog.getKv<string | null>('ai.token', null);
    if (!enc || !safeStorage.isEncryptionAvailable()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return undefined;
    }
  }

  function applySettingSideEffects(key: string): void {
    const st = s.settings.all();
    if (key === 'maxConcurrentOperations') s.ops.maxConcurrent = st.maxConcurrentOperations;
    if (key === 'indexContents') {
      s.indexer.contentEnabled = st.indexContents;
      s.indexer.rebuild();
    }
    if (key === 'diagnosticsVerbose') s.log.verbose = st.diagnosticsVerbose;
    ctx.broadcast('settings:changed', st);
  }

  /**
   * Run a cancellable background job and report progress/completion to the requester.
   * Pausable jobs get a PauseGate their loops wait on between items; every progress
   * event carries the paused state, and pausing or resuming is reported at once.
   */
  function runJob<T>(jobId: string, wc: WebContents, fn: (signal: AbortSignal, progress: (p: unknown) => void, gate?: PauseGate) => Promise<T>, opts: { pausable?: boolean } = {}): { jobId: string; pausable: boolean } {
    jobs.get(jobId)?.ac.abort();
    const ac = new AbortController();
    const pausable = opts.pausable !== false;
    const gate = pausable ? new PauseGate(ac.signal) : undefined;
    const entry = { ac, gate };
    jobs.set(jobId, entry);
    let last = 0;
    let lastProgress: unknown;
    const offGate = gate?.onChange((paused) => sendTo(wc, 'job:progress', { jobId, progress: lastProgress, paused, pausable, stateOnly: true }));
    void fn(ac.signal, (progress) => {
      lastProgress = progress;
      const t = Date.now();
      if (t - last > 150) {
        last = t;
        sendTo(wc, 'job:progress', { jobId, progress, paused: !!gate?.isPaused, pausable });
      }
    }, gate)
      .then((value) => sendTo(wc, 'job:done', { jobId, ok: true, value, cancelled: ac.signal.aborted }))
      .catch((err) => sendTo(wc, 'job:done', { jobId, ok: false, error: toOrbisError(err, `job`), cancelled: ac.signal.aborted }))
      .finally(() => {
        offGate?.();
        if (jobs.get(jobId) === entry) jobs.delete(jobId);
      });
    return { jobId, pausable };
  }

  // Restore a configured AI provider (status still comes from a real handshake).
  const storedAi = storedAiConfig();
  if (storedAi) {
    try {
      s.ai.configureProvider({ ...storedAi, token: loadToken() });
      void s.ai.connect();
    } catch (err) {
      s.log.warn('ai.restore_failed', { kind: storedAi.kind, message: (err as Error).message });
    }
  }

  for (const channel of Object.keys(InvokeSchemas) as InvokeChannel[]) {
    const schema = InvokeSchemas[channel];
    const handler = handlers[channel] as Handler;
    ipcMain.handle(`${channelPrefix}${channel}`, async (event, payload): Promise<Result<unknown>> => {
      if (!isTrustedSender(event, ctx.rendererDirUrl)) {
        s.log.warn('ipc.rejected_sender', { channel });
        return { ok: false, error: { category: 'permission_denied', operation: channel, message: 'Request rejected.', dataChanged: 'no', retryable: false } };
      }
      const parsed = schema.safeParse(payload ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { ok: false, error: { category: 'validation', operation: channel, message: 'The request was not valid.', cause: `${issue?.path.join('.')}: ${issue?.message}`, dataChanged: 'no', retryable: false } };
      }
      const verdict = checkScope(channel, parsed.data);
      if (verdict.kind === 'empty') return { ok: true, value: verdict.value };
      if (verdict.kind === 'refused') {
        s.log.warn('scope.refused', { channel });
        return { ok: false, error: { category: 'permission_denied', operation: channel, message: verdict.message, dataChanged: 'no', retryable: false } };
      }
      try {
        const value = await handler(parsed.data as never, event);
        return { ok: true, value: value === undefined ? null : value };
      } catch (err) {
        const shape = toOrbisError(err, channel, undefined, 'unknown');
        if (shape.category === 'internal' || shape.category === 'io') shape.errorId = s.log.error('ipc.error', { channel, category: shape.category, cause: shape.cause ?? (err as Error)?.message });
        else s.log.debug('ipc.fail', { channel, category: shape.category });
        return { ok: false, error: shape };
      }
    });
  }

  // Push service events to every window.
  s.ops.on('update', (rec) => ctx.broadcast('ops:update', rec));
  // Finished operations are reported to the Orbis app's event sinks, once each.
  const reported = new Set<string>();
  s.ops.on('update', (rec) => {
    if (reported.has(rec.id) || !['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'].includes(rec.state)) return;
    reported.add(rec.id);
    emitHostEvent({ type: 'operation-finished', operation: { id: rec.id, type: rec.type, state: rec.state, origin: rec.origin, destination: rec.destination, summary: rec.summary } });
  });
  s.ops.on('removed', (id) => ctx.broadcast('ops:update', { id, removed: true }));
  s.ops.on('update', (rec) => {
    if ((rec.type === 'trash' || rec.type === 'trash-restore' || rec.type === 'trash-delete' || rec.type === 'sync' || rec.type === 'dedupe') && ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(rec.state)) trashChanged();
  });
  s.ops.on('conflict', (c) => ctx.broadcast('ops:conflict', c));
  // Terminal output and exits go only to the window that owns the session.
  const toOwner = (owner: number, channel: EventChannel, payload: unknown) => {
    const wc = webContents.fromId(owner);
    if (wc && !wc.isDestroyed()) sendFrames(wc, `${eventPrefix}${channel}`, payload);
  };
  s.terminals.on('data', (owner, payload) => toOwner(owner, 'term:data', payload));
  s.terminals.on('exit', (owner, payload) => toOwner(owner, 'term:exit', payload));
  s.shares.on('changed', (list: ShareSnapshot[]) => ctx.broadcast('share:changed', list));
  // A device sent a file into a share's folder: every window shows it, and a desktop notification when none is focused.
  s.shares.on('upload', (ev: ShareUploadEvent) => {
    ctx.broadcast('share:upload', ev);
    s.indexer.touch([ev.savedAs]);
    if (!s.settings.get('notifyWhenUnfocused') || BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
    const n = new Notification({ title: 'File received over the network', body: `${path.basename(ev.savedAs)} from ${ev.from}, saved in ${path.basename(path.dirname(ev.savedAs))}.` });
    n.on('click', () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) {
        if (w.isMinimized()) w.restore();
        w.focus();
      }
    });
    n.show();
  });
  s.indexer.on('status', (st) => ctx.broadcast('index:status', st));
  s.ai.on('status', (st) => ctx.broadcast('ai:status', st));
  s.ai.on('task', (t) => ctx.broadcast('ai:taskUpdate', t));
  s.catalog.on('changed', (what) => ctx.broadcast('cat:changed', { what }));
  // Customization: every window re-resolves; Electron follows the effective mode and interface scale.
  s.customization.on('changed', (state) => {
    applyCustomizationToElectron(s);
    ctx.broadcast('custom:changed', state);
  });
  nativeTheme.on('updated', () => applyCustomizationToElectron(s));
  // Drives: the main process polls the platform's mount list and tells every window
  // when a drive appears or disappears (capacity changes alone are not announced).
  let volumesKey: string | undefined;
  let polling = false;
  const pollVolumes = async () => {
    if (polling) return; // a slow network mount must not stack up polls
    polling = true;
    try {
      const vols = await listVolumes();
      const key = vols.map((v) => v.mountPath).sort().join('\n');
      if (volumesKey !== undefined && key !== volumesKey) ctx.broadcast('fs:volumesChanged', vols);
      volumesKey = key;
    } catch (err) {
      s.log.debug('volumes.poll_failed', { message: (err as Error).message });
    } finally {
      polling = false;
    }
  };
  void pollVolumes();
  setInterval(() => void pollVolumes(), 4000).unref();
  void os;
}

/** Profiles live side by side: userData/profiles/<id>. */
function profilesRoot(s: Services): string {
  return path.dirname(s.profileDir);
}

/** Restart Orbis Files on another profile (the caller has checked that no operation is running). */
function restartOnProfile(id: string): void {
  app.relaunch({ args: relaunchArgs(process.argv, id) });
  app.quit();
}

function isTrustedSender(event: IpcMainInvokeEvent, rendererDirUrl: string): boolean {
  if (!rendererDirUrl) return true;
  return isTrustedSenderUrl(event.senderFrame?.url, rendererDirUrl);
}

export function handleHostRequest(req: HostRequest, ctx: HandlerContext, target?: BrowserWindow): void {
  ctx.host.status = 'connected';
  ctx.host.lastRequestMs = Date.now();
  ctx.host.lastRequestType = req.type;
  const s = ctx.services;
  s.log.info('host.request', { type: req.type });
  const win = target ?? BrowserWindow.getAllWindows()[0];
  const forward = (channel: EventChannel, payload: unknown) => {
    if (win && !win.webContents.isDestroyed()) sendFrames(win.webContents, `${eventPrefix}${channel}`, payload);
  };
  const failed = (err: unknown) => {
    const e = toOrbisError(err, `host.${req.type}`);
    s.log.warn('host.request_failed', { type: req.type, category: e.category, message: e.message });
    forward('host:request', { type: 'request-failed', request: req.type, message: e.message });
  };
  switch (req.type) {
    case 'register-download':
      s.catalog.registerDownload({ ...req.download, source: 'host' });
      break;
    case 'register-generated':
      s.catalog.registerGenerated(req.item);
      break;
    case 'pick-file':
      void addPendingPick(req).then((pick) => {
        if (win && !win.isDestroyed()) win.focus();
        ctx.broadcast('host:pick', pendingPicks());
        forward('host:request', { type: 'pick-file', title: pick.title });
      }, failed);
      return;
    case 'report-status':
      void writeStatus(s, req.replyFile, req.requestId, app.getVersion(), ctx.host).then((file) => s.log.info('host.status_written', { file }), failed);
      return;
    case 'register-content-feed':
      try {
        registerFeed(s, req.feed);
        s.catalog.emit('changed', 'providers');
      } catch (err) {
        failed(err);
        return;
      }
      break;
    case 'unregister-content-feed':
      unregisterFeed(s, req.providerId);
      s.catalog.emit('changed', 'providers');
      break;
    case 'register-event-sink':
      void registerEventSink(req.sinkFile).then((f) => s.log.info('host.event_sink', { file: f }), failed);
      return;
    case 'unregister-event-sink':
      unregisterEventSink(req.sinkFile);
      break;
    case 'set-design-tokens': {
      const r = s.customization.setHostTokens(req.tokens);
      s.log.info('host.design_tokens', { accepted: r.accepted.length, rejected: r.rejected.length, error: r.error });
      if (r.error) {
        failed(makeError('validation', 'host.set-design-tokens', { message: `The Orbis app's design tokens were not used: ${r.error}` }));
        return;
      }
      break;
    }
    case 'clear-design-tokens':
      s.customization.clearHostTokens();
      break;
    case 'set-reserved-shortcuts': {
      const r = s.customization.setReservedShortcuts({ shortcuts: req.shortcuts, source: req.source ?? 'the Orbis app' });
      s.log.info('host.reserved_shortcuts', { reserved: r.reserved, rejected: r.rejected.length });
      return;
    }
    case 'report-commands': {
      const st = s.customization.state();
      void writeReplyFile(req.replyFile, {
        contract: HOST_CONTRACT_VERSION,
        requestId: req.requestId,
        commands: s.customization.commands(),
        note: s.customization.commands().length ? undefined : 'The command registry is reported by the Orbis Files window once it has loaded; ask again after the window is open.',
        reserved: { os: st.osReserved, host: st.hostReserved },
        writtenMs: Date.now(),
      }).then((file) => s.log.info('host.commands_written', { file }), failed);
      return;
    }
    case 'open-settings':
      if (!FILES_SETTINGS_ENTRY_POINTS.some((x) => x.id === req.entry)) {
        failed(makeError('validation', 'host.open-settings', { message: `Unknown settings entry “${req.entry}”.` }));
        return;
      }
      if (win && !win.isDestroyed()) win.focus();
      break;
    case 'offer-ai-provider': {
      const offer = AiProviderOfferSchema.safeParse(req);
      const u = offer.success ? new URL(offer.data.endpoint) : undefined;
      if (!u || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) {
        failed(makeError('validation', 'host.offer-ai-provider', { message: 'The offered AI endpoint must use HTTPS, or HTTP on this computer only. It was not offered to you.' }));
        return;
      }
      // Never switched on automatically: the window asks the user.
      if (win && !win.isDestroyed()) win.focus();
      break;
    }
    case 'set-profile': {
      if (req.profileId === s.profileId) break;
      try {
        checkCanSwitch(s.ops.list(), req.profileId, 'host.set-profile');
      } catch (err) {
        failed(err);
        return;
      }
      // Profiles are isolated databases; switching restarts Orbis Files on the requested profile.
      s.log.info('host.switch_profile', { from: s.profileId, to: req.profileId });
      restartOnProfile(req.profileId);
      return;
    }
    default:
      break;
  }
  forward('host:request', req);
}
