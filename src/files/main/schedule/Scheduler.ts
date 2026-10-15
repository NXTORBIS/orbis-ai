import { EventEmitter } from 'node:events';
import { nextOccurrence, type Schedule, type ScheduledTaskStatus, type ScheduleStatus } from '../../shared/schedule';

/**
 * A small, generic scheduler for work that runs while Orbis Files is open.
 *
 * - Schedules: every N hours, daily at a time, weekly on a day at a time, when
 *   the app starts, or manual (never by itself).
 * - A task is due when its next occurrence after its last run (or, when it never
 *   ran, after the moment it was scheduled) has passed.
 * - Missed runs (the app was closed, the computer slept, schedules were paused)
 *   are caught up ONCE at start / resume when the schedule allows it; otherwise
 *   they are skipped and the next future occurrence is used.
 * - Never two runs of the same task at once: a task whose previous run (or a
 *   manual run, reported by `isBusy`) has not finished is not started again.
 * - "Pause all schedules" stops every automatic start; running work continues.
 *
 * The clock and timers are injectable so tests can drive it deterministically.
 */

export interface SchedulerTask {
  /** Unique id, e.g. "backup:<jobId>" or "sync:<pairId>". */
  id: string;
  kind: 'backup' | 'sync';
  targetId: string;
  label: string;
  schedule: Schedule;
  /** When the schedule was set (the anchor for a task that never ran). */
  sinceMs: number;
  /** Start of the last run (scheduled or manual). */
  lastRunMs?: number;
  /** Starts the work and resolves when it has finished (or failed). */
  run(): Promise<unknown>;
  /** True while the work runs outside the scheduler (e.g. "Run now"). */
  isBusy?(): boolean;
}

export interface SchedulerOptions {
  now?: () => number;
  /** Arm real timers (the app). Tests leave this off and call tick(). */
  timers?: boolean;
  /** Longest sleep between checks, so clock changes and sleep/wake are noticed. */
  maxSleepMs?: number;
  paused?: boolean;
  /** Persist the start time of a scheduled run. */
  onRunStart?(task: SchedulerTask, ms: number): void;
  onPausedChange?(paused: boolean): void;
  onError?(task: SchedulerTask, err: unknown): void;
}

interface Entry {
  task: SchedulerTask;
  /** A missed occurrence that was skipped (no catch-up): the next one is counted from here. */
  skipAnchorMs?: number;
  running: boolean;
  startupDone: boolean;
}

export class Scheduler extends EventEmitter {
  private entries = new Map<string, Entry>();
  private started = false;
  private pausedState: boolean;
  private timer: NodeJS.Timeout | undefined;
  private readonly now: () => number;

  constructor(private readonly opts: SchedulerOptions = {}) {
    super();
    this.now = opts.now ?? Date.now;
    this.pausedState = !!opts.paused;
  }

  get paused(): boolean {
    return this.pausedState;
  }

  /** Add or replace a task (keeps its in-memory state when only details changed). */
  upsert(task: SchedulerTask): void {
    const prev = this.entries.get(task.id);
    const sameSchedule = prev && JSON.stringify(prev.task.schedule) === JSON.stringify(task.schedule);
    this.entries.set(task.id, {
      task,
      running: prev?.running ?? false,
      skipAnchorMs: sameSchedule ? prev?.skipAnchorMs : undefined,
      startupDone: prev?.startupDone ?? this.started,
    });
    this.changed();
  }

  remove(id: string): void {
    if (this.entries.delete(id)) this.changed();
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Record a run started outside the scheduler ("Run now"), so interval schedules count from it. */
  noteRun(id: string, ms = this.now()): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.task = { ...e.task, lastRunMs: ms };
    this.changed();
  }

  /** The next time the task will start by itself (undefined: manual, already ran at start, or paused). */
  nextRun(id: string): number | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    return this.nextFor(e);
  }

  private nextFor(e: Entry): number | undefined {
    const s = e.task.schedule;
    if (s.kind === 'manual') return undefined;
    if (s.kind === 'startup') return e.startupDone ? undefined : this.now();
    const after = Math.max(e.task.lastRunMs ?? e.task.sinceMs, e.skipAnchorMs ?? -Infinity);
    return nextOccurrence(s, after);
  }

  status(): ScheduleStatus {
    const tasks: ScheduledTaskStatus[] = [...this.entries.values()].map((e) => ({
      id: e.task.id,
      kind: e.task.kind,
      targetId: e.task.targetId,
      label: e.task.label,
      schedule: e.task.schedule,
      nextRunMs: this.pausedState ? undefined : this.nextFor(e),
      lastRunMs: e.task.lastRunMs,
      running: e.running || !!e.task.isBusy?.(),
    }));
    return { paused: this.pausedState, tasks };
  }

  /**
   * Start scheduling (app start): "on start" tasks run, and tasks that missed a
   * run while the app was closed run once (catch-up) or skip to the next time.
   * Resolves when the runs started now have finished.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const runs: Array<Promise<void>> = [];
    if (!this.pausedState) runs.push(...this.catchUpPass(true));
    for (const e of this.entries.values()) e.startupDone = true;
    this.arm();
    this.changed();
    await Promise.all(runs);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  setPaused(paused: boolean): Promise<void> {
    if (paused === this.pausedState) return Promise.resolve();
    this.pausedState = paused;
    this.opts.onPausedChange?.(paused);
    let runs: Array<Promise<void>> = [];
    // Resuming: occurrences that passed while paused are caught up once, or skipped.
    if (!paused && this.started) runs = this.catchUpPass(false);
    this.arm();
    this.changed();
    return Promise.all(runs).then(() => undefined);
  }

  /** Run every due task. Resolves when the runs it started have finished. */
  async tick(): Promise<void> {
    if (!this.started || this.pausedState) return;
    const now = this.now();
    const runs: Array<Promise<void>> = [];
    for (const e of this.entries.values()) {
      const s = e.task.schedule;
      if (s.kind === 'manual' || s.kind === 'startup') continue;
      const next = this.nextFor(e);
      if (next !== undefined && next <= now) runs.push(this.runEntry(e));
    }
    this.arm();
    await Promise.all(runs);
  }

  private catchUpPass(atStart: boolean): Array<Promise<void>> {
    const now = this.now();
    const runs: Array<Promise<void>> = [];
    for (const e of this.entries.values()) {
      const s = e.task.schedule;
      if (s.kind === 'manual') continue;
      if (s.kind === 'startup') {
        if (atStart && !e.startupDone) runs.push(this.runEntry(e));
        continue;
      }
      const next = this.nextFor(e);
      if (next === undefined || next > now) continue;
      if (s.catchUp) runs.push(this.runEntry(e));
      else e.skipAnchorMs = now; // missed: wait for the next occurrence
    }
    return runs;
  }

  private async runEntry(e: Entry): Promise<void> {
    if (e.running || e.task.isBusy?.()) return; // never two runs of the same task at once
    const ms = this.now();
    e.running = true;
    e.startupDone = true;
    e.task = { ...e.task, lastRunMs: ms };
    e.skipAnchorMs = undefined;
    this.opts.onRunStart?.(e.task, ms);
    this.changed();
    this.emit('run', { id: e.task.id, kind: e.task.kind, targetId: e.task.targetId, ms });
    try {
      await e.task.run();
    } catch (err) {
      this.opts.onError?.(e.task, err);
    } finally {
      e.running = false;
      this.arm();
      this.changed();
    }
  }

  private arm(): void {
    if (!this.opts.timers || !this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pausedState) return;
    const now = this.now();
    let soonest = Infinity;
    for (const e of this.entries.values()) {
      if (e.running) continue;
      const k = e.task.schedule.kind;
      if (k === 'manual' || k === 'startup') continue;
      const n = this.nextFor(e);
      if (n !== undefined) soonest = Math.min(soonest, n);
    }
    if (soonest === Infinity) return;
    const delay = Math.max(1000, Math.min(soonest - now, this.opts.maxSleepMs ?? 60_000));
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref?.();
  }

  private changed(): void {
    this.emit('changed', this.status());
  }
}
