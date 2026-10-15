import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type * as NodePty from 'node-pty';
import { makeError } from '../../shared/errors';
import {
  parseLsofCwd, parseProcStat, shellName, terminalEnv, TERM_BATCH_MAX, TERM_BATCH_MS, TERM_HIGH_WATER, TERM_LOW_WATER, TERM_SESSIONS_MAX,
  type ShellInfo, type TermCwd, type TermSessionInfo, type TermStatus,
} from '../../shared/terminal';
import { resolveShell, type ShellSettings } from './shells';

/**
 * Real pseudo-terminals for the built-in terminal (node-pty). Each session
 * belongs to the window (WebContents id) that created it; every call names
 * that owner and a session of another window is "not found". Output is
 * batched and flow-controlled: the window acknowledges what it has parsed
 * and the PTY is paused while too much is unacknowledged, so a program that
 * prints without end (`yes`) blocks instead of flooding the window.
 *
 * node-pty is loaded on first use, so a missing or broken native module only
 * makes the terminal unavailable (with the reason) and never stops the app.
 */

type PtyModule = typeof NodePty;

interface Session {
  id: string;
  owner: number;
  pty: NodePty.IPty;
  shell: ShellInfo;
  info: TermSessionInfo;
  pending: string;
  timer?: NodeJS.Timeout;
  unacked: number;
  paused: boolean;
  /** How often output was paused (flow control), for diagnostics and tests. */
  pauses: number;
  exited?: { exitCode: number; signal?: number };
  killTimer?: NodeJS.Timeout;
  /** While output is paused: checks that the program is still running (see watchWhilePaused). */
  exitWatch?: NodeJS.Timeout;
  /** The program has ended: output is never paused again, so what is left in the PTY drains. */
  childGone?: boolean;
}

export interface TerminalEvents {
  data: (owner: number, payload: { id: string; data: string }) => void;
  exit: (owner: number, payload: { id: string; exitCode: number; signal?: number }) => void;
}

export interface TerminalServiceOptions {
  /** Loads node-pty (injected by tests; the app uses require). */
  loadPty?: () => PtyModule;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  appVersion?: string;
  /** Flow-control thresholds (tests use small ones). */
  highWater?: number;
  lowWater?: number;
}

export class TerminalService extends EventEmitter {
  private sessions = new Map<string, Session>();
  private ptyModule?: PtyModule;
  private loadError?: string;
  readonly platform: NodeJS.Platform;
  private readonly highWater: number;
  private readonly lowWater: number;

  constructor(private readonly opts: TerminalServiceOptions = {}) {
    super();
    this.platform = opts.platform ?? process.platform;
    this.highWater = opts.highWater ?? TERM_HIGH_WATER;
    this.lowWater = opts.lowWater ?? TERM_LOW_WATER;
  }

  override on<E extends keyof TerminalEvents>(event: E, listener: TerminalEvents[E]): this {
    return super.on(event, listener);
  }

  /** Whether PTYs can be created here; the reason when not. */
  availability(): { available: boolean; reason?: string } {
    try {
      this.pty();
      return { available: true };
    } catch (err) {
      return { available: false, reason: (err as Error).message };
    }
  }

  private pty(): PtyModule {
    if (this.ptyModule) return this.ptyModule;
    if (this.loadError) throw makeError('unavailable', 'term.create', { message: this.loadError });
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.ptyModule = this.opts.loadPty ? this.opts.loadPty() : (require('node-pty') as PtyModule);
      return this.ptyModule;
    } catch (err) {
      this.loadError = `The terminal component (node-pty) could not be loaded on this system: ${(err as Error).message.split('\n')[0]}`;
      throw makeError('unavailable', 'term.create', { message: this.loadError });
    }
  }

  private get(owner: number, id: string, op: string): Session {
    const s = this.sessions.get(id);
    // A session of another window is indistinguishable from one that does not exist.
    if (!s || s.owner !== owner) throw makeError('not_found', op, { message: 'This terminal session does not exist (it may have been closed).' });
    return s;
  }

  async create(owner: number, req: { cwd?: string; cols: number; rows: number }, settings: ShellSettings): Promise<TermSessionInfo> {
    const pty = this.pty();
    if ([...this.sessions.values()].filter((s) => s.owner === owner).length >= TERM_SESSIONS_MAX) {
      throw makeError('validation', 'term.create', { message: `At most ${TERM_SESSIONS_MAX} terminals can be open in one window. Close one first.` });
    }
    const shell = await resolveShell(settings, { env: this.opts.env, platform: this.platform });
    const home = os.homedir();
    let cwd = home;
    let startNote: string | undefined;
    if (req.cwd) {
      const abs = this.platform === 'win32' ? path.win32.isAbsolute(req.cwd) : path.isAbsolute(req.cwd);
      const st = abs && !req.cwd.includes('\0') ? await fsp.stat(req.cwd).catch(() => undefined) : undefined;
      if (st?.isDirectory()) cwd = path.resolve(req.cwd);
      else startNote = `“${req.cwd}” is not a folder on this computer, so the terminal started in your home folder.`;
    }
    const env = terminalEnv(this.opts.env ?? process.env, { termProgramVersion: this.opts.appVersion, platform: this.platform });
    let p: NodePty.IPty;
    try {
      p = pty.spawn(shell.path, shell.args, { name: 'xterm-256color', cols: req.cols, rows: req.rows, cwd, env });
    } catch (err) {
      throw makeError('unavailable', 'term.create', { target: shell.path, message: `${shell.label} could not be started: ${(err as Error).message}` });
    }
    const id = `t${randomBytes(8).toString('hex')}`;
    const info: TermSessionInfo = { id, pid: p.pid, shell: shellName(shell.path), shellPath: shell.path, flavor: shell.flavor, startCwd: cwd, startNote, createdMs: Date.now() };
    const s: Session = { id, owner, pty: p, shell, info, pending: '', unacked: 0, paused: false, pauses: 0 };
    this.sessions.set(id, s);
    p.onData((d) => this.queue(s, d));
    this.drainAtEnd(s);
    p.onExit(({ exitCode, signal }) => {
      clearTimeout(s.killTimer);
      clearInterval(s.exitWatch);
      this.flush(s);
      s.exited = { exitCode, signal: signal || undefined };
      s.info = { ...s.info, exited: s.exited };
      this.emit('exit', s.owner, { id, exitCode, signal: signal || undefined });
    });
    return info;
  }

  /**
   * libuv ends a stream when the PTY hangs up after a short read, even though the kernel still holds
   * output (most likely when output was paused for flow control just before the program exited); Node
   * then closes the descriptor and that output is lost. Just before that happens ('end' runs before the
   * socket is destroyed), read what is left synchronously, until EIO or EAGAIN. Not on Windows (ConPTY).
   */
  private drainAtEnd(s: Session): void {
    const sock = (s.pty as unknown as { _socket?: NodeJS.ReadableStream & { prependListener: (e: string, f: () => void) => void; _readableState?: { decoder?: StringDecoder } } })._socket;
    const fd = (s.pty as unknown as { _fd?: number })._fd;
    if (this.platform === 'win32' || !sock || typeof fd !== 'number') return;
    sock.prependListener('end', () => {
      const decoder = sock._readableState?.decoder ?? new StringDecoder('utf8');
      const buf = Buffer.alloc(64 * 1024);
      for (let i = 0; i < 1024; i++) {
        let n = 0;
        try {
          n = fs.readSync(fd, buf, 0, buf.length, null);
        } catch {
          break; // EIO: everything was read; EAGAIN: nothing left right now
        }
        if (n <= 0) break;
        const text = decoder.write(buf.subarray(0, n));
        if (text) this.queue(s, text);
      }
    });
  }

  private queue(s: Session, data: string): void {
    s.pending += data;
    if (s.pending.length >= TERM_BATCH_MAX) this.flush(s);
    else if (!s.timer) s.timer = setTimeout(() => this.flush(s), TERM_BATCH_MS);
  }

  private flush(s: Session): void {
    clearTimeout(s.timer);
    s.timer = undefined;
    if (!s.pending) return;
    const data = s.pending;
    s.pending = '';
    s.unacked += data.length;
    this.emit('data', s.owner, { id: s.id, data });
    if (!s.paused && !s.exited && !s.childGone && s.unacked > this.highWater) {
      s.paused = true;
      s.pauses++;
      try {
        s.pty.pause();
      } catch {
        /* exited meanwhile */
      }
      this.watchWhilePaused(s);
    }
  }

  /**
   * node-pty destroys the PTY's socket 200 ms after the program exits (its guard against sockets that
   * never close), dropping whatever is still unread. While output is paused for flow control nothing is
   * read, so the end of the output of a program that exits then would be lost. While paused, check every
   * 40 ms that the program is still alive; once it is gone, resume so the rest drains before that timer.
   */
  private watchWhilePaused(s: Session): void {
    clearInterval(s.exitWatch);
    s.exitWatch = setInterval(() => {
      if (!s.paused || s.exited) {
        clearInterval(s.exitWatch);
        return;
      }
      let alive = true;
      try {
        process.kill(s.pty.pid, 0);
      } catch (err) {
        alive = (err as NodeJS.ErrnoException).code === 'EPERM';
      }
      if (alive) return;
      clearInterval(s.exitWatch);
      s.childGone = true;
      s.paused = false;
      try {
        s.pty.resume();
      } catch {
        /* already closed */
      }
    }, 40);
    s.exitWatch.unref?.();
  }

  /** The window parsed `chars` characters of output. */
  ack(owner: number, id: string, chars: number): { paused: boolean } {
    const s = this.get(owner, id, 'term.ack');
    s.unacked = Math.max(0, s.unacked - chars);
    if (s.paused && s.unacked < this.lowWater) {
      s.paused = false;
      clearInterval(s.exitWatch);
      try {
        s.pty.resume();
      } catch {
        /* exited meanwhile */
      }
    }
    return { paused: s.paused };
  }

  write(owner: number, id: string, data: string): void {
    const s = this.get(owner, id, 'term.write');
    if (s.exited) throw makeError('unavailable', 'term.write', { message: 'The program in this terminal has ended.' });
    s.pty.write(data);
  }

  resize(owner: number, id: string, cols: number, rows: number): void {
    const s = this.get(owner, id, 'term.resize');
    if (s.exited) return;
    try {
      s.pty.resize(cols, rows);
    } catch {
      /* the PTY closed between the check and the call */
    }
  }

  /** End a session's process (if it still runs) and forget the session. */
  kill(owner: number, id: string): void {
    const s = this.get(owner, id, 'term.kill');
    this.end(s);
  }

  private end(s: Session): void {
    this.sessions.delete(s.id);
    clearTimeout(s.timer);
    clearInterval(s.exitWatch);
    if (s.exited) return;
    if (s.paused) {
      try {
        s.pty.resume();
      } catch {
        /* ignore */
      }
    }
    try {
      s.pty.kill();
    } catch {
      /* already gone */
    }
    // A shell that ignores SIGHUP is stopped for good after a moment.
    if (this.platform !== 'win32') {
      s.killTimer = setTimeout(() => {
        if (s.exited) return;
        try {
          process.kill(s.pty.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }, 3000);
      s.killTimer.unref?.();
    }
  }

  /** Flow-control state of a session (diagnostics and tests). */
  flow(owner: number, id: string): { unacked: number; paused: boolean; pauses: number } {
    const s = this.get(owner, id, 'term.flow');
    return { unacked: s.unacked, paused: s.paused, pauses: s.pauses };
  }

  list(owner: number): TermSessionInfo[] {
    return [...this.sessions.values()].filter((s) => s.owner === owner).map((s) => s.info);
  }

  /** End every session of a window (closed or reloaded). */
  killOwner(owner: number): number {
    const mine = [...this.sessions.values()].filter((s) => s.owner === owner);
    for (const s of mine) this.end(s);
    return mine.length;
  }

  killAll(): void {
    for (const s of [...this.sessions.values()]) this.end(s);
  }

  /**
   * What runs in a session. Linux: /proc/<shell>/stat gives the terminal's
   * foreground process group (tpgid); a group other than the shell's own means a
   * program has the terminal, named by /proc/<tpgid>/comm. macOS: node-pty's
   * foreground process name compared with the shell's. Windows: unknown (null).
   */
  status(owner: number, id: string, opts: { children?: boolean } = {}): TermStatus {
    const s = this.get(owner, id, 'term.status');
    if (s.exited) return { id, exited: true, busy: false, how: this.platform === 'linux' ? 'proc' : this.platform === 'darwin' ? 'pty-process' : 'unavailable' };
    if (this.platform === 'linux') {
      const st = readStat(s.pty.pid);
      if (st) {
        const busy = st.tpgid > 0 && st.tpgid !== st.pgrp;
        const program = busy ? readComm(st.tpgid) ?? safeProcess(s.pty) : undefined;
        return { id, exited: false, busy, program, shellState: st.state, children: opts.children ? countChildren(s.pty.pid) : undefined, how: 'proc' };
      }
    }
    if (this.platform === 'darwin' || this.platform === 'linux') {
      const fg = safeProcess(s.pty);
      if (fg) {
        const busy = fg.replace(/^-/, '') !== shellName(s.shell.path);
        return { id, exited: false, busy, program: busy ? fg : undefined, how: 'pty-process' };
      }
    }
    return { id, exited: false, busy: null, how: 'unavailable' };
  }

  /** Sessions of a window whose shell has a program running (or may have: Windows cannot tell). */
  running(owner: number): Array<{ id: string; shell: string; program?: string; unknown?: boolean }> {
    const out: Array<{ id: string; shell: string; program?: string; unknown?: boolean }> = [];
    for (const s of this.sessions.values()) {
      if (s.owner !== owner || s.exited) continue;
      const st = this.status(owner, s.id, { children: true });
      if (st.busy === null) out.push({ id: s.id, shell: s.info.shell, unknown: true });
      else if (st.busy || (st.children ?? 0) > 0) out.push({ id: s.id, shell: s.info.shell, program: st.program ?? (st.children ? 'a background job' : undefined) });
    }
    return out;
  }

  /** Every window that has running sessions (for quitting). */
  owners(): number[] {
    return [...new Set([...this.sessions.values()].filter((s) => !s.exited).map((s) => s.owner))];
  }

  /** The shell's current folder: /proc/<pid>/cwd on Linux, lsof on macOS, unavailable on Windows. */
  async cwd(owner: number, id: string): Promise<TermCwd> {
    const s = this.get(owner, id, 'term.cwd');
    if (s.exited) return { ok: false, reason: 'The program in this terminal has ended.' };
    const pid = s.pty.pid;
    if (this.platform === 'linux') {
      try {
        return { ok: true, path: await fsp.readlink(`/proc/${pid}/cwd`), how: 'proc' };
      } catch (err) {
        return { ok: false, reason: `The shell's folder could not be read (${(err as NodeJS.ErrnoException).code ?? 'error'}).` };
      }
    }
    if (this.platform === 'darwin') {
      const out = await new Promise<string | undefined>((resolve) => {
        execFile('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], { timeout: 4000, maxBuffer: 64 * 1024 }, (err, stdout) => resolve(err ? undefined : stdout));
      });
      const p = out ? parseLsofCwd(out) : undefined;
      return p ? { ok: true, path: p, how: 'lsof' } : { ok: false, reason: 'The shell’s folder could not be read with lsof.' };
    }
    return { ok: false, reason: 'Windows does not let Orbis Files read the folder a shell is in, so this is not available on Windows.' };
  }
}

function readStat(pid: number) {
  try {
    return parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return undefined;
  }
}

function readComm(pid: number): string | undefined {
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

function safeProcess(p: NodePty.IPty): string | undefined {
  try {
    return p.process || undefined;
  } catch {
    return undefined;
  }
}

/** Child processes of `pid` (Linux): every /proc/<n>/stat whose parent is `pid`. */
function countChildren(pid: number): number {
  let n = 0;
  let dirs: string[];
  try {
    dirs = fs.readdirSync('/proc');
  } catch {
    return 0;
  }
  for (const d of dirs) {
    if (!/^\d+$/.test(d)) continue;
    const st = readStat(Number(d));
    if (st?.ppid === pid) n++;
  }
  return n;
}
