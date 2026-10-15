import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { makeError } from '../../shared/errors';
import { TERMINAL_STATES, type OperationRecord } from '../../shared/operations';
import { describeSchedule, MANUAL_SCHEDULE, ScheduleSchema, type Schedule } from '../../shared/schedule';
import type { SyncPair, SyncPlan } from '../../shared/sync';
import type { AppDatabase } from '../store/Database';
import type { OperationManager } from '../ops/OperationManager';
import type { Scheduler } from '../schedule/Scheduler';
import type { SyncService } from './SyncService';

/**
 * "Run on schedule" for saved sync pairs (schema v8: sync_schedules).
 *
 * Safety rules for unattended runs:
 *  - The first run must be previewed and approved by the user. The approval is
 *    a fingerprint of the pair's folders, mode and options; editing any of them
 *    needs a new approval. A scheduled run without a matching approval does
 *    nothing and says so.
 *  - Each scheduled run previews first. It stops (changes nothing) and notifies
 *    when the plan has conflicts, would move more items to the Trash than the
 *    pair's limit, could not read every location, or needs the Trash where it
 *    is not available. Otherwise it runs exactly that plan as a 'sync' operation.
 */

export interface SyncScheduleResult {
  ms: number;
  outcome: 'synced' | 'nothing' | 'stopped' | 'needs-approval' | 'failed';
  message: string;
  operationId?: string;
}

export interface SyncScheduleInfo {
  pairId: string;
  schedule: Schedule;
  maxDeletes: number;
  approvedMs?: number;
  /** The pair (folders, mode, options) differs from what was approved, or was never approved. */
  needsApproval: boolean;
  lastRunMs?: number;
  lastResult?: SyncScheduleResult;
  nextRunMs?: number;
  running: boolean;
}

interface Row {
  pair_id: string;
  schedule: string;
  since_ms: number;
  max_deletes: number;
  approved: string | null;
  last_run_ms: number | null;
  last_result: string | null;
}

export interface SyncScheduleEvent {
  pairId: string;
  pairName: string;
  level: 'success' | 'info' | 'warning' | 'error';
  outcome: SyncScheduleResult['outcome'];
  message: string;
}

/** The fingerprint a scheduled run must match: folders, mode and every option. */
export function pairSignature(p: Pick<SyncPair, 'left' | 'right' | 'mode' | 'options'>): string {
  return crypto.createHash('sha256').update(JSON.stringify({ left: p.left, right: p.right, mode: p.mode, options: p.options })).digest('hex');
}

/** Items a plan moves to the Trash as deletions (a folder counts with everything inside it). */
export function plannedDeletions(plan: SyncPlan): number {
  const shown = plan.actions.filter((a) => a.action === 'delete');
  return shown.reduce((n, a) => n + 1 + (a.items ?? 0), 0) + Math.max(0, plan.groups.delete.count - shown.length);
}

export class SyncSchedules extends EventEmitter {
  private running = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly deps: { db: AppDatabase; sync: SyncService; ops: OperationManager; scheduler?: Scheduler; now?: () => number }) {
    super();
    this.now = deps.now ?? Date.now;
  }

  private row(pairId: string): Row | undefined {
    return this.deps.db.get<Row>('SELECT * FROM sync_schedules WHERE pair_id = ?', [pairId]);
  }

  private info(r: Row): SyncScheduleInfo {
    const sch = ScheduleSchema.safeParse(safeJson(r.schedule));
    const approved = safeJson(r.approved) as { signature?: string; ms?: number } | undefined;
    const pair = this.deps.sync.store.pair(r.pair_id);
    return {
      pairId: r.pair_id, schedule: sch.success ? sch.data : MANUAL_SCHEDULE, maxDeletes: r.max_deletes, approvedMs: approved?.ms,
      needsApproval: !pair || approved?.signature !== pairSignature(pair),
      lastRunMs: r.last_run_ms ?? undefined, lastResult: safeJson(r.last_result) as SyncScheduleResult | undefined,
      nextRunMs: this.deps.scheduler?.nextRun(`sync:${r.pair_id}`), running: this.running.has(r.pair_id),
    };
  }

  list(): SyncScheduleInfo[] {
    return this.deps.db.all<Row>('SELECT * FROM sync_schedules').map((r) => this.info(r));
  }

  get(pairId: string): SyncScheduleInfo | undefined {
    const r = this.row(pairId);
    return r ? this.info(r) : undefined;
  }

  /** Set (or with a manual schedule, remove) a pair's schedule. Keeps an existing approval. */
  set(pairId: string, schedule: Schedule, maxDeletes: number): SyncScheduleInfo | undefined {
    const pair = this.deps.sync.store.pair(pairId);
    if (!pair) throw makeError('not_found', 'sync.schedule', { message: 'This sync pair no longer exists.' });
    if (schedule.kind === 'manual') {
      this.remove(pairId);
      return undefined;
    }
    const prev = this.row(pairId);
    const t = this.now();
    const since = prev && prev.schedule === JSON.stringify(schedule) ? prev.since_ms : t;
    this.deps.db.run(
      'INSERT INTO sync_schedules(pair_id, schedule, since_ms, max_deletes, updated_ms) VALUES(?, ?, ?, ?, ?) ON CONFLICT(pair_id) DO UPDATE SET schedule = excluded.schedule, since_ms = excluded.since_ms, max_deletes = excluded.max_deletes, updated_ms = excluded.updated_ms',
      [pairId, JSON.stringify(schedule), since, maxDeletes, t],
    );
    this.register(pairId);
    this.emit('changed');
    return this.get(pairId);
  }

  remove(pairId: string): void {
    this.deps.db.run('DELETE FROM sync_schedules WHERE pair_id = ?', [pairId]);
    this.deps.scheduler?.remove(`sync:${pairId}`);
    this.emit('changed');
  }

  /**
   * Record the user's approval of a previewed plan for scheduled runs. The plan
   * must describe the pair exactly as saved (same folders, mode and options).
   */
  approve(pairId: string, plan: { left: string; right: string; mode: string; options: unknown }): void {
    const pair = this.deps.sync.store.pair(pairId);
    const r = this.row(pairId);
    if (!pair || !r) throw makeError('validation', 'sync.approve', { message: 'This pair has no schedule to approve.' });
    const same = samePath(pair.left, plan.left) && samePath(pair.right, plan.right) && pair.mode === plan.mode && JSON.stringify(pair.options) === JSON.stringify(plan.options);
    if (!same) throw makeError('validation', 'sync.approve', { message: 'The preview does not match the saved pair (folders, mode or options differ). Preview the saved pair again to approve it.' });
    this.deps.db.run('UPDATE sync_schedules SET approved = ? WHERE pair_id = ?', [JSON.stringify({ signature: pairSignature(pair), ms: this.now() }), pairId]);
    this.emit('changed');
  }

  registerAll(): void {
    for (const r of this.deps.db.all<Row>('SELECT * FROM sync_schedules')) this.register(r.pair_id);
  }

  /** Register (or update) a pair's scheduled task, e.g. after the pair was edited. */
  refresh(pairId: string): void {
    this.register(pairId);
    this.emit('changed');
  }

  private register(pairId: string): void {
    const sch = this.deps.scheduler;
    const r = this.row(pairId);
    const pair = this.deps.sync.store.pair(pairId);
    if (!sch) return;
    if (!r || !pair) {
      sch.remove(`sync:${pairId}`);
      return;
    }
    const info = this.info(r);
    if (info.schedule.kind === 'manual') return;
    sch.upsert({
      id: `sync:${pairId}`, kind: 'sync', targetId: pairId, label: pair.name, schedule: info.schedule, sinceMs: r.since_ms, lastRunMs: r.last_run_ms ?? undefined,
      isBusy: () => this.running.has(pairId) || this.deps.ops.list().some((o) => o.type === 'sync' && !TERMINAL_STATES.has(o.state) && o.origin.endsWith(`:${pairId}`)),
      run: () => this.runScheduled(pairId),
    });
  }

  /** One scheduled run: approval check → preview → safety checks → synchronize exactly that plan. */
  async runScheduled(pairId: string): Promise<SyncScheduleResult | undefined> {
    const pair = this.deps.sync.store.pair(pairId);
    const r = this.row(pairId);
    if (!pair || !r) {
      this.remove(pairId);
      return undefined;
    }
    if (this.running.has(pairId)) return undefined;
    this.running.add(pairId);
    this.deps.db.run('UPDATE sync_schedules SET last_run_ms = ? WHERE pair_id = ?', [this.now(), pairId]);
    this.emit('changed');
    let result: SyncScheduleResult;
    try {
      result = await this.attempt(pair, this.info(r));
    } catch (err) {
      result = { ms: this.now(), outcome: 'failed', message: `Could not run: ${(err as Error).message}` };
    } finally {
      this.running.delete(pairId);
    }
    this.deps.db.run('UPDATE sync_schedules SET last_result = ? WHERE pair_id = ?', [JSON.stringify(result), pairId]);
    const level: SyncScheduleEvent['level'] = result.outcome === 'synced' ? 'success' : result.outcome === 'nothing' ? 'info' : result.outcome === 'failed' ? 'error' : 'warning';
    this.emit('activity', { pairId, pairName: pair.name, level, outcome: result.outcome, message: result.message } satisfies SyncScheduleEvent);
    this.emit('changed');
    return result;
  }

  private async attempt(pair: SyncPair, info: SyncScheduleInfo): Promise<SyncScheduleResult> {
    const t = () => this.now();
    if (info.needsApproval) {
      return { ms: t(), outcome: 'needs-approval', message: info.approvedMs ? 'The pair was changed after you approved it. Preview it and approve the new settings; nothing was synchronized.' : 'The first scheduled run needs your approval. Preview the pair and approve it; nothing was synchronized.' };
    }
    const plan = await this.deps.sync.preview({ left: pair.left, right: pair.right, mode: pair.mode, options: pair.options, pairId: pair.id }, new AbortController().signal);
    const conflicts = plan.groups.conflict.count;
    const deletions = plannedDeletions(plan);
    const stop = (why: string): SyncScheduleResult => ({ ms: t(), outcome: 'stopped', message: `Stopped before changing anything: ${why} Open Synchronize to review it.` });
    if (!plan.complete) return stop(`${plan.unreadable.length} location(s) could not be read.`);
    if (conflicts) return stop(`${conflicts} conflict(s) need your decision.`);
    if (deletions > info.maxDeletes) return stop(`it would move ${deletions} item(s) to the Trash, more than the limit of ${info.maxDeletes}.`);
    if (!plan.trashAvailable && (plan.groups.delete.count || (plan.options.trashReplaced && plan.groups.update.count))) return stop('it deletes or replaces items and the Trash is not available.');
    if (!plan.actions.length) return { ms: t(), outcome: 'nothing', message: 'Already in sync; nothing to do.' };
    const rec = this.deps.sync.run(plan.planId, [], pair.id, `sync-schedule:${pair.id}`);
    const done = await new Promise<OperationRecord>((resolve) => {
      const check = (x: OperationRecord) => {
        if (x.id !== rec.id || !TERMINAL_STATES.has(x.state)) return;
        this.deps.ops.off('update', check);
        resolve(x);
      };
      this.deps.ops.on('update', check);
      const cur = this.deps.ops.get(rec.id);
      if (cur && TERMINAL_STATES.has(cur.state)) check(cur);
    });
    const s = done.summary ?? { done: 0, skipped: 0, failed: 0, cancelled: 0 };
    if (done.state === 'completed') return { ms: t(), outcome: 'synced', operationId: rec.id, message: `${s.done} item(s) synchronized${deletions ? `, ${deletions} moved to the Trash` : ''}.` };
    return { ms: t(), outcome: 'failed', operationId: rec.id, message: `${done.state.replace(/_/g, ' ')}: ${s.done} done, ${s.failed} failed${done.error ? ` (${done.error.message})` : ''}.` };
  }

  describe(pairId: string): string {
    const i = this.get(pairId);
    return i ? describeSchedule(i.schedule) : 'Not scheduled';
  }
}

function safeJson(s: string | null): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function samePath(saved: string, other: string): boolean {
  if (saved === other) return true;
  try {
    return fs.realpathSync.native(saved) === fs.realpathSync.native(other);
  } catch {
    return false;
  }
}
