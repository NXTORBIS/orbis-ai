// Bounded, explicit audio operations. Each returns a NEW signal; the source is never touched.
// Estimates (tempo) say how reliable they are instead of pretending to be exact.

import type { Decoded } from './wav.ts'

export type Op =
  | { kind: 'gain'; db: number }
  | { kind: 'fade-in'; seconds: number }
  | { kind: 'fade-out'; seconds: number }
  | { kind: 'trim-silence'; thresholdDb?: number; marginSec?: number }

export type OpResult = { ok: true; audio: Decoded; note: string } | { ok: false; reason: string }

const frames = (d: Decoded): number => (d.channels[0] ? d.channels[0].length : 0)
const clone = (d: Decoded): Decoded => ({ sampleRate: d.sampleRate, channels: d.channels.map((c) => Float32Array.from(c)) })

export function applyOp(src: Decoded, op: Op): OpResult {
  const n = frames(src)
  if (n === 0) return { ok: false, reason: 'There is no audio to change.' }
  const rate = src.sampleRate
  if (op.kind === 'gain') {
    if (!Number.isFinite(op.db) || op.db < -60 || op.db > 24) return { ok: false, reason: 'Gain must be between -60 and +24 dB.' }
    const k = 10 ** (op.db / 20)
    const out = clone(src)
    for (const c of out.channels) for (let i = 0; i < c.length; i++) c[i] *= k
    return { ok: true, audio: out, note: `Gain ${op.db >= 0 ? '+' : ''}${op.db} dB` }
  }
  if (op.kind === 'fade-in' || op.kind === 'fade-out') {
    if (!Number.isFinite(op.seconds) || op.seconds <= 0) return { ok: false, reason: 'A fade needs a length above zero.' }
    const len = Math.round(op.seconds * rate)
    if (len > n) return { ok: false, reason: 'The fade is longer than the song.' }
    const out = clone(src)
    for (const c of out.channels) {
      for (let i = 0; i < len; i++) {
        const g = len === 1 ? 0 : i / (len - 1)
        if (op.kind === 'fade-in') c[i] *= g
        else c[n - 1 - i] *= g
      }
    }
    return { ok: true, audio: out, note: `${op.kind === 'fade-in' ? 'Fade in' : 'Fade out'} ${op.seconds} s` }
  }
  const thr = 10 ** ((op.thresholdDb ?? -50) / 20)
  const margin = Math.round((op.marginSec ?? 0.25) * rate)
  const loud = (i: number): boolean => src.channels.some((c) => Math.abs(c[i]) > thr)
  let a = 0
  while (a < n && !loud(a)) a++
  if (a === n) return { ok: false, reason: 'The whole file is below the threshold, so nothing would be left.' }
  let b = n - 1
  while (b > a && !loud(b)) b--
  const start = Math.max(0, a - margin)
  const end = Math.min(n, b + 1 + margin)
  if (start === 0 && end === n) return { ok: false, reason: 'There is no leading or trailing silence to trim.' }
  const out: Decoded = { sampleRate: rate, channels: src.channels.map((c) => c.slice(start, end)) }
  return { ok: true, audio: out, note: `Trimmed ${(start / rate).toFixed(2)} s from the start and ${((n - end) / rate).toFixed(2)} s from the end` }
}

export interface Tempo {
  /** Best estimate, beats per minute. */
  bpm: number
  /** Related readings (half and double time) that fit the same rhythm. */
  alternatives: number[]
  /** `low` unless one tempo clearly stands out of the others. Not a probability. */
  reliability: 'low' | 'moderate'
}

/** Onset-envelope autocorrelation. Returns null when there is too little rhythm to say anything. */
export function estimateTempo(d: Decoded): Tempo | null {
  const n = frames(d)
  const rate = d.sampleRate
  if (n < rate * 4) return null
  const hop = Math.max(1, Math.round(rate / 100))
  const env: number[] = []
  for (let i = 0; i + hop <= n; i += hop) {
    let s = 0
    for (const c of d.channels) for (let j = i; j < i + hop; j++) s += c[j] * c[j]
    env.push(Math.sqrt(s / (hop * d.channels.length)))
  }
  const onset: number[] = [0]
  for (let i = 1; i < env.length; i++) onset.push(Math.max(0, env[i] - env[i - 1]))
  const mean = onset.reduce((x, y) => x + y, 0) / onset.length
  const x = onset.map((v) => v - mean)
  const fps = rate / hop
  const lo = Math.floor((fps * 60) / 200)
  const hi = Math.ceil((fps * 60) / 60)
  let best = -Infinity
  let bestLag = 0
  const scores: number[] = []
  for (let lag = lo; lag <= hi && lag < x.length / 2; lag++) {
    let s = 0
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag]
    scores.push(s)
    if (s > best) { best = s; bestLag = lag }
  }
  if (!bestLag || best <= 0) return null
  const avg = scores.reduce((p, q) => p + Math.abs(q), 0) / scores.length
  const bpm = Math.round((fps * 60) / bestLag)
  const alternatives = [bpm / 2, bpm * 2].map(Math.round).filter((v) => v >= 40 && v <= 240)
  return { bpm, alternatives, reliability: best > avg * 3 ? 'moderate' : 'low' }
}

/** Peak-per-bucket envelope for drawing a waveform from the real samples. */
export function envelope(d: Decoded, buckets: number): number[] {
  const n = frames(d)
  if (!n || buckets < 1) return []
  const out: number[] = []
  const size = Math.max(1, Math.floor(n / buckets))
  for (let b = 0; b < buckets && b * size < n; b++) {
    let peak = 0
    for (const c of d.channels) for (let i = b * size; i < Math.min(n, (b + 1) * size); i++) peak = Math.max(peak, Math.abs(c[i]))
    out.push(+peak.toFixed(4))
  }
  return out
}
