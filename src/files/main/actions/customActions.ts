import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { makeError, type OrbisErrorShape } from '../../shared/errors';
import {
  ACTION_OUTPUT_LIMIT, CUSTOM_ACTIONS_FORMAT, CUSTOM_ACTIONS_FORMAT_VERSION, CustomActionSchema, CustomActionsFileSchema, MAX_CUSTOM_ACTIONS, CommandLineError,
  describeRun, planRuns, type ActionItem, type CustomAction, type PlannedRun,
} from '../../shared/customActions';
import type { ActionRunOutput, OperationRecord, OperationRequest } from '../../shared/operations';
import type { ExternalRunner } from '../ops/OperationManager';
import type { KvStore } from '../tools/renamePresets';

/**
 * Custom actions: storage (per profile) and the 'custom-action' operation
 * runner. A run request names an action id only; the stored definition is
 * read here, so nothing outside the Settings editor can change what runs.
 */

const KEY = 'customActions.v1';

export class CustomActionStore {
  constructor(private readonly kv: KvStore, private readonly now: () => number = Date.now) {}

  list(): CustomAction[] {
    const raw = this.kv.getKv<unknown>(KEY, []);
    if (!Array.isArray(raw)) return [];
    const out: CustomAction[] = [];
    for (const x of raw) {
      const p = CustomActionSchema.safeParse(x);
      if (p.success && !out.some((a) => a.id === p.data.id)) out.push(p.data);
    }
    return out;
  }

  get(id: string): CustomAction | undefined {
    return this.list().find((a) => a.id === id);
  }

  /** Create (no id) or replace an action. Returns the stored action. */
  save(input: unknown): CustomAction {
    const obj = input && typeof input === 'object' && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
    const list = this.list();
    const existing = typeof obj.id === 'string' ? list.find((a) => a.id === obj.id) : undefined;
    if (!existing) {
      if (list.length >= MAX_CUSTOM_ACTIONS) throw makeError('validation', 'actions.save', { message: `Up to ${MAX_CUSTOM_ACTIONS} actions can be defined. Delete one first.` });
      obj.id = newActionId();
    }
    obj.createdMs = existing?.createdMs ?? this.now();
    obj.updatedMs = this.now();
    const p = CustomActionSchema.safeParse(obj);
    if (!p.success) {
      const issue = p.error.issues[0];
      throw makeError('validation', 'actions.save', { message: issue?.message ?? 'This action is not valid.', cause: issue?.path.join('.') });
    }
    if (list.some((a) => a.id !== p.data.id && a.name.toLowerCase() === p.data.name.toLowerCase())) throw makeError('already_exists', 'actions.save', { message: `An action called “${p.data.name}” already exists.` });
    this.kv.setKv(KEY, existing ? list.map((a) => (a.id === existing.id ? p.data : a)) : [...list, p.data]);
    return p.data;
  }

  delete(id: string): boolean {
    const list = this.list();
    const next = list.filter((a) => a.id !== id);
    if (next.length === list.length) return false;
    this.kv.setKv(KEY, next);
    return true;
  }

  exportJson(): string {
    return `${JSON.stringify({ format: CUSTOM_ACTIONS_FORMAT, version: CUSTOM_ACTIONS_FORMAT_VERSION, exportedMs: this.now(), actions: this.list().map(({ createdMs: _c, updatedMs: _u, ...a }) => a) }, null, 2)}\n`;
  }

  /**
   * Import actions from an export file. Every action is validated; actions are
   * added with new ids (an action with the same name is replaced), and
   * "Ask before running" is switched on for each of them, whatever the file says.
   */
  importJson(text: string): { added: string[]; replaced: string[]; errors: string[] } {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw makeError('validation', 'actions.import', { message: 'This file is not valid JSON.' });
    }
    const file = CustomActionsFileSchema.safeParse(raw);
    if (!file.success) throw makeError('validation', 'actions.import', { message: 'This is not an Orbis Files actions file.' });
    if (file.data.version > CUSTOM_ACTIONS_FORMAT_VERSION) throw makeError('unsupported', 'actions.import', { message: `This file was written by a newer Orbis Files (format ${file.data.version}).` });
    const added: string[] = [];
    const replaced: string[] = [];
    const errors: string[] = [];
    const list = this.list();
    const next = [...list];
    file.data.actions.forEach((x, i) => {
      const obj = x && typeof x === 'object' && !Array.isArray(x) ? { ...(x as Record<string, unknown>) } : {};
      const same = typeof obj.name === 'string' ? next.findIndex((a) => a.name.toLowerCase() === String(obj.name).trim().toLowerCase()) : -1;
      const p = CustomActionSchema.safeParse({ ...obj, id: same >= 0 ? next[same]!.id : newActionId(), confirm: true, createdMs: this.now(), updatedMs: this.now() });
      if (!p.success) {
        errors.push(`Action ${i + 1}${typeof obj.name === 'string' ? ` (“${obj.name.slice(0, 60)}”)` : ''}: ${p.error.issues[0]?.message ?? 'not valid'}`);
        return;
      }
      if (same >= 0) {
        next[same] = p.data;
        replaced.push(p.data.name);
      } else if (next.length >= MAX_CUSTOM_ACTIONS) errors.push(`“${p.data.name}”: more than ${MAX_CUSTOM_ACTIONS} actions.`);
      else {
        next.push(p.data);
        added.push(p.data.name);
      }
    });
    if (added.length || replaced.length) this.kv.setKv(KEY, next);
    return { added, replaced, errors };
  }
}

export function newActionId(): string {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * The environment a custom action runs with: only what programs need to find
 * each other and the desktop (PATH, HOME, locale, temporary folder, display),
 * never the rest of Orbis Files' environment.
 */
const KEEP_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'LANGUAGE', 'TMPDIR', 'TZ', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'DBUS_SESSION_BUS_ADDRESS',
  // Windows
  'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME'];
export function minimalEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of KEEP_ENV) if (source[k] !== undefined) env[k] = source[k];
  return env;
}

export interface ProcessResult { exitCode: number | null; signal?: string; timedOut: boolean; cancelled: boolean; stdout: string; stderr: string; truncated: boolean; durationMs: number; error?: string }

/**
 * Find a bare program name on PATH ourselves (POSIX): the first executable file wins, folders
 * that cannot be read are skipped. spawn's own search reports EACCES when any PATH folder is
 * unreadable, which would hide "not found" behind a misleading permission error.
 */
export function resolveOnPath(file: string, env: NodeJS.ProcessEnv): string | undefined {
  if (process.platform === 'win32' || file.includes('/')) return file;
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, file);
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      /* not here, or not readable/executable: keep looking */
    }
  }
  return undefined;
}

/** Run one program without a shell (or the shell itself in shell mode), collecting bounded output. */
export function runProcess(file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal; maxBytes?: number; windowsVerbatimArguments?: boolean }): Promise<ProcessResult> {
  const max = opts.maxBytes ?? ACTION_OUTPUT_LIMIT;
  const t0 = Date.now();
  const resolved = resolveOnPath(file, opts.env);
  if (!resolved) return Promise.resolve({ exitCode: null, timedOut: false, cancelled: false, stdout: '', stderr: '', truncated: false, durationMs: 0, error: `The program “${file}” was not found on PATH.` });
  file = resolved;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: opts.windowsVerbatimArguments,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group on POSIX, so a timeout or cancel stops everything the program started.
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      resolve({ exitCode: null, timedOut: false, cancelled: false, stdout: '', stderr: '', truncated: false, durationMs: 0, error: (err as Error).message });
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outN = 0;
    let errN = 0;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const take = (list: Buffer[], n: number, b: Buffer): number => {
      if (n >= max) {
        truncated = true;
        return n + b.length;
      }
      const room = max - n;
      if (b.length > room) truncated = true;
      list.push(b.length > room ? b.subarray(0, room) : b);
      return n + b.length;
    };
    child.stdout!.on('data', (b: Buffer) => { outN = take(out, outN, b); });
    child.stderr!.on('data', (b: Buffer) => { errN = take(err, errN, b); });
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const kill = (sig: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig);
          else child.kill(sig);
        } catch {
          try { child.kill(sig); } catch { /* already gone */ }
        }
      };
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 2000);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs);
    const onAbort = () => {
      cancelled = true;
      stop();
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (exitCode: number | null, signal: string | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode, signal: signal ?? undefined, timedOut, cancelled, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), truncated, durationMs: Date.now() - t0, error });
    };
    child.on('error', (e) => finish(null, null, (e as NodeJS.ErrnoException).code === 'ENOENT' ? `The program “${file}” was not found${path.isAbsolute(file) ? '' : ' on PATH'}.` : e.message));
    child.on('close', (code, sig) => finish(code, sig));
  });
}

/** The error reported for a run that did not succeed, or undefined when it did. */
export function runError(name: string, r: ProcessResult, timeoutSec: number): OrbisErrorShape | undefined {
  const base = { operation: 'actions.run', dataChanged: 'unknown' as const, retryable: false };
  if (r.cancelled) return { ...base, category: 'cancelled', message: `“${name}” was stopped.` };
  if (r.timedOut) return { ...base, category: 'busy', message: `“${name}” did not finish within ${timeoutSec} s and was stopped.` };
  if (r.error) return { ...base, category: 'unavailable', message: r.error, dataChanged: 'no' };
  if (r.exitCode !== 0) return { ...base, category: 'io', message: r.signal ? `“${name}” was ended by signal ${r.signal}.` : `“${name}” exited with code ${r.exitCode}.` };
  return undefined;
}

const ParamsSchema = z.object({ actionId: z.string().regex(/^[a-z0-9]{6,32}$/), folder: z.string().min(1).max(32767) }).passthrough();

export interface CustomActionRunnerDeps {
  store: CustomActionStore;
  markRunning: (rec: OperationRecord) => void;
  platform?: string;
  env?: () => NodeJS.ProcessEnv;
  /** Told about every run's items afterwards (status, listings), since a program may have changed them. */
  onChanged?: (paths: string[]) => void;
}

/** Plan an action's runs from an operation request (the stored action, the request's sources and folder). */
export async function planFromRequest(store: CustomActionStore, req: Pick<OperationRequest, 'sources' | 'params'>, platform: string = process.platform): Promise<{ action: CustomAction; runs: PlannedRun[] }> {
  const p = ParamsSchema.safeParse(req.params ?? {});
  if (!p.success) throw makeError('validation', 'actions.run', { message: 'The action to run was not given.' });
  const action = store.get(p.data.actionId);
  if (!action) throw makeError('not_found', 'actions.run', { message: 'This action no longer exists. It may have been deleted in Settings.' });
  if (!path.isAbsolute(p.data.folder)) throw makeError('invalid_path', 'actions.run', { message: 'The folder is not an absolute path.' });
  const items: ActionItem[] = [];
  for (const s of req.sources) {
    const st = await fsp.stat(s).catch(() => undefined);
    items.push({ path: s, kind: st?.isDirectory() ? 'directory' : st?.isFile() ? 'file' : st ? 'other' : 'file' });
  }
  try {
    return { action, runs: planRuns(action, { items, folder: p.data.folder, platform, comSpec: process.env.ComSpec }) };
  } catch (err) {
    if (err instanceof CommandLineError) throw makeError('validation', 'actions.run', { message: err.message });
    throw err;
  }
}

export function makeCustomActionRunner(deps: CustomActionRunnerDeps): { run: ExternalRunner; validate: (req: OperationRequest) => void } {
  const platform = deps.platform ?? process.platform;
  const validate = (req: OperationRequest) => {
    // A run asks the user first (when the action says so); retrying from Operations would skip that.
    if (req.origin?.startsWith('retry:')) throw makeError('unsupported', 'actions.run', { message: 'Run the action again from its command; it shows what will run first.' });
    const p = ParamsSchema.safeParse(req.params ?? {});
    if (!p.success || !deps.store.get(p.data.actionId)) throw makeError('not_found', 'actions.run', { message: 'This action no longer exists.' });
    if (!req.sources.length) throw makeError('validation', 'actions.run', { message: 'There is nothing to run the action on.' });
  };
  const run: ExternalRunner = async (rec, req, ctx, helpers) => {
    const { action, runs } = await planFromRequest(deps.store, req, platform);
    const output: ActionRunOutput = { actionId: action.id, action: action.name, showOutput: action.showOutput, shell: action.shell, runs: [] };
    rec.output = output;
    rec.progress = { totalItems: runs.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const env = deps.env?.() ?? minimalEnv();
    for (const r of runs) {
      try {
        await ctx.gate();
      } catch (err) {
        for (const item of r.items) rec.results.push({ source: item, status: 'cancelled' });
        if (ctx.signal.aborted) continue;
        throw err;
      }
      if (ctx.signal.aborted) {
        for (const item of r.items) rec.results.push({ source: item, status: 'cancelled' });
        continue;
      }
      const cwdOk = await fsp.stat(r.cwd).then((s) => s.isDirectory(), () => false);
      let res: ProcessResult;
      if (!cwdOk) res = { exitCode: null, timedOut: false, cancelled: false, stdout: '', stderr: '', truncated: false, durationMs: 0, error: `The working folder ${r.cwd} does not exist.` };
      else if (r.shell) res = await runProcess(r.shell.file, r.shell.args, { cwd: r.cwd, env, timeoutMs: action.timeoutSec * 1000, signal: ctx.signal, windowsVerbatimArguments: platform === 'win32' });
      else res = await runProcess(r.argv![0]!, r.argv!.slice(1), { cwd: r.cwd, env, timeoutMs: action.timeoutSec * 1000, signal: ctx.signal });
      output.runs.push({ label: r.label, command: describeRun(r), cwd: r.cwd, exitCode: res.exitCode, signal: res.signal, timedOut: res.timedOut || undefined, cancelled: res.cancelled || undefined, error: res.error, stdout: res.stdout, stderr: res.stderr, truncated: res.truncated || undefined, durationMs: res.durationMs });
      const error = runError(action.name, res, action.timeoutSec);
      for (const item of r.items) rec.results.push({ source: item, status: error ? (error.category === 'cancelled' ? 'cancelled' : 'failed') : 'done', error });
      helpers.tick(0, 1, r.label);
      deps.onChanged?.([...r.items, r.cwd]);
    }
  };
  return { run, validate };
}
