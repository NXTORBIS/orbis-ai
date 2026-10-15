import type { EntryKind } from './model';

/**
 * The system Trash as Orbis Files reads it (freedesktop.org Trash
 * specification 1.0, Linux only). Each item is identified by its path inside
 * the Trash (`<trash dir>/files/<name>`); restore and permanent delete are
 * operations ('trash-restore' / 'trash-delete') whose sources are those paths,
 * re-validated by the main process.
 */

export interface TrashDirSummary {
  /** The trash directory (contains files/ and info/). */
  path: string;
  /** 'home' = $XDG_DATA_HOME/Trash; 'volume' = $topdir/.Trash/$uid or $topdir/.Trash-$uid. */
  kind: 'home' | 'volume';
  /** The drive (mount point) a volume trash belongs to; for the home trash, the folder that contains it. */
  topdir: string;
}

export interface TrashItem {
  /** Path of the item inside the Trash; used as its id. */
  id: string;
  trashDir: string;
  /** Name inside files/ (and of the .trashinfo file without its extension). */
  name: string;
  /** Where it was deleted from, when the .trashinfo is present, well-formed and trusted. */
  originalPath?: string;
  /** Deletion time (local time as recorded by the system), when recorded and valid. */
  deletedMs?: number;
  kind: EntryKind;
  /** Bytes; for folders, the total of the files inside (see sizeComplete). */
  size?: number;
  /** False when a folder was too large to total quickly or parts of it could not be read. */
  sizeComplete: boolean;
  /** Why the item cannot be restored to its original location; it can still be restored to a chosen folder or deleted. */
  problem?: string;
}

export type TrashListing =
  | { supported: true; dirs: TrashDirSummary[]; items: TrashItem[]; problems: string[] }
  | { supported: false; platform: string; canOpenSystemTrash: boolean; systemTrashName: string; note: string };
