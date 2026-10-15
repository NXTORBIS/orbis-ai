import { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../../api';
import { toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { gitState, requestGit, type GitFolder } from '../../state/git';
import { ws, activePane, currentLocation } from '../../state/workspace';
import { Button, EmptyState, Pill, TextField } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { branchLabel, GIT_CODE_LABEL, GIT_CODE_LETTER } from '../../../shared/git';
import type { GitCommitResult, GitDiffSummary } from '../../../shared/gitStatus';

/**
 * GitPanelView: a full tool view for Git operations. Shows the current
 * branch, lists changed files with their status, and provides quick
 * actions: stage, unstage and commit.
 */

export function GitPanelView() {
  const pane = useStore(ws, activePane);
  const loc = currentLocation(pane);
  const dir = loc.kind === 'fs' ? loc.path : undefined;
  const byDir = useStore(gitState, (s) => s.byDir);
  const st: GitFolder | undefined = dir ? byDir[dir] : undefined;

  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState<GitDiffSummary | null>(null);
  const [_selected, _setSelected] = useState<Set<string>>(new Set());

  // Refresh git status and summary when opened.
  useEffect(() => {
    if (dir) {
      requestGit(dir, true);
      void call<GitDiffSummary>('git:diffSummary', { repoRoot: dir }).then(setSummary).catch(() => {/* */});
    }
  }, [dir]);

  const refresh = useCallback(() => {
    if (!dir) return;
    requestGit(dir, true);
    void call<GitDiffSummary>('git:diffSummary', { repoRoot: dir }).then(setSummary).catch(() => {/* */});
  }, [dir]);

  const repoRoot = st?.state === 'ok' ? st.root : undefined;

  const entries = useMemo(() => {
    if (!st || st.state !== 'ok') return [];
    return Object.entries(st.byName)
      .filter(([, b]) => b.code !== 'ignored')
      .map(([name, badge]) => ({ name, ...badge }));
  }, [st]);

  const handleStage = useCallback(async (paths: string[]) => {
    if (!repoRoot) return;
    const absPaths = paths.map((p) => `${repoRoot}/${p}`);
    try {
      const r = await call<{ ok: boolean; error?: string }>('git:stage', { repoRoot, paths: absPaths });
      if (!r.ok) toastError(`Stage failed: ${r.error}`);
      else toast({ level: 'success', title: 'Files staged' });
      refresh();
    } catch (err) {
      toastError(`Stage failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [repoRoot, refresh]);

  const handleUnstage = useCallback(async (paths: string[]) => {
    if (!repoRoot) return;
    const absPaths = paths.map((p) => `${repoRoot}/${p}`);
    try {
      const r = await call<{ ok: boolean; error?: string }>('git:unstage', { repoRoot, paths: absPaths });
      if (!r.ok) toastError(`Unstage failed: ${r.error}`);
      else toast({ level: 'success', title: 'Files unstaged' });
      refresh();
    } catch (err) {
      toastError(`Unstage failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [repoRoot, refresh]);

  const handleCommit = useCallback(async () => {
    if (!repoRoot || !commitMsg.trim()) return;
    setCommitting(true);
    try {
      const r = await call<GitCommitResult>('git:commit', { repoRoot, message: commitMsg.trim() });
      if (r.ok) {
        toast({ level: 'success', title: `Committed: ${r.message ?? r.hash ?? 'done'}` });
        setCommitMsg('');
      } else {
        toastError(`Commit failed: ${r.error}`);
      }
      refresh();
    } catch (err) {
      toastError(`Commit failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCommitting(false);
    }
  }, [repoRoot, commitMsg, refresh]);

  if (!dir) {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Git</h1></header>
        <EmptyState icon="gitBranch" title="No folder open" body="Open a folder to see its Git status." />
      </div>
    );
  }

  if (!st || st.state === 'off') {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Git</h1></header>
        <EmptyState icon="gitBranch" title="Git integration is off" body="Enable it in Settings to see file statuses." />
      </div>
    );
  }

  if (st.state === 'none' || st.state === 'unavailable') {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Git</h1></header>
        <EmptyState icon="gitBranch" title={st.state === 'none' ? 'Not a Git repository' : 'Git unavailable'} body={st.state === 'unavailable' ? st.reason : 'This folder is not inside a Git work tree.'} />
      </div>
    );
  }

  if (st.state === 'error') {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Git</h1></header>
        <EmptyState icon="gitBranch" title="Git error" body={st.message} />
      </div>
    );
  }

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Git</h1>
        <Button variant="ghost" icon="retry" onClick={refresh}>Refresh</Button>
      </header>

      {/* Branch info */}
      <div className="git-panel-branch">
        <Icon name="gitBranch" size={16} />
        <span className="git-panel-branch-label">{branchLabel(st.branch)}</span>
        {summary && (
          <span className="git-panel-summary muted">
            {summary.staged > 0 && <Pill tone="success" title="Staged">{summary.staged} staged</Pill>}
            {summary.unstaged > 0 && <Pill tone="warning" title="Unstaged">{summary.unstaged} modified</Pill>}
            {summary.untracked > 0 && <Pill tone="neutral" title="Untracked">{summary.untracked} untracked</Pill>}
            {summary.conflicted > 0 && <Pill tone="error" title="Conflicted">{summary.conflicted} conflicted</Pill>}
          </span>
        )}
      </div>

      {/* Changed files list */}
      {entries.length === 0 ? (
        <p className="muted" style={{ padding: '0 var(--sp-4)' }}>No changes detected.</p>
      ) : (
        <div className="git-panel-files">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>St</th>
                <th>File</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 140 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.name} className={`git-entry git-entry-${e.code}`}>
                  <td className="mono git-letter">{GIT_CODE_LETTER[e.code]}</td>
                  <td className="mono" title={e.name}>{e.name}</td>
                  <td>
                    <Pill tone={e.code === 'conflicted' ? 'error' : e.code === 'untracked' ? 'neutral' : e.staged ? 'success' : 'warning'}>
                      {GIT_CODE_LABEL[e.code]}
                    </Pill>
                  </td>
                  <td className="git-actions-cell">
                    {e.staged ? (
                      <Button variant="ghost" size="sm" onClick={() => void handleUnstage([e.name])}>Unstage</Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => void handleStage([e.name])}>Stage</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Commit area */}
      <div className="git-panel-commit">
        <h2 className="section-head" style={{ margin: 'var(--sp-4) 0 var(--sp-2)' }}>
          <span>Commit</span>
        </h2>
        <div className="git-commit-form">
          <TextField
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.currentTarget.value)}
            placeholder="Commit message..."
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void handleCommit(); }}
          />
          <Button
            variant="primary"
            disabled={!commitMsg.trim() || committing}
            onClick={() => void handleCommit()}
          >
            {committing ? 'Committing...' : 'Commit'}
          </Button>
        </div>
      </div>

      {st.truncated && (
        <p className="muted small" style={{ padding: 'var(--sp-2) var(--sp-4)' }}>
          Status was truncated at {st.limit.toLocaleString()} entries. Some files may not be shown.
        </p>
      )}
    </div>
  );
}
