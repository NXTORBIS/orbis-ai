import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { makeError } from '../../shared/errors';
import {
  BackupJobInputSchema,
  BackupOptionsSchema,
  RetentionSchema,
  type BackupActivity,
  type BackupJob,
  type BackupJobInput,
  type BackupRunResult,
  type BrowseEntry,
  type FileVersionRow,
  type ManifestEntry,
  type StorageMode,
  type VerifyResult,
  type VersionInfo,
  type VersionManifest,
} from '../../shared/backup';
import { describeSchedule, MANUAL_SCHEDULE, ScheduleSchema, type Schedule } from '../../shared/schedule';
import { TERMINAL_STATES, type OperationRecord } from '../../shared/operations';
import type { AppDatabase } from '../store/Database';
import type { OperationManager, PlatformOps } from '../ops/OperationManager';
import type { Scheduler } from '../schedule/Scheduler';
import type { JobGate } from '../jobs/PauseGate';
import { isWithin, requireAbsolute, validateName } from '../fs/paths';
import { checkOverlap, makeBackupRunner, type RunInfo } from './engine';
import { listVersions, readDescriptor, readManifest } from './format';
import { makeRestoreRunner, RestoreParams, verifyVersion, type RestoreRequest } from './restore';

/**
 * Backup jobs (schema v8: backup_jobs, backup_activity): saved jobs, starting
 * runs as 'backup' operations, the versions in a job's store, browsing and
 * searching them, restoring ('backup-restore' operations), verifying, and the
 * job schedules (registered with the shared Scheduler).
 */

interface JobRow {
  id: string;
  name: string;
  sources: string;
  destination: string;
  store_path: string;
  options: string;
  retention: string;
  schedule: string;
  schedule_since_ms: number;
  created_ms: number;
  updated_ms: number;
  last_run_ms: number | null;
  last_result: string | null;
}

export interface BackupServiceDeps {
  db: AppDatabase;
  ops: OperationManager;
  platform: PlatformOps;
  scheduler?: Scheduler;
  now?: () => number;
  storageFor?: (store: string) => Promise<StorageMode>;
  log?: (event: string, fields: Record<string, unknown>) => void;
  onChanged?: (paths: string[]) => void;
}

export interface BackupRunEvent {
  jobId: string;
  jobName: string;
  operationId: string;
  state: string;
  scheduled: boolean;
  level: 'success' | 'warning' | 'error' | 'info';
  message: string;
}

function parse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const ACTIVITY_MAX = 2000;
const BROWSE_MAX = 5000;

export class BackupService extends EventEmitter {
  private readonly now: () => number;
  /** jobId → operation id of its queued or running backup. */
  private active = new Map<string, string>();
  private runInfo = new Map<string, RunInfo>();
  private scheduledOps = new Set<string>();
  private verifying = new Set<string>();
  private finished = new Set<string>();
  private dirIndex = new WeakMap<VersionManifest, Map<string, ManifestEntry[]>>();

  constructor(private readonly deps: BackupServiceDeps) {
    super();
    this.now = deps.now ?? Date.now;
    const { ops } = deps;
    ops.registerRunner('backup', makeBackupRunner({
      getJob: (id) => this.job(id),
      markRunning: (r) => ops.markRunning(r),
      now: this.now,
      storageFor: deps.storageFor,
      log: deps.log,
      onRunEnd: (_jobId, info) => this.runInfo.set(info.operationId, info),
    }));
    ops.registerRunner('backup-restore', makeRestoreRunner({
      getJob: (id) => this.job(id),
      platform: deps.platform,
      markRunning: (r) => ops.markRunning(r),
      onChanged: deps.onChanged,
      onRunEnd: (jobId, i) => this.addActivity(jobId, 'restore', i.failed ? 'warning' : 'success', `Restored ${i.restored} item(s) from ${i.version} into ${i.target}${i.skipped ? `, ${i.skipped} skipped` : ''}${i.failed ? `, ${i.failed} failed` : ''}.`),
    }));
    ops.on('update', (rec: OperationRecord) => this.onOperation(rec));
  }

  // ---------------------------------------------------------------- jobs

  private toJob(r: JobRow): BackupJob {
    const opts = BackupOptionsSchema.safeParse(parse(r.options, {}));
    const ret = RetentionSchema.safeParse(parse(r.retention, {}));
    const sch = ScheduleSchema.safeParse(parse(r.schedule, {}));
    const opId = this.active.get(r.id);
    return {
      id: r.id, name: r.name, sources: parse<string[]>(r.sources, []).filter((s) => typeof s === 'string'), destination: r.destination, storePath: r.store_path,
      options: opts.success ? opts.data : BackupOptionsSchema.parse({}), retention: ret.success ? ret.data : RetentionSchema.parse({}),
      schedule: sch.success ? sch.data : MANUAL_SCHEDULE, createdMs: r.created_ms, updatedMs: r.updated_ms,
      lastRunMs: r.last_run_ms ?? undefined, lastResult: parse<BackupRunResult | undefined>(r.last_result, undefined),
      nextRunMs: this.deps.scheduler?.nextRun(`backup:${r.id}`), running: !!opId, operationId: opId,
    };
  }

  jobs(): BackupJob[] {
    return this.deps.db.all<JobRow>('SELECT * FROM backup_jobs ORDER BY name COLLATE NOCASE, created_ms').map((r) => this.toJob(r));
  }

  job(id: string): BackupJob | undefined {
    const r = this.deps.db.get<JobRow>('SELECT * FROM backup_jobs WHERE id = ?', [id]);
    return r ? this.toJob(r) : undefined;
  }

  private mustJob(id: string, op: string): BackupJob {
    const j = this.job(id);
    if (!j) throw makeError('not_found', op, { message: 'This backup job no longer exists.' });
    return j;
  }

  /** Create or update a job. Sources and destination must be existing folders that do not contain each other. */
  async saveJob(raw: BackupJobInput): Promise<BackupJob> {
    const input = BackupJobInputSchema.parse(raw);
    const sources = [...new Set(input.sources.map((s) => requireAbsolute(s, 'backup.save')))];
    const destination = requireAbsolute(input.destination, 'backup.save');
    for (const s of sources) {
      const st = await fsp.stat(s).catch(() => undefined);
      if (!st?.isDirectory()) throw makeError('not_a_directory', 'backup.save', { message: `The source ${s} is not an existing folder.`, target: s });
    }
    const dst = await fsp.stat(destination).catch(() => undefined);
    if (!dst?.isDirectory()) throw makeError('not_a_directory', 'backup.save', { message: 'The destination is not an existing folder.', target: destination });
    await checkOverlap(sources, destination, 'backup.save');
    const t = this.now();
    const existing = input.id ? this.job(input.id) : undefined;
    if (input.id && !existing) throw makeError('not_found', 'backup.save', { message: 'This backup job no longer exists.' });
    const id = existing?.id ?? crypto.randomUUID();
    if (existing && this.active.has(id)) throw makeError('busy', 'backup.save', { message: 'This backup is running. Change it after the run has finished.' });
    const storePath = existing && existing.destination === destination ? existing.storePath : await this.chooseStore(destination, input.name, id);
    await checkOverlap(sources, storePath, 'backup.save');
    const scheduleChanged = !existing || JSON.stringify(existing.schedule) !== JSON.stringify(input.schedule);
    const since = scheduleChanged ? t : this.deps.db.get<{ s: number }>('SELECT schedule_since_ms AS s FROM backup_jobs WHERE id = ?', [id])?.s ?? t;
    const vals = [input.name, JSON.stringify(sources), destination, storePath, JSON.stringify(input.options), JSON.stringify(input.retention), JSON.stringify(input.schedule), since, t];
    if (existing) this.deps.db.run('UPDATE backup_jobs SET name = ?, sources = ?, destination = ?, store_path = ?, options = ?, retention = ?, schedule = ?, schedule_since_ms = ?, updated_ms = ? WHERE id = ?', [...vals, id]);
    else this.deps.db.run('INSERT INTO backup_jobs(name, sources, destination, store_path, options, retention, schedule, schedule_since_ms, updated_ms, id, created_ms) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...vals, id, t]);
    this.addActivity(id, 'schedule', 'info', existing ? `Job changed. Schedule: ${describeSchedule(input.schedule)}.` : `Job created. Versions are kept in ${storePath}. Schedule: ${describeSchedule(input.schedule)}.`);
    this.registerSchedule(id);
    this.emit('changed');
    return this.job(id)!;
  }

  /** A folder for the store inside the destination: the job's name, or "name (2)"… when that is taken by something else. */
  private async chooseStore(destination: string, name: string, jobId: string): Promise<string> {
    let base = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120);
    if (!validateName(base).valid) base = 'Orbis backup';
    for (let i = 1; i < 100; i++) {
      const candidate = path.join(destination, i === 1 ? base : `${base} (${i})`);
      const st = await fsp.lstat(candidate).catch(() => undefined);
      if (!st) return candidate;
      if (!st.isDirectory()) continue;
      const desc = await readDescriptor(candidate).catch(() => undefined);
      if (desc?.jobId === jobId) return candidate;
      if (!desc && !(await fsp.readdir(candidate)).length) return candidate;
    }
    throw makeError('validation', 'backup.save', { message: 'No free folder name was found in the destination for this job.' });
  }

  /** Remove a job's settings. Its backup store and every version in it stay on disk. */
  deleteJob(id: string): void {
    if (this.active.has(id)) throw makeError('busy', 'backup.delete', { message: 'This backup is running. Stop it first.' });
    this.deps.db.run('DELETE FROM backup_jobs WHERE id = ?', [id]);
    this.deps.scheduler?.remove(`backup:${id}`);
    this.emit('changed');
  }

  // ---------------------------------------------------------------- runs

  isRunning(id: string): boolean {
    return this.active.has(id);
  }

  /** Start a run now. Never two runs of the same job at once. */
  run(id: string, scheduled = false): OperationRecord {
    const job = this.mustJob(id, 'backup.run');
    if (this.active.has(id)) throw makeError('busy', 'backup.run', { message: `“${job.name}” is already running.` });
    const rec = this.deps.ops.start({ type: 'backup', sources: job.sources, destination: job.storePath, origin: scheduled ? `backup-schedule:${id}` : `backup:${id}`, params: { jobId: id, scheduled } });
    this.active.set(id, rec.id);
    if (scheduled) this.scheduledOps.add(rec.id);
    const t = this.now();
    this.deps.db.run('UPDATE backup_jobs SET last_run_ms = ? WHERE id = ?', [t, id]);
    if (!scheduled) this.deps.scheduler?.noteRun(`backup:${id}`, t);
    this.emit('changed');
    return rec;
  }

  /** Start a run and resolve when it has finished (scheduled runs). */
  runAndWait(id: string, scheduled = true): Promise<OperationRecord> {
    const rec = this.run(id, scheduled);
    return new Promise((resolve) => {
      const check = (r: OperationRecord) => {
        if (r.id !== rec.id || !TERMINAL_STATES.has(r.state)) return;
        this.deps.ops.off('update', check);
        resolve(r);
      };
      this.deps.ops.on('update', check);
    });
  }

  private onOperation(rec: OperationRecord): void {
    if (rec.type !== 'backup' || !TERMINAL_STATES.has(rec.state) || this.finished.has(rec.id)) return;
    this.finished.add(rec.id); // the manager reports a terminal state more than once
    if (this.finished.size > 500) this.finished.delete(this.finished.values().next().value!);
    const jobId = [...this.active.entries()].find(([, op]) => op === rec.id)?.[0] ?? (rec.origin.split(':')[1] ?? '');
    if (this.active.get(jobId) === rec.id) this.active.delete(jobId);
    const info = this.runInfo.get(rec.id);
    this.runInfo.delete(rec.id);
    const scheduled = this.scheduledOps.delete(rec.id) || rec.origin.startsWith('backup-schedule:');
    const job = this.job(jobId);
    if (!job) return;
    const st = info?.stats;
    const result: BackupRunResult = {
      state: rec.state, finishedMs: rec.finishedMs ?? this.now(), version: info?.complete ? info.version : undefined,
      files: st?.files, newFiles: st?.newFiles, changedFiles: st?.changedFiles, copiedBytes: st?.copiedBytes, errors: info?.problems,
      removedVersions: info?.removed.length, scheduled, message: rec.error?.message,
    };
    this.deps.db.run('UPDATE backup_jobs SET last_result = ? WHERE id = ?', [JSON.stringify(result), jobId]);
    const level: BackupRunEvent['level'] = rec.state === 'completed' ? 'success' : rec.state === 'completed_with_errors' || rec.state === 'cancelled' ? 'warning' : 'error';
    const message = info?.complete && st
      ? `Version ${info.version}: ${st.files} files, ${st.newFiles} new, ${st.changedFiles} changed${info.problems ? `, ${info.problems} could not be read` : ''}.`
      : rec.state === 'cancelled' ? 'Stopped. No new version was made.' : `Failed: ${rec.error?.message ?? 'see Operations.'} No new version was made.`;
    this.addActivity(jobId, 'run', level, `${scheduled ? 'Scheduled run' : 'Run'}: ${message}`);
    for (const v of info?.removed ?? []) this.addActivity(jobId, 'retention', 'info', `Retention removed version ${v} (${job.retention.keepLast ? `keep last ${job.retention.keepLast}` : ''}${job.retention.keepDailyDays ? `${job.retention.keepLast ? ', ' : ''}daily for ${job.retention.keepDailyDays} days` : ''}${job.retention.keepWeeklyWeeks ? `, weekly for ${job.retention.keepWeeklyWeeks} weeks` : ''}).`);
    if (info?.objectsRemoved) this.addActivity(jobId, 'cleanup', 'info', `${info.objectsRemoved} stored object(s) no longer used by any version were removed.`);
    const ev: BackupRunEvent = { jobId, jobName: job.name, operationId: rec.id, state: rec.state, scheduled, level, message };
    this.emit('run', ev);
    this.emit('changed');
  }

  // ---------------------------------------------------------------- schedules

  /** Register every job's schedule (app start) and keep them in step with edits. */
  registerSchedules(): void {
    for (const j of this.jobs()) this.registerSchedule(j.id);
  }

  private registerSchedule(id: string): void {
    const sch = this.deps.scheduler;
    if (!sch) return;
    const row = this.deps.db.get<JobRow>('SELECT * FROM backup_jobs WHERE id = ?', [id]);
    const job = row && this.toJob(row);
    if (!job || job.schedule.kind === 'manual') {
      sch.remove(`backup:${id}`);
      return;
    }
    sch.upsert({
      id: `backup:${id}`, kind: 'backup', targetId: id, label: job.name, schedule: job.schedule, sinceMs: row.schedule_since_ms, lastRunMs: job.lastRunMs,
      isBusy: () => this.active.has(id),
      run: async () => {
        if (!this.job(id)) return;
        await this.runAndWait(id, true);
      },
    });
  }

  // ---------------------------------------------------------------- versions

  async versions(id: string): Promise<VersionInfo[]> {
    const job = this.mustJob(id, 'backup.versions');
    const desc = await readDescriptor(job.storePath).catch(() => undefined);
    if (desc && desc.jobId !== id) throw makeError('validation', 'backup.versions', { message: `${job.storePath} holds the backups of another job.` });
    return (await listVersions(job.storePath, id)).map(({ manifest: _m, ...v }) => v);
  }

  private async manifest(id: string, version: string, op: string): Promise<{ job: BackupJob; m: VersionManifest }> {
    const job = this.mustJob(id, op);
    const { manifest, problem } = await readManifest(job.storePath, version, id);
    if (!manifest) throw makeError('validation', op, { message: `Version ${version} cannot be opened: ${problem}` });
    return { job, m: manifest };
  }

  private index(m: VersionManifest): Map<string, ManifestEntry[]> {
    let idx = this.dirIndex.get(m);
    if (!idx) {
      idx = new Map();
      for (const e of m.entries) {
        const parent = e.p.includes('/') ? e.p.slice(0, e.p.lastIndexOf('/')) : '';
        const list = idx.get(parent) ?? [];
        list.push(e);
        idx.set(parent, list);
      }
      this.dirIndex.set(m, idx);
    }
    return idx;
  }

  /** The items directly inside `dir` ('' = the version's top level: one folder per source). */
  async browse(id: string, version: string, dir: string): Promise<{ entries: BrowseEntry[]; truncated: boolean; total: number; sources: VersionManifest['sources'] }> {
    const { m } = await this.manifest(id, version, 'backup.browse');
    const idx = this.index(m);
    const kids = idx.get(dir) ?? [];
    if (dir && !m.entries.some((e) => e.p === dir && e.k === 'd') && !kids.length) throw makeError('not_found', 'backup.browse', { message: `“${dir}” is not a folder in version ${version}.` });
    const count = (p: string): number => {
      let n = 0;
      const stack = [p];
      while (stack.length) {
        const c = idx.get(stack.pop()!) ?? [];
        n += c.length;
        for (const x of c) if (x.k === 'd') stack.push(x.p);
      }
      return n;
    };
    const entries = kids
      .slice()
      .sort((a, b) => (a.k === 'd' ? 0 : 1) - (b.k === 'd' ? 0 : 1) || a.p.localeCompare(b.p))
      .slice(0, BROWSE_MAX)
      .map((e) => toBrowse(e, e.k === 'd' ? count(e.p) : undefined));
    return { entries, truncated: kids.length > BROWSE_MAX, total: kids.length, sources: m.sources };
  }

  /** Files whose path contains `query` (case-insensitive) in any complete version, with how many versions hold them. */
  async search(id: string, query: string): Promise<Array<{ rel: string; versions: number; latest: string; size?: number }>> {
    const job = this.mustJob(id, 'backup.search');
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits = new Map<string, { rel: string; versions: number; latest: string; size?: number }>();
    for (const v of await listVersions(job.storePath, id)) {
      if (!v.manifest) continue;
      for (const e of v.manifest.entries) {
        if (e.k !== 'f' || !e.p.toLowerCase().includes(q)) continue;
        const h = hits.get(e.p);
        if (h) h.versions++;
        else if (hits.size < 500) hits.set(e.p, { rel: e.p, versions: 1, latest: v.name, size: e.s });
      }
    }
    return [...hits.values()].sort((a, b) => a.rel.localeCompare(b.rel)).slice(0, 200);
  }

  /** Every complete version's copy of one path ("versions of this file"). */
  async fileVersions(id: string, rel: string): Promise<FileVersionRow[]> {
    const job = this.mustJob(id, 'backup.fileVersions');
    const rows: FileVersionRow[] = [];
    for (const v of await listVersions(job.storePath, id)) {
      if (!v.manifest) continue;
      const e = v.manifest.entries.find((x) => x.p === rel);
      rows.push(e
        ? { version: v.name, startedMs: v.startedMs, present: true, kind: kindOf(e), size: e.s, mtimeMs: e.m, sha256: e.h, status: statusOf(e) }
        : { version: v.name, startedMs: v.startedMs, present: false });
    }
    return rows;
  }

  /** Restore items as 'backup-restore' operations (one per source folder when restoring to the original locations). */
  async restore(raw: RestoreRequest): Promise<OperationRecord[]> {
    const req = RestoreParams.parse(raw);
    const { job, m } = await this.manifest(req.jobId, req.version, 'backup.restore');
    if (req.target.kind === 'folder') {
      const dest = requireAbsolute(req.target.path, 'backup.restore');
      const st = await fsp.stat(dest).catch(() => undefined);
      if (!st?.isDirectory()) throw makeError('not_a_directory', 'backup.restore', { message: 'The folder to restore into does not exist.', target: dest });
      if (isWithin(job.storePath, dest) || isWithin(job.storePath, await fsp.realpath(dest))) throw makeError('validation', 'backup.restore', { message: 'Restore into a folder outside the backup store.' });
      return [this.deps.ops.start({ type: 'backup-restore', sources: [path.join(job.storePath, req.version)], destination: dest, conflictPolicy: 'ask', origin: `backup-restore:${job.id}`, params: { ...req, target: { kind: 'folder', path: dest } } })];
    }
    const byLabel = new Map<string, string[]>();
    for (const it of req.items) {
      const label = it.split('/')[0]!;
      byLabel.set(label, [...(byLabel.get(label) ?? []), it]);
    }
    const out: OperationRecord[] = [];
    for (const [label, items] of byLabel) {
      const src = m.sources.find((s) => s.label === label);
      if (!src) throw makeError('validation', 'backup.restore', { message: `Version ${req.version} does not say where “${label}” was backed up from.` });
      out.push(this.deps.ops.start({ type: 'backup-restore', sources: [path.join(job.storePath, req.version)], destination: src.path, conflictPolicy: 'ask', origin: `backup-restore:${job.id}`, params: { ...req, items } }));
    }
    return out;
  }

  /** Read every file of a version and compare it with the manifest (a read-only background job). */
  async verify(id: string, version: string, signal: AbortSignal, gate?: JobGate, onProgress?: (p: unknown) => void): Promise<VerifyResult> {
    if (this.active.has(id)) throw makeError('busy', 'backup.verify', { message: 'This job is running a backup. Verify after it has finished.' });
    if (this.verifying.has(id)) throw makeError('busy', 'backup.verify', { message: 'A version of this job is already being verified.' });
    const { job, m } = await this.manifest(id, version, 'backup.verify');
    this.verifying.add(id);
    try {
      const r = await verifyVersion(job.storePath, m, signal, gate, onProgress);
      const bad = r.mismatched.length + r.missing.length;
      this.addActivity(id, 'verify', bad ? 'error' : 'success', bad
        ? `Verify ${version}: ${bad} file(s) damaged or missing (${r.mismatched.length} different, ${r.missing.length} missing) of ${r.checked}.`
        : `Verify ${version}: all ${r.checked} file(s) match the manifest.`);
      this.emit('changed');
      return r;
    } finally {
      this.verifying.delete(id);
    }
  }

  // ---------------------------------------------------------------- activity

  addActivity(jobId: string, kind: BackupActivity['kind'], level: BackupActivity['level'], message: string): void {
    this.deps.db.run('INSERT INTO backup_activity(id, job_id, ms, kind, level, message) VALUES(?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), jobId, this.now(), kind, level, message]);
    this.deps.db.run('DELETE FROM backup_activity WHERE job_id = ? AND id NOT IN (SELECT id FROM backup_activity WHERE job_id = ? ORDER BY ms DESC LIMIT ?)', [jobId, jobId, ACTIVITY_MAX]);
    this.deps.log?.('backup.activity', { job: jobId, kind, level });
  }

  activity(jobId?: string, limit = 200): BackupActivity[] {
    const rows = jobId
      ? this.deps.db.all<{ id: string; job_id: string; ms: number; kind: string; level: string; message: string }>('SELECT * FROM backup_activity WHERE job_id = ? ORDER BY ms DESC, rowid DESC LIMIT ?', [jobId, limit])
      : this.deps.db.all<{ id: string; job_id: string; ms: number; kind: string; level: string; message: string }>('SELECT * FROM backup_activity ORDER BY ms DESC, rowid DESC LIMIT ?', [limit]);
    return rows.map((r) => ({ id: r.id, jobId: r.job_id, ms: r.ms, kind: r.kind as BackupActivity['kind'], level: r.level as BackupActivity['level'], message: r.message }));
  }
}

function kindOf(e: ManifestEntry): BrowseEntry['kind'] {
  return e.k === 'd' ? 'directory' : e.k === 'l' ? 'symlink' : 'file';
}

function statusOf(e: ManifestEntry): BrowseEntry['status'] {
  return e.x === 'n' ? 'new' : e.x === 'c' ? 'changed' : e.x === 'u' ? 'unchanged' : undefined;
}

function toBrowse(e: ManifestEntry, items?: number): BrowseEntry {
  return { name: e.p.slice(e.p.lastIndexOf('/') + 1), rel: e.p, kind: kindOf(e), size: e.s, mtimeMs: e.m, status: statusOf(e), sha256: e.h, linkTarget: e.t, items };
}

export type { Schedule };
