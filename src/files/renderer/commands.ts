import { app, openDialog, prompt, setSetting, toast, toastError, togglePanel } from './state/app';
import {
  activePane, activeTab, closeTab, currentLocation, cycleTab, duplicateTab, goHistory, goUp, isSplit, listingKeyFor, listings, navigate, openTab, otherPane,
  paneCount, parentPath, reload, reopenClosedTab, selectedEntries, setActivePane, setSelection, swapPanes, toggleSplit, updatePane, ws, type Pane,
} from './state/workspace';
import * as A from './actions';
import { call } from './api';
import type { FileEntry, Location, ViewMode, ToolId } from '../shared/model';
import { categoryOfEntry } from './ui/format';
import { applyCustom, custom, redoCustom, reportRegistry, resolvedNow, undoCustom } from './state/custom';
import { effectiveBindings, normalizeShortcut } from '../shared/customization/shortcuts';
import type { CommandDescriptor } from '../shared/integration/host-adapters';
import { computeChecksums } from './state/checksums';
import { folderSizesActive, startFolderSizes, stopFolderSizes } from './state/folderSizes';
import { isChecksumFileName } from '../shared/checksumFile';
import { sameTypePaths } from './features/selectPattern';
import { inShownOrder, shownEntries } from './features/arrange';
import { controlHandlesKey } from './ui/keyboard';
import { requestFindIn } from './state/docTools';
import { addToShelf, clearShelf, shelf, shelfTargets, shelfTransfer } from './state/shelf';
import { customActions, runCustomAction } from './state/customActions';
import { gitState, requestGit } from './state/git';
import { actionCommandId, appliesTo as actionAppliesTo, type CustomAction } from '../shared/customActions';
import { automation, setAutomationPaused } from './state/automation';
import { schedules, setSchedulesPaused } from './state/backups';
import { openInEditor, reloadFromDisk, save as saveEditor, saveAs as saveEditorAs, setPreview, setWrap, uiOf as editorUiOf, viewOf as editorViewOf } from './state/editor';
import { openViewer, viewerKind } from './state/viewer';
import { mediaKindOf } from '../shared/organize';
import { isRemoteRef, remoteRef } from '../shared/remote';
import { remote as remoteState, remoteAddress } from './state/remote';
import * as T from './state/terminal';
import { POWER_COMMANDS, POWER_IN_FOLDER, POWER_MODIFY, POWER_ON_SELECTION, POWER_READ } from './powerCommands';
import { systemClipboardHasContent } from './state/clipboard';
import * as PL from './state/player';
import * as DP from './state/dualPane';
import { previewTime, videoToolsReady } from './state/video';
import { isPlaylistPath } from '../shared/player';
import { OCR_COMMANDS } from './features/ocr/ocrCommands';
import { SCREENSHOT_COMMANDS } from './features/screenshotCommands';
import { openEbook, openComic, openModel } from './state/viewers';
import type { EbookManifest, ComicManifest, Model3DInfo } from '../shared/viewers';
import { closeQuickLook, isQuickLookOpen, toggleQuickLook } from './features/QuickLook';
import { toggleClipboardHistory } from './state/clipboardHistory';

/**
 * Central command registry. Toolbar buttons, context menus, keyboard
 * shortcuts and the command palette all execute these same commands.
 */

export interface CommandContext {
  pane: Pane;
  location: Location;
  selection: FileEntry[];
  dir?: string;
  /** For context menus invoked on a specific entry. */
  target?: FileEntry;
}

export interface Command {
  id: string;
  title: string;
  category: 'Navigate' | 'File' | 'Edit' | 'View' | 'Tools' | 'Window' | 'AI' | 'Customize' | 'Actions';
  icon?: string;
  /** Default bindings; the user's own bindings (Customization → Keyboard shortcuts) replace them. */
  keys?: string[];
  risk?: 'destructive' | 'normal';
  /** Longer explanation for the shortcut editor and the command registry adapter. */
  description?: string;
  /** Return true when available, or a string explaining why not. */
  when?: (c: CommandContext) => boolean | string;
  run: (c: CommandContext) => void | Promise<void>;
}

export function getContext(target?: FileEntry): CommandContext {
  const pane = activePane();
  const tab = activeTab();
  const loc = currentLocation(pane);
  const sel = selectedEntries(pane.id);
  void listingKeyFor(tab.id, pane);
  return { pane, location: loc, selection: target && !sel.some((e) => e.path === target.path) ? [target] : sel, dir: loc.kind === 'fs' ? loc.path : undefined, target };
}

const inFolder = (c: CommandContext) => (c.dir ? true : 'Only available inside a folder.');
/** A folder on this computer or on a server. */
const inAnyFolder = (c: CommandContext) => (c.dir || c.location.kind === 'remote' ? true : 'Only available inside a folder.');
const remoteFiles = (c: CommandContext) => c.selection.length > 0 && c.selection.every((e) => isRemoteRef(e.path));
const hasSel = (c: CommandContext) => (c.selection.length ? true : 'Select one or more items first.');
const oneSel = (c: CommandContext) => (c.selection.length === 1 ? true : 'Select exactly one item.');
const isDirEntry = (e?: FileEntry) => !!e && (e.kind === 'directory' || (e.kind === 'symlink' && e.linkTargetKind === 'directory'));
const setView = (view: ViewMode) => (c: CommandContext) => updatePane(c.pane.id, { view });
const twoPanes = () => (isSplit(activeTab()) ? true : 'Show more than one pane first (Toggle split view).');
const tool = (t: ToolId) => (c: CommandContext) => void navigate(c.pane.id, { kind: 'tool', tool: t });
/** Plain files and folders (links are refused by sharing and encryption; select what they point to). */
const filesOrFolders = (c: CommandContext, what: string) => (!c.selection.length ? 'Select files or folders first.' : c.selection.every((e) => e.kind === 'file' || e.kind === 'directory') ? true : `Links cannot be ${what}; select the item they point to.`);
const isOrbisEnc = (e: FileEntry) => e.kind === 'file' && e.name.toLowerCase().endsWith('.orbisenc');
/** The active built-in terminal tab. */
const activeTerm = () => T.terminal.get().tabs.find((t) => t.key === T.terminal.get().active);
const termRunning = (): true | string => {
  const t = activeTerm();
  return !t ? 'No terminal is open.' : t.status === 'running' ? true : t.status === 'starting' ? 'The terminal is still starting.' : 'The program in this terminal has ended.';
};
/** "Open terminal here": the one selected folder, else the folder shown. */
const terminalDir = (c: CommandContext): string | undefined => (c.selection.length === 1 && isDirEntry(c.selection[0]) ? c.selection[0]!.path : c.dir);
/* Music player and video tools: what the selection must be. */
const isFileEntry = (e: FileEntry) => e.kind === 'file' || (e.kind === 'symlink' && e.linkTargetKind === 'file');
const isAudioEntry = (e: FileEntry) => isFileEntry(e) && (categoryOfEntry(e) === 'audio' || isPlaylistPath(e.path));
const isVideoEntry = (e: FileEntry) => isFileEntry(e) && categoryOfEntry(e) === 'video';
const playableSel = (c: CommandContext): boolean | string => (c.selection.length && c.selection.every((e) => isAudioEntry(e) || isDirEntry(e)) ? true : 'Select audio files, playlists (.m3u, .m3u8, .pls) or folders.');
const queueReady = (): boolean | string => (PL.player.get().state.items.length ? true : 'The music queue is empty. Play some audio files first.');
/** Video tools: the selection check first, then whether FFmpeg can run them. */
const videoSel = (min: number, max: number, accept: (e: FileEntry) => boolean = isVideoEntry, what = 'video') => (c: CommandContext): boolean | string => {
  const n = c.selection.length;
  if (!n || !c.selection.every(accept)) return max === 1 ? `Select one ${what} file.` : `Select ${min > 1 ? `${min} or more ` : ''}${what} files.`;
  if (n < min) return `Select ${min} or more ${what} files.`;
  if (n > max) return max === 1 ? `Select one ${what} file.` : `Select at most ${max} ${what} files.`;
  return videoToolsReady();
};
const mediaEntry = (e: FileEntry) => isVideoEntry(e) || (isFileEntry(e) && categoryOfEntry(e) === 'audio');
const joinable = (c: CommandContext): boolean | string => {
  const r = videoSel(2, 50, mediaEntry, 'video')(c);
  if (r !== true) return r;
  return c.selection.every(isVideoEntry) || c.selection.every((e) => !isVideoEntry(e)) ? true : 'Join either videos or audio files, not both.';
};
const toolDialog = (id: string, many: boolean) => (c: CommandContext) => openDialog(id, many ? { paths: c.selection.map((e) => e.path) } : { path: c.selection[0]!.path });

/** PDF files (not links or folders) by extension; their contents are checked when they are opened. */
const isPdf = (e: FileEntry) => e.kind === 'file' && e.ext.toLowerCase() === 'pdf';
const pdfs = (min: number, max = Infinity) => (c: CommandContext): boolean | string => {
  if (!c.selection.length) return min > 1 ? `Select ${min} or more PDF files.` : 'Select a PDF file.';
  if (!c.selection.every(isPdf)) return 'Select PDF files only.';
  if (c.selection.length < min) return `Select ${min} or more PDF files.`;
  if (c.selection.length > max) return max === 1 ? 'Select one PDF file.' : `Select at most ${max} PDF files.`;
  return true;
};
/** Where new PDFs go: the folder shown, else the folder of the first PDF (e.g. in search results). */
const pdfDir = (c: CommandContext) => c.dir ?? parentPath(c.selection[0]!.path) ?? '/';
const openPdf = (tab: 'pages' | 'merge' | 'split' | 'extract') => (c: CommandContext) => openDialog('pdfTools', { paths: c.selection.map((e) => e.path).slice(0, 50), dir: pdfDir(c), tab });
/**
 * Slideshow items: two or more selected images/videos (in the order shown), else every image and
 * video of the folder shown, starting at the selected one.
 */
function slideshowItems(c: CommandContext): { entries: FileEntry[]; index: number } | string {
  const l = listings.get()[listingKeyFor(activeTab().id, c.pane)];
  const shown = l ? shownEntries(l.entries, c.pane) : [];
  const picked = c.selection.filter((e) => viewerKind(e));
  if (picked.length >= 2) {
    const order = inShownOrder(picked.map((e) => e.path), shown);
    const byPath = new Map(picked.map((e) => [e.path, e]));
    return { entries: order.map((p) => byPath.get(p)!), index: 0 };
  }
  const all = shown.filter((e) => viewerKind(e));
  if (!all.length) return c.dir ? 'No images or videos in this folder.' : 'Open a folder with images, or select images.';
  const start = c.selection[0] ? all.findIndex((e) => e.path === c.selection[0]!.path) : -1;
  return { entries: all, index: Math.max(0, start) };
}
/** Organize by date: selected files and folders, or the folder shown when nothing is selected. */
const organizeWhen = (c: CommandContext): boolean | string => {
  if (!c.selection.length) return c.dir ? true : 'Open a folder or select files and folders.';
  if (!c.selection.every((e) => e.kind === 'file' || e.kind === 'directory')) return 'Links are not organized; select what they point to.';
  return true;
};

/** The folder "Find and replace" starts in: one selected folder, else the folder shown. */
const findDir = (c: CommandContext): string | undefined => (c.selection.length === 1 && isDirEntry(c.selection[0]) ? c.selection[0]!.path : c.dir);
/** "Edit": one file (or a link to one); whether it is text is decided when it is opened. */
const oneFileToEdit = (c: CommandContext): boolean | string => {
  if (c.selection.length !== 1) return 'Select one file.';
  const e = c.selection[0]!;
  if (e.kind === 'file' || (e.kind === 'symlink' && e.linkTargetKind === 'file')) return true;
  return e.kind === 'symlink' && e.linkTargetKind === 'broken' ? 'This link points to an item that does not exist.' : 'Only files can be edited.';
};
/** Editor commands act on the active pane when it shows a file in the editor. */
const inEditor = (c: CommandContext): boolean | string => (c.location.kind !== 'editor' ? 'Only available in the editor.' : editorUiOf(c.pane.id)?.status === 'ready' ? true : 'The file is not open for editing.');

export const COMMANDS: Command[] = [
  // Navigate
  { id: 'nav.back', title: 'Back', category: 'Navigate', icon: 'back', keys: ['Alt+ArrowLeft', 'Mod+['], when: (c) => (c.pane.index > 0 ? true : 'No earlier location.'), run: (c) => goHistory(c.pane.id, -1) },
  { id: 'nav.forward', title: 'Forward', category: 'Navigate', icon: 'forward', keys: ['Alt+ArrowRight', 'Mod+]'], when: (c) => (c.pane.index < c.pane.history.length - 1 ? true : 'No later location.'), run: (c) => goHistory(c.pane.id, 1) },
  { id: 'nav.up', title: 'Go to parent folder', category: 'Navigate', icon: 'up', keys: ['Alt+ArrowUp', 'Backspace'], when: (c) => (c.location.kind === 'remote' ? (c.location.path !== '/' ? true : 'Already at the top of the server.') : c.location.kind === 'fs' && !/^([A-Za-z]:\\|\/)$/.test(c.location.path) ? true : 'Already at the top.'), run: (c) => goUp(c.pane.id) },
  { id: 'nav.refresh', title: 'Refresh', category: 'Navigate', icon: 'refresh', keys: ['F5', 'Mod+R'], run: (c) => reload(c.pane.id) },
  { id: 'nav.home', title: 'Go to Home', category: 'Navigate', icon: 'home', keys: ['Alt+Home'], run: (c) => void navigate(c.pane.id, { kind: 'home' }) },
  { id: 'nav.address', title: 'Edit path', category: 'Navigate', icon: 'path', keys: ['Mod+L'], run: (c) => document.dispatchEvent(new CustomEvent('orbis:focus-address', { detail: c.pane.id })) },
  { id: 'nav.quickOpen', title: 'Go to file or folder…', category: 'Navigate', icon: 'search', keys: ['Mod+P'], description: 'Quick switcher: find recent items, pinned places, open tabs, this folder’s items and indexed files by typing part of their name.', run: () => app.set({ switcherOpen: true, paletteOpen: false }) },
  { id: 'nav.search', title: 'Search', category: 'Navigate', icon: 'search', keys: ['Mod+F'], description: 'Focuses the search box; in the editor it opens Find and replace for the file.', run: (c) => {
    if (c.location.kind === 'editor' && editorViewOf(c.pane.id)) editorViewOf(c.pane.id)!.openSearch();
    else document.dispatchEvent(new CustomEvent('orbis:focus-search', { detail: c.pane.id }));
  } },
  { id: 'nav.searchSelected', title: 'Search in selected folders…', category: 'Navigate', icon: 'search', when: (c) => (c.selection.some(isDirEntry) ? true : 'Select one or more folders.'), run: async (c) => {
    const q = await prompt({ title: `Search in ${c.selection.filter(isDirEntry).length} folder(s)`, label: 'Search for (names, or filters such as type:pdf size:>10MB)', initial: '', confirmLabel: 'Search', validate: async (v) => (v.trim() ? (await call<{ ok: boolean; message?: string }>('search:parse', { query: v })).message : 'Enter something to search for.') });
    if (q) void navigate(c.pane.id, { kind: 'search', query: q.trim(), scope: c.selection.filter(isDirEntry).map((e) => e.path).slice(0, 64) });
  } },
  { id: 'nav.searchDrives', title: 'Search all drives…', category: 'Navigate', icon: 'drive', keys: ['Mod+Alt+F'], when: () => (app.get().volumes.length ? true : 'No drives are available.'), run: async (c) => {
    const q = await prompt({ title: 'Search all drives', label: 'Search for (unindexed drives are searched directly and may take a while)', initial: '', confirmLabel: 'Search', validate: async (v) => (v.trim() ? (await call<{ ok: boolean; message?: string }>('search:parse', { query: v })).message : 'Enter something to search for.') });
    if (q) void navigate(c.pane.id, { kind: 'search', query: q.trim(), scope: app.get().volumes.map((v) => v.mountPath).slice(0, 64) });
  } },
  { id: 'go.trash', title: 'Go to Trash', category: 'Navigate', icon: 'trash', keys: ['Mod+Shift+Delete'], description: 'Shows what is in the Trash, with restore and permanent delete (Linux; elsewhere it explains where to find the system Trash).', run: tool('trash') },
  { id: 'nav.newTab', title: 'New tab', category: 'Window', icon: 'tab', keys: ['Mod+T'], run: (c) => void openTab(c.location) },
  { id: 'nav.closeTab', title: 'Close tab', category: 'Window', keys: ['Mod+W'], run: () => closeTab(ws.get().activeTabId) },
  { id: 'nav.reopenTab', title: 'Reopen closed tab', category: 'Window', keys: ['Mod+Shift+T'], when: () => (ws.get().closed.length ? true : 'No recently closed tabs.'), run: () => reopenClosedTab() },
  { id: 'nav.nextTab', title: 'Next tab', category: 'Window', keys: ['Ctrl+Tab'], run: () => cycleTab(1) },
  { id: 'nav.prevTab', title: 'Previous tab', category: 'Window', keys: ['Ctrl+Shift+Tab'], run: () => cycleTab(-1) },
  { id: 'nav.duplicateTab', title: 'Duplicate tab', category: 'Window', keys: ['Mod+Shift+K'], run: () => duplicateTab(ws.get().activeTabId) },
  { id: 'nav.newWindow', title: 'New window', category: 'Window', icon: 'window', keys: ['Mod+N'], run: (c) => void call('win:new', { path: c.dir }).catch(toastError) },
  { id: 'nav.split', title: 'Toggle split view', category: 'View', icon: 'split', keys: ['Mod+\\'], description: 'Switches this tab between one pane and the multi-pane arrangement of your layout (two side by side if the layout has one pane).', run: () => toggleSplit() },
  { id: 'nav.swapPanes', title: 'Swap panes', category: 'View', icon: 'swap', keys: ['Alt+F6'], when: twoPanes, run: () => swapPanes() },
  { id: 'nav.otherPane', title: 'Focus next pane', category: 'View', keys: ['F6'], when: twoPanes, run: () => setActivePane(activeTab().id, (activeTab().activePane + 1) % paneCount(activeTab())) },

  // Quick Look (spacebar preview)
  { id: 'view.quickLook', title: 'Quick Look', category: 'View', icon: 'eye', keys: [' '],
    description: 'Preview the selected file in a floating overlay. Press Space or Escape to dismiss; arrow keys to move between files.',
    when: (c) => {
      if (isQuickLookOpen()) return true;
      if (!c.selection.length) return 'Select a file first.';
      if (c.selection.length !== 1) return 'Select one file.';
      if (c.selection[0]!.kind !== 'file' && !(c.selection[0]!.kind === 'symlink' && c.selection[0]!.linkTargetKind === 'file')) return 'Quick Look works on files.';
      return true;
    },
    run: (c) => {
      if (isQuickLookOpen()) { closeQuickLook(); return; }
      if (!c.selection.length) return;
      const entries = c.selection;
      const allEntries = (() => { try { const l = listings.get()[listingKeyFor(activeTab().id, c.pane)]; return l ? shownEntries(l.entries, c.pane) : []; } catch { return []; } })();
      const fileEntries = allEntries.filter((e) => e.kind === 'file' || (e.kind === 'symlink' && e.linkTargetKind === 'file'));
      const currentIndex = fileEntries.findIndex((e) => e.path === entries[0]!.path);
      toggleQuickLook(entries[0]!.path, {
        prev: () => { const i = currentIndex > 0 ? currentIndex - 1 : fileEntries.length - 1; return fileEntries[i]?.path; },
        next: () => { const i = currentIndex < fileEntries.length - 1 ? currentIndex + 1 : 0; return fileEntries[i]?.path; },
      });
    },
  },

  // File
  { id: 'file.open', title: 'Open', category: 'File', icon: 'open', keys: ['Enter'], when: hasSel, run: async (c) => { for (const e of c.selection.slice(0, 20)) await A.openEntry(c.pane.id, e); } },
  { id: 'file.edit', title: 'Edit', category: 'File', icon: 'edit', keys: ['F4'], description: 'Opens the selected text file in the built-in editor beside the file list (in the other pane; a tab with one pane is split first). Binary files and files over 5 MB are offered to their default app instead.', when: oneFileToEdit, run: (c) => openInEditor(c.selection[0]!.path, 'beside') },
  { id: 'file.openInEditor', title: 'Open in editor', category: 'File', icon: 'edit', description: 'Opens the selected text file in the built-in editor in a new tab.', when: oneFileToEdit, run: (c) => openInEditor(c.selection[0]!.path, 'tab') },
  { id: 'file.openWith', title: 'Open with…', category: 'File', icon: 'openWith', keys: ['Shift+Enter'], when: (c) => (c.selection.length !== 1 ? 'Select one file.' : c.selection[0]!.kind === 'file' || (c.selection[0]!.kind === 'symlink' && c.selection[0]!.linkTargetKind === 'file') ? true : 'Choose an application for files only.'), run: (c) => openDialog('openWith', { path: c.selection[0]!.path }) },
  { id: 'file.openTab', title: 'Open in new tab', category: 'File', icon: 'tab', keys: ['Mod+Enter'], when: (c) => (c.selection.some(isDirEntry) ? true : 'Select a folder.'), run: (c) => { for (const e of c.selection.filter(isDirEntry)) void A.openEntry(c.pane.id, e, 'tab'); } },
  { id: 'file.openWindow', title: 'Open in new window', category: 'File', icon: 'window', when: (c) => (c.selection.length === 1 && isDirEntry(c.selection[0]) ? true : 'Select one folder.'), run: (c) => void A.openEntry(c.pane.id, c.selection[0]!, 'window') },
  { id: 'file.newFolder', title: 'New folder', category: 'File', icon: 'newFolder', keys: ['Mod+Shift+N'], when: inAnyFolder, run: (c) => A.newFolder(c.pane.id) },
  { id: 'file.newText', title: 'New text file', category: 'File', icon: 'newFile', keys: ['Mod+Alt+X'], when: inFolder, run: (c) => A.newFile(c.pane.id, 'text') },
  { id: 'file.newMarkdown', title: 'New Markdown file', category: 'File', icon: 'newFile', when: inFolder, run: (c) => A.newFile(c.pane.id, 'markdown') },
  { id: 'file.newJson', title: 'New JSON file', category: 'File', icon: 'newFile', when: inFolder, run: (c) => A.newFile(c.pane.id, 'json') },
  { id: 'file.newEmpty', title: 'New empty file', category: 'File', icon: 'newFile', when: inFolder, run: (c) => A.newFile(c.pane.id, 'empty') },
  { id: 'file.newFromTemplate', title: 'New file from template…', category: 'File', icon: 'newFile', description: 'Creates a copy of a file from your templates folder (Settings → Your data; on Linux the desktop’s Templates folder by default).', when: inFolder, run: (c) => openDialog('templates', { paneId: c.pane.id }) },
  { id: 'file.rename', title: 'Rename', category: 'File', icon: 'rename', keys: ['F2'], when: (c) => (c.selection.length === 1 ? true : c.selection.length > 1 ? 'Use Bulk rename for several items.' : 'Select an item.'), run: (c) => A.renameEntry(c.pane.id, c.selection[0]!) },
  { id: 'file.bulkRename', title: 'Bulk rename…', category: 'File', icon: 'bulkRename', keys: ['Mod+Shift+R'], when: (c) => (c.selection.length > 1 ? true : 'Select two or more items.'), run: (c) => {
    // Numbering follows the order the items are shown in (the selection itself is kept in folder-listing order).
    const l = listings.get()[listingKeyFor(activeTab().id, c.pane)];
    openDialog('bulkRename', { paths: inShownOrder(c.selection.map((e) => e.path), l ? shownEntries(l.entries, c.pane) : []) });
  } },
  { id: 'edit.copy', title: 'Copy', category: 'Edit', icon: 'copy', keys: ['Mod+C'], when: hasSel, run: (c) => A.copyToClipboard(c.selection, 'copy') },
  { id: 'edit.cut', title: 'Cut', category: 'Edit', icon: 'cut', keys: ['Mod+X'], when: hasSel, run: (c) => A.copyToClipboard(c.selection, 'cut') },
  { id: 'edit.paste', title: 'Paste', category: 'Edit', icon: 'paste', keys: ['Mod+V'], description: 'Pastes what was copied or cut: files from Orbis Files or another file manager; an image or text on the clipboard opens “Paste image/text as file”.', when: (c) => (!c.dir && c.location.kind !== 'remote' ? 'Open a folder to paste into.' : app.get().clipboard || systemClipboardHasContent() ? true : 'Nothing to paste.'), run: (c) => A.paste(c.pane.id) },
  { id: 'file.duplicate', title: 'Duplicate', category: 'File', icon: 'duplicate', keys: ['Mod+D'], when: hasSel, run: (c) => A.duplicateEntries(c.selection) },
  { id: 'file.trash', title: 'Move to Trash', category: 'File', icon: 'trash', keys: ['Delete'], risk: 'destructive', when: (c) => (!c.selection.length ? 'Select items first.' : app.get().capabilities?.trash ? true : 'Trash is not available on this system.'), run: (c) => A.trashEntries(c.selection) },
  { id: 'file.delete', title: 'Delete permanently…', category: 'File', icon: 'deleteForever', keys: ['Shift+Delete'], risk: 'destructive', when: hasSel, run: (c) => A.deletePermanently(c.selection) },
  { id: 'file.copyPath', title: 'Copy path', category: 'Edit', icon: 'path', keys: ['Mod+Shift+C'], when: (c) => (c.selection.length || c.dir ? true : 'Nothing to copy.'), run: (c) => A.copyPaths(c.selection.length ? c.selection : [{ path: c.dir!, name: c.dir! } as FileEntry], 'path') },
  { id: 'file.copyName', title: 'Copy name', category: 'Edit', keys: ['Mod+Shift+X'], when: hasSel, run: (c) => A.copyPaths(c.selection, 'name') },
  { id: 'file.copyUri', title: 'Copy as file link (file://)', category: 'Edit', icon: 'link', when: hasSel, run: (c) => A.copyPaths(c.selection, 'uri') },
  { id: 'file.copyRelativePath', title: 'Copy path relative to this folder', category: 'Edit', icon: 'path', when: (c) => (!c.selection.length ? 'Select one or more items.' : c.dir ? true : 'Only available inside a folder.'), run: (c) => void A.copyPathsAs(c.selection.map((e) => e.path), 'relative', c.dir) },
  { id: 'file.copyPosixPath', title: 'Copy path with / separators (POSIX)', category: 'Edit', icon: 'path', when: hasSel, run: (c) => void A.copyPathsAs(c.selection.map((e) => e.path), 'posix') },
  { id: 'file.copyWindowsPath', title: 'Copy path with \\ separators (Windows)', category: 'Edit', icon: 'path', when: hasSel, run: (c) => void A.copyPathsAs(c.selection.map((e) => e.path), 'windows') },
  { id: 'file.copyQuotedPath', title: 'Copy path quoted for the shell', category: 'Edit', icon: 'path', description: 'Copies the paths quoted so a shell reads each as one argument (single quotes for sh/bash/zsh; PowerShell quoting on Windows), separated by spaces.', when: hasSel, run: (c) => void A.copyPathsAs(c.selection.map((e) => e.path), 'quoted') },
  { id: 'file.copyContents', title: 'Copy file contents as text', category: 'Edit', icon: 'copy', description: 'Copies the text of a UTF-8 text file of up to 1 MB to the clipboard. Binary files and other encodings are refused.', when: (c) => (c.selection.length !== 1 ? 'Select one text file.' : c.selection[0]!.kind !== 'file' && c.selection[0]!.linkTargetKind !== 'file' ? 'Select a file.' : (c.selection[0]!.size ?? 0) > 1024 * 1024 ? 'Only files up to 1 MB are copied as text.' : true), run: (c) => void A.copyFileContents(c.selection[0]!) },
  { id: 'file.permissions', title: 'Permissions…', category: 'File', icon: 'permissions', when: (c) => (c.selection.length !== 1 ? 'Select one item.' : c.selection[0]!.kind === 'symlink' ? 'Change permissions on the item the link points to.' : c.selection[0]!.mode === undefined ? 'Permissions are not available for this item.' : true), run: (c) => openDialog('permissions', { entry: c.selection[0]!, onDone: () => reload(c.pane.id) }) },
  { id: 'file.reveal', title: 'Show in system file manager', category: 'File', icon: 'external', keys: ['Mod+Shift+E'], when: (c) => (c.selection.length === 1 || c.dir ? true : 'Select one item.'), run: (c) => void call('fs:reveal', { path: c.selection[0]?.path ?? c.dir! }).catch(toastError) },
  { id: 'file.properties', title: 'Properties', category: 'File', icon: 'info', keys: ['Alt+Enter', 'Mod+I'], description: 'Shows the details panel with the properties of the selection.', run: () => void showDetailsPanel() },
  { id: 'file.copyToOther', title: 'Copy to other pane', category: 'File', icon: 'copyTo', keys: ['F7'], description: 'Copies the selection into the folder shown in the other (previously active) pane, through the operation queue.', when: (c) => (twoPanes() !== true ? twoPanes() : c.selection.length ? (otherPane(c.pane.id) ? true : 'No other pane.') : 'Select items first.'), run: (c) => A.transferToOtherPane(c.pane.id, 'copy') },
  { id: 'file.moveToOther', title: 'Move to other pane', category: 'File', icon: 'moveTo', keys: ['F8'], description: 'Moves the selection into the folder shown in the other (previously active) pane, through the operation queue.', when: (c) => (twoPanes() !== true ? twoPanes() : c.selection.length ? (otherPane(c.pane.id) ? true : 'No other pane.') : 'Select items first.'), run: (c) => A.transferToOtherPane(c.pane.id, 'move') },
  { id: 'file.checksum', title: 'Calculate checksum (SHA-256)', category: 'File', icon: 'verify', description: 'Reads the selected files and shows their SHA-256 checksums in the Checksum column and the details panel.', when: (c) => (c.selection.some((e) => e.kind === 'file') ? true : 'Select one or more files.'), run: (c) => void computeChecksums(c.selection.filter((e) => e.kind === 'file')) },
  { id: 'file.createChecksums', title: 'Create checksum file…', category: 'File', icon: 'verify', description: 'Calculates SHA-256 for the selected files (folders included, links skipped) and saves them in this folder as SHA256SUMS or <name>.sha256 in GNU coreutils format, as an operation you can pause.', when: (c) => (!c.dir ? 'Only available inside a folder.' : c.selection.length ? true : 'Select files or folders first.'), run: (c) => void A.createChecksumFile(c.pane.id, c.selection) },
  { id: 'file.verifyChecksums', title: 'Verify checksum file', category: 'File', icon: 'verify', description: 'Reads a SHA256SUMS, .sha256, .sha1, .md5 (or similar) file in GNU or BSD format and checks every listed file next to it.', when: (c) => (c.selection.length === 1 && c.selection[0]!.kind === 'file' && isChecksumFileName(c.selection[0]!.name) ? true : 'Select one checksum file (SHA256SUMS, .sha256, .sha1, .md5…).'), run: (c) => openDialog('checksumVerify', { path: c.selection[0]!.path }) },
  { id: 'file.quickZip', title: 'Compress to .zip', category: 'File', icon: 'archive', description: 'Makes a ZIP archive of the selection in this folder at once, named after the item (or Archive.zip). An existing archive is never replaced; a numbered name is used instead.', when: (c) => (!c.dir ? 'Only available inside a folder.' : !c.selection.length ? 'Select items first.' : c.selection.every((e) => parentPath(e.path) === c.dir) ? true : 'Select items in this folder.'), run: (c) => void A.quickZip(c.pane.id, c.selection) },
  { id: 'file.openTerminal', title: 'Open terminal here', category: 'File', icon: 'fileExe', keys: ['Mod+Alt+T'], description: 'Starts the system’s terminal in the selected folder, or else in the folder shown.', when: (c) => (app.get().terminal === null ? 'No terminal application was found on this system.' : terminalDir(c) ? true : 'Only available inside a folder.'), run: (c) => void A.openTerminalIn(terminalDir(c)!) },
  { id: 'file.compress', title: 'Compress…', category: 'File', icon: 'archive', keys: ['Mod+Shift+Z'], when: (c) => (!c.dir ? 'Only available inside a folder.' : c.selection.length ? true : 'Select items first.'), run: (c) => A.compressEntries(c.pane.id, c.selection) },
  { id: 'file.encrypt', title: 'Encrypt…', category: 'File', icon: 'lock', description: 'Saves a password-encrypted copy of each selected file (and of every file inside selected folders) as name.orbisenc next to it, with AES-256-GCM. The originals stay unless you choose to move them to the Trash.', when: (c) => filesOrFolders(c, 'encrypted'), run: (c) => openDialog('encrypt', { paths: c.selection.map((e) => e.path), folders: c.selection.filter((e) => e.kind === 'directory').length }) },
  { id: 'file.decrypt', title: 'Decrypt…', category: 'File', icon: 'unlock', description: 'Decrypts .orbisenc files (or every .orbisenc file inside selected folders) next to them, with their original names; nothing is replaced.', when: (c) => (c.selection.some((e) => isOrbisEnc(e) || e.kind === 'directory') ? true : 'Select .orbisenc files, or folders that contain them.'), run: (c) => openDialog('decrypt', { paths: c.selection.filter((e) => isOrbisEnc(e) || e.kind === 'directory').map((e) => e.path) }) },
  { id: 'file.shareLan', title: 'Share on local network…', category: 'File', icon: 'share', description: 'Lets a phone or another computer on the same network download the selection through a temporary link and QR code (plain HTTP, read-only unless you allow uploads).', when: (c) => filesOrFolders(c, 'shared'), run: (c) => openDialog('shareStart', { paths: c.selection.map((e) => e.path), dir: c.dir, folders: c.selection.filter((e) => e.kind === 'directory').length }) },
  { id: 'file.extractHere', title: 'Extract here', category: 'File', icon: 'extract', when: (c) => (c.selection.length === 1 && categoryOfEntry(c.selection[0]!) === 'archive' ? true : 'Select one archive.'), run: (c) => A.extractEntry(c.pane.id, c.selection[0]!, 'here') },
  { id: 'file.extractFolder', title: 'Extract to new folder', category: 'File', icon: 'extract', when: (c) => (c.selection.length === 1 && categoryOfEntry(c.selection[0]!) === 'archive' ? true : 'Select one archive.'), run: (c) => A.extractEntry(c.pane.id, c.selection[0]!, 'subfolder') },
  { id: 'file.extractTo', title: 'Extract to…', category: 'File', icon: 'extract', when: (c) => (c.selection.length === 1 && categoryOfEntry(c.selection[0]!) === 'archive' ? true : 'Select one archive.'), run: (c) => A.extractEntry(c.pane.id, c.selection[0]!, 'choose') },
  { id: 'file.testArchive', title: 'Test archive integrity', category: 'Tools', icon: 'verify', when: (c) => (c.selection.length === 1 && categoryOfEntry(c.selection[0]!) === 'archive' ? true : 'Select one archive.'), run: (c) => void import('./features/FileDialogs').then((m) => m.testArchiveIntegrity(c.selection[0]!.path)) },
  { id: 'file.browseArchive', title: 'Browse archive', category: 'File', icon: 'archive', when: (c) => (c.selection.length === 1 && categoryOfEntry(c.selection[0]!) === 'archive' ? true : 'Select one archive.'), run: (c) => void navigate(c.pane.id, { kind: 'archive', archivePath: c.selection[0]!.path, inner: '' }) },
  { id: 'file.convertArchive', title: 'Convert archive…', category: 'File', icon: 'convert', description: 'Convert an archive to another format (ZIP, 7z, TAR.GZ, TAR.BZ2, TAR.XZ). The original is kept unchanged.', when: (c) => (c.selection.length === 1 && categoryOfEntry(c.selection[0]!) === 'archive' ? true : 'Select one archive.'), run: (c) => openDialog('archiveConvert', { archivePath: c.selection[0]!.path, currentFormat: c.selection[0]!.ext }) },
  { id: 'file.link', title: 'Create link', category: 'File', icon: 'link', when: (c) => (app.get().capabilities?.symlinkCreate === false ? 'Not supported on this system.' : !c.dir ? 'Only available inside a folder.' : oneSel(c)), run: (c) => A.createLink(c.pane.id, c.selection[0]!) },
  { id: 'file.compare', title: 'Compare', category: 'Tools', icon: 'compare', when: (c) => (c.selection.length === 2 ? true : 'Select exactly two items.'), run: (c) => (c.selection.every((e) => categoryOfEntry(e) === 'image') ? openDialog('imageCompare', { left: c.selection[0]!.path, right: c.selection[1]!.path }) : openDialog('compare', { left: c.selection[0]!.path, right: c.selection[1]!.path, bothDirs: c.selection.every(isDirEntry) })) },
  { id: 'file.convert', title: 'Convert…', category: 'File', icon: 'convert', when: (c) => (!c.dir ? 'Only available inside a folder.' : !c.selection.length ? 'Select images, audio or video.' : c.selection.every((e) => categoryOfEntry(e) === 'image') || c.selection.every((e) => ['audio', 'video'].includes(categoryOfEntry(e))) ? true : 'Select only images, or only audio and video.'), run: (c) => openDialog('convert', { paths: c.selection.map((e) => e.path), dir: c.dir! }) },
  { id: 'file.organizeByDate', title: 'Organize by date…', category: 'File', icon: 'organizeDate', description: 'Moves or copies photos and videos (or every file) into folders such as 2024/05, named from the date taken (EXIF), the video recording date or the modification date. Shows every destination and conflict before anything changes; one operation, undoable.',
    when: organizeWhen, run: (c) => {
      const paths = c.selection.length ? c.selection.map((e) => e.path) : [c.dir!];
      const destination = c.dir ?? parentPath(c.selection[0]!.path) ?? '/';
      const folders = c.selection.length ? c.selection.filter((e) => e.kind === 'directory').length : 1;
      const media = c.selection.filter((e) => e.kind === 'file' && mediaKindOf(e.ext) !== 'other').length;
      openDialog('organizeDate', { paths, destination, folders, media });
    } },
  { id: 'file.imageTools', title: 'Batch image tools…', category: 'File', icon: 'imageTools', description: 'Resize, crop to an aspect ratio, rotate, flip, remove metadata or convert the selected images. New files are saved next to the originals or in a folder you choose; nothing is overwritten.',
    when: (c) => (!c.selection.length ? 'Select one or more images.' : c.selection.every((e) => categoryOfEntry(e) === 'image') ? true : 'Select only images.'), run: (c) => openDialog('imageTools', { paths: c.selection.map((e) => e.path) }) },
  { id: 'file.snapshot', title: 'Save a snapshot', category: 'File', icon: 'history', when: oneSel, run: async (c) => {
    try {
      const s = await call<{ kind: string }>('snap:create', { path: c.selection[0]!.path });
      toast({ level: 'success', title: s.kind === 'file-copy' ? 'Snapshot saved (restorable copy)' : 'Folder manifest saved', detail: s.kind === 'file-copy' ? undefined : 'Records names, sizes and checksums only. It shows what changed but cannot restore contents.' });
    } catch (err) {
      toastError(err, 'Snapshot not saved');
    }
  } },
  // Document tools
  { id: 'file.pdfTools', title: 'PDF tools…', category: 'File', icon: 'filePdf', description: 'Shows the pages of the selected PDF to delete, turn or reorder them, and offers merge, split and extract. Always makes new PDFs; the selected files are not changed.', when: pdfs(1, 50), run: openPdf('pages') },
  { id: 'file.pdfMerge', title: 'Merge PDFs…', category: 'File', icon: 'merge', description: 'Joins the selected PDFs, in an order you choose, into a new PDF.', when: pdfs(2, 50), run: openPdf('merge') },
  { id: 'file.pdfSplit', title: 'Split PDF…', category: 'File', icon: 'splitDoc', description: 'Makes one new PDF per page, or one per page range (such as 1-3, 5, 7-).', when: pdfs(1, 1), run: openPdf('split') },
  { id: 'file.pdfExtract', title: 'Extract PDF pages…', category: 'File', icon: 'extractPages', description: 'Copies chosen pages of a PDF into a new PDF.', when: pdfs(1, 1), run: openPdf('extract') },
  { id: 'file.textFixes', title: 'Fix text files…', category: 'File', icon: 'textFix', description: 'Converts text files to UTF-8, sets LF or CRLF line endings, trims trailing spaces, adds a final newline or removes a BOM — previewed per file, snapshot first, undoable.', when: (c) => (!c.selection.length ? 'Select one or more text files.' : c.selection.every((e) => e.kind === 'file') ? (c.selection.length <= 2000 ? true : 'Select at most 2,000 files.') : 'Select files only (not folders or links).'), run: (c) => openDialog('textFix', { paths: c.selection.map((e) => e.path) }) },
  { id: 'tools.findReplace', title: 'Find and replace in files…', category: 'Tools', icon: 'replace', keys: ['Mod+Shift+H'], description: 'Searches the text files in a folder (the selected folder or the one shown), lists the matches by file, previews each change as a diff and replaces the chosen matches with snapshots and undo.', run: (c) => {
    requestFindIn(findDir(c), c.pane.id);
    void navigate(c.pane.id, { kind: 'tool', tool: 'findReplace' });
  } },
  { id: 'file.pin', title: 'Pin to sidebar', category: 'File', icon: 'pin', keys: ['Mod+Shift+B'], when: (c) => ((c.selection.length === 1 && isDirEntry(c.selection[0])) || (!c.selection.length && c.dir) ? true : 'Select one folder.'), run: (c) => A.pinPath(c.selection[0]?.path ?? c.dir!) },
  { id: 'file.collect', title: 'Add to collection…', category: 'File', icon: 'collection', when: hasSel, run: (c) => A.addToCollectionDialog(c.selection) },
  { id: 'file.addToProject', title: 'Add to project…', category: 'File', icon: 'project', when: hasSel, run: (c) => openDialog('addToProject', { paths: c.selection.map((e) => e.path) }) },
  { id: 'file.addAsProject', title: 'Add as project…', category: 'File', icon: 'project', when: (c) => ((c.selection.length === 1 && isDirEntry(c.selection[0])) || (!c.selection.length && c.dir) ? true : 'Select one folder.'), run: (c) => void import('./features/views/ProjectsView').then((m) => m.addFolderAsProject(c.selection[0]?.path ?? c.dir!)) },
  { id: 'file.import', title: 'Import a copy into Orbis Library', category: 'File', icon: 'import', when: hasSel, run: async (c) => {
    const r = await call<{ folder: string; operation: { id: string } }>('lib:import', { paths: c.selection.map((e) => e.path) }).catch((e) => {
      toastError(e);
      return null;
    });
    if (!r) return;
    A.watchOperation(r.operation.id);
    toast({ level: 'info', title: `Copying ${c.selection.length} item${c.selection.length === 1 ? '' : 's'} into the Orbis Library`, detail: `${r.folder} — the originals stay where they are.` });
  } },
  { id: 'tools.projects', title: 'Projects', category: 'Tools', icon: 'project', run: tool('projects') },
  { id: 'file.tag', title: 'Tags…', category: 'File', icon: 'tag', keys: ['Mod+Shift+G'], when: hasSel, run: (c) => A.tagDialog(c.selection) },
  { id: 'edit.selectAll', title: 'Select all', category: 'Edit', keys: ['Mod+A'], run: (c) => {
    const l = listings.get()[listingKeyFor(activeTab().id, c.pane)];
    // Only what the view shows: items hidden by the filter are never selected (and then deleted) unseen.
    if (l) setSelection(c.pane.id, shownEntries(l.entries, c.pane).map((e) => e.path));
  } },
  { id: 'edit.invertSelection', title: 'Invert selection', category: 'Edit', keys: ['Mod+Shift+I'], run: (c) => {
    const l = listings.get()[listingKeyFor(activeTab().id, c.pane)];
    if (!l) return;
    const sel = new Set(c.pane.selection);
    setSelection(c.pane.id, l.entries.filter((e) => !sel.has(e.path)).map((e) => e.path));
  } },
  { id: 'edit.clearSelection', title: 'Clear selection', category: 'Edit', keys: ['Escape'], run: (c) => setSelection(c.pane.id, []) },
  { id: 'edit.selectPattern', title: 'Select by pattern…', category: 'Edit', icon: 'search', keys: ['Mod+Shift+A'], description: 'Selects items by a wildcard pattern (*.jpg), a regular expression, or their type and extension; replace, add to or remove from the selection.', when: (c) => (listings.get()[listingKeyFor(activeTab().id, c.pane)]?.entries.length ? true : 'Open a folder or search with items first.'), run: (c) => openDialog('selectPattern', { paneId: c.pane.id }) },
  { id: 'edit.selectSameType', title: 'Select items of the same type', category: 'Edit', description: 'Selects every item with the same extension as a selected file (and all folders when a folder is selected).', when: hasSel, run: (c) => {
    const l = listings.get()[listingKeyFor(activeTab().id, c.pane)];
    if (l) setSelection(c.pane.id, sameTypePaths(l.entries, c.selection.map((e) => e.path)));
  } },

  // Editor (the active pane shows a file in the built-in editor)
  { id: 'editor.save', title: 'Save', category: 'File', icon: 'save', keys: ['Mod+S'], description: 'Saves the file open in the editor in its own encoding and line endings. If another program changed it meanwhile you are asked what to keep; the previous version is kept as a snapshot.', when: inEditor, run: (c) => void saveEditor(c.pane.id) },
  { id: 'editor.saveAs', title: 'Save as…', category: 'File', icon: 'exportFile', keys: ['Mod+Alt+S'], description: 'Saves the editor text as a new file (choose name, folder, encoding and line endings). An existing file is only replaced after you confirm.', when: inEditor, run: (c) => void saveEditorAs(c.pane.id) },
  { id: 'editor.find', title: 'Find and replace in file', category: 'Edit', icon: 'replace', description: 'Opens the editor’s search panel (text or regular expression, match case, whole word, replace one or all). Ctrl+F inside the editor does the same.', when: inEditor, run: (c) => editorViewOf(c.pane.id)?.openSearch() },
  { id: 'editor.gotoLine', title: 'Go to line…', category: 'Edit', icon: 'gotoLine', keys: ['Mod+G'], description: 'Moves the cursor to a line (also line:column, or +/- relative lines).', when: inEditor, run: (c) => editorViewOf(c.pane.id)?.gotoLine() },
  { id: 'editor.toggleWrap', title: 'Soft wrap lines', category: 'View', icon: 'textFix', keys: ['Alt+Z'], description: 'Wraps long lines at the edge of the editor (the file itself is not changed).', when: inEditor, run: (c) => setWrap(c.pane.id, !editorUiOf(c.pane.id)?.wrap) },
  { id: 'editor.togglePreview', title: 'Markdown preview', category: 'View', icon: 'eye', keys: ['Mod+Shift+M'], description: 'Shows the rendered Markdown beside the editor and keeps it up to date while you type.', when: (c) => { const a = inEditor(c); return a !== true ? a : editorUiOf(c.pane.id)?.language === 'markdown' ? true : 'Only for Markdown files.'; }, run: (c) => setPreview(c.pane.id, !editorUiOf(c.pane.id)?.preview) },
  { id: 'editor.reload', title: 'Reload file from disk', category: 'File', icon: 'refresh', description: 'Reads the file again (asks first if there are unsaved changes).', when: inEditor, run: (c) => void reloadFromDisk(c.pane.id) },
  { id: 'editor.compare', title: 'Compare with file on disk', category: 'File', icon: 'diff', description: 'Shows the differences between the editor text and the file as it is on disk.', when: inEditor, run: (c) => openDialog('editorDiff', { paneId: c.pane.id }) },

  // View
  { id: 'view.details', title: 'Details view', category: 'View', icon: 'viewDetails', keys: ['Mod+1'], run: setView('details') },
  { id: 'view.list', title: 'List view', category: 'View', icon: 'viewList', keys: ['Mod+2'], run: setView('list') },
  { id: 'view.compact', title: 'Compact list', category: 'View', icon: 'viewCompact', keys: ['Mod+3'], run: setView('compact') },
  { id: 'view.grid', title: 'Icon grid', category: 'View', icon: 'viewGrid', keys: ['Mod+4'], run: setView('grid') },
  { id: 'view.slideshow', title: 'Start slideshow', category: 'View', icon: 'slideshow', keys: ['F11'], description: 'Shows the selected images (or every image in this folder) one after another in the viewer: Space pauses, ← → step, Esc leaves full screen. Interval, shuffle, repeat and videos are set in the viewer.',
    // Cheap check (menus and the palette ask often); the order shown is worked out only when it runs.
    when: (c) => {
      if (c.selection.filter((e) => viewerKind(e)).length >= 2) return true;
      const l = listings.get()[listingKeyFor(activeTab().id, c.pane)];
      return l?.entries.some((e) => viewerKind(e)) ? true : c.dir ? 'No images or videos in this folder.' : 'Open a folder with images, or select images.';
    },
    run: (c) => {
      const r = slideshowItems(c);
      if (typeof r === 'string') toast({ level: 'info', title: r === 'No images or videos in this folder.' ? 'No images or videos are shown (check the filter).' : r });
      else openViewer(r.entries, r.index, { slideshow: true });
    } },

  // Viewer commands (e-book, comic, 3D model)
  { id: 'viewer.openEbook', title: 'Read e-book', category: 'File', icon: 'book',
    description: 'Opens the selected EPUB file in the built-in e-book reader.',
    when: (c) => (c.selection.length === 1 && c.selection[0]!.ext === 'epub' ? true : 'Select one EPUB file.'),
    run: async (c) => {
      const path = c.selection[0]!.path;
      const manifest = await call<EbookManifest>('ebook:open', { path });
      const pos = await call<{ index: number } | null>('ebook:position', { path });
      openEbook(path, manifest, pos?.index ?? 0);
    },
  },
  { id: 'viewer.openComic', title: 'Read comic', category: 'File', icon: 'image',
    description: 'Opens the selected comic archive (CBZ, CBR, CB7, CBT) in the built-in comic reader.',
    when: (c) => (c.selection.length === 1 && ['cbz', 'cbr', 'cb7', 'cbt'].includes(c.selection[0]!.ext) ? true : 'Select one comic archive.'),
    run: async (c) => {
      const path = c.selection[0]!.path;
      const manifest = await call<ComicManifest>('comic:open', { path });
      const pos = await call<{ index: number } | null>('comic:position', { path });
      openComic(path, manifest, pos?.index ?? 0);
    },
  },
  { id: 'viewer.open3DModel', title: 'View 3D model', category: 'File', icon: 'cube',
    description: 'Opens the selected 3D model (STL, OBJ, PLY, glTF, GLB) in the built-in 3D viewer.',
    when: (c) => (c.selection.length === 1 && ['stl', 'obj', 'ply', 'gltf', 'glb'].includes(c.selection[0]!.ext) ? true : 'Select one 3D model file.'),
    run: async (c) => {
      const path = c.selection[0]!.path;
      const info = await call<Model3DInfo>('model3d:info', { path });
      openModel(path, info);
    },
  },

  { id: 'view.thumbnails', title: 'Large thumbnails', category: 'View', icon: 'image', keys: ['Mod+8'], description: 'A grid of large thumbnails; the size is set in Customization → Typography & density.', run: setView('thumbnails') },
  { id: 'view.gallery', title: 'Gallery', category: 'View', icon: 'viewGallery', keys: ['Mod+5'], run: setView('gallery') },
  { id: 'view.columns', title: 'Columns', category: 'View', icon: 'viewColumns', keys: ['Mod+6'], run: setView('columns') },
  { id: 'view.tree', title: 'Tree', category: 'View', icon: 'viewTree', keys: ['Mod+7'], when: (c) => (c.location.kind === 'fs' ? true : 'Tree view is available for folders.'), run: setView('tree') },
  { id: 'view.zoomIn', title: 'Make text and controls larger', category: 'View', icon: 'zoomIn', keys: ['Mod+=', 'Mod+Shift+='], run: () => void zoomBy(0.1) },
  { id: 'view.zoomOut', title: 'Make text and controls smaller', category: 'View', icon: 'zoomOut', keys: ['Mod+-'], run: () => void zoomBy(-0.1) },
  { id: 'view.zoomReset', title: 'Reset interface size', category: 'View', keys: ['Mod+0'], run: () => void applyCustom({ op: 'set', section: 'accessibility', path: ['interfaceScale'], value: 1, label: 'Interface size 100%' }) },
  { id: 'view.hidden', title: 'Show hidden files', category: 'View', icon: 'eye', keys: ['Mod+H'], run: async (c) => {
    await setSetting('showHidden', !app.get().settings.showHidden);
    reload(c.pane.id);
  } },
  { id: 'view.inspector', title: 'Toggle details panel', category: 'View', icon: 'panelRight', keys: ['Mod+Alt+I'], run: () => togglePanel('inspector') },
  { id: 'view.sidebar', title: 'Toggle sidebar', category: 'View', icon: 'panelLeft', keys: ['Mod+B'], run: () => togglePanel('sidebar') },
  { id: 'view.theme', title: 'Switch light/dark theme', category: 'View', icon: 'theme', keys: ['Mod+Shift+L'], description: 'Switches between the dark and light versions of the current theme.', run: () => void applyCustom({ op: 'set', section: 'appearance', path: ['mode'], value: resolvedNow().mode === 'light' ? 'dark' : 'light', label: 'Switched light/dark' }) },
  { id: 'view.statusBar', title: 'Toggle status bar', category: 'View', run: () => void applyCustom({ op: 'set', section: 'layout', path: ['statusBar', 'visible'], value: !resolvedNow().layout.statusBar.visible, label: 'Status bar' }) },
  { id: 'view.toolbar', title: 'Toggle toolbar buttons', category: 'View', run: () => void applyCustom({ op: 'set', section: 'layout', path: ['toolbar', 'visible'], value: !resolvedNow().layout.toolbar.visible, label: 'Toolbar buttons' }) },
  { id: 'view.tabs', title: 'Toggle tab strip', category: 'View', run: () => void applyCustom({ op: 'set', section: 'layout', path: ['tabs', 'visible'], value: !resolvedNow().layout.tabs.visible, label: 'Tab strip' }) },
  { id: 'view.saveView', title: 'Save view…', category: 'View', icon: 'save', description: 'Saves this pane’s view mode, columns, sorting, grouping, sizes and filter as a reusable view.', run: (c) => void import('./features/SavedViews').then((m) => m.saveCurrentView(c.pane)) },
  { id: 'view.applyDefaults', title: 'Make this the default view', category: 'View', description: 'Uses this pane’s view mode, sorting and grouping for new tabs (in the active workspace when it overrides them).', run: (c) => void applyCustom({ op: 'batch', label: 'Default view', ops: [
    { op: 'set', section: 'view', path: ['view'], value: c.pane.view },
    { op: 'set', section: 'view', path: ['sort'], value: c.pane.sort },
    { op: 'set', section: 'view', path: ['thenBy'], value: c.pane.thenBy },
    { op: 'set', section: 'view', path: ['groupBy'], value: c.pane.groupBy },
  ] }) },
  { id: 'view.foldersFirst', title: 'Folders first', category: 'View', run: (c) => updatePane(c.pane.id, { sort: { ...c.pane.sort, foldersFirst: !c.pane.sort.foldersFirst } }) },
  { id: 'view.folderSizes', title: 'Calculate folder sizes', category: 'View', icon: 'storage', description: 'Calculates the size of every folder in this folder as a background task (pausable) and shows it in the Size column. Run again to clear; the values are dropped when the folder changes.', when: inFolder, run: (c) => (folderSizesActive(c.dir) ? stopFolderSizes(c.dir!) : startFolderSizes(c.dir!)) },

  // Built-in terminal (dock under the panes; see state/terminal.ts)
  { id: 'terminal.toggle', title: 'Toggle terminal', category: 'View', icon: 'terminal', keys: ['Ctrl+`'], description: 'Shows the terminal panel under the panes and moves the keyboard into it (the first time, a terminal starts in the active pane’s folder). Pressed in the terminal, it hides the panel and gives the keyboard back to the files; the terminals keep running.', run: () => void T.toggleDock() },
  { id: 'terminal.hide', title: 'Hide terminal panel', category: 'View', icon: 'panelHide', description: 'Hides the terminal panel; the terminals keep running and come back with Toggle terminal.', when: () => (T.terminal.get().open ? true : 'The terminal panel is not shown.'), run: () => T.hideDock() },
  { id: 'terminal.new', title: 'New terminal', category: 'View', icon: 'plus', keys: ['Ctrl+Shift+`'], description: 'Starts another terminal (a new tab in the terminal panel) in the folder of the active pane, with the shell chosen in Settings → Built-in terminal.', run: () => void T.newTerminal() },
  { id: 'terminal.openHere', title: 'Open in terminal', category: 'File', icon: 'terminal', description: 'Starts a terminal in the built-in terminal panel, in the selected folder or else in the folder shown. (“Open terminal here” opens the system’s own terminal application instead.)', when: (c) => (terminalDir(c) ? true : 'Only available for a folder on this computer.'), run: (c) => void T.newTerminal(terminalDir(c)!) },
  { id: 'terminal.cdToPane', title: 'Terminal: go to pane folder', category: 'View', icon: 'terminalCd', description: 'Types a correctly quoted cd command for the active pane’s folder into the terminal (asks first when a program other than the shell is running).', when: (c) => termRunning() !== true ? termRunning() : c.dir ? true : 'The active pane does not show a folder on this computer.', run: () => void T.cdToPaneFolder() },
  { id: 'terminal.showInPane', title: 'Terminal: show terminal folder in pane', category: 'View', icon: 'terminalReveal', description: 'Opens the folder the terminal’s shell is in, in the active pane (Linux and macOS; Windows does not let other programs read it).', when: () => (termRunning() !== true ? termRunning() : T.terminal.get().info?.cwdSupported === false ? 'Windows does not let Orbis Files read the folder a shell is in.' : true), run: () => void T.showTerminalFolder() },
  { id: 'terminal.follow', title: 'Terminal: follow pane folder', category: 'View', icon: 'follow', description: 'While on, the terminal changes to the active pane’s folder whenever it changes, but only when the shell is idle at its prompt (no program running, nothing typed, no output arriving). Linux and macOS.', when: () => (termRunning() !== true ? termRunning() : T.terminal.get().info?.foregroundSupported === false ? 'On Windows Orbis Files cannot tell whether the shell is idle, so it cannot follow the pane safely.' : true), run: () => T.toggleFollow() },
  { id: 'terminal.find', title: 'Terminal: find', category: 'View', icon: 'search', description: 'Searches the terminal output and its scrollback (Ctrl+Shift+F, or ⌘F on macOS, while the terminal has the keyboard).', when: () => (T.terminal.get().tabs.length ? true : 'No terminal is open.'), run: () => T.openFind() },
  { id: 'terminal.clear', title: 'Terminal: clear', category: 'View', icon: 'eraser', description: 'Clears the terminal’s screen and scrollback (the prompt stays).', when: () => (T.terminal.get().tabs.length ? true : 'No terminal is open.'), run: () => T.clearTerminal() },
  { id: 'terminal.copy', title: 'Terminal: copy', category: 'Edit', icon: 'copy', description: 'Copies the text selected in the terminal (Ctrl+Shift+C, or ⌘C on macOS, while the terminal has the keyboard).', when: () => (T.hasSelectionIn() ? true : 'Select text in the terminal first.'), run: () => T.copySelection() },
  { id: 'terminal.paste', title: 'Terminal: paste', category: 'Edit', icon: 'paste', description: 'Pastes the clipboard text into the terminal (Ctrl+Shift+V, or ⌘V on macOS); text with several lines asks first unless the program uses bracketed paste (Settings → Built-in terminal).', when: () => termRunning(), run: () => void T.pasteFromClipboard() },
  { id: 'terminal.restart', title: 'Terminal: restart', category: 'View', icon: 'retry', description: 'Starts the shell again in a terminal whose program has ended, in its last folder.', when: () => { const t = activeTerm(); return !t ? 'No terminal is open.' : t.status === 'exited' || t.status === 'failed' ? true : 'The terminal is still running.'; }, run: () => void T.restartTerminal() },
  { id: 'terminal.close', title: 'Terminal: close terminal', category: 'View', icon: 'close', description: 'Ends the active terminal and closes its tab (asks first when a program is running in it).', when: () => (activeTerm() ? true : 'No terminal is open.'), run: () => void T.closeTab() },
  { id: 'terminal.closeAll', title: 'Close terminal panel', category: 'View', icon: 'panelClose', description: 'Ends every terminal and closes the panel (asks first when programs are running). To keep them running, hide the panel instead (Toggle terminal).', when: () => (T.terminal.get().tabs.length ? true : 'No terminal is open.'), run: () => void T.closeAllTerminals() },

  // Music player (bar under the panes; state/player.ts) and video tools (FFmpeg; features/MediaDialogs.tsx)
  { id: 'player.play', title: 'Play', category: 'File', icon: 'playMedia', description: 'Plays the selected audio files, playlists or folders (their audio files, in name order, up to 2,000 at a time) in the music player, replacing its queue.', when: playableSel, run: (c) => void PL.addPaths(c.selection.map((e) => e.path), 'play') },
  { id: 'player.playNext', title: 'Play next', category: 'File', icon: 'playNext', description: 'Puts the selected audio files, playlists or folders in the music queue right after the item playing now.', when: playableSel, run: (c) => void PL.addPaths(c.selection.map((e) => e.path), 'next') },
  { id: 'player.enqueue', title: 'Add to queue', category: 'File', icon: 'enqueue', description: 'Adds the selected audio files, playlists or folders to the end of the music queue.', when: playableSel, run: (c) => void PL.addPaths(c.selection.map((e) => e.path), 'queue') },
  { id: 'player.playFolder', title: 'Play folder', category: 'File', icon: 'playMedia', description: 'Plays every audio file in the folder shown and its subfolders (name order, up to 2,000), replacing the music queue.', when: inFolder, run: (c) => void PL.addPaths([c.dir!], 'play') },
  { id: 'player.toggle', title: 'Play or pause music', category: 'View', icon: 'play', keys: ['Mod+Alt+P'], description: 'Starts or pauses the music player (media keys work too).', when: queueReady, run: () => PL.togglePlay() },
  { id: 'player.next', title: 'Next track', category: 'View', icon: 'skipForward', keys: ['Mod+Alt+.'], when: queueReady, run: () => void PL.next() },
  { id: 'player.previous', title: 'Previous track', category: 'View', icon: 'skipBack', keys: ['Mod+Alt+,'], description: 'Goes back to the start of the track, or to the previous one in the first 3 seconds.', when: queueReady, run: () => void PL.previous() },
  { id: 'player.queue', title: 'Show music queue', category: 'View', icon: 'queue', keys: ['Mod+Alt+Q'], description: 'Opens or closes the queue above the music player: reorder by dragging or Alt+↑/↓, remove with Delete.', when: queueReady, run: () => {
    PL.toggleQueue();
    if (PL.player.get().queueOpen) requestAnimationFrame(() => document.querySelector<HTMLElement>('.pq-main[tabindex="0"]')?.focus());
  } },
  { id: 'player.shuffle', title: 'Shuffle music', category: 'View', icon: 'shuffle', when: queueReady, run: () => PL.toggleShuffle() },
  { id: 'player.repeat', title: 'Repeat: off / all / one', category: 'View', icon: 'loop', description: 'Switches between no repeat, repeating the whole queue and repeating the current item.', when: queueReady, run: () => PL.cycleRepeat() },
  { id: 'player.savePlaylist', title: 'Save queue as playlist…', category: 'File', icon: 'save', description: 'Saves the music queue as an .m3u8 playlist (UTF-8, titles and lengths; relative paths when it is next to the files).', when: queueReady, run: (c) => PL.savePlaylistDialog(c.dir) },
  { id: 'player.clear', title: 'Clear music queue', category: 'View', icon: 'eraser', when: queueReady, run: () => void PL.clear() },
  { id: 'player.show', title: 'Show music player', category: 'View', icon: 'music', when: () => (!PL.player.get().state.items.length ? 'The music queue is empty.' : PL.player.get().hidden ? true : 'The music player is already shown.'), run: () => PL.showPlayer() },
  { id: 'player.close', title: 'Close music player', category: 'View', icon: 'close', description: 'Stops the music and hides the player; the queue is kept for next time.', when: () => (PL.player.get().state.items.length && !PL.player.get().hidden ? true : 'The music player is not shown.'), run: () => PL.closePlayer() },
  // Saved playlists (DB-backed named collections)
  { id: 'player.saveNamedPlaylist', title: 'Save playlist…', category: 'File', icon: 'save', description: 'Saves the current music queue as a named playlist in the app database.', when: queueReady, run: () => PL.saveNamedPlaylistDialog() },
  { id: 'player.loadPlaylist', title: 'Load playlist…', category: 'File', icon: 'queue', description: 'Loads a saved playlist from the app database into the music queue, replacing it.', run: () => PL.loadPlaylistDialog() },
  { id: 'player.deletePlaylist', title: 'Delete playlist…', category: 'File', icon: 'eraser', description: 'Deletes a saved playlist from the app database.', run: () => PL.deletePlaylistDialog() },

  // Dual-pane mode (Total Commander / Midnight Commander style)
  { id: 'view.dualPane', title: 'Toggle dual-pane mode', category: 'View', icon: 'split', keys: ['F3'], description: 'Toggles the dedicated two-pane file manager mode with F5–F8 shortcuts for copy, move, new folder and delete between panes.', run: () => DP.toggleDualPane() },
  { id: 'dualPane.copy', title: 'Copy to other pane', category: 'File', icon: 'copy', description: "In dual-pane mode, copies the selected items to the other pane's directory. Shown as F5 on the toolbar.", when: () => (DP.dualPane.get().active ? true : 'Enable dual-pane mode first (F3).'), run: () => DP.copyToOther() },
  { id: 'dualPane.move', title: 'Move to other pane', category: 'File', icon: 'move', description: "In dual-pane mode, moves the selected items to the other pane's directory. Shown as F6 on the toolbar.", when: () => (DP.dualPane.get().active ? true : 'Enable dual-pane mode first (F3).'), run: () => DP.moveToOther() },
  { id: 'dualPane.newFolder', title: 'New folder in pane', category: 'File', icon: 'newFolder', description: 'In dual-pane mode, creates a new folder in the active pane. Shown as F7 on the toolbar.', when: () => (DP.dualPane.get().active ? true : 'Enable dual-pane mode first (F3).'), run: () => DP.newFolderInActive() },
  { id: 'dualPane.delete', title: 'Delete in pane', category: 'File', icon: 'trash', description: 'In dual-pane mode, deletes the selected items in the active pane. Shown as F8 on the toolbar.', when: () => (DP.dualPane.get().active ? true : 'Enable dual-pane mode first (F3).'), run: () => DP.deleteSelected() },
  { id: 'dualPane.switchPane', title: 'Switch pane', category: 'View', icon: 'swap', description: 'In dual-pane mode, switches focus to the other pane.', when: () => (DP.dualPane.get().active ? true : 'Enable dual-pane mode first (F3).'), run: () => DP.switchPane() },
  { id: 'dualPane.syncNav', title: 'Toggle sync navigation', category: 'View', icon: 'link', description: 'When active, navigating in one pane navigates the other pane to the same path.', when: () => (DP.dualPane.get().active ? true : 'Enable dual-pane mode first (F3).'), run: () => DP.toggleSyncNav() },

  { id: 'video.trim', title: 'Trim…', category: 'File', icon: 'cut', description: 'Cuts a part out of a video (or audio file) into a new file: set the start and end in a preview, frame by frame. Fast mode copies the streams (cuts on keyframes); exact mode re-encodes. Uses the installed FFmpeg.', when: videoSel(1, 1, mediaEntry, 'video or audio'), run: toolDialog('videoTrim', false) },
  { id: 'video.extractAudio', title: 'Extract audio…', category: 'File', icon: 'fileAudio', description: 'Saves the sound of videos as audio files: the stream as it is where the container allows, or converted to M4A, MP3, Opus, FLAC or WAV.', when: videoSel(1, 500), run: toolDialog('videoExtractAudio', true) },
  { id: 'video.gif', title: 'Make GIF…', category: 'File', icon: 'gif', description: 'Turns part of a video into a GIF (two-pass palette for good colours) or an animated WebP.', when: videoSel(1, 1), run: toolDialog('videoGif', false) },
  { id: 'video.contactSheet', title: 'Make contact sheet…', category: 'File', icon: 'contactSheet', description: 'Saves a grid of frames spread over the video as one JPEG or PNG, optionally with time stamps.', when: videoSel(1, 500), run: toolDialog('videoContactSheet', true) },
  { id: 'video.saveFrame', title: 'Save frame as PNG', category: 'File', icon: 'frame', description: 'Saves the frame shown in the video preview (details panel) as a PNG next to the video; the first frame when no preview is open.', when: videoSel(1, 1), run: (c) => void import('./features/MediaDialogs').then((m) => m.saveFrameNow(c.selection[0]!.path, previewTime(c.selection[0]!.path))) },
  { id: 'video.join', title: 'Join…', category: 'File', icon: 'join', description: 'Joins videos (or audio files) one after another into a new file: without re-encoding when every stream matches, otherwise by re-encoding to MP4.', when: joinable, run: (c) => {
    const l = listings.get()[listingKeyFor(activeTab().id, c.pane)];
    openDialog('videoJoin', { paths: inShownOrder(c.selection.map((e) => e.path), l ? shownEntries(l.entries, c.pane) : []) });
  } },
  { id: 'video.rotate', title: 'Rotate or flip…', category: 'File', icon: 'rotateVideo', description: 'Turns or mirrors videos: losslessly through the rotation flag in MP4/MOV, otherwise by re-encoding.', when: videoSel(1, 500), run: toolDialog('videoRotate', true) },

  // Shelf (drop stack): references collected from any folder, acted on together.
  { id: 'shelf.toggle', title: 'Show or hide the shelf', category: 'View', icon: 'shelf', keys: ['Mod+Shift+S'], description: 'The shelf under the files collects items from any folder, pane or tab (references, not copies) to copy or move them together later.', run: () => void applyCustom({ op: 'set', section: 'layout', path: ['shelf', 'visible'], value: !resolvedNow().layout.shelf.visible, label: 'Shelf' }) },
  { id: 'shelf.add', title: 'Add to shelf', category: 'File', icon: 'shelfAdd', keys: ['Mod+Shift+D'], description: 'Puts the selected items on the shelf. They stay where they are; the shelf keeps a reference.', when: hasSel, run: (c) => void addToShelf(c.selection.map((e) => e.path)) },
  { id: 'shelf.copyHere', title: 'Copy shelf items here', category: 'File', icon: 'copyTo', description: 'Copies the items on the shelf (or the ones selected on it) into the folder shown, as one operation that asks about conflicts.', when: (c) => (!c.dir ? 'Open a folder to copy into.' : shelfTargets().paths.length ? true : shelf.get().items.length ? 'The shelf items are missing.' : 'The shelf is empty.'), run: (c) => void shelfTransfer('copy', c.dir!) },
  { id: 'shelf.moveHere', title: 'Move shelf items here', category: 'File', icon: 'moveTo', description: 'Moves the items on the shelf (or the ones selected on it) into the folder shown, as one operation that asks about conflicts. The shelf follows them.', when: (c) => (!c.dir ? 'Open a folder to move into.' : shelfTargets().paths.length ? true : shelf.get().items.length ? 'The shelf items are missing.' : 'The shelf is empty.'), run: (c) => void shelfTransfer('move', c.dir!) },
  { id: 'shelf.clear', title: 'Clear the shelf', category: 'File', icon: 'close', description: 'Removes every item from the shelf. The files themselves are not touched.', when: () => (shelf.get().items.length ? true : 'The shelf is empty.'), run: () => void clearShelf() },

  // Custom actions (each one also appears as its own command: see syncActionCommands)
  { id: 'actions.manage', title: 'Custom actions…', category: 'Actions', icon: 'action', description: 'Define commands that run a program on the selected items (Settings → Custom actions).', run: (c) => {
    void navigate(c.pane.id, { kind: 'tool', tool: 'settings' });
    setTimeout(() => document.getElementById('custom-actions')?.scrollIntoView({ block: 'start' }), 300);
  } },

  // Git (read-only)
  { id: 'git.copyRemote', title: 'Copy Git remote URL', category: 'Edit', icon: 'gitBranch', description: 'Copies the URL of this repository’s “origin” remote (or its first remote) without any user name or password in it.', when: (c) => gitWhen(c), run: async (c) => {
    try {
      const r = await call<{ remote: string; url: string }>('git:remoteUrl', { path: c.dir! });
      await call('fs:copyText', { text: r.url });
      toast({ level: 'success', title: `Copied the ${r.remote} URL`, detail: r.url });
    } catch (err) {
      toastError(err, 'No remote URL copied');
    }
  } },
  { id: 'git.refresh', title: 'Refresh Git status', category: 'View', icon: 'gitBranch', description: 'Runs git status again for the folder shown (it also refreshes on its own when files change).', when: (c) => gitWhen(c), run: (c) => requestGit(c.dir!, true) },

  // Tools / app
  { id: 'app.palette', title: 'Command palette', category: 'Tools', icon: 'command', keys: ['Mod+K', 'Mod+Shift+P'], description: 'Search and run any Files command. Always keeps a shortcut.', run: () => app.set({ paletteOpen: true }) },
  { id: 'app.shortcuts', title: 'Keyboard shortcuts', category: 'Tools', icon: 'keyboard', keys: ['F1'], description: 'Searchable reference of every keyboard shortcut, grouped by category.', run: tool('shortcutReference') },
  { id: 'app.customize', title: 'Customization Studio', category: 'Customize', icon: 'palette', keys: ['Mod+Shift+,'], description: 'Themes, layout, workspaces, views, toolbars, menus, shortcuts and accessibility. Always keeps a shortcut.', run: (c) => void navigate(c.pane.id, { kind: 'tool', tool: 'customize' }) },
  { id: 'custom.undo', title: 'Undo customization change', category: 'Customize', icon: 'undo', keys: ['Mod+Alt+Z'], description: 'Reverses the most recent change to appearance, layout, workspaces or other customization. File operations are undone from Operations instead.', when: () => (custom.get().server.canUndo ? true : 'No customization change to undo.'), run: () => void undoCustom() },
  { id: 'custom.redo', title: 'Redo customization change', category: 'Customize', icon: 'redo', keys: ['Mod+Alt+Shift+Z'], when: () => (custom.get().server.canRedo ? true : 'Nothing to redo.'), run: () => void redoCustom() },
  { id: 'custom.layoutEditor', title: 'Edit layout…', category: 'Customize', icon: 'layout', description: 'Opens the layout editor: panels, positions, sizes and panes, with preview.', run: (c) => void openStudio(c, 'layout') },
  { id: 'custom.workspaces', title: 'Switch workspace…', category: 'Customize', icon: 'workspace', keys: ['Mod+Alt+W'], description: 'Shows your workspaces. Switching changes only the interface, never files.', run: () => openDialog('workspaceSwitcher') },
  { id: 'custom.nextWorkspace', title: 'Next workspace', category: 'Customize', keys: ['Mod+Alt+]'], run: () => void cycleWorkspace(1) },
  { id: 'custom.prevWorkspace', title: 'Previous workspace', category: 'Customize', keys: ['Mod+Alt+['], run: () => void cycleWorkspace(-1) },
  { id: 'app.operations', title: 'Operations', category: 'Tools', icon: 'activity', keys: ['Mod+J'], run: () => app.set((s) => ({ opsPanelOpen: !s.opsPanelOpen })) },
  { id: 'app.settings', title: 'Settings', category: 'Tools', icon: 'settings', keys: ['Mod+,'], run: tool('settings') },
  { id: 'tools.storage', title: 'Storage analysis', category: 'Tools', icon: 'storage', run: tool('storage') },
  { id: 'tools.duplicates', title: 'Find duplicates', category: 'Tools', icon: 'duplicates', run: tool('duplicates') },
  { id: 'tools.compare', title: 'Compare folders', category: 'Tools', icon: 'compare', run: tool('compare') },
  { id: 'tools.batchRename', title: 'Batch rename', category: 'Tools', icon: 'bulkRename', keys: ['Mod+Alt+R'], description: 'Opens the batch rename tool with pattern-based renaming, live preview and undo support.', run: tool('batchRename') },
  { id: 'tools.checksum', title: 'Checksum tool', category: 'Tools', icon: 'verify', description: 'Compute and verify file checksums (MD5, SHA-1, SHA-256, SHA-512) with progress and clipboard support.', run: tool('checksum') },
  { id: 'tools.shares', title: 'Network shares', category: 'Tools', icon: 'share', description: 'Shows the files shared on the local network: links, QR codes, what other devices downloaded or sent, and Stop.', run: () => void import('./state/shares').then((m) => m.showSharesPanel()) },
  { id: 'tools.sync', title: 'Synchronize folders', category: 'Tools', icon: 'sync', description: 'Mirror, update or two-way synchronize two folders. Shows a preview first; deletions go to the Trash.', run: tool('sync') },
  { id: 'tools.backups', title: 'Backups', category: 'Tools', icon: 'backup', description: 'Backup jobs with versions: run now or on a schedule, browse versions, find every version of a file, restore and verify.', run: tool('backups') },
  { id: 'schedule.pause', title: 'Pause all schedules', category: 'Tools', icon: 'scheduleOff', description: 'Scheduled backups and synchronizations do not start until you resume. Running ones continue.',
    when: () => { const st = schedules.get().status; return !st ? 'Schedules are not loaded yet.' : st.paused ? 'Schedules are already paused.' : true; }, run: () => void setSchedulesPaused(true) },
  { id: 'schedule.resume', title: 'Resume schedules', category: 'Tools', icon: 'schedule', description: 'Scheduled backups and synchronizations start again; runs missed while paused start once when their schedule allows catching up.',
    when: () => (schedules.get().status?.paused ? true : 'Schedules are not paused.'), run: () => void setSchedulesPaused(false) },
  { id: 'tools.rules', title: 'Organising rules', category: 'Tools', icon: 'rules', run: tool('rules') },
  { id: 'tools.timeline', title: 'Recent changes', category: 'Tools', icon: 'timeline', description: 'Files created or modified in the last day, week or month across your folders, grouped by day.', run: tool('timeline') },
  { id: 'automation.pause', title: 'Pause automation', category: 'Tools', icon: 'automationOff', description: 'Stops organising rules from running on new files until you resume. Files that arrive meanwhile are not processed later.',
    when: () => { const st = automation.get().status; return !st ? 'Automation status is not loaded yet.' : st.paused ? 'Automation is already paused.' : st.rules.length ? true : 'No rule runs automatically. Turn it on for a rule in Organising rules.'; },
    run: () => void setAutomationPaused(true) },
  { id: 'automation.resume', title: 'Resume automation', category: 'Tools', icon: 'automation', description: 'Organising rules set to run automatically handle new files again.',
    when: () => (automation.get().status?.paused ? true : 'Automation is not paused.'), run: () => void setAutomationPaused(false) },
  { id: 'tools.downloads', title: 'Downloads', category: 'Tools', icon: 'download', run: tool('downloads') },
  { id: 'tools.media', title: 'Media library', category: 'Tools', icon: 'media', run: tool('media') },
  { id: 'tools.integrations', title: 'Integrations & diagnostics', category: 'Tools', icon: 'plug', run: tool('integrations') },
  { id: 'tools.diskUsage', title: 'Disk usage analyzer', category: 'Tools', icon: 'storage', keys: ['Mod+Shift+U'], description: 'Visualize disk space usage with an interactive treemap. Scan a directory recursively to find what takes the most space.', run: tool('diskUsage') },
  { id: 'tools.bulkImage', title: 'Bulk image tools', category: 'Tools', icon: 'image', description: 'Resize, convert, compress, strip metadata, rotate and flip images in batch.', run: tool('imageTools') },
  { id: 'tools.hexEditor', title: 'Hex editor', category: 'Tools', icon: 'binary', description: 'View and edit files in hexadecimal. Supports search, data inspector and byte-level editing.', run: tool('hexEditor') },
  { id: 'tools.contentSearch', title: 'Search in files', category: 'Tools', icon: 'search', keys: ['Mod+Shift+F'], description: 'Search inside file contents with regular expressions, live results grouped by file.', run: tool('contentSearch') },
  { id: 'file.addNote', title: 'Add note to file...', category: 'File', icon: 'edit', description: 'Attach a persistent note to the selected file.', when: oneSel, run: (c) => { if (c.selection[0]) openDialog('fileNote', { path: c.selection[0].path }); } },
  { id: 'tools.noteSearch', title: 'Search file notes', category: 'Tools', icon: 'edit', description: 'Search across all file notes.', run: () => openDialog('noteSearch') },
  { id: 'tools.symlinks', title: 'Symbolic links', category: 'Tools', icon: 'link', description: 'View, create, fix and convert symbolic links in the current directory.', run: tool('symlinks') },
  { id: 'tools.batchDate', title: 'Batch date modifier', category: 'Tools', icon: 'clock', description: 'Change file timestamps (modified, accessed) in bulk: set, shift, extract from filename or EXIF.', run: tool('batchDate') },
  { id: 'file.newFromTemplatePicker', title: 'New from template catalog…', category: 'File', icon: 'newFile', keys: ['Mod+Alt+N'], description: 'Create a file from built-in or custom templates with variable substitution.', when: inFolder, run: (_c) => openDialog('templatePicker') },
  { id: 'tools.transfers', title: 'Transfer queue', category: 'Tools', icon: 'activity', description: 'Background copy/move queue with progress, priority and pause control.', run: tool('transfers') },
  { id: 'tools.pdfTools', title: 'PDF tools', category: 'Tools', icon: 'file', description: 'Merge, split, rotate and extract pages from PDFs.', run: tool('pdfTools') },
  { id: 'tools.snippets', title: 'Snippet Library', category: 'Tools', icon: 'code', description: 'Save, search and manage text and code snippets with tags, import/export and clipboard copy.', run: tool('snippets') },
  { id: 'tools.conversionPipeline', title: 'Conversion pipeline', category: 'Tools', icon: 'convert', description: 'Chain multiple file conversions: image formats, archive compress/decompress. Build reusable pipelines with drag-to-reorder steps.', run: tool('conversionPipeline') },
  { id: 'tools.volumes', title: 'Mounted volumes', category: 'Tools', icon: 'storage', description: 'List all mounted volumes and drives with capacity, used and free space. Eject removable drives and quick-navigate to volume roots.', run: tool('volumes') },
  { id: 'tools.recycleBin', title: 'Recycle Bin', category: 'Tools', icon: 'trash', description: 'Advanced recycle bin with restore, permanent delete, and auto-purge settings.', run: tool('recycleBin') },
  { id: 'tools.git', title: 'Git panel', category: 'Tools', icon: 'gitBranch', keys: ['F10'], description: 'Full Git panel with branch info, changed files, stage/unstage and commit.', run: tool('git') },
  { id: 'tools.hashCompare', title: 'File hash comparator', category: 'Tools', icon: 'verify', description: 'Compare two files by computing their cryptographic hashes (MD5, SHA-1, SHA-256, SHA-512). Drag and drop files to compare.', run: tool('hashCompare') },
  { id: 'tools.recentFiles', title: 'Recent files', category: 'Tools', icon: 'clock', keys: ['F9'], description: 'Track recently opened and modified files, grouped by today, yesterday, this week and older. Pin items and clear history.', run: tool('recentFiles') },
  { id: 'tools.cloudMount', title: 'Cloud storage', category: 'Tools', icon: 'cloud', description: 'Connect to FTP, SFTP and WebDAV servers to browse and transfer files.', run: tool('cloudMount') },
  { id: 'tools.archiveManager', title: 'Archive manager', category: 'Tools', icon: 'archive', description: 'Browse archive contents without extracting, extract individual files, and create archives with compression options.', run: tool('archiveManager') },
  { id: 'tools.clipboardHistory', title: 'Clipboard history', category: 'Tools', icon: 'clipboard', keys: ['Mod+Shift+V'], description: 'View and manage clipboard history. Re-copy, pin or clear past clipboard items.', run: () => toggleClipboardHistory() },
  { id: 'tools.macros', title: 'Macro Recorder', category: 'Tools', icon: 'activity', description: 'Record file operation sequences (copy, move, rename, create), play them back on different targets, and save/load macros.', run: tool('macros') },
  { id: 'tools.folderWatch', title: 'Folder Watcher', category: 'Tools', icon: 'eye', description: 'Watch folders for file changes with configurable rules, pattern filters, notification log and auto-actions.', run: tool('folderWatch') },
  { id: 'tools.fileVersions', title: 'File Version History', category: 'Tools', icon: 'clock', description: 'Snapshot-based version tracking for files. Compare versions with diffs, restore previous versions, and configure retention.', run: tool('fileVersions') },
  { id: 'tools.universeExplorer', title: 'Universe Explorer', category: 'Tools', icon: 'globe', description: 'Visualize your filesystem as an interactive treemap, sunburst or grid with multiple lenses (structure, space, type, time, change).', run: tool('universeExplorer') },
  { id: 'tools.folderDiff', title: 'Folder Diff', category: 'Tools', icon: 'compare', description: 'Compare two folders side by side showing added, removed and modified files with optional content hashing.', run: tool('folderDiff') },
  { id: 'tools.changeObservatory', title: 'Change Observatory', category: 'Tools', icon: 'activity', description: 'Monitor filesystem changes in real time across multiple folders with event stream, filtering and statistics.', run: tool('changeObservatory') },
  { id: 'tools.impactSimulator', title: 'Impact Simulator', category: 'Tools', icon: 'alertTriangle', description: 'Analyze the impact of delete, move or rename operations before executing them. Shows broken symlinks, space freed and affected files.', run: tool('impactSimulator') },
  { id: 'tools.universeObservatory', title: 'Universe Observatory', category: 'Tools', icon: 'globe', description: 'Dashboard overview of saved universe maps, portals, and annotations.', run: tool('universeObservatory') },
  { id: 'tools.quickNotes', title: 'Quick Notes', category: 'Tools', icon: 'edit', description: 'A built-in scratchpad for jotting down notes while browsing files. Search, pin and organize notes.', run: tool('quickNotes') },
  { id: 'tools.systemInfo', title: 'System Information', category: 'Tools', icon: 'cpu', description: 'View system details: app version, platform, memory usage, screen info, locale and session uptime.', run: tool('systemInfo') },
  { id: 'tools.spaceCleaner', title: 'Space Cleaner', category: 'Tools', icon: 'cleanup', description: 'Find large, old and temporary files to free disk space. Analyze directories and clean up selectively.', run: tool('spaceCleaner') },
  { id: 'tools.textDiff', title: 'Text Diff', category: 'Tools', icon: 'diff', description: 'Compare two text blocks side by side with a real line-by-line diff algorithm. Copy unified diffs.', run: tool('textDiff') },
  { id: 'tools.colorPicker', title: 'Color Picker', category: 'Tools', icon: 'palette', description: 'Pick colors with HEX, RGB and HSL display, saved palette, history and WCAG contrast checker.', run: tool('colorPicker') },
  { id: 'tools.qrGenerator', title: 'QR Code Generator', category: 'Tools', icon: 'link', description: 'Generate QR-style codes from text, URLs or file paths. Download as PNG or copy to clipboard.', run: tool('qrGenerator') },
  { id: 'tools.workspaceSessions', title: 'Workspace Sessions', category: 'Tools', icon: 'workspace', description: 'Save and restore tab layouts as named sessions. Import and export session configurations.', run: tool('workspaceSessions') },
  { id: 'tools.tagManager', title: 'Tag Manager', category: 'Tools', icon: 'tag', description: 'Create, edit, merge and organize file tags with color coding and group categories.', run: tool('tagManager') },
  { id: 'tabGroups.saveSession', title: 'Save tab group session', category: 'Window', icon: 'save', description: 'Save the current tab groups as a named session to restore later.', run: async () => {
    const { saveTabGroupSession } = await import('./state/tabGroups');
    const name = await prompt({ title: 'Save tab group session', label: 'Session name', initial: 'Session', confirmLabel: 'Save' });
    if (name) { saveTabGroupSession(name); toast({ level: 'success', title: 'Tab group session saved' }); }
  }},

  // Workspace saves
  { id: 'workspace.save', title: 'Save workspace…', category: 'Window', icon: 'workspace', description: 'Saves the current set of open tabs, pane layout, active paths and sidebar state as a named workspace that can be restored later.', run: async () => {
    const name = await prompt({ title: 'Save workspace', label: 'Workspace name', initial: 'My workspace', confirmLabel: 'Save' });
    if (!name) return;
    const s = ws.get();
    const state = { tabs: s.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => ({ ...p, selection: [], restore: undefined })) })), groups: s.groups, activeTabId: s.activeTabId };
    await call('cat:saveWorkspace', { name, state }).then(() => toast({ level: 'success', title: `Workspace "${name}" saved` }), toastError);
  } },
  { id: 'workspace.load', title: 'Load workspace…', category: 'Window', icon: 'workspace', description: 'Picks a saved workspace and restores its tabs, panes and layout.', run: () => openDialog('workspaceLoader') },
  { id: 'workspace.manage', title: 'Manage workspaces…', category: 'Window', icon: 'workspace', description: 'Open the workspace management UI in Customization.', run: () => openDialog('workspaceSwitcher') },

  // Smart folders
  { id: 'file.smartFolder', title: 'Create smart folder…', category: 'File', icon: 'search', description: 'Creates a virtual folder that automatically shows files matching tag, extension, size or date criteria.', run: () => openDialog('smartFolder') },

  // Remote locations (SFTP, WebDAV, FTP/FTPS)
  { id: 'remote.add', title: 'Add remote connection…', category: 'Tools', icon: 'server', description: 'Connect to a folder on another computer over SFTP (SSH), WebDAV or FTP/FTPS. It appears in the sidebar under Remote.', run: () => openDialog('remoteEdit', {}) },
  { id: 'remote.manage', title: 'Remote connections…', category: 'Tools', icon: 'server', description: 'Add, edit, connect, disconnect or remove remote connections, and upload changes of remote files you opened.', run: () => openDialog('remoteConnections') },
  { id: 'remote.disconnect', title: 'Disconnect from this server', category: 'Navigate', icon: 'unplug', description: 'Closes the connection of the remote folder shown and forgets a password that was asked for this session.', when: (c) => (c.location.kind === 'remote' ? true : 'Only available in a remote folder.'), run: async (c) => {
    if (c.location.kind !== 'remote') return;
    const id = c.location.connectionId;
    await call('remote:disconnect', { id, forgetPassword: true }).catch(toastError);
    for (const t of ws.get().tabs) for (const p of t.panes) { const l = currentLocation(p); if (l.kind === 'remote' && l.connectionId === id) void navigate(p.id, { kind: 'home' }); }
    toast({ level: 'info', title: `Disconnected from ${remoteState.get().connections.find((x) => x.id === id)?.name ?? 'the server'}` });
  } },
  { id: 'remote.preview', title: 'Preview remote file', category: 'File', icon: 'eye', description: 'Downloads a temporary copy of the selected file (up to 20 MB) and shows it in the details panel.', when: (c) => (c.selection.length === 1 && remoteFiles(c) ? (c.selection[0]!.kind === 'file' ? true : 'Select a file.') : 'Select one file on a server.'), run: async (c) => {
    remoteState.set({ previewRef: c.selection[0]!.path });
    await showDetailsPanel();
  } },
  { id: 'remote.download', title: 'Download to…', category: 'File', icon: 'download', description: 'Copies the selected items from the server into a folder you choose on this computer, as an operation.', when: (c) => (remoteFiles(c) ? true : 'Select items on a server.'), run: async (c) => {
    const dir = await call<string | null>('fs:pickDirectory', { title: 'Download to…' }).catch(() => null);
    if (dir) await A.startTransfer(c.selection.map((e) => e.path), dir, 'copy', 'remote-download');
  } },
  { id: 'remote.copyAddress', title: 'Copy server address', category: 'Edit', icon: 'link', description: 'Copies the address of the selected items (or the folder shown) as sftp://…, davs://… or ftps://… for other programs. It never contains a password.', when: (c) => (remoteFiles(c) || c.location.kind === 'remote' ? true : 'Only available for items on a server.'), run: async (c) => {
    const refs = c.selection.length ? c.selection.map((e) => e.path) : c.location.kind === 'remote' ? [remoteRef(c.location.connectionId, c.location.path)] : [];
    const text = refs.map((r) => remoteAddress(r) ?? '').filter(Boolean).join('\n');
    if (!text) return;
    await call('fs:copyText', { text }).catch(toastError);
    toast({ level: 'success', title: refs.length === 1 ? 'Copied the server address' : `Copied ${refs.length} server addresses`, detail: text.slice(0, 160) });
  } },
  // Tab sets store open tabs and their folders (not interface customization: that is what workspaces are for).
  { id: 'app.saveTabSet', title: 'Save tab set…', category: 'Window', icon: 'tab', description: 'Saves the open tabs, panes and their folders under a name.', run: async () => {
    const name = await prompt({ title: 'Save tab set', label: 'Name', initial: 'My tabs', confirmLabel: 'Save' });
    if (!name) return;
    const s = ws.get();
    await call('cat:saveWorkspace', { name, state: { tabs: s.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => ({ ...p, selection: [] })) })), groups: s.groups, activeTabId: s.activeTabId } }).then(() => toast({ level: 'success', title: `Saved tab set "${name}"` }), toastError);
  } },
  { id: 'app.openTabSet', title: 'Open tab set…', category: 'Window', icon: 'tab', description: 'Reopens a saved set of tabs; folders that no longer exist open at Home.', run: () => openDialog('tabSets') },

  // AI — enabled only when the connected provider declares the capability.
  { id: 'ai.explain', title: 'Ask Orbis AI to explain', category: 'AI', icon: 'sparkle', when: (c) => aiWhen('explain_file', c, 1), run: (c) => openDialog('ai', { kind: 'explain_file', paths: c.selection.map((e) => e.path) }) },
  { id: 'ai.summarize', title: 'Summarize with Orbis AI', category: 'AI', icon: 'sparkle', when: (c) => aiWhen('summarize_document', c, 1), run: (c) => openDialog('ai', { kind: 'summarize_document', paths: c.selection.map((e) => e.path) }) },
  { id: 'ai.organize', title: 'Suggest organisation with Orbis AI', category: 'AI', icon: 'sparkle', when: (c) => aiWhen('organize_suggestions', c, 1), run: (c) => openDialog('ai', { kind: 'organize_suggestions', paths: c.selection.map((e) => e.path) }) },
  { id: 'ai.compare', title: 'Interpret differences with Orbis AI', category: 'AI', icon: 'sparkle', when: (c) => aiWhen('compare_interpret', c, 2), run: (c) => openDialog('ai', { kind: 'compare_interpret', paths: c.selection.map((e) => e.path) }) },
  { id: 'ai.extract', title: 'Extract data with Orbis AI', category: 'AI', icon: 'sparkle', when: (c) => aiWhen('extract_structured', c, 1), run: (c) => openDialog('ai', { kind: 'extract_structured', paths: c.selection.map((e) => e.path) }) },
  { id: 'ai.edit', title: 'Edit with Orbis AI…', category: 'AI', icon: 'sparkle', when: (c) => {
    const w = aiWhen('edit_file', c, 1);
    if (w !== true) return w;
    return c.selection.length === 1 && c.selection[0]!.kind === 'file' ? true : 'Select one file.';
  }, run: (c) => openDialog('ai', { kind: 'edit_file', paths: [c.selection[0]!.path] }) },
  // Folder-level tasks share the folder's listing (names only) unless the user changes it.
  { id: 'ai.folder', title: 'Analyse this folder with Orbis AI', category: 'AI', icon: 'sparkle', when: (c) => aiFolderWhen('folder_analysis', c), run: (c) => openDialog('ai', { kind: 'folder_analysis', paths: aiFolderRefs(c), share: 'metadata' }) },
  { id: 'ai.search', title: 'Search in plain language with Orbis AI…', category: 'AI', icon: 'sparkle', when: (c) => aiFolderWhen('nl_search_plan', c), run: (c) => openDialog('ai', { kind: 'nl_search_plan', paths: aiFolderRefs(c), share: 'metadata' }) },
  { id: 'ai.generate', title: 'Create a file with Orbis AI…', category: 'AI', icon: 'sparkle', when: (c) => aiFolderWhen('generate_file', c), run: (c) => openDialog('ai', { kind: 'generate_file', paths: aiFolderRefs(c), share: 'metadata' }) },
  // Breadcrumb & links
  { id: 'nav.editPath', title: 'Edit breadcrumb path', category: 'Navigate', icon: 'terminal', description: 'Type a path directly in the breadcrumb bar.', when: (c) => c.location.kind === 'fs', run: () => { document.dispatchEvent(new CustomEvent('orbis:breadcrumb-edit')); } },
  { id: 'nav.copyPath', title: 'Copy current path', category: 'Navigate', icon: 'copy', description: 'Copy the current folder path to the clipboard.', when: (c) => c.location.kind === 'fs', run: (c) => { if (c.dir) void call('fs:copyText', { text: c.dir }).then(() => toast({ level: 'info', title: 'Path copied' })).catch(toastError); } },
  { id: 'link.create', title: 'Create file link…', category: 'File', icon: 'link-2', description: 'Create a soft alias pointing to a file or folder.', when: (c) => c.location.kind === 'fs' && c.selection.length === 1, run: async (c) => { const entry = c.selection[0]!; if (c.dir) { await call('link:create', { name: entry.name, targetPath: entry.path, parentPath: c.dir }); toast({ level: 'info', title: 'Link created' }); } } },
  // Power tools and clipboard (powerCommands.ts)
  ...POWER_COMMANDS,
  // Text recognition (OCR): features/ocr/ocrCommands.ts
  ...OCR_COMMANDS,
  // Screenshot capture and annotation: features/screenshotCommands.ts
  ...SCREENSHOT_COMMANDS,
];

// Orbis Files only works inside Orbis's own folder: nothing here reaches other machines, drives, or a shell.
const OUT_OF_SCOPE = /^(remote|s3|cloud|share|tools\.(cloudMount|s3|shares)|app\.customize)/i;
for (let i = COMMANDS.length - 1; i >= 0; i--) if (OUT_OF_SCOPE.test(COMMANDS[i]!.id)) COMMANDS.splice(i, 1);

function gitWhen(c: CommandContext): boolean | string {
  if (!c.dir) return 'Open a folder first.';
  if (!app.get().settings.gitIntegration) return 'Git status is switched off in Settings.';
  const st = gitState.get().byDir[c.dir];
  if (!st) return 'Checking Git status…';
  if (st.state === 'unavailable') return 'Git not found.';
  return st.state === 'ok' ? true : 'This folder is not in a Git repository.';
}

/** Selected folders, or the folder being viewed. */
function aiFolderRefs(c: CommandContext): string[] {
  const dirs = c.selection.filter((e) => e.kind === 'directory').map((e) => e.path);
  if (dirs.length) return dirs;
  return c.location.kind === 'fs' ? [c.location.path] : [];
}

function aiFolderWhen(cap: string, c: CommandContext): boolean | string {
  if (aiState.status !== 'available' && aiState.status !== 'degraded') return 'Orbis AI is not connected.';
  if (!aiState.capabilities.includes(cap)) return 'The connected provider does not offer this.';
  return aiFolderRefs(c).length ? true : 'Open a folder first.';
}

function zoomBy(step: number): Promise<boolean> {
  const next = Math.round(Math.min(1.6, Math.max(0.8, resolvedNow().accessibility.interfaceScale + step)) * 10) / 10;
  return applyCustom({ op: 'set', section: 'accessibility', path: ['interfaceScale'], value: next, label: `Interface size ${Math.round(next * 100)}%` });
}

/** Show the details panel (in a narrow window: for this session, without changing the layout). */
async function showDetailsPanel(): Promise<void> {
  const { fitState } = await import('./state/layoutFit');
  if (!resolvedNow().layout.details.visible) await applyCustom({ op: 'set', section: 'layout', path: ['details', 'visible'], value: true, label: 'Details panel' });
  else if (fitState.get().hidden.details) togglePanel('inspector');
  // Switch an already visible panel to its Properties tab (after a panel that was just shown renders).
  requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('orbis:show-properties')));
}

function openStudio(c: CommandContext, category: string): void {
  document.dispatchEvent(new CustomEvent('orbis:open-studio', { detail: { category, paneId: c.pane.id } }));
}

async function cycleWorkspace(d: 1 | -1): Promise<void> {
  const cfg = custom.get().server.config;
  const i = cfg.workspaces.findIndex((w) => w.id === cfg.activeWorkspaceId);
  const next = cfg.workspaces[(i + d + cfg.workspaces.length) % cfg.workspaces.length];
  if (next && next.id !== cfg.activeWorkspaceId && (await applyCustom({ op: 'activateWorkspace', id: next.id }))) toast({ level: 'info', title: `Workspace: ${next.name}`, detail: 'Only the interface changed; no files were touched.' });
}

export const aiState: { status: string; capabilities: string[] } = { status: 'not_configured', capabilities: [] };

function aiWhen(cap: string, c: CommandContext, min: number): boolean | string {
  if (aiState.status !== 'available' && aiState.status !== 'degraded') return 'Orbis AI is not connected.';
  if (!aiState.capabilities.includes(cap)) return 'The connected provider does not offer this.';
  return c.selection.length >= min ? true : `Select ${min === 1 ? 'an item' : `${min} items`}.`;
}

let byId = new Map(COMMANDS.map((c) => [c.id, c]));

/**
 * Each custom action is a command ("action.<id>") like any other: in the
 * palette, the context menu's Actions submenu, the toolbar catalogue and the
 * shortcut editor. Rebuilt when the actions change.
 */
export function actionCommand(a: CustomAction): Command {
  return {
    id: actionCommandId(a.id),
    title: a.name,
    category: 'Actions',
    icon: 'action',
    // The command line itself is not part of the registry reported to a host (it may contain private paths or tokens).
    description: `Custom action: runs a program you defined in Settings → Custom actions${a.shell ? ", through the shell" : ""}.`,
    when: (c) => {
      const r = actionAppliesTo(a, c.selection, c.dir);
      if (r !== true) return r;
      return c.selection.length || c.dir ? true : 'Only available inside a folder.';
    },
    run: (c) => runCustomAction(a, c.selection, c.dir),
  };
}

export function syncActionCommands(list: CustomAction[] = customActions.get().list): void {
  for (let i = COMMANDS.length - 1; i >= 0; i--) if (COMMANDS[i]!.id.startsWith('action.')) COMMANDS.splice(i, 1);
  COMMANDS.push(...list.map(actionCommand));
  byId = new Map(COMMANDS.map((c) => [c.id, c]));
  lastShortcuts = undefined; // rebuild the keymap (bindings for actions)
  rebuildKeymap();
  // The customization service validates shortcut assignments against this registry.
  reportRegistry(describeCommands());
}

export const commandById = (id: string): Command | undefined => byId.get(id);
export function command(id: string): Command {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown command ${id}`);
  return c;
}

/** Commands that work for items and folders on a server; other file commands need local files. */
const REMOTE_OK = new Set([
  'file.open', 'file.openTab', 'file.rename', 'file.delete', 'file.copyToOther', 'file.moveToOther', 'file.newFolder', 'file.properties', 'file.copyName',
  'edit.copy', 'edit.cut', 'edit.paste', 'edit.selectAll', 'edit.invertSelection', 'edit.clearSelection', 'edit.selectSameType', 'edit.selectPattern',
]);
/** View and navigation commands that need a folder on this computer. */
const REMOTE_NO = new Set(['view.columns', 'view.tree', 'view.folderSizes', 'view.saveView', 'nav.search', 'nav.searchSelected', 'shelf.add', 'shelf.copyHere', 'shelf.moveHere', 'git.copyRemote', 'git.refresh']);

/** Why a command is unavailable in a remote folder or for items on a server (undefined when it is available). */
function remoteRestriction(cmd: Command, ctx: CommandContext): string | undefined {
  const remoteCtx = ctx.location.kind === 'remote' || ctx.selection.some((e) => isRemoteRef(e.path));
  if (!remoteCtx || cmd.id.startsWith('remote.')) return undefined;
  if (cmd.id === 'file.trash') return 'Servers have no Trash. Use Delete permanently (Shift+Delete), which asks first.';
  if (REMOTE_NO.has(cmd.id)) return 'Not available for folders on a server.';
  const fileCommand = cmd.category === 'File' || cmd.category === 'Edit' || cmd.category === 'AI' || cmd.category === 'Actions';
  if (fileCommand && !REMOTE_OK.has(cmd.id)) return 'Not available for items on a server. Copy them to this computer first.';
  return undefined;
}

export function availability(cmd: Command, ctx: CommandContext): { enabled: boolean; reason?: string } {
  const restricted = remoteRestriction(cmd, ctx);
  if (restricted) return { enabled: false, reason: restricted };
  const r = cmd.when ? cmd.when(ctx) : true;
  return r === true ? { enabled: true } : { enabled: false, reason: typeof r === 'string' ? r : undefined };
}

export async function runCommand(id: string, ctx: CommandContext = getContext()): Promise<void> {
  const cmd = command(id);
  const a = availability(cmd, ctx);
  if (!a.enabled) {
    if (a.reason) toast({ level: 'info', title: a.reason });
    return;
  }
  try {
    await cmd.run(ctx);
  } catch (err) {
    toastError(err);
  }
}

// ------------------------------------------------------------------ keyboard
const isMac = () => window.orbis.platform === 'darwin';

export function keyLabel(k: string): string {
  const mac = isMac();
  return k
    .replace('Mod', mac ? '⌘' : 'Ctrl')
    .replace('Alt', mac ? '⌥' : 'Alt')
    .replace('Shift', mac ? '⇧' : 'Shift')
    .replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓')
    .replace(/\+/g, mac ? '' : '+');
}

function eventKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('Mod');
  if (!isMac() && e.ctrlKey && !mod) parts.push('Ctrl');
  if (isMac() && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (key === ' ') key = 'Space';
  if (e.code === 'Backslash') key = '\\';
  if (e.code === 'BracketLeft') key = '[';
  if (e.code === 'BracketRight') key = ']';
  if (e.code === 'Comma') key = ',';
  if (e.code === 'Equal' || e.code === 'NumpadAdd') key = '=';
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') key = '-';
  if (e.code === 'Digit0' || e.code === 'Numpad0') key = '0';
  if (e.code === 'Backquote') key = '`';
  parts.push(key);
  return parts.join('+');
}

/**
 * Effective key bindings: the registry defaults, replaced per command by the
 * user's bindings (Customization → Keyboard shortcuts). Rebuilt whenever the
 * customization changes; every binding runs a registered command.
 */
let keymap = new Map<string, string>();
let bindingsById = new Map<string, string[]>();
let lastShortcuts: unknown;
export const shortcutConflicts: string[] = [];

/** Bindings as written ("Mod+K"); on Linux/Windows "Ctrl+X" and "Mod+X" are the same key. */
const lookupForms = (k: string): string[] => (!isMac() && k.startsWith('Ctrl+') ? [k, `Mod+${k.slice(5)}`] : [k]);

export function defaultBindings(): Array<{ command: string; keys: string[] }> {
  return COMMANDS.map((c) => ({ command: c.id, keys: (c.keys ?? []).map((k) => (normalizeShortcut(k).ok ? (normalizeShortcut(k) as { value: string }).value : k)) }));
}

function rebuildKeymap(): void {
  const overrides = resolvedNow().shortcuts.bindings;
  if (overrides === lastShortcuts && keymap.size) return;
  lastShortcuts = overrides;
  const { bindings } = effectiveBindings(defaultBindings(), overrides);
  const next = new Map<string, string>();
  const byId = new Map<string, string[]>();
  shortcutConflicts.length = 0;
  for (const b of bindings) {
    byId.set(b.command, b.keys);
    for (const k of b.keys) for (const form of lookupForms(k)) {
      if (next.has(form) && next.get(form) !== b.command) shortcutConflicts.push(`${k}: ${next.get(form)} / ${b.command}`);
      next.set(form, b.command);
    }
  }
  keymap = next;
  bindingsById = byId;
}
rebuildKeymap();
custom.subscribe(rebuildKeymap);
// The terminal asks which command a key would run, to leave only a few keys to the app.
T.setTerminalKeyLookup((e) => {
  rebuildKeymap();
  return keymap.get(eventKey(e));
});
{
  let lastList = customActions.get().list;
  customActions.subscribe(() => {
    if (customActions.get().list === lastList) return;
    lastList = customActions.get().list;
    syncActionCommands(lastList);
  });
}

export function bindingsFor(id: string): string[] {
  rebuildKeymap();
  return bindingsById.get(id) ?? [];
}

/** Commands that stay available while typing in a text field (only through a modified key or a function key). */
const WHILE_TYPING = new Set(['player.toggle', 'player.next', 'player.previous', 'terminal.toggle', 'terminal.new', 'editor.save', 'editor.saveAs', 'editor.gotoLine', 'editor.toggleWrap', 'editor.togglePreview', 'app.palette', 'app.shortcuts', 'nav.quickOpen', 'app.customize', 'nav.address', 'nav.search', 'nav.newTab', 'nav.closeTab', 'nav.newWindow', 'app.operations', 'app.settings', 'nav.refresh', 'view.sidebar', 'nav.nextTab', 'nav.prevTab', 'custom.workspaces', 'view.dualPane', 'dualPane.copy', 'dualPane.move', 'dualPane.newFolder', 'dualPane.delete']);
const hasCommandModifier = (k: string) => /(^|\+)(Mod|Ctrl|Alt)\+/.test(k) || /^F\d+$/.test(k.split('+').pop() ?? '');

const DUAL_PANE_KEYS: Record<string, () => void> = {
  F5: () => DP.copyToOther(),
  F6: () => DP.moveToOther(),
  F7: () => DP.newFolderInActive(),
  F8: () => DP.deleteSelected(),
  Tab: () => DP.switchPane(),
};

export function handleGlobalKey(e: KeyboardEvent): boolean {
  rebuildKeymap();
  const k = eventKey(e);
  // Dual-pane mode intercepts F5–F8 and Tab before the normal keymap.
  if (DP.dualPane.get().active && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const dpAction = DUAL_PANE_KEYS[k];
    if (dpAction) {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (!typing && !app.get().dialog && !app.get().paletteOpen && !app.get().switcherOpen) {
        e.preventDefault();
        dpAction();
        return true;
      }
    }
  }
  const id = keymap.get(k);
  if (!id && k !== 'Escape') return false;
  const el = e.target as HTMLElement | null;
  // The editor handled this key itself (Ctrl+F opens its search, Ctrl+G goes to a line…).
  if (e.defaultPrevented && el?.closest?.('.cm-editor')) return false;
  // In a terminal every key goes to the shell except the few it leaves to the app (toggle, new terminal, palette).
  if (el?.closest?.('.term-surface')) {
    if (!id || !T.isAppKey(e) || app.get().dialog) return false;
    e.preventDefault();
    void runCommand(id);
    return true;
  }
  // Elsewhere in the terminal panel (its tabs, buttons, find box) plain keys never act on the files in the panes.
  if (el?.closest?.('.term-dock') && !hasCommandModifier(k)) return false;
  const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  // Never intercept ordinary typing or text-editing keys in text fields and path inputs.
  if (typing && !(id && WHILE_TYPING.has(id) && hasCommandModifier(k))) return false;
  // A key-capture field (shortcut editor) handles its own keys.
  if (el?.closest?.('[data-capture-keys]')) return false;
  // Enter/Space on a focused button, link, switch, tab… press that control, not a file command.
  if (controlHandlesKey(k, el)) return false;
  if (!id) return false;
  if (app.get().dialog || app.get().paletteOpen || app.get().switcherOpen) return false;
  e.preventDefault();
  void runCommand(id);
  return true;
}

export function shortcutFor(id: string): string | undefined {
  const k = bindingsFor(id)[0];
  return k ? keyLabel(k) : undefined;
}

// ------------------------------------------------------------------ registry adapter
const MODIFY = new Set(['editor.save', 'editor.saveAs', 'file.pdfTools', 'file.pdfMerge', 'file.pdfSplit', 'file.pdfExtract', 'file.textFixes', 'tools.findReplace', 'file.newFolder', 'file.newText', 'file.newMarkdown', 'file.newJson', 'file.newEmpty', 'file.newFromTemplate', 'file.createChecksums', 'file.quickZip', 'file.rename', 'file.bulkRename', 'edit.paste', 'file.duplicate', 'file.copyToOther', 'file.moveToOther', 'file.compress', 'file.extractHere', 'file.extractFolder', 'file.extractTo', 'file.link', 'file.convert', 'file.permissions', 'file.import', 'ai.edit', 'ai.organize', 'ai.generate', 'shelf.copyHere', 'shelf.moveHere', 'file.encrypt', 'file.decrypt', 'file.imageTools', 'file.organizeByDate', 'remote.download', 'terminal.paste', 'terminal.cdToPane', 'terminal.follow']);
const READ = new Set(['file.edit', 'file.openInEditor', 'editor.compare', 'editor.reload', 'editor.find', 'editor.gotoLine', 'edit.copy', 'edit.cut', 'file.copyPath', 'file.copyName', 'file.copyUri', 'file.copyRelativePath', 'file.copyPosixPath', 'file.copyWindowsPath', 'file.copyQuotedPath', 'file.copyContents', 'file.verifyChecksums', 'view.folderSizes', 'file.properties', 'file.compare', 'file.testArchive', 'file.checksum', 'file.snapshot', 'file.tag', 'file.collect', 'file.addToProject', 'file.addAsProject', 'file.pin', 'ai.explain', 'ai.summarize', 'ai.compare', 'ai.extract', 'ai.folder', 'ai.search', 'shelf.add', 'shelf.clear', 'git.copyRemote', 'file.shareLan', 'remote.preview', 'remote.copyAddress']);

for (const id of POWER_MODIFY) MODIFY.add(id);
for (const id of POWER_READ) READ.add(id);
// Music player and video tools in the registry adapter.
for (const id of ['player.savePlaylist', 'player.saveNamedPlaylist', 'player.deletePlaylist', 'video.trim', 'video.extractAudio', 'video.gif', 'video.contactSheet', 'video.saveFrame', 'video.join', 'video.rotate', 'dualPane.copy', 'dualPane.move', 'dualPane.newFolder', 'dualPane.delete']) MODIFY.add(id);
for (const id of ['player.play', 'player.playNext', 'player.enqueue', 'player.playFolder', 'player.loadPlaylist']) READ.add(id);

function permissionOf(c: Command): CommandDescriptor['permission'] {
  if (c.risk === 'destructive') return 'destructive';
  // A custom action runs a program the user chose, which may change anything.
  if (c.id.startsWith('action.')) return 'modify';
  if (MODIFY.has(c.id)) return 'modify';
  if (READ.has(c.id)) return 'read';
  if (c.category === 'View' || c.category === 'Customize' || c.id === 'app.settings') return 'settings';
  return 'navigate';
}

const IN_FOLDER = new Set(['shelf.copyHere', 'shelf.moveHere', 'git.copyRemote', 'git.refresh', 'file.newFolder', 'file.newText', 'file.newMarkdown', 'file.newJson', 'file.newEmpty', 'file.newFromTemplate', 'file.openTerminal', 'terminal.openHere', 'view.folderSizes', 'edit.selectPattern', 'file.createChecksums', 'file.quickZip', 'edit.paste', 'file.compress', 'file.link', 'file.convert', 'nav.up', 'edit.selectAll', 'edit.invertSelection', 'ai.folder', 'ai.search', 'ai.generate']);
const ON_SELECTION = new Set([
  'terminal.openHere', 'shelf.add', 'file.edit', 'file.openInEditor', 'remote.preview', 'remote.download', 'remote.copyAddress',
  'file.open', 'file.openWith', 'file.openTab', 'file.openWindow', 'file.rename', 'file.bulkRename', 'edit.copy', 'edit.cut', 'file.duplicate', 'file.trash', 'file.delete', 'file.copyName', 'file.copyUri',
  'file.permissions', 'file.copyToOther', 'file.moveToOther', 'file.extractHere', 'file.extractFolder', 'file.extractTo', 'file.testArchive', 'file.browseArchive', 'file.convertArchive', 'file.compare', 'file.snapshot', 'file.collect',
  'file.addToProject', 'file.import', 'file.tag', 'file.pdfTools', 'file.pdfMerge', 'file.pdfSplit', 'file.pdfExtract', 'file.textFixes', 'file.checksum', 'nav.searchSelected', 'file.copyRelativePath', 'file.copyPosixPath', 'file.copyWindowsPath', 'file.copyQuotedPath', 'file.copyContents', 'file.createChecksums', 'file.verifyChecksums', 'file.quickZip', 'edit.selectSameType', 'edit.clearSelection', 'ai.explain', 'ai.summarize', 'ai.organize', 'ai.compare', 'ai.extract', 'ai.edit', 'file.encrypt', 'file.decrypt', 'file.shareLan',
]);

for (const id of POWER_IN_FOLDER) IN_FOLDER.add(id);
for (const id of POWER_ON_SELECTION) ON_SELECTION.add(id);
for (const id of ['player.play', 'player.playNext', 'player.enqueue', 'video.trim', 'video.extractAudio', 'video.gif', 'video.contactSheet', 'video.saveFrame', 'video.join', 'video.rotate']) ON_SELECTION.add(id);
IN_FOLDER.add('player.playFolder');
// Text recognition (OCR): recognizing only reads; extracting writes new files.
READ.add('ocr.recognize');
MODIFY.add('ocr.extract');
ON_SELECTION.add('ocr.recognize');
ON_SELECTION.add('ocr.extract');
IN_FOLDER.add('ocr.extract');

function contextsOf(c: Command): CommandDescriptor['contexts'] {
  if (c.id.startsWith('action.')) return ['files', 'selection', 'folder'];
  if (c.category === 'Customize' || c.category === 'Window' || c.category === 'Tools') return ['global'];
  const out: CommandDescriptor['contexts'] = ['files'];
  if (ON_SELECTION.has(c.id)) out.push('selection');
  if (IN_FOLDER.has(c.id)) out.push('folder');
  return out;
}

/** The Files command registry with its metadata, as offered to a future host's command system. */
export function describeCommands(): CommandDescriptor[] {
  return COMMANDS.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    description: (c.description ?? (/[.…]$/.test(c.title) ? c.title : `${c.title}.`)).slice(0, 300),
    contexts: contextsOf(c),
    permission: permissionOf(c),
    defaultKeys: defaultBindings().find((b) => b.command === c.id)!.keys,
    keys: bindingsFor(c.id),
  }));
}
