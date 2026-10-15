import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { changeCount, folderBadges, parsePorcelainV2, redactRemoteUrl, type GitBadge, type GitBranch, type GitEntry } from '../../shared/git';

/**
 * Git integration: the system's `git` is run (never a shell) to decorate
 * folders inside a work tree. Status is computed once per repository and
 * cached; each folder only receives the badges of its own items. Nothing here
 * changes a repository: optional locks are disabled (GIT_OPTIONAL_LOCKS=0)
 * and so is core.fsmonitor, which would otherwise let a repository's own
 * configuration start a program.
 */

export type GitFolderResult =
  | { state: 'off' }
  | { state: 'unavailable'; reason: string }
  | { state: 'none' }
  | { state: 'error'; message: string; root?: string }
  | {
    state: 'ok';
    root: string;
    /** This folder relative to the repository root ("" at the root). */
    rel: string;
    branch: GitBranch;
    byName: Record<string, GitBadge>;
    inherited?: GitBadge;
    /** Changed (not ignored) entries in the whole repository. */
    changes: number;
    truncated: boolean;
    limit: number;
    durationMs: number;
    checkedMs: number;
  };

export interface GitRun { code: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean; error?: NodeJS.ErrnoException }

export interface GitOptions {
  /** Program to run (default "git", found on PATH). */
  gitPath?: string;
  timeoutMs?: number;
  /** Entries parsed per repository before the status is reported as incomplete. */
  maxEntries?: number;
  /** Largest output read from `git status`. */
  maxBytes?: number;
  /** How long a status is reused without a refresh request. */
  freshMs?: number;
  env?: NodeJS.ProcessEnv;
}

const SAFE_CONFIG = ['-c', 'core.fsmonitor=false'];

export function runGit(args: string[], opts: { gitPath?: string; cwd?: string; timeoutMs: number; maxBytes: number; env?: NodeJS.ProcessEnv }): Promise<GitRun> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(opts.gitPath ?? 'git', [...SAFE_CONFIG, ...args], {
        cwd: opts.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...(opts.env ?? process.env), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', LANGUAGE: 'C' },
      });
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, truncated: false, error: err as NodeJS.ErrnoException });
      return;
    }
    const out: Buffer[] = [];
    let outBytes = 0;
    const errOut: Buffer[] = [];
    let errBytes = 0;
    let timedOut = false;
    let truncated = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stdout!.on('data', (b: Buffer) => {
      if (truncated) return;
      outBytes += b.length;
      if (outBytes > opts.maxBytes) {
        truncated = true;
        out.push(b.subarray(0, b.length - (outBytes - opts.maxBytes)));
        child.kill('SIGKILL');
        return;
      }
      out.push(b);
    });
    child.stderr!.on('data', (b: Buffer) => {
      if (errBytes < 64 * 1024) errOut.push(b);
      errBytes += b.length;
    });
    const done = (code: number | null, error?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(errOut).toString('utf8'), timedOut, truncated, error });
    };
    child.on('error', (e) => done(null, e as NodeJS.ErrnoException));
    child.on('close', (code) => done(code));
  });
}

interface RepoCache { status?: { branch: GitBranch; entries: GitEntry[]; truncated: boolean; durationMs: number; checkedMs: number; error?: string }; inflight?: Promise<void>; startedMs?: number }

export class GitService {
  private detected?: Promise<{ available: boolean; version?: string; reason?: string }>;
  private roots = new Map<string, { root: string | null; error?: string; ms: number }>();
  private repos = new Map<string, RepoCache>();
  readonly timeoutMs: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly freshMs: number;

  constructor(private readonly opts: GitOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.maxEntries = opts.maxEntries ?? 50000;
    this.maxBytes = opts.maxBytes ?? 32 * 1024 * 1024;
    this.freshMs = opts.freshMs ?? 3000;
  }

  private run(args: string[], cwd?: string, maxBytes = 1024 * 1024): Promise<GitRun> {
    return runGit(args, { gitPath: this.opts.gitPath, cwd, timeoutMs: this.timeoutMs, maxBytes, env: this.opts.env });
  }

  /** Whether git can be run here (checked once; `recheck` looks again, e.g. after installing git). */
  detect(recheck = false): Promise<{ available: boolean; version?: string; reason?: string }> {
    if (!this.detected || recheck) {
      this.detected = this.run(['--version']).then((r) => {
        if (r.error?.code === 'ENOENT') return { available: false, reason: 'Git was not found on PATH.' };
        if (r.error || r.code !== 0) return { available: false, reason: `Git could not be run${r.error ? ` (${r.error.code ?? r.error.message})` : r.stderr ? `: ${r.stderr.trim().split('\n')[0]}` : ''}.` };
        const m = /git version (\S+)/.exec(r.stdout);
        return { available: true, version: m?.[1] ?? r.stdout.trim() };
      });
    }
    return this.detected;
  }

  /** The work tree root containing `dir`, or null outside a work tree (cached for 30 s). */
  async repoRootOf(dir: string): Promise<{ root: string | null; error?: string }> {
    const cached = this.roots.get(dir);
    if (cached && Date.now() - cached.ms < 30000) return cached;
    const r = await this.run(['rev-parse', '--is-inside-work-tree', '--show-toplevel'], dir);
    let entry: { root: string | null; error?: string; ms: number };
    if (r.timedOut) entry = { root: null, error: `Git did not answer within ${Math.round(this.timeoutMs / 1000)} s.`, ms: Date.now() };
    else if (r.code === 0) {
      const [inside, top] = r.stdout.trim().split('\n');
      entry = { root: inside === 'true' && top ? path.resolve(top) : null, ms: Date.now() };
    } else if (/dubious ownership/i.test(r.stderr)) {
      entry = { root: null, error: 'Git refuses this repository because it belongs to another user (see git’s safe.directory setting).', ms: Date.now() };
    } else entry = { root: null, ms: Date.now() };
    if (this.roots.size > 2000) this.roots.clear();
    this.roots.set(dir, entry);
    return entry;
  }

  /** Status badges for the items of one folder. Never throws. */
  async folderStatus(dir: string, opts: { refresh?: boolean } = {}): Promise<GitFolderResult> {
    const det = await this.detect();
    if (!det.available) return { state: 'unavailable', reason: det.reason ?? 'Git was not found.' };
    const { root, error } = await this.repoRootOf(dir);
    if (error) return { state: 'error', message: error };
    if (!root) return { state: 'none' };
    const real = await fsp.realpath(dir).catch(() => dir);
    const rel = path.relative(root, real).split(path.sep).join('/');
    if (rel.startsWith('..') || path.isAbsolute(rel)) return { state: 'none' };
    // Nothing inside the .git folder is part of the work tree.
    if (rel === '.git' || rel.startsWith('.git/')) return { state: 'none' };
    const st = await this.repoStatus(root, !!opts.refresh);
    if (st.error) return { state: 'error', message: st.error, root };
    const { byName, inherited } = folderBadges(st.entries, rel);
    delete byName['.git'];
    return { state: 'ok', root, rel, branch: st.branch, byName, inherited, changes: changeCount(st.entries), truncated: st.truncated, limit: this.maxEntries, durationMs: st.durationMs, checkedMs: st.checkedMs };
  }

  private async repoStatus(root: string, refresh: boolean): Promise<NonNullable<RepoCache['status']>> {
    let c = this.repos.get(root);
    if (!c) {
      c = {};
      this.repos.set(root, c);
    }
    const now = Date.now();
    // A run that started just now answers a refresh too.
    if (c.inflight && (!refresh || now - (c.startedMs ?? 0) < 300)) await c.inflight;
    else if (!c.status || refresh || now - c.status.checkedMs > (c.status.error ? 20000 : this.freshMs)) {
      const cache = c;
      cache.startedMs = now;
      cache.inflight = this.computeStatus(root).then((s) => {
        cache.status = s;
      }).finally(() => {
        cache.inflight = undefined;
      });
      await cache.inflight;
    }
    return c.status!;
  }

  private async computeStatus(root: string): Promise<NonNullable<RepoCache['status']>> {
    const t0 = Date.now();
    const r = await this.run(['status', '--porcelain=v2', '-z', '--branch', '--ignored=matching', '--untracked-files=normal'], root, this.maxBytes);
    const base = { branch: { detached: false, initial: false }, entries: [] as GitEntry[], truncated: false, durationMs: Date.now() - t0, checkedMs: Date.now() };
    if (r.timedOut) return { ...base, error: `Git did not answer within ${Math.round(this.timeoutMs / 1000)} s, so no Git status is shown for this repository.` };
    if (r.error) return { ...base, error: `Git could not be run (${r.error.code ?? r.error.message}).` };
    if (r.code !== 0 && !r.truncated) return { ...base, error: `git status failed: ${r.stderr.trim().split('\n')[0] || `exit code ${r.code}`}` };
    const parsed = parsePorcelainV2(r.stdout, this.maxEntries);
    return { branch: parsed.branch, entries: parsed.entries, truncated: parsed.truncated || r.truncated, durationMs: Date.now() - t0, checkedMs: Date.now() };
  }

  /** Forget cached status of repositories containing any of these paths (after Orbis Files changed them). */
  invalidate(paths: string[]): void {
    for (const root of this.repos.keys()) {
      if (paths.some((p) => p === root || p.startsWith(root + path.sep))) {
        const c = this.repos.get(root)!;
        if (c.status) c.status.checkedMs = 0;
      }
    }
  }

  /** The URL of the repository's "origin" remote (or its first remote), without user names or passwords. */
  async remoteUrl(dir: string): Promise<{ remote: string; url: string } | null> {
    const det = await this.detect();
    if (!det.available) return null;
    const { root } = await this.repoRootOf(dir);
    if (!root) return null;
    const list = await this.run(['remote'], root);
    if (list.code !== 0) return null;
    const remotes = list.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    const name = remotes.includes('origin') ? 'origin' : remotes[0];
    if (!name) return null;
    const r = await this.run(['remote', 'get-url', name], root);
    if (r.code !== 0 || !r.stdout.trim()) return null;
    return { remote: name, url: redactRemoteUrl(r.stdout.trim().split('\n')[0]!) };
  }
}
