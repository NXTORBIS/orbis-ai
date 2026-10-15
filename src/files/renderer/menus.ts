import { app } from './state/app';
import { activeTab, isSplit, ws } from './state/workspace';
import { availability, command, commandById, runCommand, shortcutFor, type CommandContext } from './commands';
import { categoryOfEntry } from './ui/format';
import { SEP, type MenuItem } from './ui/components';
import { resolvedNow } from './state/custom';
import type { ContextMenuConfig } from '../shared/customization/schema';
import type { FileEntry } from '../shared/model';
import { refreshTemplates, templates } from './state/templates';
import { folderSizesActive } from './state/folderSizes';
import { isChecksumFileName } from '../shared/checksumFile';
import { customActions } from './state/customActions';
import { shelf } from './state/shelf';
import { actionCommandId } from '../shared/customActions';
import { mayBeText } from '../shared/editor';
import { hasClipboardImage, hasClipboardText } from './state/clipboard';
import { DESCRIPTOR_SUFFIX, parsePartName } from '../shared/powerTools';
import { isRemoteRef } from '../shared/remote';
import { ocrExtractWhen, ocrRecognizeWhen } from './features/ocr/ocrCommands';

/**
 * Context menus, built from the command registry and arranged by the user's
 * configuration (Customization → Context menus). Every item runs its real
 * command, with that command's own availability checks and confirmations;
 * rearranging or hiding items never removes a safety step.
 *
 * An arrangement is a list of item ids and "separator". Items relevant to
 * the clicked item(s) are shown in that order; items the arrangement does not
 * mention (for example, commands added in a newer version) keep their
 * default place at the end of their default group.
 */

export const MENU_SEPARATOR = 'separator';
const AI_ITEMS = ['ai.explain', 'ai.summarize', 'ai.extract', 'ai.edit', 'ai.organize', 'ai.compare', 'ai.folder', 'ai.search', 'ai.generate'];

/** Default arrangement of the item (file/folder) menu. */
export const ENTRY_MENU_DEFAULT: string[] = [
  'file.open', 'file.edit', 'file.openInEditor', 'file.openWith', 'file.openTab', 'file.openWindow', 'file.browseArchive', 'file.openTerminal', 'terminal.openHere', MENU_SEPARATOR,
  'edit.cut', 'edit.copy', 'edit.pasteInto', 'file.duplicate', 'file.copyToOther', 'file.moveToOther', MENU_SEPARATOR,
  'file.rename', 'file.compress', 'file.quickZip', 'file.extractHere', 'file.extractFolder', 'file.extractTo', 'file.testArchive', 'file.compare', 'file.convert', 'menu:pdf', 'file.textFixes', 'tools.findReplace', 'file.encrypt', 'file.decrypt', 'file.imageTools', 'file.organizeByDate', 'ocr.recognize', 'ocr.extract', 'view.slideshow', MENU_SEPARATOR,
  'file.tag', 'file.collect', 'file.addToProject', 'file.addAsProject', 'nav.searchSelected', 'file.import', 'file.pin', 'file.snapshot', 'file.link', 'shelf.add', 'file.shareLan', MENU_SEPARATOR,
  'menu:actions', 'menu:ai', MENU_SEPARATOR,
  'file.copyPath', 'menu:copyPathAs', 'file.checksum', 'file.createChecksums', 'file.verifyChecksums', 'file.permissions', 'file.reveal', 'file.properties', MENU_SEPARATOR,
  'file.trash', 'file.delete',
];

/** Default arrangement of the folder-background menu. */
export const BACKGROUND_MENU_DEFAULT: string[] = [
  'file.newFolder', 'menu:newFile', MENU_SEPARATOR,
  'edit.paste', 'edit.selectAll', 'edit.selectPattern', MENU_SEPARATOR,
  'nav.refresh', 'file.pin', 'file.copyPath', 'file.openTerminal', 'terminal.openHere', 'file.reveal', 'view.folderSizes', 'tools.findReplace', 'view.saveView', MENU_SEPARATOR,
  'view.slideshow', 'file.organizeByDate', 'ocr.extract', MENU_SEPARATOR,
  'shelf.copyHere', 'shelf.moveHere', 'menu:actions', 'git.copyRemote', MENU_SEPARATOR,
  'view.hidden', 'menu:ai',
];

// Power tools and clipboard: their places in the default menus (kept here as one block).
ENTRY_MENU_DEFAULT.splice(ENTRY_MENU_DEFAULT.indexOf('edit.copy') + 1, 0, 'clip.copyImage');
ENTRY_MENU_DEFAULT.splice(ENTRY_MENU_DEFAULT.indexOf('view.slideshow') + 1, 0, 'menu:powerTools');
ENTRY_MENU_DEFAULT.splice(ENTRY_MENU_DEFAULT.indexOf('file.delete') + 1, 0, 'file.shred');
BACKGROUND_MENU_DEFAULT.splice(BACKGROUND_MENU_DEFAULT.indexOf('edit.paste') + 1, 0, 'clip.pasteImage', 'clip.pasteText', 'clip.history');
BACKGROUND_MENU_DEFAULT.splice(BACKGROUND_MENU_DEFAULT.indexOf('file.organizeByDate') + 1, 0, 'file.flatten');

/** Labels for the menu editor (ids that are not plain commands). */
export const MENU_SPECIAL_LABEL: Record<string, string> = {
  'edit.pasteInto': 'Paste into folder',
  'menu:ai': 'Orbis AI actions (shown only when a provider offers them)',
  'menu:newFile': 'New file ▸',
  'menu:copyPathAs': 'Copy path as ▸',
  'menu:pdf': 'PDF tools ▸ (PDF files only)',
  'menu:actions': 'Actions ▸ (your custom actions that apply here)',
  'menu:powerTools': 'Power tools ▸ (split, join, flatten, dates, hard links)',
  [MENU_SEPARATOR]: '──── separator ────',
};

// Music player and video tools: Play / Play next / Add to queue after the open commands, a "Video tools ▸"
// submenu in the tools group, and "Play folder" on the folder background (kept in one block for easy merging).
ENTRY_MENU_DEFAULT.splice(ENTRY_MENU_DEFAULT.indexOf('terminal.openHere') + 1, 0, 'player.play', 'player.playNext', 'player.enqueue');
ENTRY_MENU_DEFAULT.splice(ENTRY_MENU_DEFAULT.indexOf('view.slideshow') + 1, 0, 'menu:video');
BACKGROUND_MENU_DEFAULT.splice(BACKGROUND_MENU_DEFAULT.indexOf('view.slideshow'), 0, 'player.playFolder');
MENU_SPECIAL_LABEL['menu:video'] = 'Video tools ▸ (videos; Trim also for audio)';
const VIDEO_MENU = ['video.trim', 'video.extractAudio', 'video.gif', 'video.contactSheet', 'video.saveFrame', 'video.join', 'video.rotate'];

export function menuItemLabel(id: string): string {
  return MENU_SPECIAL_LABEL[id] ?? commandById(id)?.title ?? id;
}

export function cmdItem(id: string, ctx: CommandContext, label?: string): MenuItem {
  const c = command(id);
  const a = availability(c, ctx);
  return { id, label: label ?? c.title, icon: c.icon, shortcut: shortcutFor(id), disabled: !a.enabled, reason: a.reason, danger: c.risk === 'destructive', run: () => void runCommand(id, ctx) };
}

/** Drop leading, trailing and doubled separators. */
export function tidy(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (it.separator && (!out.length || out[out.length - 1]!.separator)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1]!.separator) out.pop();
  return out;
}

/** The user's arrangement merged with the defaults: unknown ids are dropped, new defaults appended in their group. */
export function arrangement(defaults: string[], saved: string[]): string[] {
  if (!saved.length) return defaults;
  const known = new Set(defaults);
  const out = saved.filter((id) => id === MENU_SEPARATOR || known.has(id));
  const present = new Set(out);
  for (const id of defaults) if (id !== MENU_SEPARATOR && !present.has(id)) out.push(id);
  return out;
}

function present(items: Array<MenuItem | MenuItem[] | false | undefined>, cfg: ContextMenuConfig): MenuItem[] {
  const flat: MenuItem[] = [];
  for (const it of items) {
    if (!it) continue;
    for (const x of Array.isArray(it) ? it : [it]) {
      if (!x.separator && x.disabled && cfg.unavailable === 'hide') continue;
      flat.push({ ...x, icon: cfg.showIcons ? x.icon : undefined, shortcut: cfg.showShortcuts ? x.shortcut : undefined, submenu: x.submenu?.map((s) => ({ ...s, icon: cfg.showIcons ? s.icon : undefined, shortcut: cfg.showShortcuts ? s.shortcut : undefined })) });
    }
  }
  return tidy(flat);
}

/** Items that moved into "Copy path as ▸": a saved arrangement keeps the submenu where it had them. */
const MOVED_INTO_SUBMENU: Record<string, string> = { 'file.copyName': 'menu:copyPathAs', 'file.copyUri': 'menu:copyPathAs' };

function migrateOrder(order: string[]): string[] {
  const out: string[] = [];
  for (const id of order) {
    const to = MOVED_INTO_SUBMENU[id] ?? id;
    if (to === MENU_SEPARATOR || !out.includes(to)) out.push(to);
  }
  return out;
}

/** "Copy path as ▸": every format of shared/pathFormats, plus the contents of a small text file. */
export function copyPathAsItems(ctx: CommandContext): MenuItem[] {
  const quoted = window.orbis.platform === 'win32' ? 'Quoted for PowerShell' : 'Quoted for the shell (sh, bash, zsh)';
  return [
    cmdItem('file.copyPath', ctx, 'Absolute path'),
    cmdItem('file.copyRelativePath', ctx, 'Relative to this folder'),
    cmdItem('file.copyPosixPath', ctx, 'With / separators (POSIX)'),
    cmdItem('file.copyWindowsPath', ctx, 'With \\ separators (Windows)'),
    cmdItem('file.copyQuotedPath', ctx, quoted),
    cmdItem('file.copyUri', ctx, 'File link (file://)'),
    cmdItem('file.copyName', ctx, ctx.selection.length > 1 ? 'Names' : 'Name'),
    SEP,
    cmdItem('file.copyContents', ctx, 'File contents as text'),
  ];
}

/** Actions ▸: the custom actions that apply to this selection (disabled ones say why), then "Custom actions…". */
export function actionItems(ctx: CommandContext): MenuItem[] | false {
  const list = customActions.get().list;
  if (!list.length) return false;
  const items = list.map((a) => cmdItem(actionCommandId(a.id), ctx));
  const usable = items.filter((i) => !i.disabled);
  return [...(usable.length ? usable : items), SEP, cmdItem('actions.manage', ctx, 'Custom actions…')];
}

/** New → items: built-in kinds, then the files of the templates folder. */
export function newFileItems(ctx: CommandContext, paneId: string): MenuItem[] {
  void refreshTemplates(); // the next opening shows files added to the folder since
  const list = templates.get().listing?.templates ?? [];
  const inFolder = !!ctx.dir;
  return [
    ...['file.newText', 'file.newMarkdown', 'file.newJson', 'file.newEmpty'].map((x) => cmdItem(x, ctx)),
    ...(list.length ? [SEP] : []),
    ...list.slice(0, 30).map((t) => ({ id: `tpl:${t.path}`, label: t.name, icon: 'newFile', disabled: !inFolder, reason: 'Only available inside a folder.', run: () => void import('./actions').then((A) => A.newFromTemplate(paneId, t)) })),
    SEP,
    cmdItem('file.newFromTemplate', ctx, list.length ? 'More templates…' : 'From template…'),
  ];
}

export function entryMenu(ctx: CommandContext, entry: FileEntry, cfg: ContextMenuConfig = resolvedNow().contextMenu): MenuItem[] {
  const multi = ctx.selection.length > 1;
  const isFolder = entry.kind === 'directory' || entry.linkTargetKind === 'directory';
  const isArchive = categoryOfEntry(entry) === 'archive';
  const split = isSplit(activeTab(ws.get()));
  const hidden = new Set(cfg.item.hidden);
  const build = (id: string): MenuItem | MenuItem[] | false => {
    if (id === MENU_SEPARATOR) return SEP;
    if (hidden.has(id)) return false;
    const power = powerEntryItem(id, ctx, entry);
    if (power !== undefined) return power;
    switch (id) {
      case 'file.openWith': return !isFolder && !multi && cmdItem(id, ctx);
      // Offered for files that may be text (not media, archives, office documents…); the editor checks the contents when opening.
      case 'file.edit': case 'file.openInEditor': return !isFolder && !multi && entry.linkTargetKind !== 'broken' && mayBeText(entry.name) && cmdItem(id, ctx);
      case 'file.openTab': return isFolder && cmdItem(id, ctx);
      case 'file.openWindow': return isFolder && !multi && cmdItem(id, ctx);
      case 'file.browseArchive': return isArchive && !multi && cmdItem(id, ctx);
      case 'edit.pasteInto': {
        const clip = app.get().clipboard;
        if (!isFolder || multi || !clip) return false;
        return { ...cmdItem('edit.paste', { ...ctx, dir: entry.path }), id, label: 'Paste into folder', run: () => void import('./actions').then((A) => A.startOperation({ type: clip.mode === 'cut' ? 'move' : 'copy', sources: clip.paths, destination: entry.path, conflictPolicy: 'ask', origin: 'paste' })) };
      }
      case 'file.copyToOther': case 'file.moveToOther': return split && cmdItem(id, ctx);
      case 'file.rename': return multi ? cmdItem('file.bulkRename', ctx) : cmdItem(id, ctx);
      case 'file.extractHere': case 'file.extractFolder': case 'file.extractTo': case 'file.testArchive': return isArchive && !multi && cmdItem(id, ctx);
      case 'file.compare': return ctx.selection.length === 2 && cmdItem(id, ctx);
      case 'file.convert': return ctx.selection.every((e) => ['image', 'audio', 'video'].includes(categoryOfEntry(e))) && cmdItem(id, ctx);
      case 'menu:pdf': {
        if (!ctx.selection.every((e) => e.kind === 'file' && e.ext === 'pdf')) return false;
        return { id, label: 'PDF tools', icon: 'filePdf', submenu: ['file.pdfTools', 'file.pdfMerge', 'file.pdfSplit', 'file.pdfExtract'].map((x) => cmdItem(x, ctx, x === 'file.pdfTools' ? 'Pages: delete, turn, reorder…' : undefined)) };
      }
      // Offered on text-like files; the command itself (palette, shortcut) accepts any files and refuses binary ones in its preview.
      case 'file.textFixes': return ctx.selection.every((e) => e.kind === 'file' && (['text', 'code', 'document'].includes(categoryOfEntry(e)) || ['csv', 'tsv', 'sh', 'bat', 'cmd', 'ps1'].includes(e.ext)) && !/^(docx?|xlsx?|pptx?|od[tsp]|rtf|epub|pages)$/.test(e.ext)) && cmdItem(id, ctx);
      case 'tools.findReplace': return isFolder && !multi && cmdItem(id, ctx, 'Find and replace in this folder…');
      case 'file.imageTools': return ctx.selection.every((e) => categoryOfEntry(e) === 'image') && cmdItem(id, ctx);
      // Offered on folders and on photos/videos (the command itself accepts any files from the palette).
      case 'file.organizeByDate': return ctx.selection.every((e) => e.kind === 'directory' || (e.kind === 'file' && ['image', 'video'].includes(categoryOfEntry(e)))) && cmdItem(id, ctx);
      case 'view.slideshow': return ctx.selection.every((e) => e.kind === 'file' && ['image', 'video'].includes(categoryOfEntry(e))) && cmdItem(id, ctx);
      // Text recognition: offered on images and PDFs (and folders, for extracting); the commands check the rest.
      case 'ocr.recognize': return !multi && ocrRecognizeWhen(ctx) === true && cmdItem(id, ctx);
      case 'ocr.extract': return ocrExtractWhen(ctx) === true && cmdItem(id, ctx);
      case 'file.addAsProject': return isFolder && !multi && cmdItem(id, ctx);
      case 'player.play': case 'player.playNext': case 'player.enqueue': {
        const it = cmdItem(id, ctx);
        return !it.disabled && it;
      }
      case 'menu:video': {
        const cats = ctx.selection.map((e) => (e.kind === 'file' || e.linkTargetKind === 'file' ? categoryOfEntry(e) : 'other'));
        if (cats.every((c) => c === 'video')) {
          const items = VIDEO_MENU.map((x) => cmdItem(x, ctx)).filter((i) => !(i.id === 'video.join' && !multi) && !(['video.trim', 'video.gif', 'video.saveFrame'].includes(i.id!) && multi));
          return { id, label: 'Video tools', icon: 'videoTools', submenu: items };
        }
        return !multi && cats[0] === 'audio' ? cmdItem('video.trim', ctx, 'Trim…') : multi && cats.every((c) => c === 'audio') ? cmdItem('video.join', ctx, 'Join audio files…') : false;
      }
      // Decrypt only where there is something to decrypt; Encrypt not for items that are all encrypted already.
      case 'file.decrypt': return ctx.selection.some((e) => e.kind === 'directory' || (e.kind === 'file' && e.name.toLowerCase().endsWith('.orbisenc'))) && cmdItem(id, ctx);
      case 'file.encrypt': return !ctx.selection.every((e) => e.kind === 'file' && e.name.toLowerCase().endsWith('.orbisenc')) && cmdItem(id, ctx);
      case 'nav.searchSelected': return ctx.selection.some((e) => e.kind === 'directory') && cmdItem(id, ctx);
      case 'file.pin': return isFolder && !multi && cmdItem(id, ctx);
      case 'file.snapshot': return !multi && cmdItem(id, ctx);
      case 'file.link': return !multi && !!app.get().capabilities?.symlinkCreate && cmdItem(id, ctx);
      case 'menu:ai': {
        // Shown only when the connected provider actually offers them (never as fake entries).
        const ai = AI_ITEMS.map((x) => cmdItem(x, ctx)).filter((i) => !i.disabled);
        return ai.length ? ai : false;
      }
      case 'file.copyName': return !multi && cmdItem(id, ctx);
      case 'menu:copyPathAs': return { id, label: 'Copy path as', icon: 'path', submenu: copyPathAsItems(ctx) };
      case 'menu:actions': {
        const sub = actionItems(ctx);
        return sub && { id, label: 'Actions', icon: 'action', submenu: sub };
      }
      case 'file.openTerminal': return isFolder && !multi && !!app.get().terminal && cmdItem(id, ctx);
      case 'terminal.openHere': return isFolder && !multi && cmdItem(id, ctx);
      case 'file.checksum': return ctx.selection.some((e) => e.kind === 'file') && cmdItem(id, ctx);
      case 'file.verifyChecksums': return !multi && entry.kind === 'file' && isChecksumFileName(entry.name) && cmdItem(id, ctx);
      case 'file.permissions': return !multi && entry.kind !== 'symlink' && cmdItem(id, ctx);
      case 'file.reveal': return !multi && cmdItem(id, ctx);
      default: return commandById(id) ? cmdItem(id, ctx) : false;
    }
  };
  return present(arrangement(ENTRY_MENU_DEFAULT, migrateOrder(cfg.item.order)).map(build), cfg);
}

export function backgroundMenu(ctx: CommandContext, cfg: ContextMenuConfig = resolvedNow().contextMenu): MenuItem[] {
  const hidden = new Set(cfg.background.hidden);
  const none = { ...ctx, selection: [] };
  const build = (id: string): MenuItem | MenuItem[] | false => {
    if (id === MENU_SEPARATOR) return SEP;
    if (hidden.has(id)) return false;
    // Paste image/text as file are offered when the clipboard holds an image or text.
    if (id === 'clip.pasteImage') return hasClipboardImage() && cmdItem(id, none);
    if (id === 'clip.pasteText') return hasClipboardText() && cmdItem(id, none);
    if (id === 'clip.history' || id === 'file.flatten') return cmdItem(id, none);
    switch (id) {
      case 'menu:newFile': return { label: 'New file', icon: 'newFile', submenu: newFileItems(ctx, ctx.pane.id) };
      case 'file.pin': case 'file.copyPath': case 'file.reveal': return cmdItem(id, none);
      case 'file.openTerminal': return !!app.get().terminal && cmdItem(id, none);
      case 'terminal.openHere': return !!ctx.dir && cmdItem(id, none);
      case 'player.playFolder': return !!ctx.dir && cmdItem(id, none);
      case 'tools.findReplace': return cmdItem(id, none, 'Find and replace in this folder…');
      case 'view.folderSizes': return { ...cmdItem(id, none), checked: folderSizesActive(ctx.dir) };
      case 'view.hidden': return cmdItem(id, ctx, app.get().settings.showHidden ? 'Hide hidden files' : 'Show hidden files');
      case 'shelf.copyHere': case 'shelf.moveHere': return shelf.get().items.length > 0 && cmdItem(id, none);
      case 'ocr.extract': return !!ctx.dir && cmdItem(id, none, 'Extract text from this folder…');
      case 'git.copyRemote': {
        const it = cmdItem(id, none);
        return !it.disabled && it;
      }
      case 'menu:actions': {
        const sub = actionItems(none);
        return sub && { id, label: 'Actions', icon: 'action', submenu: sub };
      }
      case 'menu:ai': {
        const ai = ['ai.folder', 'ai.search', 'ai.generate'].map((x) => cmdItem(x, none)).filter((i) => !i.disabled);
        return ai.length ? { label: 'Orbis AI', icon: 'sparkle', submenu: ai } : false;
      }
      default: return commandById(id) ? cmdItem(id, ctx) : false;
    }
  };
  return present(arrangement(BACKGROUND_MENU_DEFAULT, cfg.background.order).map(build), cfg);
}

// ------------------------------------------------------------------ toolbar

/** Toolbar slots that open menus rather than run one command. */
export const TOOLBAR_SPECIAL_LABEL: Record<string, string> = {
  'menu:new': 'New… (folder or file)',
  'menu:view': 'View, sort and group',
  'menu:views': 'Saved views',
  'menu:more': 'More actions (always kept; holds everything that does not fit)',
};

/** Commands that can be placed on the toolbar: Files commands with an icon. */
export function toolbarCatalog(): Array<{ id: string; label: string; icon: string }> {
  const specials = Object.entries(TOOLBAR_SPECIAL_LABEL).map(([id, label]) => ({ id, label, icon: id === 'menu:new' ? 'plus' : id === 'menu:view' ? 'viewDetails' : id === 'menu:views' ? 'save' : 'more' }));
  const cmds: Array<{ id: string; label: string; icon: string }> = [];
  for (const id of [...TOOLBAR_COMMANDS, ...customActions.get().list.map((a) => actionCommandId(a.id))]) {
    const c = commandById(id);
    if (c?.icon) cmds.push({ id, label: c.category === 'Actions' ? `Action: ${c.title}` : c.title, icon: c.icon });
  }
  return [...specials, ...cmds];
}

/** Commands offered for the toolbar (selection-independent or commonly used ones). */
export const TOOLBAR_COMMANDS = [
  'nav.back', 'nav.forward', 'nav.up', 'nav.refresh', 'nav.home', 'nav.newTab', 'nav.newWindow', 'nav.split', 'nav.swapPanes', 'nav.searchDrives',
  'nav.quickOpen', 'file.edit', 'edit.paste', 'edit.copy', 'edit.cut', 'file.newFolder', 'file.duplicate', 'file.rename', 'file.trash', 'file.copyPath', 'file.reveal', 'file.openTerminal', 'terminal.toggle', 'terminal.new', 'file.pin', 'file.properties', 'edit.selectPattern',
  'file.compress', 'file.quickZip', 'file.compare', 'file.checksum', 'file.createChecksums', 'view.folderSizes', 'file.copyToOther', 'file.moveToOther', 'file.tag', 'file.collect',
  'view.details', 'view.list', 'view.grid', 'view.thumbnails', 'view.gallery', 'view.columns', 'view.tree', 'view.hidden', 'view.inspector', 'view.sidebar', 'view.theme', 'view.saveView',
  'app.operations', 'app.settings', 'app.customize', 'custom.undo', 'custom.redo', 'custom.workspaces', 'app.palette',
  'file.shareLan', 'file.encrypt', 'tools.shares',
  'tools.storage', 'tools.duplicates', 'tools.compare', 'tools.sync', 'tools.findReplace', 'tools.rules', 'tools.downloads', 'tools.media', 'tools.projects', 'tools.integrations',
  'shelf.toggle', 'shelf.add', 'shelf.copyHere', 'shelf.moveHere', 'actions.manage', 'git.copyRemote', 'git.refresh',
];

// ------------------------------------------------------------------ power tools

/** Item-menu entries of the power tools (undefined: not a power-tool id). */
function powerEntryItem(id: string, ctx: CommandContext, entry: FileEntry): MenuItem | false | undefined {
  if (id !== 'clip.copyImage' && id !== 'file.shred' && id !== 'menu:powerTools') return undefined;
  // Local items only: not offered for items on a server.
  if (ctx.location.kind === 'remote' || isRemoteRef(entry.path)) return false;
  const multi = ctx.selection.length > 1;
  const files = ctx.selection.every((e) => e.kind === 'file');
  switch (id) {
    case 'clip.copyImage': return !multi && entry.kind === 'file' && categoryOfEntry(entry) === 'image' && cmdItem(id, ctx);
    case 'file.shred': return cmdItem(id, ctx, 'Shred (secure delete)…');
    case 'menu:powerTools': {
      const isPart = entry.kind === 'file' && (!!parsePartName(entry.name) || entry.name.endsWith(DESCRIPTOR_SUFFIX));
      const sub = [
        !multi && entry.kind === 'file' && !isPart && cmdItem('file.splitFile', ctx),
        !multi && isPart && cmdItem('file.joinFiles', ctx),
        !multi && entry.kind === 'directory' && cmdItem('file.flatten', ctx),
        cmdItem('file.setDates', ctx),
        files && cmdItem('file.hardLink', ctx),
        !multi && entry.kind === 'directory' && window.orbis.platform === 'win32' && cmdItem('file.junction', ctx),
      ].filter((x): x is MenuItem => !!x);
      return sub.length ? { id, label: 'Power tools', icon: 'sliders', submenu: sub } : false;
    }
    default: return undefined;
  }
}
