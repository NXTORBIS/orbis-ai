import { openDialog } from './state/app';
import { parentPath } from './state/workspace';
import { categoryOfEntry } from './ui/format';
import { clip, copyImageToClipboard, hasClipboardImage, hasClipboardText, startClipboardWatch } from './state/clipboard';
import { DESCRIPTOR_SUFFIX, parsePartName } from '../shared/powerTools';
import type { Command, CommandContext } from './commands';
import type { FileEntry } from '../shared/model';

/**
 * Power-tool and clipboard commands (registered in commands.ts). Every one
 * opens a dialog with a preview first; the work itself runs as operations in
 * the main process (see main/powerToolsIpc.ts).
 */

const isFile = (e: FileEntry) => e.kind === 'file';
const isDir = (e: FileEntry) => e.kind === 'directory';
/** Folders on this computer only (no archives, Trash view, tools or servers). */
const localPlace = (c: CommandContext): true | string => {
  const k = c.location.kind;
  if (k === 'archive') return 'Not available inside archives. Extract the items first.';
  if (k === 'tool') return 'Not available here.';
  if (k === 'remote') return 'Not available for items on a server. Copy them to this computer first.';
  return true;
};
const oneFile = (c: CommandContext): true | string => (c.selection.length !== 1 ? 'Select one file.' : isFile(c.selection[0]!) ? true : c.selection[0]!.kind === 'symlink' ? 'This is a link; select the file it points to.' : 'Select a file.');
const isPart = (e: FileEntry) => isFile(e) && (!!parsePartName(e.name) || e.name.endsWith(DESCRIPTOR_SUFFIX));
const folderOf = (c: CommandContext): string | undefined => c.dir ?? (c.selection[0] ? parentPath(c.selection[0].path) : undefined);
/** The folder to flatten: one selected folder, or the folder shown when nothing is selected. */
export const flattenTarget = (c: CommandContext): string | undefined => (c.selection.length === 1 && isDir(c.selection[0]!) ? c.selection[0]!.path : !c.selection.length ? c.dir : undefined);
const and = (...checks: Array<(c: CommandContext) => true | string>) => (c: CommandContext): true | string => {
  for (const f of checks) {
    const r = f(c);
    if (r !== true) return r;
  }
  return true;
};
const pasteHere = (c: CommandContext): true | string => (c.dir ? true : c.location.kind === 'remote' ? 'Images and text are pasted as files only into folders on this computer.' : 'Open a folder to paste into.');

export const POWER_COMMANDS: Command[] = [
  { id: 'file.splitFile', title: 'Split file…', category: 'File', icon: 'splitFile',
    description: 'Splits a large file into numbered parts (name.ext.001, .002 …) of a chosen size (100 MB, 700 MB, FAT32’s 4 GB limit or your own) or into a number of parts, with a checksum descriptor so the join can be verified. Streams the file; nothing is replaced.',
    when: and(localPlace, oneFile, (c) => ((c.selection[0]!.size ?? 0) > 1 ? true : 'The file is too small to split.')),
    run: (c) => openDialog('pt.split', { path: c.selection[0]!.path, name: c.selection[0]!.name, size: c.selection[0]!.size ?? 0, dir: folderOf(c) }) },
  { id: 'file.joinFiles', title: 'Join files…', category: 'File', icon: 'joinFiles',
    description: 'Joins numbered parts (name.ext.001, .002 …, also made by 7-Zip or HJSplit) back into one file. Checks for missing parts first and verifies the SHA-256 when the parts came with an .orbis-split.json descriptor.',
    when: and(localPlace, (c) => (c.selection.length === 1 && isPart(c.selection[0]!) ? true : 'Select one numbered part such as “name.ext.001”.')),
    run: (c) => openDialog('pt.join', { path: c.selection[0]!.path }) },
  { id: 'file.shred', title: 'Shred (secure delete)…', category: 'File', icon: 'shred', risk: 'destructive',
    description: 'Overwrites the contents of the selected files (and everything inside selected folders) with random data, then removes them. Cannot be undone. On SSDs and copy-on-write file systems old data may remain; the dialog says what it can detect.',
    when: and(localPlace, (c) => (c.selection.length ? true : 'Select files or folders first.')),
    run: (c) => openDialog('pt.shred', { paths: c.selection.map((e) => e.path), names: c.selection.slice(0, 20).map((e) => e.name) }) },
  { id: 'file.flatten', title: 'Flatten folder…', category: 'File', icon: 'flatten',
    description: 'Moves every file from the subfolders of a folder (the selected one, or the folder shown) into that folder, asking about name conflicts, and can remove the emptied subfolders. Shows the counts first; Undo puts everything back.',
    when: and(localPlace, (c) => (flattenTarget(c) ? true : 'Select one folder, or open the folder to flatten with nothing selected.')),
    run: (c) => openDialog('pt.flatten', { path: flattenTarget(c)! }) },
  { id: 'file.setDates', title: 'Set dates…', category: 'File', icon: 'setDates',
    description: 'Changes the modification and access time of the selected files and folders (optionally everything inside) to a date you choose, to now, to the photo’s EXIF date taken or to a date in the file name. Previewed per file; undoable.',
    when: and(localPlace, (c) => (c.selection.length ? true : 'Select files or folders first.')),
    run: (c) => openDialog('pt.dates', { paths: c.selection.map((e) => e.path) }) },
  { id: 'file.hardLink', title: 'Create hard link…', category: 'File', icon: 'hardLink',
    description: 'Creates another name for the same file (a hard link) in a folder you choose on the same drive. Both names show the same contents; deleting one keeps the other.',
    when: and(localPlace, (c) => (!c.selection.length ? 'Select one or more files.' : c.selection.every(isFile) ? true : 'Only files can have hard links (not folders or links).')),
    run: (c) => openDialog('pt.link', { kind: 'hard', paths: c.selection.map((e) => e.path), dir: folderOf(c) }) },
  { id: 'file.junction', title: 'Create junction…', category: 'File', icon: 'link',
    description: 'Windows only: creates a junction (a folder link that needs no administrator rights) to the selected folder. Not tested on Windows.',
    when: and(localPlace, () => (window.orbis.platform === 'win32' ? true : 'Junctions exist only on Windows. Use Create link for a symbolic link.'), (c) => (c.selection.length === 1 && isDir(c.selection[0]!) ? true : 'Select one folder.')),
    run: (c) => openDialog('pt.link', { kind: 'junction', paths: c.selection.map((e) => e.path), dir: folderOf(c) }) },
  // Clipboard
  { id: 'clip.pasteImage', title: 'Paste image as file…', category: 'Edit', icon: 'pasteImage',
    description: 'Saves the image on the clipboard as a new PNG file in this folder (you name it first). Ctrl+V does the same when the clipboard holds an image and no files.',
    when: and(pasteHere, () => (hasClipboardImage() ? true : 'The clipboard holds no image.')),
    run: (c) => openDialog('pt.pasteImage', { dir: c.dir! }) },
  { id: 'clip.pasteText', title: 'Paste text as file…', category: 'Edit', icon: 'pasteText',
    description: 'Saves the text on the clipboard as a new UTF-8 file in this folder: .txt, .md, .json or .csv.',
    when: and(pasteHere, () => (hasClipboardText() ? true : clip.get().peek?.files ? 'The clipboard holds files, not text. Use Paste.' : 'The clipboard holds no text.')),
    run: (c) => openDialog('pt.pasteText', { dir: c.dir! }) },
  { id: 'clip.history', title: 'Clipboard history…', category: 'Edit', icon: 'clipHistory', keys: ['Mod+Shift+V'],
    description: 'The last 10 sets of files you copied or cut in Orbis Files, with time and names; paste any of them into the folder shown. Kept in memory until Orbis Files quits.',
    run: (c) => openDialog('pt.clipHistory', { dir: c.location.kind === 'fs' ? c.location.path : undefined, paneId: c.pane.id }) },
  { id: 'clip.copyImage', title: 'Copy image', category: 'Edit', icon: 'copyImage',
    description: 'Puts the selected image itself (not its path) on the clipboard, to paste into other programs.',
    when: and(localPlace, (c) => (c.selection.length === 1 && isFile(c.selection[0]!) && categoryOfEntry(c.selection[0]!) === 'image' ? ((c.selection[0]!.size ?? 0) <= 64 * 1024 * 1024 ? true : 'Images over 64 MB are not copied.') : 'Select one image.')),
    run: (c) => void copyImageToClipboard(c.selection[0]!) },
];

/** Registry metadata for the host adapter (commands.ts permissionOf/contextsOf). */
export const POWER_MODIFY = ['file.splitFile', 'file.joinFiles', 'file.flatten', 'file.setDates', 'file.hardLink', 'file.junction', 'clip.pasteImage', 'clip.pasteText', 'clip.history'];
export const POWER_READ = ['clip.copyImage'];
export const POWER_ON_SELECTION = ['file.splitFile', 'file.joinFiles', 'file.shred', 'file.flatten', 'file.setDates', 'file.hardLink', 'file.junction', 'clip.copyImage'];
export const POWER_IN_FOLDER = ['file.flatten', 'clip.pasteImage', 'clip.pasteText', 'clip.history'];

// Watch the system clipboard while the window is in use (window only; not in unit tests).
if (typeof window !== 'undefined' && (window as { orbis?: unknown }).orbis) {
  startClipboardWatch();
}
