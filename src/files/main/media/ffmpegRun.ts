import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { makeError } from '../../shared/errors';
import { estimateEta, FfmpegProgressParser, type ProgressSnapshot } from '../../shared/videoTools';
import type { RunContext } from '../ops/OperationManager';

/**
 * Runs FFmpeg / ffprobe for the video tools. Arguments are always an argv
 * array (never a shell). FFmpeg runs in its own process group on Linux and
 * macOS so that Cancel can kill the whole tree and Pause can stop it with
 * SIGSTOP (SIGCONT resumes); on Windows the tree is killed with taskkill and
 * pausing is not offered.
 */

export const PAUSE_SUPPORTED = process.platform !== 'win32';
export const PAUSE_UNAVAILABLE_REASON = 'Pausing FFmpeg is not supported on Windows; cancel it instead (nothing is kept).';

function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function signalTree(child: ChildProcess, sig: 'SIGSTOP' | 'SIGCONT'): void {
  if (!child.pid || child.exitCode !== null || process.platform === 'win32') return;
  try {
    process.kill(-child.pid, sig);
  } catch {
    try {
      child.kill(sig);
    } catch {
      /* already gone */
    }
  }
}

/** FFmpeg processes running now: their own process groups are ended when Orbis Files exits, so none is left behind. */
const running = new Set<ChildProcess>();
let exitHook = false;
function track(child: ChildProcess): void {
  running.add(child);
  if (exitHook) return;
  exitHook = true;
  process.once('exit', () => {
    for (const c of running) killTree(c);
  });
}

export interface FfmpegRun {
  bin: string;
  /** Arguments after the common ones (-hide_banner -nostdin -nostats -progress pipe:1 -loglevel error). */
  args: string[];
  /** Output seconds expected (for the fraction and the time-left estimate). */
  totalSec?: number;
  ctx: RunContext;
  /** Called for every progress block with the fraction (0–1) of this run and the seconds left. */
  onProgress?: (p: { fraction?: number; etaSec?: number; snapshot: ProgressSnapshot }) => void;
  /** What the error message names when FFmpeg fails ("trim the video"…). */
  what: string;
  op: string;
}

/** Last meaningful lines of FFmpeg's error output, for messages. */
export function ffmpegErrorTail(stderr: string): string {
  return stderr.split('\n').map((l) => l.trim()).filter((l) => l && !/^(Press \[q\]|frame=|size=)/.test(l)).slice(-3).join(' ').slice(0, 600);
}

/**
 * Run FFmpeg to completion. Resolves on exit code 0; rejects with a
 * `cancelled` error when the operation was cancelled (after the process is
 * gone, so its partial output can be removed safely), otherwise with an `io`
 * error carrying FFmpeg's own explanation.
 */
export function runFfmpeg(r: FfmpegRun): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    if (r.ctx.signal.aborted) return reject(makeError('cancelled', r.op));
    const child = spawn(r.bin, ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1', ...r.args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    track(child);
    const parser = new FfmpegProgressParser();
    let stderr = '';
    // Running time without the paused stretches, for the estimate.
    let activeMs = 0;
    let since = Date.now();
    let paused = false;
    const offPause = r.ctx.onPauseChange((p) => {
      if (p === paused) return;
      paused = p;
      if (p) activeMs += Date.now() - since;
      else since = Date.now();
      signalTree(child, p ? 'SIGSTOP' : 'SIGCONT');
    });
    // The operation may have been paused before FFmpeg started.
    if (r.ctx.paused) {
      paused = true;
      signalTree(child, 'SIGSTOP');
    }
    const abort = () => killTree(child);
    r.ctx.signal.addEventListener('abort', abort, { once: true });
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      for (const snap of parser.push(chunk)) {
        const ms = activeMs + (paused ? 0 : Date.now() - since);
        const done = snap.outTimeSec;
        const fraction = r.totalSec && done !== undefined ? Math.max(0, Math.min(1, done / r.totalSec)) : snap.end ? 1 : undefined;
        r.onProgress?.({ fraction, etaSec: done !== undefined ? estimateEta(done, r.totalSec, ms) : undefined, snapshot: snap });
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (c: string) => {
      stderr = (stderr + c).slice(-8000);
    });
    let started = true;
    child.on('error', (e) => {
      started = false;
      running.delete(child);
      offPause();
      r.ctx.signal.removeEventListener('abort', abort);
      reject(makeError('io', r.op, { message: `FFmpeg could not be started: ${e.message}` }));
    });
    child.on('close', (code, signal) => {
      running.delete(child);
      if (!started) return;
      offPause();
      r.ctx.signal.removeEventListener('abort', abort);
      if (r.ctx.signal.aborted) return reject(makeError('cancelled', r.op));
      if (code === 0) return resolve({ stderr });
      const tail = ffmpegErrorTail(stderr);
      reject(makeError('io', r.op, { message: `FFmpeg could not ${r.what}: ${tail || (signal ? `stopped by ${signal}` : `exit code ${code}`)}` }));
    });
  });
}

/** Run a short helper (ffprobe) and return its standard output. */
export function runQuiet(bin: string, args: string[], timeoutMs = 30000, maxBuffer = 16 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error(ffmpegErrorTail(String(stderr ?? '')) || err.message), { code: (err as NodeJS.ErrnoException).code }));
      else resolve(String(stdout));
    });
  });
}

/**
 * An input or output path FFmpeg cannot mistake for an option or a protocol:
 * absolute paths get the `file:` protocol prefix (so a name such as
 * "-y.mp4" or "http:x" is always a local file).
 */
export function ffPath(p: string): string {
  return `file:${p}`;
}
