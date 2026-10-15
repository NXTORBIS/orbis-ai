import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { makeError } from '../../shared/errors';
import { TERMINAL_STATES, type OperationRecord } from '../../shared/operations';
import {
  SYNC_PLAN_ROWS_MAX,
  type ConflictChoice,
  type SyncAction,
  type SyncActionKind,
  type SyncMode,
  type SyncOptions,
  type SyncPair,
  type SyncPlan,
} from '../../shared/sync';
import type { OperationManager, PlatformOps } from '../ops/OperationManager';
import { requireAbsolute } from '../fs/paths';
import type { JobGate } from '../jobs/PauseGate';
import { computePlan, HashCache, type PlanResult } from './engine';
import { makeSyncRunner, type RunStats, type StoredPlan } from './runner';
import { SyncStore } from './SyncStore';

/** Previews kept for "Synchronize" (and Retry) in this session. */
const PLAN_TTL_MS = 60 * 60 * 1000;
const PLANS_MAX = 8;

/**
 * Folder synchronization: saved pairs, previews (plans) and starting the
 * 'sync' operation. Every change runs as an operation in the shared
 * OperationManager (queue, progress, pause, cancel, per-item results).
 */
export class SyncService {
  private plans = new Map<string, StoredPlan>();
  private runs = new Map<string, { pairId?: string; stats: RunStats }>();

  constructor(
    readonly store: SyncStore,
    private readonly ops: OperationManager,
    private readonly platform: PlatformOps,
    private readonly now: () => number = Date.now,
  ) {
    ops.registerRunner('sync', makeSyncRunner({
      getPlan: (id) => this.getPlan(id),
      baseline: (l, r) => store.baseline(l, r),
      saveBaseline: (l, r, rows) => store.saveBaseline(l, r, rows),
      platform,
      markRunning: (rec) => ops.markRunning(rec),
      track: (id, t) => this.runs.set(id, t),
    }));
    ops.on('update', (rec: OperationRecord) => {
      if (rec.type !== 'sync' || !TERMINAL_STATES.has(rec.state)) return;
      const run = this.runs.get(rec.id);
      this.runs.delete(rec.id);
      if (!run?.pairId || !store.pair(run.pairId)) return;
      const s = rec.summary ?? { done: 0, skipped: 0, failed: 0, cancelled: 0 };
      store.recordRun(run.pairId, { state: rec.state, finishedMs: rec.finishedMs ?? this.now(), ...s, changedSincePreview: run.stats.changedSincePreview });
    });
  }

  // ---------------- pairs

  pairs(): SyncPair[] {
    return this.store.pairs();
  }

  savePair(input: { id?: string; name: string; left: string; right: string; mode: SyncMode; options: SyncOptions }): SyncPair {
    const left = requireAbsolute(input.left, 'sync.savePair');
    const right = requireAbsolute(input.right, 'sync.savePair');
    if (left === right) throw makeError('validation', 'sync.savePair', { message: 'Choose two different folders.' });
    return this.store.savePair({ ...input, name: input.name.trim(), left, right });
  }

  deletePair(id: string): void {
    this.store.deletePair(id);
  }

  async forgetBaseline(left: string, right: string): Promise<{ forgotten: boolean }> {
    const [l, r] = await Promise.all([real(requireAbsolute(left, 'sync.forget')), real(requireAbsolute(right, 'sync.forget'))]);
    return { forgotten: this.store.forgetBaseline(l, r) };
  }

  // ---------------- preview and run

  getPlan(planId: string): StoredPlan | undefined {
    const p = this.plans.get(planId);
    if (p && this.now() - p.createdMs > PLAN_TTL_MS) {
      this.plans.delete(planId);
      return undefined;
    }
    return p;
  }

  async preview(
    input: { left: string; right: string; mode: SyncMode; options: SyncOptions; pairId?: string },
    signal: AbortSignal,
    onProgress?: (p: unknown) => void,
    gate?: JobGate,
  ): Promise<SyncPlan> {
    const checkpoint = async () => {
      if (gate?.isPaused) await gate.wait();
      if (signal.aborted) throw makeError('cancelled', 'sync.preview');
    };
    const left = requireAbsolute(input.left, 'sync.preview');
    const right = requireAbsolute(input.right, 'sync.preview');
    const [l, r] = await Promise.all([real(left), real(right)]);
    const baseline = input.mode === 'two-way' ? this.store.baseline(l, r) : undefined;
    const result = await computePlan({ left, right, mode: input.mode, options: input.options, baseline, checkpoint, signal, hashes: new HashCache(), onProgress });
    const planId = crypto.randomUUID();
    this.plans.set(planId, { planId, pairId: input.pairId, createdMs: this.now(), result });
    while (this.plans.size > PLANS_MAX) this.plans.delete(this.plans.keys().next().value!);
    return this.toPublic(planId, input.pairId, result, baseline ? { entries: baseline.rows.length, updatedMs: baseline.updatedMs } : undefined);
  }

  /**
   * Start synchronizing a previewed plan. Conflicts without a decision are skipped.
   * `pairId`: a pair saved after the preview was made; the run is recorded on it
   * when it describes the same folders and mode as the preview.
   */
  run(planId: string, decisions: Array<{ id: number; choice: ConflictChoice }>, pairId?: string, origin?: string): OperationRecord {
    const stored = this.getPlan(planId);
    if (!stored) throw makeError('validation', 'sync.run', { message: 'This preview is no longer available. Preview again.' });
    const byId = new Map(stored.result.actions.map((a) => [a.id, a]));
    for (const d of decisions) {
      const a = byId.get(d.id);
      if (!a || a.action !== 'conflict') throw makeError('validation', 'sync.run', { message: 'A decision refers to an item that is not a conflict in this preview.' });
      if (!a.choices?.includes(d.choice)) throw makeError('validation', 'sync.run', { message: `“${a.rel}” cannot be resolved that way.`, target: a.rel });
    }
    const willRemove = stored.result.actions.some((a) => a.action === 'delete' || (a.action === 'update' && stored.result.options.trashReplaced));
    if (willRemove && !this.platform.trashSupported) {
      throw makeError('unsupported', 'sync.run', { message: 'This synchronization deletes or replaces items, which go to the Trash, and the Trash is not available here. Nothing was changed.' });
    }
    const later = pairId ? this.store.pair(pairId) : undefined;
    const runPair = later && samePath(later.left, stored.result.left) && samePath(later.right, stored.result.right) && later.mode === stored.result.mode ? later.id : stored.pairId;
    return this.ops.start({
      type: 'sync',
      sources: [stored.result.left],
      destination: stored.result.right,
      origin: origin ?? (runPair ? `sync:${runPair}` : 'sync'),
      params: { planId, pairId: runPair, decisions },
    });
  }

  private toPublic(planId: string, pairId: string | undefined, r: PlanResult, baseline: SyncPlan['baseline']): SyncPlan {
    const groups: SyncPlan['groups'] = { copy: { count: 0, bytes: 0 }, update: { count: 0, bytes: 0 }, delete: { count: 0, bytes: 0 }, conflict: { count: 0, bytes: 0 } };
    for (const a of r.actions) {
      groups[a.action as SyncActionKind].count++;
      groups[a.action as SyncActionKind].bytes += a.bytes;
    }
    const actions: SyncAction[] = r.actions.slice(0, SYNC_PLAN_ROWS_MAX).map((a) => ({
      id: a.id, rel: a.rel, kind: a.kind, action: a.action, to: a.to, reason: a.reason, bytes: a.bytes, items: a.items,
      left: a.left, right: a.right, conflict: a.conflict, choices: a.choices,
    }));
    const notes = [...r.notes];
    const removes = groups.delete.count + (r.options.trashReplaced ? groups.update.count : 0);
    if (removes && !this.platform.trashSupported) notes.unshift('The Trash is not available here. This synchronization deletes or replaces items, so it cannot run.');
    return {
      planId, pairId, left: r.left, right: r.right, mode: r.mode, options: r.options, createdMs: this.now(), actions, truncated: r.actions.length > actions.length, groups,
      inSync: r.inSync.length, excluded: r.leftScan.excluded + r.rightScan.excluded, symlinksSkipped: r.leftScan.symlinksSkipped + r.rightScan.symlinksSkipped,
      specialSkipped: r.leftScan.special + r.rightScan.special, extraKept: r.extraKept, notCompared: r.notCompared,
      unreadable: [...r.leftScan.errors, ...r.rightScan.errors].slice(0, 200),
      complete: !r.leftScan.errors.length && !r.rightScan.errors.length,
      caseInsensitive: r.caseInsensitive, baseline, trashAvailable: this.platform.trashSupported, notes,
    };
  }
}

/** `saved` (as the user typed it) names the folder `resolved` (the real path a preview works on). */
function samePath(saved: string, resolved: string): boolean {
  if (saved === resolved) return true;
  try {
    return fs.realpathSync.native(saved) === resolved;
  } catch {
    return false;
  }
}

async function real(p: string): Promise<string> {
  return fsp.realpath(p).catch(() => p);
}
