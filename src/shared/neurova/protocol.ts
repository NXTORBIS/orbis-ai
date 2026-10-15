// The messages a model worker may send, and the checks applied to every one of them.
// Output paths are authorised against the job's own folder; a worker cannot claim success for another job.

import { isAbsolute, relative, resolve } from 'node:path'

export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'stage'; stage: 'loading' | 'preparing' | 'generating' | 'decoding' }
  | { type: 'progress'; step: number; total: number }
  | { type: 'output'; path: string }
  | { type: 'done' }
  | { type: 'error'; code: string; message: string }

export interface Envelope { v: 1; job: string; seq: number; msg: WorkerMessage }

export interface Context { job: string; outDir: string; lastSeq: number }

export type Checked = { ok: true; env: Envelope } | { ok: false; reason: string }

const STAGES = new Set(['loading', 'preparing', 'generating', 'decoding'])
export const MAX_LINE = 64 * 1024

export const inside = (root: string, p: string): boolean => {
  if (typeof p !== 'string' || !p || p.includes('\0')) return false
  const rel = relative(resolve(root), resolve(root, p))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function check(line: string, ctx: Context): Checked {
  if (line.length > MAX_LINE) return { ok: false, reason: 'message too large' }
  let raw: unknown
  try { raw = JSON.parse(line) } catch { return { ok: false, reason: 'not JSON' } }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' }
  const e = raw as Record<string, unknown>
  if (e.v !== 1) return { ok: false, reason: 'unknown protocol version' }
  if (e.job !== ctx.job) return { ok: false, reason: 'message for another job' }
  if (typeof e.seq !== 'number' || !Number.isInteger(e.seq) || e.seq <= ctx.lastSeq) return { ok: false, reason: 'out of order' }
  const m = e.msg as Record<string, unknown> | undefined
  if (!m || typeof m.type !== 'string') return { ok: false, reason: 'no message' }
  switch (m.type) {
    case 'ready':
    case 'done':
      break
    case 'stage':
      if (typeof m.stage !== 'string' || !STAGES.has(m.stage)) return { ok: false, reason: 'unknown stage' }
      break
    case 'progress':
      if (typeof m.step !== 'number' || typeof m.total !== 'number' || m.total <= 0 || m.step < 0 || m.step > m.total) return { ok: false, reason: 'progress out of range' }
      break
    case 'output':
      if (typeof m.path !== 'string' || !inside(ctx.outDir, m.path)) return { ok: false, reason: 'output path outside the job folder' }
      break
    case 'error':
      if (typeof m.code !== 'string' || typeof m.message !== 'string') return { ok: false, reason: 'bad error' }
      break
    default:
      return { ok: false, reason: 'unknown message type' }
  }
  return { ok: true, env: { v: 1, job: e.job as string, seq: e.seq, msg: m as unknown as WorkerMessage } }
}
