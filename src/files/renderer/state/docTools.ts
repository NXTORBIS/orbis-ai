import { createStore } from './store';

/**
 * Hand-over for "Find and replace in files…": the folder the command was run
 * on, picked up by the tool view when it opens (or is already open). `seq`
 * changes on every request so the same folder can be asked for again.
 */
export const findPrefill = createStore<{ root?: string; paneId?: string; seq: number }>({ seq: 0 });

export function requestFindIn(root: string | undefined, paneId: string): void {
  findPrefill.set((s) => ({ root, paneId, seq: s.seq + 1 }));
}
