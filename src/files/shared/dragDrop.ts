/**
 * Advanced drag-and-drop types shared between main and renderer.
 */

export type DropOperation = 'copy' | 'move' | 'link';

export interface DropHistoryEntry {
  id: string;
  operation: DropOperation;
  sources: string[];
  destination: string;
  timestampMs: number;
  undone: boolean;
}

export interface DragPreviewInfo {
  fileCount: number;
  folderCount: number;
  totalSize: number;
  names: string[];
}

export interface DropZoneInfo {
  path: string;
  kind: 'directory' | 'archive';
  operation: DropOperation;
  label: string;
}

/** How long (ms) to hover over a folder before it springs open. */
export const SPRING_LOAD_DELAY = 800;

/** Maximum entries in the drop history ring buffer. */
export const DROP_HISTORY_MAX = 50;
