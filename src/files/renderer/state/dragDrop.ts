import { createStore } from './store';
import type { DropHistoryEntry, DropOperation, DragPreviewInfo } from '../../shared/dragDrop';
import { DROP_HISTORY_MAX } from '../../shared/dragDrop';

export interface DragDropState {
  /** Currently dragging? */
  isDragging: boolean;
  /** Paths being dragged. */
  draggedPaths: string[];
  /** Preview info for the current drag. */
  preview: DragPreviewInfo | null;
  /** Current drop operation indicator. */
  currentOperation: DropOperation | null;
  /** Path of the folder the cursor is over (for spring-loaded open). */
  hoverTarget: string | null;
  /** Timestamp when the hover started. */
  hoverStartMs: number;
  /** History of recent drops for undo. */
  history: DropHistoryEntry[];
  /** Active drop zone paths. */
  activeZones: string[];
}

const initial: DragDropState = {
  isDragging: false,
  draggedPaths: [],
  preview: null,
  currentOperation: null,
  hoverTarget: null,
  hoverStartMs: 0,
  history: [],
  activeZones: [],
};

export const dragDrop = createStore<DragDropState>(initial);

export function startDrag(paths: string[], preview: DragPreviewInfo): void {
  dragDrop.set({
    isDragging: true,
    draggedPaths: paths,
    preview,
    currentOperation: null,
    hoverTarget: null,
    hoverStartMs: 0,
  });
}

export function endDrag(): void {
  dragDrop.set({
    isDragging: false,
    draggedPaths: [],
    preview: null,
    currentOperation: null,
    hoverTarget: null,
    hoverStartMs: 0,
    activeZones: [],
  });
}

export function setDropOperation(op: DropOperation | null): void {
  dragDrop.set({ currentOperation: op });
}

export function setHoverTarget(path: string | null): void {
  const s = dragDrop.get();
  if (s.hoverTarget === path) return;
  dragDrop.set({ hoverTarget: path, hoverStartMs: path ? Date.now() : 0 });
}

export function setActiveZones(zones: string[]): void {
  dragDrop.set({ activeZones: zones });
}

export function addDropHistory(entry: Omit<DropHistoryEntry, 'id' | 'timestampMs' | 'undone'>): void {
  const s = dragDrop.get();
  const newEntry: DropHistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestampMs: Date.now(),
    undone: false,
  };
  const history = [newEntry, ...s.history].slice(0, DROP_HISTORY_MAX);
  dragDrop.set({ history });
}

export function markUndone(id: string): void {
  const s = dragDrop.get();
  dragDrop.set({
    history: s.history.map((e) => (e.id === id ? { ...e, undone: true } : e)),
  });
}

/** Determine the drop operation from modifier keys. */
export function operationFromModifiers(e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): DropOperation {
  if (e.altKey) return 'link';
  if (e.ctrlKey) return 'copy';
  return 'move';
}
