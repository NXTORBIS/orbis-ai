import { spawn, type ChildProcess } from 'node:child_process'
import { check, type Envelope } from '../../shared/neurova/protocol.ts'
import type { RunResult } from './runner.ts'

export interface SessionOptions {
  command: string
  /** Full argument list, including the worker script and `--serve`. */
  args: string[]
  cwd?: string
  /** Identity of the loaded model setup. A session is never reused for a different key. */
  configKey: string
  /** Unload (end the process) after this long with no job. Default 10 minutes. */
  idleMs?: number
  graceMs?: number
}

export interface SessionJob {
  job: string
  outDir: string
  /** The request object sent to the worker (without `cmd`). */
  request: Record<string, unknown>
  startupMs: number
  signal?: AbortSignal
  onEvent?: (e: Envelope) => void
}

export type SessionResult = RunResult & {
  /** True when the process failed before the job started (could not start, or died before saying anything). Safe to retry one-shot. */
  startFailure: boolean
}

/**
 * One long-lived worker process that keeps its model loaded between jobs. It is a cache, never a source of truth:
 * any doubt (crash, cancel, timeout, another config) ends the process and the next job starts a fresh one.
 */
export class WorkerSession {
  readonly configKey: string
  spawns = 0
  private readonly o: SessionOptions
  private child: ChildProcess | null = null
  private busy = false
  private idle: ReturnType<typeof setTimeout> | undefined
  private handler: ((chunk: Buffer) => void) | null = null

  constructor(o: SessionOptions) {
    this.o = o
    this.configKey = o.configKey
  }

  get alive(): boolean { return !!this.child && this.child.exitCode === null && !this.child.killed }
  get isBusy(): boolean { return this.busy }

  private clearIdle(): void { if (this.idle) clearTimeout(this.idle); this.idle = undefined }
  private armIdle(): void {
    this.clearIdle()
    this.idle = setTimeout(() => this.close(), this.o.idleMs ?? 10 * 60_000)
    this.idle.unref?.()
  }

  /** Ends the process: asks it to quit, then forces it. Safe to call at any time. */
  close(): void {
    this.clearIdle()
    const c = this.child
    this.child = null
    if (!c) return
    try { c.stdin?.write(JSON.stringify({ cmd: 'quit' }) + '\n') } catch { /* already gone */ }
    try { c.stdin?.end() } catch { /* ignore */ }
    const t = setTimeout(() => { try { c.kill('SIGKILL') } catch { /* ignore */ } }, this.o.graceMs ?? 3000)
    t.unref?.()
    c.once('close', () => clearTimeout(t))
  }

  private kill(): void {
    this.clearIdle()
    const c = this.child
    this.child = null
    if (!c) return
    try { c.kill('SIGTERM') } catch { /* ignore */ }
    const t = setTimeout(() => { try { c.kill('SIGKILL') } catch { /* ignore */ } }, this.o.graceMs ?? 3000)
    t.unref?.()
    c.once('close', () => clearTimeout(t))
  }

  private ensure(): ChildProcess {
    if (this.alive && this.child) return this.child
    const c = spawn(this.o.command, this.o.args, { cwd: this.o.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.spawns += 1
    this.child = c
    c.stderr?.on('data', () => undefined)
    c.stdout?.on('data', (b: Buffer) => this.handler?.(b))
    c.stdin?.on('error', () => undefined)
    return c
  }

  run(j: SessionJob): Promise<SessionResult> {
    if (this.busy) return Promise.resolve({ state: 'failed', outputs: [], code: 'UNKNOWN', message: 'The engine session is already running a job.', graceful: true, rejected: [], startFailure: false })
    this.busy = true
    this.clearIdle()
    return new Promise((resolve) => {
      const outputs: string[] = []
      const rejected: string[] = []
      let lastSeq = 0
      let sawAnything = false
      let ready = false
      let done = false
      let error: { code: string; message: string } | null = null
      let cancelled = false
      let timedOut = false
      let settled = false
      let buf = ''
      const child = this.ensure()

      const finish = (r: Omit<SessionResult, 'startFailure'>, kill: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(startTimer)
        this.handler = null
        this.busy = false
        j.signal?.removeEventListener('abort', onAbort)
        child.removeListener('close', onClose)
        child.removeListener('error', onError)
        if (kill) this.kill()
        else this.armIdle()
        resolve({ ...r, startFailure: !sawAnything && r.state === 'failed' })
      }
      const startTimer = setTimeout(() => {
        if (!ready) { timedOut = true; finish({ state: 'failed', outputs: [], code: 'TIMEOUT', message: 'The worker did not become ready in time.', graceful: true, rejected }, true) }
      }, j.startupMs)
      const onAbort = (): void => {
        cancelled = true
        finish({ state: 'cancelled', outputs: [], code: 'CANCELLED', message: null, graceful: true, rejected }, true)
      }
      const onError = (err: Error): void => finish({ state: 'failed', outputs: [], code: 'RUNTIME_MISSING', message: err.message, graceful: true, rejected }, true)
      const onClose = (exit: number | null): void => {
        if (cancelled || timedOut) return
        this.child = null
        finish({ state: 'failed', outputs: [], code: 'WORKER_CRASHED', message: `The worker exited with code ${exit}.`, graceful: true, rejected }, false)
      }
      child.once('error', onError)
      child.once('close', onClose)
      if (j.signal) { if (j.signal.aborted) { onAbort(); return } j.signal.addEventListener('abort', onAbort, { once: true }) }

      this.handler = (chunk: Buffer): void => {
        buf += chunk.toString('utf8')
        if (buf.length > 1_000_000) { buf = ''; rejected.push('output flood') }
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          const r = check(line, { job: j.job, outDir: j.outDir, lastSeq })
          if (!r.ok) { rejected.push(r.reason); continue }
          lastSeq = r.env.seq
          sawAnything = true
          const m = r.env.msg
          if (m.type === 'ready') ready = true
          else if (m.type === 'output') outputs.push(m.path)
          else if (m.type === 'done') done = true
          else if (m.type === 'error') error = { code: m.code, message: m.message }
          j.onEvent?.(r.env)
          if (settled) return
          if (done || error) {
            if (error) return finish({ state: 'failed', outputs: [], code: 'UNKNOWN', message: (error as { message: string }).message, graceful: true, rejected }, false)
            if (!outputs.length) return finish({ state: 'failed', outputs: [], code: 'OUTPUT_INVALID', message: 'The worker ended without reporting a finished output.', graceful: true, rejected }, false)
            return finish({ state: 'done', outputs, code: null, message: null, graceful: true, rejected }, false)
          }
        }
      }
      try {
        child.stdin?.write(JSON.stringify({ ...j.request, cmd: 'job', job: j.job, out_dir: j.outDir }) + '\n')
      } catch (e) {
        finish({ state: 'failed', outputs: [], code: 'WORKER_CRASHED', message: e instanceof Error ? e.message : 'Could not reach the worker.', graceful: true, rejected }, true)
      }
    })
  }
}

/** Holds at most one session; a request for a different config or engine ends the old one first. */
export class SessionHolder {
  private cur: WorkerSession | null = null
  private readonly make: (key: string) => WorkerSession

  constructor(make: (key: string) => WorkerSession) { this.make = make }

  get(key: string): WorkerSession {
    if (this.cur && this.cur.configKey !== key) { this.cur.close(); this.cur = null }
    if (!this.cur) this.cur = this.make(key)
    return this.cur
  }

  /** Ends whatever is loaded (engine switch, cancel, app quit). */
  drop(): void { this.cur?.close(); this.cur = null }
  get current(): WorkerSession | null { return this.cur }
}
