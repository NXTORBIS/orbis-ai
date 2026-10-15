import React, { useCallback } from 'react';
import { useStore } from '../state/store';
import { folderSizes, startFolderSizes, type FolderTotal } from '../state/folderSizes';
import { formatBytes } from '../ui/format';
import { Icon } from '../ui/Icon';

/**
 * Folder size display component: shows the calculated size of a folder
 * in the file list. Uses the existing folderSizes state which is populated
 * by the `view.folderSizes` command (View -> Calculate folder sizes).
 */

export function FolderSizeValue({ dir, folderPath }: { dir: string; folderPath: string }) {
  const state = useStore(folderSizes, (s) => s[dir]);
  if (!state) return null;

  const total: FolderTotal | undefined = state.sizes[folderPath];
  if (!total && state.running) {
    return <span className="folder-size-loading"><Icon name="spinner" size={12} /></span>;
  }
  if (!total) return null;

  const label = formatBytes(total.bytes);
  const detail = `${total.files.toLocaleString()} files, ${total.directories.toLocaleString()} folders`;
  const partial = !total.complete;

  return (
    <span className="folder-size-value" title={`${label} (${detail})${partial ? ' — partial count' : ''}`}>
      {partial && '≥ '}{label}
    </span>
  );
}

/**
 * Button to trigger folder size calculation for a directory.
 * Appears in the view header area.
 */
export function CalculateFolderSizesButton({ dir }: { dir: string }) {
  const state = useStore(folderSizes, (s) => s[dir]);
  const running = !!state?.running;

  const handleClick = useCallback(() => {
    if (!running) startFolderSizes(dir);
  }, [dir, running]);

  return (
    <button
      type="button"
      className="btn btn-default btn-sm"
      onClick={handleClick}
      disabled={running}
      title="Calculate the sizes of all folders in this directory"
    >
      <Icon name="storage" size={14} />
      <span>{running ? 'Calculating...' : 'Folder sizes'}</span>
    </button>
  );
}
