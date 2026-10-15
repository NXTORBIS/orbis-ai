import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { toOrbisError } from '../../shared/errors';
import { OcrIndexSettingsSchema, ocrKindOf, type OcrIndexSettings, type OcrIndexStatus } from '../../shared/ocr';
import { PauseGate } from '../jobs/PauseGate';
import { TreeWatcher } from '../search/TreeWatcher';
import { isWithin } from '../fs/paths';
import { readMetadata } from '../media/metadata';
import type { OcrEngine } from './engine';
import { recognizeFile } from './recognize';
import type { OcrTextStore } from './store';

/**
 * "Make text in images searchable": an opt-in background job that recognizes the
 * images in chosen folders (default Pictures and Documents) and stores their text
 * for content search (OcrTextStore, keyed by path + size + modification time).
 *
 * - Runs at the lowest priority: its engine threads are niced to 19 on Linux (that
 *   thread only), with 1 or 2 threads (setting), one image at a time per thread.
 * - Skips images over the size and pixel limits (recorded, so they are not looked at
 *   again until they change), hidden files and folders, links and the index exclusions.
 * - Pausable and cancellable; a run starts when it is switched on, when folders
 *   change, 20 s after start-up and every 30 minutes; changed files are noticed by
 *   per-folder watchers (Linux) and by those periodic runs.
 * - Turning it off stops the job and deletes all stored text.
 */

const KV_KEY = 'ocr.index.v1';
const EXCLUDE = new Set(['node_modules', '.git', '.cache', '$RECYCLE.BIN', 'System Volume Information']);

export interface OcrIndexDeps {
  store: OcrTextStore;
  engine: OcrEngine;
  kv: { getKv<T>(key: string, fallback: T): T; setKv(key: string, value: unknown): void };
  /** Pictures and Documents (resolved when the setting is first turned on). */
  defaultFolders: () => Promise<string[]>;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Timings (tests use short ones). */
  startDelayMs?: number;
  intervalMs?: number;
  watch?: boolean;
}

export class OcrIndexJob extends EventEmitter {
  private ac: AbortController | undefined;
  private gate: PauseGate | undefined;
  private running: Promise<void> | undefined;
  private rerun = false;
  private timer: NodeJS.Timeout | undefined;
  private interval: NodeJS.Timeout | undefined;
  private watchers = new Map<string, TreeWatcher>();
  private touched = new Set<string>();
  private touchTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private stats = { checked: 0, recognized: 0, pending: 0, skipped: 0, failed: 0 };
  private current: string | undefined;
  private lastRunMs: number | undefined;
  private lastError: string | undefined;
  private statusTimer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: OcrIndexDeps) {
    super();
  }

  settings(): OcrIndexSettings {
    const raw = this.deps.kv.getKv<unknown>(KV_KEY, {});
    const p = OcrIndexSettingsSchema.safeParse(raw);
    return p.success ? p.data : OcrIndexSettingsSchema.parse({});
  }

  /** Change settings. Off: stop and delete all stored text. Folders removed: their text is deleted. */
  async update(patch: Partial<OcrIndexSettings>): Promise<OcrIndexStatus> {
    const before = this.settings();
    let next = OcrIndexSettingsSchema.parse({ ...before, ...patch });
    if (patch.folders) next.folders = [...new Set(patch.folders.map((f) => path.resolve(f)))].filter((f) => path.isAbsolute(f));
    if (next.enabled && !before.enabled && !next.folders.length) next = { ...next, folders: await this.deps.defaultFolders() };
    this.deps.kv.setKv(KV_KEY, next);
    this.deps.engine.setBackgroundWorkers(next.workers);
    if (!next.enabled) {
      if (before.enabled || this.deps.store.count('all')) {
        this.cancel();
        await this.running?.catch(() => undefined);
        this.deps.store.clear();
        this.deps.log?.('ocr.index_cleared', {});
      }
      this.unwatch();
    } else {
      for (const f of before.folders) if (!next.folders.some((n) => isWithin(n, f))) this.deps.store.removeUnder(f);
      const langsChanged = before.langs.join('+') !== next.langs.join('+');
      if (!before.enabled || langsChanged || before.folders.join('\n') !== next.folders.join('\n') || before.maxFileMB !== next.maxFileMB || before.maxMegapixels !== next.maxMegapixels) {
        this.unwatch();
        this.watchFolders(next);
        this.requestRun();
      }
    }
    this.emitStatus(true);
    return this.status();
  }

  /** Start after the app is up (delayed), then every interval. */
  start(): void {
    this.stopped = false;
    const s = this.settings();
    this.deps.engine.setBackgroundWorkers(s.workers);
    if (!s.enabled) return;
    this.watchFolders(s);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.requestRun(), this.deps.startDelayMs ?? 20_000);
    this.timer.unref?.();
    clearInterval(this.interval);
    this.interval = setInterval(() => this.requestRun(), this.deps.intervalMs ?? 30 * 60_000);
    this.interval.unref?.();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.interval);
    clearTimeout(this.touchTimer);
    clearTimeout(this.statusTimer);
    this.unwatch();
    this.cancel();
  }

  /** Run now (or once more after the current run). */
  requestRun(): void {
    if (this.stopped || !this.settings().enabled) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = this.runOnce().finally(() => {
      this.running = undefined;
      this.emitStatus(true);
      if (this.rerun && !this.stopped) {
        this.rerun = false;
        this.requestRun();
      }
    });
  }

  /** Wait for the current run (tests). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  pause(): void {
    this.gate?.pause();
    this.emitStatus(true);
  }

  resume(): void {
    this.gate?.resume();
    this.emitStatus(true);
  }

  /** Stop the current run (the setting stays on; the next periodic run starts over). */
  cancel(): void {
    this.rerun = false;
    this.ac?.abort();
  }

  status(): OcrIndexStatus {
    const s = this.settings();
    const linux = process.platform === 'linux';
    return {
      settings: s,
      state: !s.enabled ? 'off' : !this.running ? 'idle' : this.gate?.isPaused ? 'paused' : 'scanning',
      current: this.current,
      ...this.stats,
      stored: this.deps.store.count('text'),
      lastRunMs: this.lastRunMs,
      lastError: this.lastError,
      priority: linux ? 'lowered' : 'normal',
      priorityNote: linux
        ? 'Recognition threads run at the lowest priority (nice 19), so other programs come first.'
        : 'On this system the recognition threads keep normal priority; at most the chosen number of images is recognized at a time.',
    };
  }

  private emitStatus(now = false): void {
    if (now) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
      this.emit('status', this.status());
      return;
    }
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.emit('status', this.status());
    }, 300);
  }

  private watchFolders(s: OcrIndexSettings): void {
    if (this.deps.watch === false || process.platform !== 'linux') return;
    for (const f of s.folders) {
      if (this.watchers.has(f)) continue;
      const w = new TreeWatcher(f, (p) => this.touch(p), { maxDirs: 2000, exclude: (n) => n.startsWith('.') || EXCLUDE.has(n) });
      this.watchers.set(f, w);
      void w.start();
    }
  }

  private unwatch(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  /** A file changed in a watched folder: re-check it soon (images only). */
  private touch(p: string): void {
    if (!ocrKindOf(path.basename(p)) || ocrKindOf(path.basename(p)) !== 'image') return;
    this.touched.add(p);
    clearTimeout(this.touchTimer);
    this.touchTimer = setTimeout(() => {
      const paths = [...this.touched];
      this.touched.clear();
      void this.checkFiles(paths);
    }, 2000);
    this.touchTimer.unref?.();
  }

  private async checkFiles(paths: string[]): Promise<void> {
    if (this.running || this.stopped) {
      // The run in progress (or the next one) sees them.
      if (this.running) this.rerun = true;
      return;
    }
    const s = this.settings();
    if (!s.enabled) return;
    this.running = (async () => {
      this.ac = new AbortController();
      this.gate = new PauseGate(this.ac.signal);
      const gone: string[] = [];
      for (const p of paths) {
        const st = await fsp.lstat(p).catch(() => undefined);
        if (!st) gone.push(p);
        else if (st.isFile() && s.folders.some((f) => isWithin(f, p))) await this.recognizeOne(p, st, s).catch(() => undefined);
      }
      this.deps.store.remove(gone);
    })().finally(() => {
      this.running = undefined;
      this.emitStatus(true);
    });
    await this.running;
  }

  private async runOnce(): Promise<void> {
    const s = this.settings();
    if (!s.enabled) return;
    this.ac = new AbortController();
    this.gate = new PauseGate(this.ac.signal);
    const offGate = this.gate.onChange(() => this.emitStatus(true));
    const signal = this.ac.signal;
    this.stats = { checked: 0, recognized: 0, pending: 0, skipped: 0, failed: 0 };
    this.lastError = undefined;
    this.emitStatus(true);
    this.deps.log?.('ocr.index_run', { folders: s.folders.length });
    try {
      for (const folder of s.folders) {
        if (signal.aborted) break;
        this.current = folder;
        const seen = new Set<string>();
        const todo: Array<{ p: string; st: import('node:fs').Stats }> = [];
        // 1. Walk: find images that are new or changed since they were recognized.
        const stack = [folder];
        while (stack.length && !signal.aborted) {
          await this.gate.wait();
          const dir = stack.pop()!;
          const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
          for (const d of entries) {
            if (d.name.startsWith('.') || EXCLUDE.has(d.name) || d.name.startsWith('.orbis-part-')) continue;
            const p = path.join(dir, d.name);
            if (d.isDirectory()) stack.push(p);
            else if (d.isFile() && ocrKindOf(d.name) === 'image') {
              seen.add(p);
              this.stats.checked++;
              const st = await fsp.lstat(p).catch(() => undefined);
              if (st?.isFile() && !this.deps.store.fresh(p, st.size, st.mtimeMs, s.langs.join('+'))) todo.push({ p, st });
              this.emitStatus();
            }
          }
        }
        // Images that are gone are forgotten.
        if (!signal.aborted) this.deps.store.remove(this.deps.store.pathsUnder(folder).filter((p) => !seen.has(p)));
        // 2. Recognize, with as many images at a time as there are background threads.
        this.stats.pending += todo.length;
        this.emitStatus(true);
        let next = 0;
        const workers = Array.from({ length: s.workers }, async () => {
          while (next < todo.length && !signal.aborted) {
            await this.gate!.wait();
            if (signal.aborted) break;
            const item = todo[next++]!;
            await this.recognizeOne(item.p, item.st, s).catch(() => undefined);
            this.stats.pending--;
            this.emitStatus();
            // Leave the processor alone for a moment between images.
            await new Promise((r) => setTimeout(r, 25));
          }
        });
        await Promise.all(workers);
      }
    } catch (err) {
      this.lastError = toOrbisError(err, 'ocr.index').message;
    } finally {
      offGate();
      this.current = undefined;
      this.stats.pending = 0;
      this.lastRunMs = Date.now();
      this.emitStatus(true);
    }
  }

  private async recognizeOne(p: string, st: import('node:fs').Stats, s: OcrIndexSettings): Promise<void> {
    const signal = this.ac?.signal;
    const langs = s.langs.join('+');
    const row = { path: p, size: st.size, mtime_ms: st.mtimeMs, langs, text: null as string | null, confidence: null as number | null, error: null as string | null };
    if (st.size > s.maxFileMB * 1024 * 1024) {
      this.stats.skipped++;
      this.deps.store.put([{ ...row, status: 'skipped', error: `Larger than ${s.maxFileMB} MB` }]);
      return;
    }
    const meta = await readMetadata(p).catch(() => undefined);
    if (meta?.width && meta.height && meta.width * meta.height > s.maxMegapixels * 1_000_000) {
      this.stats.skipped++;
      this.deps.store.put([{ ...row, status: 'skipped', error: `More than ${s.maxMegapixels} megapixels` }]);
      return;
    }
    try {
      const r = await recognizeFile(p, { langs: s.langs, detectOrientation: false, pdfTextPages: 'use-text' }, {
        engine: this.deps.engine,
        lane: 'background',
        signal,
        limits: { maxBytes: s.maxFileMB * 1024 * 1024, maxMegapixels: s.maxMegapixels },
      });
      // The file must not have changed while it was read.
      const again = await fsp.lstat(p).catch(() => undefined);
      if (!again || again.size !== st.size || again.mtimeMs !== st.mtimeMs) return;
      this.stats.recognized++;
      this.deps.store.put([{ ...row, status: 'ok', text: r.result.text, confidence: r.result.confidence }]);
    } catch (err) {
      const e = toOrbisError(err, 'ocr.index', p);
      if (e.category === 'cancelled') throw err;
      this.stats.failed++;
      this.deps.store.put([{ ...row, status: 'failed', error: e.message.slice(0, 300) }]);
    }
  }
}
