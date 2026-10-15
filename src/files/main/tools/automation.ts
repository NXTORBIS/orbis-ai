import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { TreeWatcher } from '../search/TreeWatcher';
import { matches, parseQuery, type Candidate, type EvalContext, type ParsedQuery } from '../search/query';
import { isTextLike, readSmallText } from '../search/SearchEngine';
import { extOf } from '../fs/FileSystemService';
import { isWithin } from '../fs/paths';
import { META_EXTS } from '../../shared/media';
import { TERMINAL_STATES, type OperationRecord } from '../../shared/operations';
import { toOrbisError } from '../../shared/errors';
import type { OperationManager } from '../ops/OperationManager';
import type { Catalog } from '../store/Catalog';
import { applyRule, AUTOMATIC_ACTIONS, type Rule, type RulesEngine } from './rules';

/**
 * Rule automation: rules the user opted in run on NEW files that appear in
 * chosen folders, while Orbis Files is open (nothing runs while it is closed or
 * paused, and files that arrived meanwhile are not processed later).
 *
 * Safety, in order:
 *  - only enabled rules with automation switched on, whose exact definition was
 *    applied by hand at least once, and whose action keeps files (move, copy,
 *    tag, add to collection) — checked again right before acting;
 *  - a file is acted on only once it has been stable (same size and
 *    modification time) for `stableMs`, is a regular file (not a link or
 *    folder), is not hidden, does not look like a partial download or a
 *    temporary file (*.crdownload, *.part, *.!qB…), and no partial-download
 *    sibling for it exists (Firefox writes "name" + "name.part");
 *  - loop protection: a file this automation placed somewhere is not processed
 *    again by the same rule, files restored by an undo are left alone, and a
 *    file moved `maxHops` times by automation within `loopWindowMs` is not
 *    touched again;
 *  - rate limit: at most `maxActionsPerMinute` files per rolling minute; the
 *    rest wait (a notice says so) and at most `maxPending` files are tracked;
 *  - moves and copies never replace anything (name conflicts are skipped).
 * Every batch is an operation tagged "automatic" (origin `rule-auto:<id>`),
 * recorded as a rule run that can be undone like a manual run.
 */

export interface AutomationOptions {
  /** How long a file must keep its size and modification time before it is used. */
  stableMs: number;
  /** How often pending files are checked. */
  pollMs: number;
  maxActionsPerMinute: number;
  /** How long loop protection remembers files placed by automation. */
  loopWindowMs: number;
  /** A file moved this many times by automation (within the window) is left alone. */
  maxHops: number;
  /** Files waiting to become stable or to be processed (beyond this, new files are ignored and reported). */
  maxPending: number;
  /** Folders watched per watched folder when a rule includes subfolders. */
  maxWatchedSubfolders: number;
}

export const AUTOMATION_DEFAULTS: AutomationOptions = {
  stableMs: 4000,
  pollMs: 1000,
  maxActionsPerMinute: 30,
  loopWindowMs: 10 * 60_000,
  maxHops: 3,
  maxPending: 5000,
  maxWatchedSubfolders: 500,
};

/** Extensions browsers, download managers and editors use while a file is still being written. */
const PARTIAL_EXTS = new Set(['crdownload', 'part', 'partial', 'download', 'opdownload', '!qb', '!ut', 'aria2', 'tmp', 'temp', 'swp', 'swx', 'filepart', 'crswap', 'dtapart', 'unconfirmed']);
const PARTIAL_PREFIXES = ['.orbis-part-', '.goutputstream-', '~$', '.~lock.', '.#'];
/** Sidecar files that mean "<name> is still being downloaded". */
const SIBLING_SUFFIXES = ['.crdownload', '.part', '.download', '.opdownload', '.!qB', '.!ut', '.aria2', '.filepart'];

/** Whether a file name looks like something still being written (a partial download or temporary file). */
export function isPartialName(name: string): boolean {
  if (PARTIAL_PREFIXES.some((p) => name.startsWith(p))) return true;
  if (/^Unconfirmed \d+\.crdownload$/i.test(name)) return true;
  const dot = name.lastIndexOf('.');
  if (dot > 0 && PARTIAL_EXTS.has(name.slice(dot + 1).toLowerCase())) return true;
  return name.endsWith('~');
}

export interface AutomationActivity {
  ruleId: string;
  ruleName: string;
  runId?: string;
  action: Rule['action']['type'];
  files: string[];
  operationId?: string;
  state: 'started' | 'finished' | 'failed';
  done?: number;
  skipped?: number;
  failed?: number;
  message?: string;
  atMs: number;
}

export interface AutomationStatus {
  paused: boolean;
  rules: Array<{ id: string; name: string; folders: string[]; active: boolean; problem?: string; unavailable: string[] }>;
  watching: string[];
  pending: number;
  limits: { stableMs: number; maxActionsPerMinute: number };
  actionsLastMinute: number;
  /** Set while files wait because of the rate limit. */
  throttled: boolean;
  /** Files that are ready but wait for the rate limit. */
  waiting: number;
}

interface Pending {
  size: number;
  mtimeMs: number;
  stableSince: number;
  lastEventMs: number;
}

export class RuleAutomation extends EventEmitter {
  readonly opts: AutomationOptions;
  private watchers = new Map<string, { w: TreeWatcher; recursive: boolean }>();
  private unavailable = new Set<string>();
  private pending = new Map<string, Pending>();
  private ready: string[] = [];
  private timer: NodeJS.Timeout | undefined;
  private processing = false;
  private actions: number[] = [];
  private throttledNoticeMs = 0;
  private droppedNoticeMs = 0;
  /** Paths placed by automation: which rules put them there and how often the file was moved. */
  private placed = new Map<string, { rules: Set<string>; hops: number; atMs: number }>();
  /** Files already acted on (by identity, size and time), so repeated notifications do not act twice. */
  private handled = new Map<string, { sig: string; atMs: number }>();
  /** Paths that undo operations put back; never processed automatically. */
  private suppressed = new Map<string, number>();
  private runsByOp = new Map<string, { runId: string; rule: Rule; files: string[] }>();
  private stopped = false;
  private readonly onOpUpdate = (rec: OperationRecord) => this.opUpdated(rec);

  constructor(
    private readonly deps: {
      rules: RulesEngine;
      ops: OperationManager;
      catalog: Catalog;
      ctx: () => EvalContext;
      kv: { getKv<T>(k: string, f: T): T; setKv(k: string, v: unknown): void };
      now?: () => number;
    },
    opts: Partial<AutomationOptions> = {},
  ) {
    super();
    this.opts = { ...AUTOMATION_DEFAULTS, ...opts };
    deps.ops.on('update', this.onOpUpdate);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  get paused(): boolean {
    return this.deps.kv.getKv<boolean>('automation.paused', false) === true;
  }

  /** Pause or resume all automation. While paused nothing is watched; files that arrive meanwhile are not processed later. */
  setPaused(paused: boolean): void {
    this.deps.kv.setKv('automation.paused', paused);
    this.refresh();
  }

  /** Rules allowed to run automatically right now. */
  activeRules(): Rule[] {
    return this.deps.rules.list().filter((r) => r.automatic.enabled && AUTOMATIC_ACTIONS.has(r.action.type) && !this.deps.rules.automationProblem(r));
  }

  /** Start or stop folder watchers to match the rules (call after rules change). */
  refresh(): void {
    if (this.stopped) return;
    const want = new Map<string, boolean>();
    if (!this.paused) {
      for (const r of this.activeRules()) for (const f of r.automatic.folders) want.set(f, (want.get(f) ?? false) || r.recursive);
    }
    for (const [dir, w] of this.watchers) {
      if (want.get(dir) !== w.recursive) {
        w.w.close();
        this.watchers.delete(dir);
      }
    }
    this.unavailable.clear();
    for (const [dir, recursive] of want) {
      if (this.watchers.has(dir)) continue;
      const w = new TreeWatcher(dir, (p, ev) => this.onChange(p, ev), { maxDirs: recursive ? this.opts.maxWatchedSubfolders : 1, exclude: (n) => n.startsWith('.') });
      this.watchers.set(dir, { w, recursive });
      void fsp.stat(dir).then(
        (st) => {
          if (!st.isDirectory()) throw new Error('not a folder');
          return w.start();
        },
        () => {
          this.unavailable.add(dir);
          this.emit('changed');
        },
      ).catch(() => {
        this.unavailable.add(dir);
        this.emit('changed');
      });
    }
    if (this.paused || !want.size) {
      this.pending.clear();
      this.ready = [];
    }
    this.emit('changed');
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
    for (const w of this.watchers.values()) w.w.close();
    this.watchers.clear();
    this.pending.clear();
    this.ready = [];
    this.deps.ops.off('update', this.onOpUpdate);
  }

  status(): AutomationStatus {
    const now = this.now();
    this.actions = this.actions.filter((t) => now - t < 60_000);
    const rules = this.deps.rules.list().filter((r) => r.automatic.enabled);
    return {
      paused: this.paused,
      rules: rules.map((r) => {
        const problem = this.deps.rules.automationProblem(r);
        return { id: r.id, name: r.name, folders: r.automatic.folders, active: !problem && !this.paused, problem, unavailable: r.automatic.folders.filter((f) => this.unavailable.has(f)) };
      }),
      watching: [...this.watchers.keys()].filter((d) => !this.unavailable.has(d)),
      pending: this.pending.size + this.ready.length,
      limits: { stableMs: this.opts.stableMs, maxActionsPerMinute: this.opts.maxActionsPerMinute },
      actionsLastMinute: this.actions.length,
      throttled: this.ready.length > 0 && this.actions.length >= this.opts.maxActionsPerMinute,
      waiting: this.ready.length,
    };
  }

  /** Files restored by an undo must not be processed again. */
  suppress(paths: string[]): void {
    const until = this.now() + this.opts.loopWindowMs;
    for (const p of paths) {
      this.suppressed.set(path.resolve(p), until);
      this.pending.delete(path.resolve(p));
    }
  }

  /**
   * A change notification for a path inside a watched folder. Only entries that
   * appear ('rename': created, moved or renamed in) start being tracked; content
   * changes ('change') of a tracked file restart its stability wait, and changes
   * to files that were already there are not "new files".
   */
  onChange(p: string, event: 'rename' | 'change' = 'rename'): void {
    if (this.stopped || this.paused) return;
    const name = path.basename(p);
    if (name.startsWith('.') || isPartialName(name)) return;
    const now = this.now();
    const cur = this.pending.get(p);
    if (cur) cur.lastEventMs = now;
    else if (event === 'rename' && !this.ready.includes(p)) {
      if (this.pending.size + this.ready.length >= this.opts.maxPending) {
        if (now - this.droppedNoticeMs > 60_000) {
          this.droppedNoticeMs = now;
          this.emit('notice', { level: 'warning', message: `Automation is tracking ${this.opts.maxPending.toLocaleString()} new files already; further new files are not processed automatically. Preview the rules to handle them.` });
        }
        return;
      }
      this.pending.set(p, { size: -1, mtimeMs: -1, stableSince: now, lastEventMs: now });
    }
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.tick(), this.opts.pollMs);
    this.timer.unref?.();
  }

  /** Check pending files for stability, then process the ready ones. Exposed for tests. */
  async tick(): Promise<void> {
    const now = this.now();
    for (const [p, info] of [...this.pending]) {
      const st = await fsp.lstat(p).catch(() => undefined);
      if (!st || !st.isFile()) {
        this.pending.delete(p); // gone, a folder, a link or a special file: never acted on
        continue;
      }
      if (st.size !== info.size || st.mtimeMs !== info.mtimeMs) {
        info.size = st.size;
        info.mtimeMs = st.mtimeMs;
        info.stableSince = now;
        continue;
      }
      if (now - info.stableSince < this.opts.stableMs || now - info.lastEventMs < this.opts.stableMs) continue;
      if (await this.hasPartialSibling(p)) {
        info.stableSince = now;
        continue;
      }
      this.pending.delete(p);
      this.ready.push(p);
    }
    if (this.ready.length) await this.processReady();
    if (!this.pending.size && !this.ready.length && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.prune(now);
  }

  private async hasPartialSibling(p: string): Promise<boolean> {
    for (const s of SIBLING_SUFFIXES) if (await fsp.lstat(p + s).then(() => true, () => false)) return true;
    return false;
  }

  private prune(now: number): void {
    for (const [p, v] of this.placed) if (now - v.atMs > this.opts.loopWindowMs) this.placed.delete(p);
    for (const [p, until] of this.suppressed) if (now > until) this.suppressed.delete(p);
    for (const [p, v] of this.handled) if (now - v.atMs > this.opts.loopWindowMs) this.handled.delete(p);
  }

  private ruleCovers(rule: Rule, file: string): boolean {
    const parent = path.dirname(file);
    return rule.automatic.folders.some((f) => parent === f || (rule.recursive && isWithin(f, file)));
  }

  private async processReady(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      if (this.paused) {
        this.ready = [];
        return;
      }
      const now = this.now();
      this.actions = this.actions.filter((t) => now - t < 60_000);
      const rules = this.activeRules();
      const parsed = new Map<string, { cond: ParsedQuery; excl?: ParsedQuery }>();
      for (const r of rules) {
        try {
          parsed.set(r.id, { cond: parseQuery(r.condition), excl: r.exclusion ? parseQuery(r.exclusion) : undefined });
        } catch {
          /* an invalid stored query never matches */
        }
      }
      const batches = new Map<string, { rule: Rule; files: string[] }>();
      const waiting: string[] = [];
      const ctx = this.deps.ctx();
      for (const file of this.ready) {
        if (this.suppressed.has(file)) continue;
        const placed = this.placed.get(file);
        if (placed && placed.hops >= this.opts.maxHops) continue;
        const st = await fsp.lstat(file).catch(() => undefined);
        if (!st?.isFile()) continue;
        const sig = `${st.ino}:${st.size}:${st.mtimeMs}`;
        if (this.handled.get(file)?.sig === sig) continue; // already handled (late notifications for the same file)
        const name = path.basename(file);
        const cand: Candidate = { path: file, name, ext: extOf(name), kind: 'file', size: st.size, modifiedMs: st.mtimeMs, createdMs: st.birthtimeMs > 0 ? st.birthtimeMs : undefined };
        let rule: Rule | undefined;
        for (const r of rules) {
          const q = parsed.get(r.id);
          if (!q || !this.ruleCovers(r, file)) continue;
          if (placed?.rules.has(r.id)) continue; // this rule put the file here: never again
          if ((r.action.type === 'move' || r.action.type === 'copy') && (isWithin(r.action.toDir, file) || path.dirname(file) === path.resolve(r.action.toDir))) continue;
          if ((q.cond.usesMeta || q.excl?.usesMeta) && META_EXTS.has(cand.ext)) cand.meta = await ctx.metaLookup?.(file).catch(() => undefined);
          if ((q.cond.usesContent || q.excl?.usesContent) && cand.content === undefined) cand.content = isTextLike(cand.ext) ? await readSmallText(file) : null;
          if (!matches(q.cond, cand, ctx)) continue;
          if (q.excl && matches(q.excl, cand, ctx)) continue;
          rule = r;
          break;
        }
        if (!rule) continue;
        if (this.actions.length >= this.opts.maxActionsPerMinute) {
          waiting.push(file);
          continue;
        }
        this.actions.push(now);
        this.handled.set(file, { sig, atMs: now });
        const b = batches.get(rule.id) ?? { rule, files: [] };
        b.files.push(file);
        batches.set(rule.id, b);
      }
      this.ready = waiting;
      if (waiting.length && now - this.throttledNoticeMs > 60_000) {
        this.throttledNoticeMs = now;
        this.emit('notice', { level: 'warning', message: `Automation reached its limit of ${this.opts.maxActionsPerMinute} files per minute. ${waiting.length} file${waiting.length === 1 ? ' waits' : 's wait'} and will be handled when the limit allows.` });
      }
      for (const { rule, files } of batches.values()) await this.runBatch(rule, files);
      this.emit('changed');
    } finally {
      this.processing = false;
    }
  }

  private async runBatch(rule: Rule, files: string[]): Promise<void> {
    // Checked again right before acting: the rule may have changed since the files were matched.
    const fresh = this.deps.rules.list().find((r) => r.id === rule.id);
    if (!fresh || this.deps.rules.automationProblem(fresh) || !fresh.automatic.enabled) return;
    const base: Omit<AutomationActivity, 'state' | 'atMs'> = { ruleId: rule.id, ruleName: rule.name, action: rule.action.type, files };
    if (rule.action.type === 'move' || rule.action.type === 'copy') {
      const now = this.now();
      for (const f of files) {
        const dest = path.join(path.resolve(rule.action.toDir), path.basename(f));
        const prev = this.placed.get(f);
        const entry = this.placed.get(dest) ?? { rules: new Set<string>(), hops: 0, atMs: now };
        entry.rules.add(rule.id);
        for (const id of prev?.rules ?? []) entry.rules.add(id);
        entry.hops = Math.max(entry.hops, (prev?.hops ?? 0) + 1);
        entry.atMs = now;
        this.placed.set(dest, entry);
        this.pending.delete(dest);
      }
    }
    try {
      const r = await applyRule({ rules: this.deps.rules, ops: this.deps.ops, catalog: this.deps.catalog }, fresh, files, { automatic: true });
      if (r.operationId && r.runId) {
        this.runsByOp.set(r.operationId, { runId: r.runId, rule: fresh, files });
        const rec = this.deps.ops.get(r.operationId);
        this.emit('activity', { ...base, runId: r.runId, operationId: r.operationId, state: 'started', atMs: this.now() } satisfies AutomationActivity);
        if (rec && TERMINAL_STATES.has(rec.state)) this.opUpdated(rec);
      } else {
        this.emit('activity', { ...base, runId: r.runId, state: 'finished', done: r.applied, skipped: 0, failed: r.failed.length, atMs: this.now() } satisfies AutomationActivity);
      }
    } catch (err) {
      this.emit('activity', { ...base, state: 'failed', message: toOrbisError(err, 'rules.auto').message, atMs: this.now() } satisfies AutomationActivity);
    }
  }

  private opUpdated(rec: OperationRecord): void {
    // Items an undo puts back must not be picked up again.
    if (/^(rule-undo|undo):/.test(rec.origin) && rec.state === 'queued' && rec.type === 'move' && rec.destination) {
      this.suppress(rec.sources.map((s) => path.join(rec.destination!, path.basename(s))));
    }
    const run = this.runsByOp.get(rec.id);
    if (!run || !TERMINAL_STATES.has(rec.state)) return;
    this.runsByOp.delete(rec.id);
    const s = rec.summary ?? { done: 0, skipped: 0, failed: 0, cancelled: 0 };
    this.deps.rules.updateRun(run.runId, { outcome: { state: rec.state, done: s.done, skipped: s.skipped, failed: s.failed + s.cancelled, finishedMs: rec.finishedMs ?? this.now() } });
    this.emit('activity', {
      ruleId: run.rule.id, ruleName: run.rule.name, runId: run.runId, action: run.rule.action.type, files: run.files, operationId: rec.id,
      state: rec.state === 'failed' ? 'failed' : 'finished', done: s.done, skipped: s.skipped, failed: s.failed + s.cancelled, message: rec.error?.message, atMs: this.now(),
    } satisfies AutomationActivity);
  }
}
