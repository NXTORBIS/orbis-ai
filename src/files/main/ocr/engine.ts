import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { makeError, OrbisError } from '../../shared/errors';
import { OCR_LIMITS, type OcrWord, type QuarterTurn } from '../../shared/ocr';

/**
 * Pool of text-recognition worker threads (see worker.ts). Work is split into lanes,
 * each with its own threads, so a long batch never makes the panel wait and the
 * background job never competes at normal priority:
 *
 *   interactive  1 thread, normal priority  ("Recognize text" in the panel)
 *   batch        1 thread, normal priority  ("Extract text to files" operations)
 *   background   1–2 threads, lowest priority (Linux: nice 19 for that thread only)
 *
 * Every call has a time limit; a call that runs over it, or whose AbortSignal
 * fires, terminates its thread at once (WebAssembly cannot be interrupted any
 * other way) and the next call starts a fresh one. Idle threads end after a
 * minute, so the engine and its language data do not stay in memory.
 */

export type OcrLane = 'interactive' | 'batch' | 'background';

export interface RecognizeOutput {
  text: string;
  /** Tesseract's mean text confidence (0–100). */
  confidence: number;
  words: OcrWord[];
  width: number;
  height: number;
  skew: number;
  turn: QuarterTurn;
}

export interface LanguageSource {
  /** Language data bytes (gzip or plain) for a code; throws a readable error when it is not installed. */
  load(code: string): Promise<Uint8Array>;
}

export interface OcrEngineOptions {
  /** Folder with tesseract-core-simd-lstm.wasm and tesseract-core-lstm.wasm. */
  wasmDir: string;
  /** The bundled worker script (dist/main/ocr-worker.cjs); it runs as an eval worker, so it can live in app.asar. */
  workerScript: string;
  languages: LanguageSource;
  idleMs?: number;
  timeoutMs?: number;
  /** Background lane size (1 or 2); can be changed later. */
  backgroundWorkers?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

interface CallOpts { timeoutMs?: number; signal?: AbortSignal; onProgress?: (fraction: number) => void }

/** A tiny module that only validates where WebAssembly SIMD is supported (as wasm-feature-detect checks it). */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
export const simdSupported = (): boolean => {
  try {
    return (globalThis as unknown as { WebAssembly: { validate(b: Uint8Array): boolean } }).WebAssembly.validate(SIMD_PROBE);
  } catch {
    return false;
  }
};

class EngineThread {
  readonly worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; onProgress?: (f: number) => void }>();
  dead = false;
  langs = '';
  lastUsed = Date.now();
  busy = false;

  constructor(script: string, wasm: Uint8Array, variant: 'simd' | 'plain', readonly lane: OcrLane, private readonly onExit: (t: EngineThread) => void, private readonly defaultTimeoutMs: number = OCR_LIMITS.pageTimeoutMs) {
    this.worker = new Worker(script, { eval: true, workerData: { wasm, variant, lowPriority: lane === 'background' } });
    this.worker.on('message', (m: { id: number; ok?: boolean; value?: unknown; message?: string; progress?: number }) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.progress !== undefined && m.ok === undefined) {
        p.onProgress?.(m.progress);
        return;
      }
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(makeError('io', 'ocr.engine', { message: m.message ?? 'Text recognition failed.' }));
    });
    const fail = (why: string) => {
      if (this.dead) return;
      this.dead = true;
      for (const p of this.pending.values()) p.reject(makeError('internal', 'ocr.engine', { message: why }));
      this.pending.clear();
      this.onExit(this);
    };
    this.worker.on('error', (err) => fail(`The text recognition engine stopped unexpectedly: ${err.message}`));
    this.worker.on('exit', () => fail('The text recognition engine stopped.'));
  }

  call<T>(type: string, payload: Record<string, unknown>, opts: CallOpts = {}, transfer: ArrayBuffer[] = []): Promise<T> {
    if (this.dead) return Promise.reject(makeError('unavailable', 'ocr.engine', { message: 'The text recognition engine is not running.' }));
    const id = ++this.seq;
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    if (opts.signal?.aborted) return Promise.reject(makeError('cancelled', 'ocr.engine'));
    return new Promise<T>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      };
      // Cancelled while the engine works: the only way to stop WebAssembly is to end its thread.
      const onAbort = () => {
        done();
        this.pending.delete(id);
        reject(makeError('cancelled', 'ocr.engine'));
        this.kill();
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        done();
        this.pending.delete(id);
        reject(makeError('busy', 'ocr.engine', { message: `Text recognition took longer than ${Math.round(timeoutMs / 1000)} s and was stopped. Try a smaller image or fewer languages.`, retryable: true }));
        this.kill();
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          done();
          resolve(v as T);
        },
        reject: (e) => {
          done();
          reject(e);
        },
        onProgress: opts.onProgress,
      });
      this.worker.postMessage({ id, type, ...payload }, transfer);
    });
  }

  /** Stop the thread now (running WebAssembly included). */
  kill(): void {
    if (this.dead) return;
    void this.worker.terminate();
  }
}

/** A thread borrowed from a lane for one file (a searchable PDF needs every page on the same thread). */
export interface OcrLease {
  recognize(image: Uint8Array, opts: { langs: string[]; orientation?: number; detectOrientation: boolean; dpi?: number; addToPdf?: boolean } & CallOpts): Promise<RecognizeOutput>;
  pdfBegin(title: string, langs: string[], opts?: CallOpts): Promise<void>;
  pdfEnd(opts?: CallOpts): Promise<Uint8Array>;
  /** The thread's nice value and whether its priority was lowered (tests and diagnostics). */
  nice(): Promise<{ nice: number | null; priority: string }>;
  /** Proves the network guard inside the thread (tests): returns the error a fetch got. */
  fetchTest(url: string): Promise<string>;
  release(): void;
}

export class OcrEngine {
  private threads = new Set<EngineThread>();
  private waiters: Array<{ lane: OcrLane; resolve: (t: EngineThread) => void; reject: (e: unknown) => void; signal?: AbortSignal }> = [];
  private wasm: Uint8Array | undefined;
  private script: string | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  readonly variant: 'simd' | 'plain' = simdSupported() ? 'simd' : 'plain';
  private laneSize: Record<OcrLane, number> = { interactive: 1, batch: 1, background: 1 };

  constructor(private readonly opts: OcrEngineOptions) {
    this.laneSize.background = Math.max(1, Math.min(2, opts.backgroundWorkers ?? 1));
  }

  /** Whether the engine's files are present (worker script and WebAssembly). */
  available(): boolean {
    return fs.existsSync(this.opts.workerScript) && fs.existsSync(this.wasmPath());
  }

  setBackgroundWorkers(n: number): void {
    this.laneSize.background = Math.max(1, Math.min(2, n));
    this.dispatch();
  }

  private wasmPath(): string {
    return path.join(this.opts.wasmDir, this.variant === 'simd' ? 'tesseract-core-simd-lstm.wasm' : 'tesseract-core-lstm.wasm');
  }

  private async load(): Promise<{ wasm: Uint8Array; script: string }> {
    if (!this.wasm) {
      this.wasm = new Uint8Array(await fsp.readFile(this.wasmPath()).catch(() => {
        throw makeError('unavailable', 'ocr.engine', { message: 'The text recognition engine is missing from this installation.' });
      }));
    }
    this.script ??= await fsp.readFile(this.opts.workerScript, 'utf8').catch(() => {
      throw makeError('unavailable', 'ocr.engine', { message: 'The text recognition worker is missing from this installation.' });
    });
    return { wasm: this.wasm, script: this.script };
  }

  /** Borrow a thread of `lane` (waits while all of that lane's threads are busy). */
  async acquire(lane: OcrLane, signal?: AbortSignal): Promise<OcrLease> {
    return this.lease(await this.take(lane, signal), lane, signal);
  }

  private async take(lane: OcrLane, signal?: AbortSignal): Promise<EngineThread> {
    if (this.stopped) throw makeError('unavailable', 'ocr.engine', { message: 'Text recognition has stopped.' });
    if (signal?.aborted) throw makeError('cancelled', 'ocr.engine');
    const { wasm, script } = await this.load();
    return new Promise<EngineThread>((resolve, reject) => {
      const w = { lane, resolve, reject, signal };
      this.waiters.push(w);
      signal?.addEventListener('abort', () => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(makeError('cancelled', 'ocr.engine'));
        }
      }, { once: true });
      this.dispatch(wasm, script);
    });
  }

  private dispatch(wasm = this.wasm, script = this.script): void {
    if (!wasm || !script) return;
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i]!;
      const laneThreads = [...this.threads].filter((t) => t.lane === w.lane && !t.dead);
      let t = laneThreads.find((x) => !x.busy);
      if (!t && laneThreads.length < this.laneSize[w.lane]) {
        t = new EngineThread(script, wasm, this.variant, w.lane, (dead) => {
          this.threads.delete(dead);
          this.dispatch();
        }, this.opts.timeoutMs);
        this.threads.add(t);
      }
      if (!t) continue;
      t.busy = true;
      this.waiters.splice(i, 1);
      i--;
      w.resolve(t);
    }
  }

  private lease(first: EngineThread, lane: OcrLane, signal?: AbortSignal): OcrLease {
    let released = false;
    let t = first;
    // A thread stopped by a time limit is replaced for the next call (a searchable PDF in progress is lost with it).
    const live = async () => {
      if (t.dead && !released) {
        t = await this.take(lane, signal);
      }
    };
    const ensureLangs = async (langs: string[], o: CallOpts) => {
      await live();
      const key = langs.join('+');
      if (t.langs === key) return;
      const data: Array<{ code: string; data: Uint8Array }> = [];
      for (const code of langs) data.push({ code, data: await this.opts.languages.load(code) });
      await t.call('init', { langs: data }, { ...o, timeoutMs: Math.max(o.timeoutMs ?? 0, 120_000) });
      t.langs = key;
    };
    return {
      recognize: async (image, o) => {
        await ensureLangs(o.langs, o);
        const copy = new Uint8Array(image);
        return t.call<RecognizeOutput>('recognize', { image: copy, orientation: o.orientation ?? 1, detectOrientation: o.detectOrientation, dpi: o.dpi, addToPdf: !!o.addToPdf }, o, [copy.buffer]);
      },
      pdfBegin: async (title, langs, o = {}) => {
        await ensureLangs(langs, o);
        await t.call('pdf-begin', { title }, o);
      },
      pdfEnd: async (o = {}) => {
        await live();
        return t.call<Uint8Array>('pdf-end', {}, o);
      },
      nice: async () => {
        await live();
        return t.call('nice', {});
      },
      fetchTest: async (url) => {
        await live();
        return t.call('fetch-test', { url });
      },
      release: () => {
        if (released) return;
        released = true;
        t.busy = false;
        t.lastUsed = Date.now();
        this.scheduleIdle();
        this.dispatch();
      },
    };
  }

  private scheduleIdle(): void {
    clearTimeout(this.idleTimer);
    const idleMs = this.opts.idleMs ?? 60_000;
    this.idleTimer = setTimeout(() => {
      for (const t of this.threads) if (!t.busy && Date.now() - t.lastUsed >= idleMs - 50) t.kill();
      if ([...this.threads].some((t) => !t.dead)) this.scheduleIdle();
    }, idleMs);
    this.idleTimer.unref?.();
  }

  /** Start the engine with one language file the user wants to add (refused when Tesseract cannot load it). */
  async verifyLanguage(code: string, data: Uint8Array, signal?: AbortSignal): Promise<void> {
    const t = await this.take('interactive', signal);
    try {
      await t.call('init', { langs: [{ code, data: new Uint8Array(data) }] }, { timeoutMs: 120_000, signal });
    } finally {
      t.langs = '';
      t.busy = false;
      t.lastUsed = Date.now();
      this.scheduleIdle();
      this.dispatch();
    }
  }

  /** Threads alive now, per lane (diagnostics and tests). */
  threadCount(lane?: OcrLane): number {
    return [...this.threads].filter((t) => !t.dead && (!lane || t.lane === lane)).length;
  }

  /** Stop every thread (quit). Waiting callers are refused. */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.idleTimer);
    for (const w of this.waiters.splice(0)) w.reject(new OrbisError({ category: 'unavailable', operation: 'ocr.engine', message: 'Text recognition has stopped.', dataChanged: 'no', retryable: false }));
    for (const t of this.threads) t.kill();
  }
}
