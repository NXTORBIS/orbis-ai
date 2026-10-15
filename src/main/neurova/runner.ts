import { spawn } from 'node:child_process'
import { check, type Envelope } from '../../shared/neurova/protocol.ts'
import type { FailureCode } from '../../shared/neurova/scheduler.ts'

export interface RunOptions {
  command: string
  args: string[]
  cwd?: string
  job: string
  outDir: string
  /** How long the worker has to say `ready` before it is treated as failed to start. Not a limit on generation. */
  startupMs: number
  /** Time allowed between a stop request and a forced end. */
  graceMs?: number
  signal?: AbortSignal
  onEvent?: (e: Envelope) => void
}

export interface RunResult {
  state: 'done' | 'failed' | 'cancelled'
  outputs: string[]
  code: FailureCode | null
  message: string | null
  /** Whether the worker ended on its own after a stop request. */
  graceful: boolean
  rejected: string[]
}

/**
 * Starts one worker, reads its JSON lines, and returns only what the validated protocol established.
 * It never trusts a "done" without the process ending and at least one authorised output.
 */
export function runWorker(o: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const outputs: string[] = []
    const rejected: string[] = []
    let lastSeq = 0
    let ready = false
    let done = false
    let error: { code: string; message: string } | null = null
    let cancelRequested = false
    let settled = false
    let buf = ''
    const child = spawn(o.command, o.args, { cwd: o.cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

    const finish = (r: RunResult): void => {
      if (settled) return
      settled = true
      clearTimeout(startTimer)
      clearTimeout(forceTimer)
      resolve(r)
    }
    const startTimer = setTimeout(() => {
      if (!ready) {
        timedOut = true
        child.kill()
      }
    }, o.startupMs)
    let timedOut = false
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    let graceful = true

    const stop = (): void => {
      if (cancelRequested) return
      cancelRequested = true
      child.kill('SIGTERM')
      forceTimer = setTimeout(() => {
        graceful = false
        child.kill('SIGKILL')
      }, o.graceMs ?? 5000)
    }
    if (o.signal) {
      if (o.signal.aborted) stop()
      else o.signal.addEventListener('abort', stop, { once: true })
    }

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      if (buf.length > 1_000_000) { buf = ''; rejected.push('output flood') }
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        const r = check(line, { job: o.job, outDir: o.outDir, lastSeq })
        if (!r.ok) { rejected.push(r.reason); continue }
        lastSeq = r.env.seq
        const m = r.env.msg
        if (m.type === 'ready') ready = true
        else if (m.type === 'output') outputs.push(m.path)
        else if (m.type === 'done') done = true
        else if (m.type === 'error') error = { code: m.code, message: m.message }
        o.onEvent?.(r.env)
      }
    })
    child.stderr.on('data', () => undefined)
    child.on('error', (err) => finish({ state: 'failed', outputs: [], code: 'RUNTIME_MISSING', message: err.message, graceful: true, rejected }))
    child.on('close', (exit) => {
      if (cancelRequested && !done) return finish({ state: 'cancelled', outputs: [], code: 'CANCELLED', message: null, graceful, rejected })
      if (timedOut) return finish({ state: 'failed', outputs: [], code: 'TIMEOUT', message: 'The worker did not become ready in time.', graceful, rejected })
      if (error) return finish({ state: 'failed', outputs: [], code: 'UNKNOWN', message: (error as { message: string }).message, graceful, rejected })
      if (exit !== 0) return finish({ state: 'failed', outputs: [], code: 'WORKER_CRASHED', message: `The worker exited with code ${exit}.`, graceful, rejected })
      if (!done || !outputs.length) return finish({ state: 'failed', outputs: [], code: 'OUTPUT_INVALID', message: 'The worker ended without reporting a finished output.', graceful, rejected })
      finish({ state: 'done', outputs, code: null, message: null, graceful, rejected })
    })
  })
}
