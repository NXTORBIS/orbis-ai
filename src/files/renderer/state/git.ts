import { createStore } from './store';
import { call } from '../api';
import { app } from './app';
import type { GitBadge, GitBranch } from '../../shared/git';

/**
 * Git decorations per folder, requested after the folder is listed (never
 * delaying the listing) and refreshed when the listing is (watch events,
 * operations, Refresh).
 */

export type GitFolder =
  | { state: 'off' }
  | { state: 'unavailable'; reason: string }
  | { state: 'none' }
  | { state: 'error'; message: string; root?: string }
  | { state: 'ok'; root: string; rel: string; branch: GitBranch; byName: Record<string, GitBadge>; inherited?: GitBadge; changes: number; truncated: boolean; limit: number; durationMs: number; checkedMs: number };

export const gitState = createStore<{ byDir: Record<string, GitFolder> }>({ byDir: {} });

const inflight = new Map<string, number>();
let seq = 0;

/** Ask for a folder's Git status (refresh: run git again even when a recent result exists). */
export function requestGit(dir: string, refresh = false): void {
  if (!app.get().settings.gitIntegration) {
    if (gitState.get().byDir[dir]?.state !== 'off') gitState.set((s) => ({ byDir: { ...s.byDir, [dir]: { state: 'off' } } }));
    return;
  }
  const my = ++seq;
  inflight.set(dir, my);
  void call<GitFolder>('git:status', { path: dir, refresh }).then((r) => {
    if (inflight.get(dir) !== my) return; // a newer request answers
    inflight.delete(dir);
    gitState.set((s) => {
      const byDir = { ...s.byDir, [dir]: r };
      // Keep the cache small: folders not shown any more are dropped first.
      const keys = Object.keys(byDir);
      if (keys.length > 64) for (const k of keys.slice(0, keys.length - 64)) delete byDir[k];
      return { byDir };
    });
  }, () => inflight.delete(dir));
}

/** The badge of one item in a folder's status (or the one every item inherits). */
export function gitBadgeFor(st: GitFolder | undefined, name: string): GitBadge | undefined {
  if (!st || st.state !== 'ok') return undefined;
  return st.byName[name] ?? st.inherited;
}
