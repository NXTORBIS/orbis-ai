import { formatBytes, formatCount } from '../ui/format';

/**
 * How a calculated folder size appears in the Size column. Pure (tested).
 * Values are marked as calculated (they are not file-system metadata and
 * are not updated automatically); a total that stopped early is "≥".
 */

export interface FolderTotalLike { bytes: number; files: number; directories: number; errors: number; symlinksSkipped: number; complete: boolean; limited?: boolean }

export interface FolderSizeCell {
  text: string;
  title: string;
  partial: boolean;
  pending: boolean;
}

export function folderSizeCell(total: FolderTotalLike | undefined, opts: { active: boolean; running: boolean; current?: boolean }): FolderSizeCell | undefined {
  if (!opts.active) return undefined;
  if (!total) {
    if (!opts.running) return { text: '—', title: 'Not calculated (the calculation was stopped before this folder).', partial: false, pending: false };
    return { text: opts.current ? 'Counting…' : '…', title: opts.current ? 'Calculating the size of this folder now.' : 'Waiting to be calculated.', partial: false, pending: true };
  }
  // Unreadable items make the total a lower bound even when counting finished.
  const partial = !total.complete || total.errors > 0;
  const why = total.limited
    ? 'Counting stopped at the entry limit, so the folder holds at least this much.'
    : total.errors
      ? `${formatCount(total.errors, 'item')} could not be read, so the folder holds at least this much.`
      : !total.complete
        ? 'The calculation was stopped while counting this folder.'
        : '';
  const contents = `${formatCount(total.files, 'file')} in ${formatCount(total.directories, 'folder')}${total.symlinksSkipped ? `; ${formatCount(total.symlinksSkipped, 'link')} not followed` : ''}`;
  return {
    text: `${partial ? '≥ ' : ''}${formatBytes(total.bytes)}`,
    title: `Calculated folder size: ${formatBytes(total.bytes)} (${total.bytes.toLocaleString()} bytes), ${contents}. ${why ? `${why} ` : ''}Not updated automatically.`,
    partial,
    pending: false,
  };
}
