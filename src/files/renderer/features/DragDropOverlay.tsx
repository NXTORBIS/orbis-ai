import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { call } from '../api';
import { toast, toastError } from '../state/app';
import { Icon } from '../ui/Icon';
import {
  dragDrop, endDrag, setDropOperation, setHoverTarget,
  addDropHistory, markUndone, operationFromModifiers, type DragDropState,
} from '../state/dragDrop';
import { SPRING_LOAD_DELAY, type DropOperation } from '../../shared/dragDrop';
import { navigate } from '../state/workspace';

/* -------------------------------------------------------------------------- */
/*  Drag & Drop Overlay                                                        */
/*  Visual drop zones with operation indicators, spring-loaded folders,        */
/*  drag preview with file count/size, and drop history with undo.            */
/* -------------------------------------------------------------------------- */

function useDragDrop<T>(sel: (s: DragDropState) => T): T {
  const ref = useRef(sel(dragDrop.get()));
  return useSyncExternalStore(
    dragDrop.subscribe,
    () => {
      const next = sel(dragDrop.get());
      if (next !== ref.current) ref.current = next;
      return ref.current;
    },
  );
}

const OP_LABELS: Record<DropOperation, { icon: string; label: string; color: string }> = {
  copy: { icon: 'copy', label: 'Copy here', color: 'var(--accent)' },
  move: { icon: 'move', label: 'Move here', color: 'var(--success)' },
  link: { icon: 'link-2', label: 'Create link', color: 'var(--info)' },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** The floating drag preview showing count and size. */
export function DragPreview() {
  const isDragging = useDragDrop((s) => s.isDragging);
  const preview = useDragDrop((s) => s.preview);
  const operation = useDragDrop((s) => s.currentOperation);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!isDragging) return;
    const handler = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    document.addEventListener('mousemove', handler);
    return () => document.removeEventListener('mousemove', handler);
  }, [isDragging]);

  if (!isDragging || !preview) return null;

  const op = operation ? OP_LABELS[operation] : null;
  const totalItems = preview.fileCount + preview.folderCount;

  return (
    <div
      className="drag-preview"
      style={{ left: pos.x + 16, top: pos.y + 16 }}
    >
      <div className="drag-preview-count">
        <Icon name="file" size={14} />
        <span>{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
      </div>
      {preview.totalSize > 0 && (
        <div className="drag-preview-size">{formatSize(preview.totalSize)}</div>
      )}
      {op && (
        <div className="drag-preview-op" style={{ color: op.color }}>
          <Icon name={op.icon} size={12} />
          <span>{op.label}</span>
        </div>
      )}
    </div>
  );
}

/** A visual drop zone indicator that appears over drop targets. */
export interface DropZoneProps {
  path: string;
  kind: 'directory' | 'archive';
  paneId: string;
  onDrop?: (sources: string[], dest: string, op: DropOperation) => void;
}

export function DropZone({ path, kind, paneId, onDrop }: DropZoneProps) {
  const isDragging = useDragDrop((s) => s.isDragging);
  const draggedPaths = useDragDrop((s) => s.draggedPaths);
  const [isOver, setIsOver] = useState(false);
  const [op, setOp] = useState<DropOperation>('move');
  const springTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newOp = operationFromModifiers(e);
    setOp(newOp);
    setDropOperation(newOp);
    e.dataTransfer.dropEffect = newOp === 'link' ? 'link' : newOp;
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(true);
    setHoverTarget(path);
    // Spring-loaded folder: navigate after holding
    if (kind === 'directory') {
      springTimer.current = setTimeout(() => {
        navigate(paneId, { kind: 'fs', path });
      }, SPRING_LOAD_DELAY);
    }
  }, [path, kind, paneId]);

  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    setIsOver(false);
    setHoverTarget(null);
    clearTimeout(springTimer.current);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(false);
    setHoverTarget(null);
    clearTimeout(springTimer.current);

    const dropOp = operationFromModifiers(e);
    // Get paths from native drag or from internal state
    const files = Array.from(e.dataTransfer.files);
    const nativePaths = files.map((f) => window.orbis.getPathForFile?.(f)).filter(Boolean) as string[];
    const sources = nativePaths.length ? nativePaths : draggedPaths;

    if (sources.length && path) {
      if (onDrop) {
        onDrop(sources, path, dropOp);
      } else {
        const opsType = dropOp === 'copy' ? 'copy' : dropOp === 'link' ? 'copy' : 'move';
        void call('ops:start', { type: opsType, sources, destination: path }).then(() => {
          addDropHistory({ operation: dropOp, sources, destination: path });
          toast({ level: 'info', title: `${dropOp === 'copy' ? 'Copied' : dropOp === 'link' ? 'Linked' : 'Moved'} ${sources.length} item${sources.length !== 1 ? 's' : ''}` });
        }).catch(toastError);
      }
    }
    endDrag();
  }, [draggedPaths, path, onDrop]);

  if (!isDragging && !isOver) return null;

  const opInfo = OP_LABELS[op];

  return (
    <div
      className={`drop-zone ${isOver ? 'is-over' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ '--drop-color': opInfo.color } as React.CSSProperties}
    >
      {isOver && (
        <div className="drop-zone-indicator">
          <Icon name={opInfo.icon} size={16} />
          <span>{opInfo.label}</span>
        </div>
      )}
    </div>
  );
}

/** Drop history panel with undo capability. */
export function DropHistory() {
  const history = useDragDrop((s) => s.history);

  const handleUndo = useCallback((entry: typeof history[number]) => {
    if (entry.undone) return;
    if (entry.operation === 'move') {
      // Undo a move by moving back
      const originalParents = entry.sources.map((s) => {
        const parts = s.split('/');
        return parts.slice(0, -1).join('/') || '/';
      });
      const uniqueParent = [...new Set(originalParents)][0];
      if (uniqueParent) {
        const movedPaths = entry.sources.map((s) => {
          const name = s.split('/').pop() ?? '';
          return entry.destination + '/' + name;
        });
        void call('ops:start', { type: 'move', sources: movedPaths, destination: uniqueParent }).then(() => {
          markUndone(entry.id);
          toast({ level: 'info', title: 'Drop undone' });
        }).catch(toastError);
      }
    } else if (entry.operation === 'copy') {
      // Undo a copy by trashing the copies
      const copiedPaths = entry.sources.map((s) => {
        const name = s.split('/').pop() ?? '';
        return entry.destination + '/' + name;
      });
      void call('ops:start', { type: 'trash', sources: copiedPaths }).then(() => {
        markUndone(entry.id);
        toast({ level: 'info', title: 'Copied files moved to Trash' });
      }).catch(toastError);
    }
  }, []);

  if (history.length === 0) return null;

  return (
    <div className="drop-history">
      <div className="drop-history-title">Recent drops</div>
      {history.slice(0, 10).map((entry) => (
        <div key={entry.id} className={`drop-history-entry ${entry.undone ? 'is-undone' : ''}`}>
          <Icon name={OP_LABELS[entry.operation].icon} size={12} />
          <span className="ellipsis">
            {entry.sources.length} item{entry.sources.length !== 1 ? 's' : ''} {entry.operation === 'copy' ? 'copied' : entry.operation === 'link' ? 'linked' : 'moved'} to {entry.destination.split('/').pop()}
          </span>
          {!entry.undone && (entry.operation === 'move' || entry.operation === 'copy') && (
            <button className="icon-btn" onClick={() => handleUndo(entry)} aria-label="Undo" data-tip="Undo this drop">
              <Icon name="rotate-ccw" size={12} />
            </button>
          )}
          {entry.undone && <span className="drop-history-undone">Undone</span>}
        </div>
      ))}
    </div>
  );
}
