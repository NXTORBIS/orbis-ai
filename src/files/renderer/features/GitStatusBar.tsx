import React from 'react';
import { useStore } from '../state/store';
import { gitState, type GitFolder } from '../state/git';
import { ws, activePane, currentLocation, navigate } from '../state/workspace';
import { Icon } from '../ui/Icon';
import { branchLabel } from '../../shared/git';

/**
 * GitStatusBar: a compact bar shown in the status area when the current
 * folder is inside a Git repository. Shows branch name, ahead/behind
 * counts, and change count with a link to open the Git panel view.
 */

export function GitStatusBar() {
  const pane = useStore(ws, activePane);
  const loc = currentLocation(pane);
  const dir = loc.kind === 'fs' ? loc.path : undefined;
  const byDir = useStore(gitState, (s) => s.byDir);
  const st: GitFolder | undefined = dir ? byDir[dir] : undefined;

  if (!st || st.state !== 'ok') return null;

  const label = branchLabel(st.branch);

  return (
    <button
      type="button"
      className="git-status-bar"
      onClick={() => void navigate(pane.id, { kind: 'tool', tool: 'git' })}
      title={`Git: ${label} - ${st.changes} change${st.changes !== 1 ? 's' : ''}`}
    >
      <Icon name="gitBranch" size={13} />
      <span className="git-branch-name">{st.branch.head ?? (st.branch.detached ? `${(st.branch.oid ?? '').slice(0, 7)}` : '?')}</span>
      {(st.branch.ahead ?? 0) > 0 && <span className="git-ahead" title={`${st.branch.ahead} ahead`}>↑{st.branch.ahead}</span>}
      {(st.branch.behind ?? 0) > 0 && <span className="git-behind" title={`${st.branch.behind} behind`}>↓{st.branch.behind}</span>}
      {st.changes > 0 && <span className="git-changes" title={`${st.changes} changed file${st.changes !== 1 ? 's' : ''}`}>{st.changes}</span>}
    </button>
  );
}
