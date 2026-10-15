import path from 'node:path';
import { runGit, type GitRun } from '../git/GitService';
import type { GitCommitResult, GitDiffSummary } from '../../shared/gitStatus';
import { parsePorcelainV2 } from '../../shared/git';

/**
 * Git integration: write operations (stage, unstage, commit) that extend
 * the read-only GitService. Each function runs git directly (never through
 * a shell) with safe defaults.
 */

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 32 * 1024 * 1024;

function run(args: string[], cwd: string): Promise<GitRun> {
  return runGit(args, { cwd, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
}

/** Stage files (git add). Paths must be absolute. */
export async function gitStage(repoRoot: string, absPaths: string[]): Promise<{ ok: boolean; error?: string }> {
  // Convert absolute paths to relative paths from repo root.
  const relPaths = absPaths.map((p) => path.relative(repoRoot, p));
  const r = await run(['add', '--', ...relPaths], repoRoot);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim().split('\n')[0] || `exit code ${r.code}` };
  return { ok: true };
}

/** Unstage files (git reset HEAD). Paths must be absolute. */
export async function gitUnstage(repoRoot: string, absPaths: string[]): Promise<{ ok: boolean; error?: string }> {
  const relPaths = absPaths.map((p) => path.relative(repoRoot, p));
  const r = await run(['reset', 'HEAD', '--', ...relPaths], repoRoot);
  // git reset exits 0 on success; non-zero with an initial commit needs a different approach.
  if (r.code !== 0) {
    // For initial commits, use rm --cached instead.
    const r2 = await run(['rm', '--cached', '--', ...relPaths], repoRoot);
    if (r2.code !== 0) return { ok: false, error: r2.stderr.trim().split('\n')[0] || r.stderr.trim().split('\n')[0] || `exit code ${r.code}` };
  }
  return { ok: true };
}

/** Commit staged changes. */
export async function gitCommit(repoRoot: string, message: string): Promise<GitCommitResult> {
  const r = await run(['commit', '-m', message], repoRoot);
  if (r.code !== 0) {
    const err = r.stderr.trim().split('\n')[0] || r.stdout.trim().split('\n')[0] || `exit code ${r.code}`;
    return { ok: false, error: err };
  }
  // Extract commit hash from output like "[main abc1234] message"
  const m = /^\[.+?\s+([0-9a-f]+)\]/.exec(r.stdout.trim());
  return { ok: true, hash: m?.[1], message: r.stdout.trim().split('\n')[0] };
}

/** Get a summary of staged/unstaged/untracked/conflicted counts. */
export async function gitDiffSummary(repoRoot: string): Promise<GitDiffSummary> {
  const r = await run(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=normal'], repoRoot);
  if (r.code !== 0 && !r.truncated) return { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  const parsed = parsePorcelainV2(r.stdout);
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  for (const e of parsed.entries) {
    if (e.code === 'conflicted') conflicted++;
    else if (e.code === 'untracked') untracked++;
    else {
      if (e.staged) staged++;
      if (e.unstaged) unstaged++;
    }
  }
  return { staged, unstaged, untracked, conflicted };
}
