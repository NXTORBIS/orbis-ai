/**
 * Shared types for archive editing: adding, deleting, renaming and moving
 * entries inside an archive, and converting between archive formats.
 */

/** Formats that support in-place editing (extract + repack round-trip). */
export type EditableFormat = 'zip' | 'tar' | 'tar.gz' | '7z';

export function isEditableFormat(f: string): f is EditableFormat {
  return f === 'zip' || f === 'tar' || f === 'tar.gz' || f === '7z';
}

/** Target formats for archive conversion. */
export type ConvertFormat = 'zip' | '7z' | 'tar.gz' | 'tar.bz2' | 'tar.xz';

export const CONVERT_FORMATS: ReadonlyArray<{ id: ConvertFormat; label: string; ext: string }> = [
  { id: 'zip', label: 'ZIP', ext: '.zip' },
  { id: '7z', label: '7z', ext: '.7z' },
  { id: 'tar.gz', label: 'TAR.GZ (gzip)', ext: '.tar.gz' },
  { id: 'tar.bz2', label: 'TAR.BZ2 (bzip2)', ext: '.tar.bz2' },
  { id: 'tar.xz', label: 'TAR.XZ (xz)', ext: '.tar.xz' },
];

export interface ArchiveEditResult {
  /** Whether the archive was modified. */
  modified: boolean;
  /** Number of entries affected. */
  affected: number;
  /** Warnings from the operation. */
  warnings: string[];
}

export interface ArchiveConvertResult {
  /** Path to the new archive. */
  path: string;
  /** Format of the new archive. */
  format: ConvertFormat;
  /** Size of the new archive in bytes. */
  size: number;
}
