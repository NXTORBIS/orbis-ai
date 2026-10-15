import { call, UiError } from './api';
import { app, confirm, openDialog, prompt, toast, toastError } from './state/app';
import { activePane, currentLocation, findPane, navigate, openTab, otherPane, parentPath, refreshDir, remapLocations, selectedEntries, setSelection, ws } from './state/workspace';
import type { FileEntry } from '../shared/model';
import type { OperationRecord, OperationRequest } from '../shared/operations';
import { formatCount } from './ui/format';
import { fileUri as fileUriOf, formatPaths, quickZipName, type PathFormat } from '../shared/pathFormats';
import { invalidateFolderSizes } from './state/folderSizes';
import type { TemplateInfo } from './state/templates';
import { isRemoteRef, parseRemoteRef, remoteNameProblem, remoteRef, remoteRefParent } from '../shared/remote';
import { connectionOf, displayPath, ensureConnected, openRemoteFile, remoteAddress } from './state/remote';
import type { RemoteConnectResult } from '../shared/remote';
import { clip, refreshClipboard } from './state/clipboard';
import { POWER_OPERATION_LABELS } from '../shared/powerTools';

/**
 * Action helpers. Every user-facing file action goes through these, and they
 * call the main-process services. Success is only reported from a real result.
 */

export function paneDir(paneId: string): string | undefined {
  const f = findPane(paneId);
  if (!f) return undefined;
  const loc = currentLocation(f.pane);
  return loc.kind === 'fs' ? loc.path : undefined;
}

/** The remote folder a pane shows, as a reference (orbis-remote://…), or undefined. */
export function paneRemoteDir(paneId: string): string | undefined {
  const f = findPane(paneId);
  if (!f) return undefined;
  const loc = currentLocation(f.pane);
  return loc.kind === 'remote' ? remoteRef(loc.connectionId, loc.path) : undefined;
}

/**
 * Connect to a remote connection (asking for a password or a host key
 * decision when needed) and show its start folder.
 */
export async function openRemote(id: string, opts: { paneId?: string; tab?: boolean } = {}): Promise<boolean> {
  if (!(await ensureConnected(id))) return false;
  const r = await call<RemoteConnectResult>('remote:connect', { id }).catch((err) => {
    toastError(err, `Could not connect to ${connectionOf(id)?.name ?? 'the server'}`);
    return undefined;
  });
  if (r?.status !== 'connected') return false;
  const loc = { kind: 'remote' as const, connectionId: id, path: r.home };
  if (opts.tab) openTab(loc);
  else await navigate(opts.paneId ?? activePane().id, loc);
  return true;
}

/** A folder to paste or drop into: a local path or a remote reference. */
export function paneTarget(paneId: string): string | undefined {
  return paneDir(paneId) ?? paneRemoteDir(paneId);
}

/** The parent folder of a local path or a remote reference. */
export function parentOf(p: string): string | undefined {
  return isRemoteRef(p) ? remoteRefParent(p) : parentPath(p);
}

/**
 * Copy or move items into a folder. Anything on a server goes through the
 * 'remote-transfer' operation (streamed, verified, conflicts asked); plain
 * local transfers stay ordinary copy/move operations.
 */
export async function startTransfer(sources: string[], destination: string, mode: 'copy' | 'move', origin: string): Promise<OperationRecord | undefined> {
  if (!sources.length) return undefined;
  if (!isRemoteRef(destination) && !sources.some(isRemoteRef)) return startOperation({ type: mode, sources, destination, conflictPolicy: 'ask', origin });
  const from = new Set(sources.map((s) => parseRemoteRef(s)?.connectionId ?? 'local'));
  const to = parseRemoteRef(destination)?.connectionId ?? 'local';
  if (from.size > 1) {
    toast({ level: 'warning', title: 'These items come from different places', detail: 'Transfer items from one folder at a time.' });
    return undefined;
  }
  const src = [...from][0]!;
  if (src !== 'local' && to !== 'local' && src !== to) {
    toast({ level: 'warning', title: 'Copying directly between two servers is not supported', detail: `Copy the items to this computer first, then to ${connectionOf(to)?.name ?? 'the other server'}.` });
    return undefined;
  }
  return startOperation({ type: 'remote-transfer', sources, destination, conflictPolicy: 'ask', origin, params: { mode } });
}

export async function startOperation(req: OperationRequest): Promise<OperationRecord | undefined> {
  try {
    const rec = await call<OperationRecord>('ops:start', req);
    // Extractions are remembered (without any password) so a "needs a password" failure can be retried with one.
    if (req.type === 'extract') extractRequests.set(rec.id, { ...req, params: withoutPassword(req.params) });
    // Decryptions likewise (only the files): a wrong password can be retried with another one.
    if (req.type === 'decrypt') decryptRequests.set(rec.id, req.sources);
    watchOperation(rec.id);
    return rec;
  } catch (err) {
    toastError(err);
    return undefined;
  }
}

const watched = new Set<string>();
const extractRequests = new Map<string, OperationRequest>();
const decryptRequests = new Map<string, string[]>();

function withoutPassword(params: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!params || !('password' in params)) return params;
  const rest = { ...params };
  delete rest.password;
  return rest;
}

/**
 * Ask for an archive's password and try it with `attempt` until it is
 * accepted or the user cancels. Wrong passwords are reported in the dialog.
 * The password is returned to the caller, which keeps it in memory only.
 */
export function askArchivePassword<T>(name: string, attempt: (password: string) => Promise<T>, opts: { wrong?: boolean } = {}): Promise<{ password: string; value: T } | null> {
  return new Promise((resolve) => openDialog('archivePassword', { name, attempt, resolve, wrong: !!opts.wrong }));
}

/** Whether an error means "this archive needs a (different) password". */
export function isPasswordError(err: unknown): boolean {
  return err instanceof UiError && !!err.shape.needsPassword;
}

/** Retry a failed extraction with a password the user enters now. */
async function retryExtractWithPassword(rec: OperationRecord): Promise<void> {
  const req = extractRequests.get(rec.id);
  const archive = rec.sources[0];
  if (!req || !archive) return;
  const name = archive.split(/[\\/]/).pop() ?? archive;
  const ok = await askArchivePassword(name, (password) => call('tool:archiveList', { path: archive, password }), { wrong: !!rec.error?.wrongPassword });
  if (!ok) return;
  await startOperation({ ...req, params: { ...(req.params ?? {}), password: ok.password }, origin: req.origin ?? 'ui' });
}
const VERB: Record<string, [(n: string) => string, string]> = {
  copy: [(n) => `Copied ${n}`, 'copy'], move: [(n) => `Moved ${n}`, 'move'], trash: [(n) => `Moved ${n} to the Trash`, 'move to the Trash'],
  delete: [(n) => `Permanently deleted ${n}`, 'delete'], duplicate: [(n) => `Duplicated ${n}`, 'duplicate'], 'rename-batch': [(n) => `Renamed ${n}`, 'rename'],
  extract: [(n) => `Extracted ${n}`, 'extract'], compress: [(n) => `Compressed ${n}`, 'compress'],
  'edit-metadata': [(n) => `Updated metadata in ${n}`, 'update the metadata'], convert: [(n) => `Converted ${n}`, 'convert'],
  'trash-restore': [(n) => `Restored ${n} from the Trash`, 'restore from the Trash'], 'trash-delete': [(n) => `Permanently deleted ${n} from the Trash`, 'delete from the Trash'],
  sync: [(n) => `Synchronized ${n}`, 'synchronize'],
  dedupe: [(n) => `Cleaned up ${n}`, 'clean up the duplicates'],
  'checksum-create': [(n) => `Calculated SHA-256 checksums of ${n}`, 'create the checksum file'],
  'pdf-tools': [(n) => `Made ${n.replace(/items?$/, (m) => (m === 'item' ? 'PDF' : 'PDFs'))}`, 'make the PDF'],
  'find-replace': [(n) => `Replaced text in ${n.replace(/items?$/, (m) => (m === 'item' ? 'file' : 'files'))}`, 'replace the text'],
  'text-fix': [(n) => `Fixed ${n.replace(/items?$/, (m) => (m === 'item' ? 'file' : 'files'))}`, 'fix the text files'],
  'snapshot-restore': [(n) => `Restored ${n.replace(/items?$/, (m) => (m === 'item' ? 'file' : 'files'))} from snapshots`, 'restore from the snapshots'],
  'custom-action': [(n) => `Ran the action on ${n}`, 'run the action'],
  encrypt: [(n) => `Encrypted ${n}`, 'encrypt'], decrypt: [(n) => `Decrypted ${n}`, 'decrypt'],
  'share-receive': [(n) => `Received ${n}`, 'save the received files'],
  'image-batch': [(n) => `Processed ${n}`, 'process the images'],
  backup: [(n) => `Backed up ${n.replace(/items?$/, (m) => (m === 'item' ? 'folder' : 'folders'))}`, 'make the backup'],
  'backup-restore': [(n) => `Restored ${n} from the backup`, 'restore from the backup'],
  'video-tool': [(n) => `Made ${n.replace(/items?$/, (m) => (m === 'item' ? 'new file' : 'new files'))} with the video tools`, 'run the video tool'],
  'organize-date': [(n) => `Organized ${n.replace(/items?$/, (m) => (m === 'item' ? 'file' : 'files'))} by date`, 'organize the files'],
  'remote-transfer': [(n) => `Transferred ${n}`, 'transfer'],
  'remote-delete': [(n) => `Permanently deleted ${n} on the server`, 'delete on the server'],
  'remote-save': [() => 'Uploaded the changes', 'upload the changes'],
  // Text recognition (OCR)
  'ocr-extract': [(n) => `Extracted the text of ${n.replace(/items?$/, (m) => (m === 'item' ? 'file' : 'files'))}`, 'extract the text'],
  'ocr-save': [() => 'Saved the recognized text', 'save the text'],
  'archive-edit': [(n) => `Edited the archive (${n})`, 'edit the archive'],
};
// Power tools
Object.assign(VERB, {
  'split-file': [() => 'Split the file into parts', 'split the file'],
  'join-files': [() => 'Joined the parts', 'join the parts'],
  shred: [(n: string) => `Securely deleted ${n}`, 'securely delete'],
  flatten: [(n: string) => `Flattened: moved ${n.replace(/items?$/, (m) => (m === 'item' ? 'item' : 'items'))}`, 'flatten the folder'],
  'flatten-restore': [(n: string) => `Put back ${n} where they were`, 'undo the flatten'],
  'set-dates': [(n: string) => `Set the dates of ${n}`, 'set the dates'],
  'link-create': [(n: string) => `Created ${n.replace(/items?$/, (m) => (m === 'item' ? 'link' : 'links'))}`, 'create the link'],
  'clip-save': [() => 'Saved the clipboard as a file', 'save the clipboard as a file'],
} satisfies Record<keyof typeof POWER_OPERATION_LABELS, [(n: string) => string, string]>);

/** "Uploaded … to Build server", "Downloaded … from Team share", "Transferred … on Build server". */
export function transferDirection(rec: Pick<OperationRecord, 'sources' | 'destination'>): { kind: 'upload' | 'download' | 'within'; server: string } {
  const to = rec.destination ? parseRemoteRef(rec.destination) : null;
  const from = rec.sources[0] ? parseRemoteRef(rec.sources[0]) : null;
  const name = (id?: string) => (id ? connectionOf(id)?.name ?? 'the server' : 'the server');
  if (to && !from) return { kind: 'upload', server: name(to.connectionId) };
  if (from && !to) return { kind: 'download', server: name(from.connectionId) };
  return { kind: 'within', server: name(to?.connectionId ?? from?.connectionId) };
}

function transferVerb(rec: OperationRecord): [(n: string) => string, string] {
  const d = transferDirection(rec);
  if (d.kind === 'upload') return [(n) => `Uploaded ${n} to ${d.server}`, `upload to ${d.server}`];
  if (d.kind === 'download') return [(n) => `Downloaded ${n} from ${d.server}`, `download from ${d.server}`];
  return [(n) => `Transferred ${n} on ${d.server}`, `transfer on ${d.server}`];
}

/** Report the real outcome of an operation once it reaches a terminal state. */
export function watchOperation(id: string): void {
  if (watched.has(id)) return;
  watched.add(id);
  const unsub = app.subscribe(() => {
    const rec = app.get().ops[id];
    if (!rec || !['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'].includes(rec.state)) return;
    unsub();
    watched.delete(id);
    const dirs = new Set<string>();
    for (const r of rec.results) {
      const pp = parentOf(r.source);
      if (pp) dirs.add(pp);
      if (r.destination) dirs.add(parentOf(r.destination) ?? r.destination);
    }
    if (rec.destination) dirs.add(rec.destination);
    dirs.forEach((d) => refreshDir(d));
    // Calculated folder sizes that include anything this operation changed are no longer right
    // (sources of copies, archives, checksum files and conversions are only read).
    const readsSources = ['copy', 'compress', 'checksum-create', 'convert', 'extract', 'image-batch', 'backup', 'backup-restore', 'ocr-extract', 'ocr-save'].includes(rec.type);
    invalidateFolderSizes([...rec.results.flatMap((r) => [readsSources ? undefined : parentPath(r.source), r.destination]), rec.destination].filter((x): x is string => !!x && !isRemoteRef(x)));
    const [past, verb] = rec.type === 'remote-transfer' ? transferVerb(rec) : VERB[rec.type] ?? [(n: string) => `Finished ${n}`, rec.type];
    const s = rec.summary ?? { done: 0, skipped: 0, failed: 0, cancelled: 0 };
    const actions: Array<{ label: string; run: () => void }> = [];
    if (rec.destination && rec.state !== 'failed' && rec.type !== 'remote-save') actions.push({ label: 'Open destination', run: () => void openDestination(rec.destination!) });
    if (canUndo(rec)) actions.push({ label: 'Undo', run: () => void undoOperation(id) });
    if (rec.state === 'failed' && rec.error?.needsPassword && extractRequests.has(id)) actions.unshift({ label: rec.error.wrongPassword ? 'Try another password…' : 'Enter password…', run: () => void retryExtractWithPassword(rec) });
    else extractRequests.delete(id);
    const decryptSources = decryptRequests.get(id);
    decryptRequests.delete(id);
    if (rec.state === 'failed' && rec.error?.wrongPassword && decryptSources) actions.unshift({ label: 'Try another password…', run: () => openDialog('decrypt', { paths: decryptSources, wrong: true }) });
    actions.push({ label: 'Details', run: () => app.set({ opsPanelOpen: true }) });
    if (rec.state === 'completed') {
      toast({ level: 'success', title: `${past(formatCount(s.done, 'item'))}${s.skipped ? `; skipped ${s.skipped}` : ''}`, detail: rec.notes?.join(' '), actions });
    } else if (rec.state === 'completed_with_errors') {
      toast({ level: 'warning', title: `${past(`${s.done} of ${s.done + s.failed + s.skipped} items`)}; ${s.failed} failed`, detail: rec.results.find((r) => r.error)?.error?.message, actions, sticky: true });
    } else if (rec.state === 'cancelled') {
      toast({ level: 'info', title: `Cancelled. ${s.done ? `${formatCount(s.done, 'item')} had already finished.` : 'Nothing was changed.'}`, detail: rec.notes?.join(' '), actions });
    } else {
      toast({ level: 'error', title: `Could not ${verb}`, detail: rec.error?.message ?? rec.results.find((r) => r.error)?.error?.message, errorId: rec.error?.errorId, actions, sticky: true });
    }
  });
}

/** Show an operation's destination (a local folder or a folder on a server) in the active pane. */
export function openDestination(dest: string): void {
  const r = parseRemoteRef(dest);
  if (r) void navigate(activePane().id, { kind: 'remote', connectionId: r.connectionId, path: r.path });
  else void navigate(activePane().id, { kind: 'fs', path: dest });
}

export function watchExisting(): void {
  for (const rec of Object.values(app.get().ops)) if (!['completed', 'completed_with_errors', 'failed', 'cancelled', 'interrupted'].includes(rec.state)) watchOperation(rec.id);
}

// ------------------------------------------------------------------ open
export async function openEntry(paneId: string, entry: FileEntry, mode: 'here' | 'tab' | 'window' = 'here'): Promise<void> {
  const isDir = entry.kind === 'directory' || (entry.kind === 'symlink' && entry.linkTargetKind === 'directory');
  const remote = parseRemoteRef(entry.path);
  if (remote) {
    if (isDir) {
      const loc = { kind: 'remote' as const, connectionId: remote.connectionId, path: remote.path };
      if (mode === 'here') await navigate(paneId, loc);
      else openTab(loc, { activate: false, after: ws.get().activeTabId });
      return;
    }
    if (entry.kind === 'symlink' && entry.linkTargetKind === 'broken') {
      toast({ level: 'error', title: 'This link on the server points to an item that does not exist (or cannot be read).' });
      return;
    }
    await openRemoteFile(entry);
    return;
  }
  if (isDir) {
    if (mode === 'tab') openTab({ kind: 'fs', path: entry.path }, { activate: false, after: ws.get().activeTabId });
    else if (mode === 'window') await call('win:new', { path: entry.path }).catch(toastError);
    else await navigate(paneId, { kind: 'fs', path: entry.path });
    return;
  }
  if (entry.kind === 'symlink' && entry.linkTargetKind === 'broken') {
    toast({ level: 'error', title: 'This link points to an item that does not exist.', detail: entry.linkTarget });
    return;
  }
  // Shortcut files (.lnk, freedesktop Link entries) open what they point to.
  if (entry.ext === 'lnk' || entry.ext === 'desktop') {
    const sc = await call<{ target: string; targetKind: 'file' | 'directory' | 'missing' } | null>('fs:resolveShortcut', { path: entry.path }).catch(() => null);
    if (sc) {
      if (sc.targetKind === 'missing') {
        toast({ level: 'error', title: 'This shortcut points to an item that does not exist.', detail: sc.target });
        return;
      }
      if (sc.targetKind === 'directory') {
        if (mode === 'tab') openTab({ kind: 'fs', path: sc.target }, { activate: false, after: ws.get().activeTabId });
        else await navigate(paneId, { kind: 'fs', path: sc.target });
        return;
      }
      await openFile(sc.target);
      return;
    }
  }
  await openFile(entry.path);
}

/** Open with the default application. Resolves to whether it was handed over (programs need a confirmation). */
export async function openFile(path: string): Promise<boolean> {
  try {
    const r = await call<{ opened: boolean; needsConfirmation?: boolean; reason?: string }>('fs:open', { path });
    if (r.needsConfirmation) {
      const ok = await confirm({
        title: 'Run this program?',
        body: `${r.reason} Opening it may run code on your computer. Only continue if you trust where it came from.`,
        confirmLabel: 'Open anyway',
        destructive: true,
        detail: [path],
      });
      if (!ok) return false;
      await call('fs:open', { path, allowExecutable: true });
    }
    return true;
  } catch (err) {
    toastError(err, 'Could not open the item');
    return false;
  }
}

// ------------------------------------------------------------------ create / rename
export async function newFolder(paneId: string): Promise<void> {
  const remoteDir = paneRemoteDir(paneId);
  if (remoteDir) return newRemoteFolder(paneId, remoteDir);
  const dir = paneDir(paneId);
  if (!dir) return;
  const name = await prompt({
    title: 'New folder',
    label: 'Folder name',
    initial: 'New Folder',
    confirmLabel: 'Create',
    validate: async (v) => (await call<{ valid: boolean; reason?: string }>('fs:validateName', { parent: dir, name: v })).reason,
  });
  if (!name) return;
  try {
    const e = await call<FileEntry>('fs:mkdir', { parent: dir, name });
    refreshDir(dir);
    setSelection(paneId, [e.path], e.path, e.path);
  } catch (err) {
    toastError(err, 'Could not create the folder');
  }
}

async function newRemoteFolder(paneId: string, dirRef: string): Promise<void> {
  const r = parseRemoteRef(dirRef)!;
  const name = await prompt({ title: 'New folder on the server', label: 'Folder name', initial: 'New Folder', confirmLabel: 'Create', validate: (v) => remoteNameProblem(v) });
  if (!name) return;
  try {
    const e = await call<FileEntry>('remote:mkdir', { id: r.connectionId, parent: r.path, name });
    refreshDir(dirRef);
    setSelection(paneId, [e.path], e.path, e.path);
  } catch (err) {
    toastError(err, 'Could not create the folder');
  }
}

export async function newFile(paneId: string, template: 'text' | 'markdown' | 'json' | 'empty'): Promise<void> {
  const dir = paneDir(paneId);
  if (!dir) return;
  const ext = template === 'markdown' ? '.md' : template === 'json' ? '.json' : template === 'text' ? '.txt' : '';
  const name = await prompt({
    title: template === 'empty' ? 'New empty file' : `New ${template === 'markdown' ? 'Markdown' : template === 'json' ? 'JSON' : 'text'} file`,
    label: 'File name',
    initial: `Untitled${ext}`,
    selectStem: true,
    confirmLabel: 'Create',
    validate: async (v) => (await call<{ valid: boolean; reason?: string }>('fs:validateName', { parent: dir, name: v })).reason,
  });
  if (!name) return;
  try {
    const e = await call<FileEntry>('fs:createFile', { parent: dir, name, template });
    refreshDir(dir);
    setSelection(paneId, [e.path], e.path, e.path);
  } catch (err) {
    toastError(err, 'Could not create the file');
  }
}

/** New file from a user template (a copy of the template file; never overwrites). */
export async function newFromTemplate(paneId: string, tpl: TemplateInfo): Promise<void> {
  const dir = paneDir(paneId);
  if (!dir) return;
  const name = await prompt({
    title: `New ${tpl.name}`,
    label: 'File name',
    initial: tpl.name,
    selectStem: true,
    confirmLabel: 'Create',
    validate: async (v) => (await call<{ valid: boolean; reason?: string }>('fs:validateName', { parent: dir, name: v })).reason,
  });
  if (!name) return;
  try {
    const e = await call<FileEntry>('fs:createFromTemplate', { parent: dir, name, template: tpl.path });
    refreshDir(dir);
    setSelection(paneId, [e.path], e.path, e.path);
  } catch (err) {
    toastError(err, 'Could not create the file from the template');
  }
}

export async function renameEntry(paneId: string, entry: FileEntry): Promise<void> {
  if (isRemoteRef(entry.path)) return renameRemote(paneId, entry);
  const parent = parentPath(entry.path);
  if (!parent) return;
  const name = await prompt({
    title: 'Rename',
    label: 'New name',
    initial: entry.name,
    selectStem: entry.kind !== 'directory',
    confirmLabel: 'Rename',
    validate: async (v) => {
      if (v === entry.name) return undefined;
      if (v.toLowerCase() === entry.name.toLowerCase()) return undefined; // case-only rename
      return (await call<{ valid: boolean; reason?: string }>('fs:validateName', { parent, name: v })).reason;
    },
  });
  if (!name || name === entry.name) return;
  const oldExt = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : '';
  const newExt = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (entry.kind === 'file' && oldExt && oldExt.toLowerCase() !== newExt.toLowerCase()) {
    const ok = await confirm({ title: 'Change the extension?', body: `Changing "${oldExt}" to "${newExt || '(none)'}" may change which app opens the file. The file contents are not converted.`, confirmLabel: 'Change extension' });
    if (!ok) return;
  }
  try {
    const e = await call<FileEntry>('fs:rename', { path: entry.path, newName: name });
    remapLocations([{ from: entry.path, to: e.path }]);
    refreshDir(parent);
    setSelection(paneId, [e.path], e.path, e.path);
  } catch (err) {
    toastError(err, 'Could not rename');
  }
}

async function renameRemote(paneId: string, entry: FileEntry): Promise<void> {
  const parent = remoteRefParent(entry.path);
  if (!parent) return;
  const name = await prompt({ title: 'Rename on the server', label: 'New name', initial: entry.name, selectStem: entry.kind !== 'directory', confirmLabel: 'Rename', validate: (v) => (v === entry.name ? undefined : remoteNameProblem(v)) });
  if (!name || name === entry.name) return;
  try {
    const e = await call<FileEntry>('remote:rename', { ref: entry.path, newName: name });
    refreshDir(parent);
    setSelection(paneId, [e.path], e.path, e.path);
  } catch (err) {
    toastError(err, 'Could not rename');
  }
}

// ------------------------------------------------------------------ clipboard
export function copyToClipboard(entries: FileEntry[], mode: 'copy' | 'cut'): void {
  if (!entries.length) return;
  app.set({ clipboard: { mode, paths: entries.map((e) => e.path) } });
  // Other programs get local paths, or the server address (sftp://user@host/path, never with a password).
  // The main process also keeps the set in the clipboard history (Ctrl+Shift+V).
  const text = entries.map((e) => (isRemoteRef(e.path) ? (remoteAddress(e.path) ?? e.name) : e.path)).join('\n');
  void call('clip:setFiles', { mode, paths: entries.map((e) => e.path), text }).then(() => refreshClipboard(), () => undefined);
  toast({ level: 'info', title: `${mode === 'cut' ? 'Cut' : 'Copied'} ${formatCount(entries.length, 'item')}`, detail: 'Paste into a folder to finish.' });
}

/**
 * Paste into the pane's folder. Items copied or cut in Orbis Files are pasted as before while the
 * system clipboard still holds them; when another program put something newer there, that wins:
 * files (from a file manager or a list of paths) are copied (or moved, for a file manager's cut),
 * an image or text opens "Paste image/text as file".
 */
export async function paste(paneId: string): Promise<void> {
  const dir = paneTarget(paneId);
  if (!dir) return;
  const internal = app.get().clipboard;
  const sys = await refreshClipboard(true);
  const foreign = !!sys && !sys.ours && !!(sys.files || sys.image || sys.text);
  if (internal && !foreign) {
    const rec = await startTransfer(internal.paths, dir, internal.mode === 'cut' ? 'move' : 'copy', 'paste');
    if (rec && internal.mode === 'cut') app.set({ clipboard: null });
    return;
  }
  if (sys?.files) {
    const r = await call<{ mode: 'copy' | 'cut'; paths: string[] } | null>('clip:readFiles').catch((err) => {
      toastError(err, 'Nothing pasted');
      return null;
    });
    if (!r?.paths.length) return;
    const rec = await startTransfer(r.paths, dir, r.mode === 'cut' ? 'move' : 'copy', 'paste');
    if (rec && r.mode === 'cut' && sys.ours) app.set({ clipboard: null });
    return;
  }
  if (sys && (sys.image || sys.text)) {
    if (isRemoteRef(dir)) {
      toast({ level: 'info', title: 'Images and text are pasted as files only into folders on this computer.' });
      return;
    }
    openDialog(sys.image ? 'pt.pasteImage' : 'pt.pasteText', { dir });
    return;
  }
  toast({ level: 'info', title: sys?.staleOurs ? 'Nothing to paste: the items that were cut have already been moved.' : 'Nothing to paste.' });
}

/** The system clipboard as last seen (for menus); see state/clipboard.ts. */
export const clipboardPeek = () => clip.get().peek;

/** A file:// URI for a local path (see shared/pathFormats). */
export const fileUri = fileUriOf;

const FORMAT_NOUN: Record<PathFormat, [string, string]> = {
  absolute: ['path', 'paths'], relative: ['relative path', 'relative paths'], posix: ['path with / separators', 'paths with / separators'],
  windows: ['path with \\ separators', 'paths with \\ separators'], quoted: ['quoted path', 'quoted paths'], uri: ['file link', 'file links'], name: ['name', 'names'],
};

/** "Copy path as…": copy the paths in one of the formats of shared/pathFormats. */
export async function copyPathsAs(paths: string[], format: PathFormat, base?: string): Promise<void> {
  if (!paths.length) return;
  try {
    const text = formatPaths(paths, format, { base, platform: window.orbis.platform });
    await call('fs:copyText', { text });
    const [one, many] = FORMAT_NOUN[format];
    toast({ level: 'success', title: paths.length === 1 ? `Copied ${one}` : `Copied ${paths.length} ${many}`, detail: text.length > 160 ? `${text.slice(0, 160)}…` : text });
  } catch (err) {
    toastError(err, 'Could not copy');
  }
}

/** Copy a small UTF-8 text file's contents (checked and read in the main process). */
export async function copyFileContents(entry: FileEntry): Promise<void> {
  try {
    const r = await call<{ bytes: number; characters: number }>('fs:copyFileText', { path: entry.path });
    toast({ level: 'success', title: `Copied the contents of ${entry.name}`, detail: `${formatCount(r.characters, 'character')} of text.` });
  } catch (err) {
    toastError(err, 'Contents not copied');
  }
}

/** "Create checksum file…": SHA-256 of the items, written as a GNU coreutils file into the folder (an operation). */
export async function createChecksumFile(paneId: string, entries: FileEntry[]): Promise<void> {
  const dir = paneDir(paneId);
  if (!dir || !entries.length) return;
  const single = entries.length === 1 && entries[0]!.kind === 'file';
  const name = await prompt({
    title: 'Create checksum file',
    label: `File name (SHA-256 of ${single ? entries[0]!.name : formatCount(entries.length, 'item')}; paths are written relative to this folder)`,
    initial: single ? `${entries[0]!.name}.sha256` : 'SHA256SUMS',
    confirmLabel: 'Create',
    validate: async (v) => (await call<{ valid: boolean; reason?: string }>('fs:validateName', { parent: dir, name: v })).reason,
  });
  if (!name) return;
  await startOperation({ type: 'checksum-create', sources: entries.map((e) => e.path), destination: dir, params: { name }, conflictPolicy: 'ask', origin: 'checksum-file' });
}

/** "Compress to .zip": one click, named after the item; an existing archive is never replaced (keeps both). */
export async function quickZip(paneId: string, entries: FileEntry[]): Promise<void> {
  const dir = paneDir(paneId);
  if (!dir || !entries.length) return;
  const name = quickZipName(entries.map((e) => ({ name: e.name, isDir: e.kind === 'directory' || e.linkTargetKind === 'directory' })));
  await startOperation({ type: 'compress', sources: entries.map((e) => e.path), destination: dir, params: { name, format: 'zip', level: 6 }, conflictPolicy: 'keep-both', origin: 'quick-zip' });
}

/** Start the system's terminal in a folder. */
export async function openTerminalIn(dir: string): Promise<void> {
  try {
    const r = await call<{ label: string }>('fs:openTerminal', { path: dir });
    toast({ level: 'info', title: `Opened ${r.label}`, detail: dir });
  } catch (err) {
    toastError(err, 'Could not open a terminal');
  }
}

export async function copyPaths(entries: FileEntry[], what: 'path' | 'name' | 'uri'): Promise<void> {
  const text = entries.map((e) => (what === 'path' ? e.path : what === 'uri' ? fileUri(e.path) : e.name)).join('\n');
  try {
    await call('fs:copyText', { text });
    const noun = what === 'uri' ? 'file link' : what;
    toast({ level: 'success', title: entries.length === 1 ? `Copied ${noun}` : `Copied ${entries.length} ${noun}s` });
  } catch (err) {
    toastError(err);
  }
}

// ------------------------------------------------------------------ delete
export async function trashEntries(entries: FileEntry[]): Promise<void> {
  if (!entries.length) return;
  const caps = app.get().capabilities;
  if (!caps?.trash) {
    toast({ level: 'warning', title: 'Trash is not available on this system.', detail: 'Use Delete permanently instead.' });
    return;
  }
  if (app.get().settings.confirmTrash || entries.length > 50) {
    const ok = await confirm({ title: `Move ${formatCount(entries.length, 'item')} to Trash?`, body: 'You can restore them from the Trash.', confirmLabel: 'Move to Trash', detail: entries.slice(0, 8).map((e) => e.path) });
    if (!ok) return;
  }
  await startOperation({ type: 'trash', sources: entries.map((e) => e.path), origin: 'ui' });
}

export async function deletePermanently(entries: FileEntry[]): Promise<void> {
  if (!entries.length) return;
  if (entries.some((e) => isRemoteRef(e.path))) return deleteOnServer(entries);
  const folders = entries.filter((e) => e.kind === 'directory').length;
  const ok = await confirm({
    title: `Permanently delete ${formatCount(entries.length, 'item')}?`,
    body: `${folders ? `${formatCount(folders, 'folder')} and everything inside ${folders === 1 ? 'it' : 'them'} will be deleted. ` : ''}This does not use the Trash and cannot be undone.`,
    confirmLabel: 'Delete permanently',
    destructive: true,
    detail: entries.slice(0, 8).map((e) => e.path).concat(entries.length > 8 ? [`…and ${entries.length - 8} more`] : []),
  });
  if (ok) await startOperation({ type: 'delete', sources: entries.map((e) => e.path), origin: 'ui' });
}

/**
 * Delete items on a server. Servers have no Trash, so this always asks, names
 * the server and lists every target (folders with everything inside).
 */
export async function deleteOnServer(entries: FileEntry[]): Promise<void> {
  const refs = entries.map((e) => parseRemoteRef(e.path));
  if (refs.some((r) => !r)) {
    toast({ level: 'warning', title: 'Delete items on the server separately from items on this computer.' });
    return;
  }
  const server = connectionOf(refs[0]!.connectionId)?.name ?? 'the server';
  const folders = entries.filter((e) => e.kind === 'directory').length;
  const shown = entries.slice(0, 20).map((e) => `${displayPath(e.path)}${e.kind === 'directory' ? '/  (folder and everything inside)' : ''}`);
  const ok = await confirm({
    title: `Permanently delete ${formatCount(entries.length, 'item')} on ${server}?`,
    body: `${folders ? `${formatCount(folders, 'folder')} and everything inside ${folders === 1 ? 'it' : 'them'} will be deleted. ` : ''}Servers have no Trash: this cannot be undone, and nobody can restore these items from Orbis Files.`,
    confirmLabel: 'Delete permanently on the server',
    destructive: true,
    detail: shown.concat(entries.length > 20 ? [`…and ${entries.length - 20} more`] : []),
  });
  if (ok) await startOperation({ type: 'remote-delete', sources: entries.map((e) => e.path), origin: 'ui' });
}

// ------------------------------------------------------------------ transfers
export async function transferToOtherPane(paneId: string, mode: 'copy' | 'move'): Promise<void> {
  const other = otherPane(paneId);
  if (!other) return;
  const loc = currentLocation(other);
  const dest = loc.kind === 'fs' ? loc.path : loc.kind === 'remote' ? remoteRef(loc.connectionId, loc.path) : undefined;
  if (!dest) {
    toast({ level: 'warning', title: 'The other pane is not showing a folder.' });
    return;
  }
  const entries = selectedEntries(paneId);
  if (entries.length) await startTransfer(entries.map((e) => e.path), dest, mode, 'other-pane');
}

export async function duplicateEntries(entries: FileEntry[]): Promise<void> {
  if (entries.length) await startOperation({ type: 'duplicate', sources: entries.map((e) => e.path), origin: 'ui' });
}

export async function compressEntries(paneId: string, entries: FileEntry[]): Promise<void> {
  const dir = paneDir(paneId);
  if (!dir || !entries.length) return;
  openDialog('compress', { paths: entries.map((e) => e.path), dir });
}

export async function extractEntry(paneId: string, entry: FileEntry, into: 'here' | 'subfolder' | 'choose'): Promise<void> {
  let dest = paneDir(paneId) ?? parentPath(entry.path);
  if (into === 'choose') dest = (await call<string | null>('fs:pickDirectory', { title: 'Extract to…' })) ?? undefined;
  if (!dest) return;
  await startOperation({ type: 'extract', sources: [entry.path], destination: dest, params: { subfolder: into !== 'here' }, conflictPolicy: 'ask', origin: 'ui' });
}

export async function createLink(paneId: string, entry: FileEntry): Promise<void> {
  const dir = paneDir(paneId);
  if (!dir) return;
  const name = await prompt({ title: 'Create link', label: 'Link name', initial: `${entry.name} link`, confirmLabel: 'Create link' });
  if (!name) return;
  try {
    await call('fs:createSymlink', { target: entry.path, parent: dir, name });
    refreshDir(dir);
  } catch (err) {
    toastError(err, 'Could not create the link');
  }
}

/** Handle a drop of internal paths (or OS files) onto a folder. */
export async function dropOnto(dest: string, paths: string[], mode: 'copy' | 'move'): Promise<void> {
  const filtered = paths.filter((p) => p !== dest && !(mode === 'move' && parentOf(p) === dest));
  if (!filtered.length) return;
  await startTransfer(filtered, dest, mode, 'drag');
}

export async function pinPath(path: string): Promise<void> {
  await call('cat:pin', { path }).catch(toastError);
}

export async function addToCollectionDialog(entries: FileEntry[]): Promise<void> {
  if (entries.length) openDialog('collect', { paths: entries.map((e) => e.path) });
}

export async function tagDialog(entries: FileEntry[]): Promise<void> {
  if (entries.length) openDialog('tag', { paths: entries.map((e) => e.path) });
}

export function errorMessage(err: unknown): string {
  return err instanceof UiError ? err.shape.message : (err as Error)?.message ?? 'Unexpected error.';
}

/** Whether an operation can be reversed exactly (and has not been yet). */
export function canUndo(rec: OperationRecord): boolean {
  return !rec.undoneMs && rec.state !== 'failed' && (rec.undo?.kind === 'rename-batch' || rec.undo?.kind === 'transfer' || rec.undo?.kind === 'trash' || rec.undo?.kind === 'snapshots' || rec.undo?.kind === 'operation');
}

export function undoLabel(rec: OperationRecord): string {
  if (rec.undo?.kind === 'rename-batch') return 'Undo rename';
  if (rec.undo?.kind === 'operation') return rec.undo.label;
  if (rec.undo?.kind === 'transfer' && POWER_UNDO_LABEL[rec.type]) return POWER_UNDO_LABEL[rec.type]!;
  if (rec.type === 'pdf-tools' && rec.undo?.kind === 'transfer') return 'Undo (move the new PDFs to the Trash)';
  if (rec.type === 'video-tool' && rec.undo?.kind === 'transfer') return 'Undo (move the new files to the Trash)';
  if (rec.undo?.kind === 'transfer') return rec.undo.mode === 'move' ? 'Undo move (move items back)' : 'Undo copy (move the copies to the Trash)';
  if (rec.undo?.kind === 'trash') return 'Undo move to Trash (restore the items)';
  if (rec.undo?.kind === 'snapshots') return 'Undo (restore the earlier versions from snapshots)';
  return 'Undo';
}

const POWER_UNDO_LABEL: Record<string, string> = {
  'split-file': 'Undo (move the parts to the Trash)',
  'join-files': 'Undo (move the joined file to the Trash)',
  'link-create': 'Undo (move the new links to the Trash)',
  'clip-save': 'Undo (move the new file to the Trash)',
};

export async function undoOperation(id: string): Promise<void> {
  try {
    const r = await call<{ operations: OperationRecord[]; notes: string[] }>('ops:undo', { id });
    r.operations.forEach((o) => watchOperation(o.id));
    if (r.notes.length) toast({ level: 'info', title: 'Undoing what can be reversed', detail: r.notes.join(' ') });
  } catch (err) {
    toastError(err, 'Could not undo');
  }
}
