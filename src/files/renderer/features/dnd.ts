import type React from 'react';
import { app } from '../state/app';
import { call } from '../api';
import { isRemoteRef, parseRemoteRef } from '../../shared/remote';

/**
 * Drag-and-drop helpers shared by every drop target.
 * Platform convention: same volume → move, different volume → copy.
 * Hold Ctrl (Option on macOS) to force copy, Shift to force move.
 */

let currentDrag: string[] | null = null;

export function beginDrag(e: React.DragEvent, paths: string[]): void {
  currentDrag = paths;
  e.dataTransfer.setData('application/x-orbis-paths', JSON.stringify(paths));
  e.dataTransfer.setData('text/plain', paths.join('\n'));
  e.dataTransfer.effectAllowed = 'copyMove';
}

export function endDrag(): void {
  currentDrag = null;
}

/** Start a native drag so items can be dropped into other applications. */
export function dragOut(paths: string[]): void {
  // Items on a server have no local file to hand to other applications.
  paths = paths.filter((p) => !isRemoteRef(p));
  if (!paths.length) return;
  void call('fs:startDrag', { paths }).catch(() => undefined);
}

export function readDragPaths(e: React.DragEvent): string[] {
  const internal = e.dataTransfer.getData('application/x-orbis-paths');
  if (internal) {
    try {
      const v = JSON.parse(internal);
      if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
    } catch {
      /* fall through */
    }
  }
  const files = [...e.dataTransfer.files];
  if (files.length && window.orbis.getPathForFile) {
    return files.map((f) => window.orbis.getPathForFile!(f)).filter((p) => !!p);
  }
  return [];
}

function volumeOf(p: string): string {
  let best = '';
  for (const v of app.get().volumes) if (p.startsWith(v.mountPath) && v.mountPath.length > best.length) best = v.mountPath;
  return best;
}

export function dropEffectFor(e: React.DragEvent, dest: string): 'copy' | 'move' {
  const mac = window.orbis.platform === 'darwin';
  if (mac ? e.altKey : e.ctrlKey) return 'copy';
  if (e.shiftKey) return 'move';
  const src = currentDrag?.[0];
  if (!src) return 'copy'; // from another application: never move by default
  // To or from a server: copy, except within the same server (like the same volume).
  if (isRemoteRef(src) || isRemoteRef(dest)) return parseRemoteRef(src)?.connectionId !== undefined && parseRemoteRef(src)?.connectionId === parseRemoteRef(dest)?.connectionId ? 'move' : 'copy';
  return volumeOf(src) === volumeOf(dest) ? 'move' : 'copy';
}

export function isDraggingPaths(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes('application/x-orbis-paths') || e.dataTransfer.types.includes('Files');
}
