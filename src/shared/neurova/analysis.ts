// Real signal analysis on decoded audio. Every function either refuses with a reason or returns a result that
// names its method, how far to trust it, and what it cannot tell you. Nothing here is a learned model.
import type { Decoded } from './wav.ts'

export type Reliability = 'low' | 'moderate' | 'high'
export type Refused = { ok: false; reason: string }

const valid = (d: Decoded): boolean =>
  !!d && d.sampleRate > 0 && Array.isArray(d.channels) && d.channels.length > 0 && d.channels[0].length > 0

function mono(d: Decoded, maxSec = Infinity): Float32Array {
  const n = Math.min(d.channels[0].length, Math.floor(maxSec * d.sampleRate))
  const out = new Float32Array(n)
  const c = d.channels.length
  for (let ch = 0; ch < c; ch++) {
    const s = d.channels[ch]
    for (let i = 0; i < n; i++) out[i] += s[i] / c
  }
  return out
}

/** In-place radix-2 FFT. re/im length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi
        re[a] += xr; im[a] += xi
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

function decimate(x: Float32Array, rate: number, target: number): { x: Float32Array; rate: number } {
  const f = Math.max(1, Math.floor(rate / target))
  if (f === 1) return { x, rate }
  const n = Math.floor(x.length / f)
  const o = new Float32Array(n)
  // Box average is a weak low-pass; content near the new Nyquist can alias. We only read chroma below 2 kHz.
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < f; k++) s += x[i * f + k]
    o[i] = s / f
  }
  return { x: o, rate: rate / f }
}

// ---------------------------------------------------------------- key
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface KeyEstimate {
  ok: true
  key: string
  tonic: string
  mode: 'major' | 'minor'
  score: number
  alternatives: { key: string; score: number }[]
  method: string
  reliability: Reliability
  limitations: string[]
}

function pearson(a: number[], b: number[]): number {
  const n = a.length
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let num = 0, da = 0, db2 = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db2 += (b[i] - mb) ** 2
  }
  return da > 0 && db2 > 0 ? num / Math.sqrt(da * db2) : 0
}

export function estimateKey(d: Decoded): KeyEstimate | Refused {
  if (!valid(d)) return { ok: false, reason: 'No audio to analyse.' }
  const m = mono(d, 120)
  if (m.length < d.sampleRate * 3) return { ok: false, reason: 'Under 3 seconds of audio: too little to judge a key.' }
  const dec = decimate(m, d.sampleRate, 11025)
  const N = 4096, hop = 2048
  if (dec.x.length < N) return { ok: false, reason: 'Too little audio after downsampling.' }
  const win = new Float64Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  const chroma = new Array(12).fill(0)
  const re = new Float64Array(N), im = new Float64Array(N)
  const binHz = dec.rate / N
  const lo = Math.ceil(90 / binHz), hi = Math.min(N / 2 - 1, Math.floor(2000 / binHz))
  let activeFrames = 0
  let flux = 0, mag = 0
  let prev: Float64Array | null = null
  for (let s = 0; s + N <= dec.x.length; s += hop) {
    let e = 0
    for (let i = 0; i < N; i++) { re[i] = dec.x[s + i] * win[i]; im[i] = 0; e += re[i] * re[i] }
    if (e / N < 1e-9) continue
    activeFrames++
    fft(re, im)
    const cur = new Float64Array(hi + 1)
    for (let k = lo; k <= hi; k++) {
      const a = Math.hypot(re[k], im[k])
      cur[k] = a
      const midi = 69 + 12 * Math.log2((k * binHz) / 440)
      const pc = ((Math.round(midi) % 12) + 12) % 12
      const off = Math.abs(midi - Math.round(midi))
      chroma[pc] += a * (1 - off)
      mag += a
      if (prev) flux += Math.max(0, a - prev[k])
    }
    prev = cur
  }
  if (activeFrames < 3) return { ok: false, reason: 'The audio is essentially silent.' }
  const total = chroma.reduce((a, b) => a + b, 0)
  if (total <= 0) return { ok: false, reason: 'No energy in the pitched range.' }
  const norm = chroma.map((c) => c / total)
  const mean = 1 / 12
  const sd = Math.sqrt(norm.reduce((a, c) => a + (c - mean) ** 2, 0) / 12)
  const peakiness = sd / mean // 0 = flat (noise-like)
  const fluxRatio = mag > 0 ? flux / mag : 0
  const limitations = [
    'Pitch-class profile only: no chord or melody tracking, so modulations and modal music are flattened to one answer.',
    'Uses at most the first 120 seconds, mixed to mono.',
    'Relative major/minor pairs share notes and are easily confused.',
  ]
  const method = 'Windowed FFT chroma (90-2000 Hz) correlated with Krumhansl-Kessler major/minor profiles'
  if (peakiness < 0.35) {
    return { ok: false, reason: 'The pitch content is flat across all twelve notes (noise-like or atonal), so no key can be named.' }
  }
  const scores: { key: string; tonic: string; mode: 'major' | 'minor'; score: number }[] = []
  for (let t = 0; t < 12; t++) {
    const rot = (p: number[]) => p.map((_, i) => p[(i - t + 12) % 12])
    scores.push({ key: `${NOTES[t]} major`, tonic: NOTES[t], mode: 'major', score: pearson(norm, rot(KK_MAJOR)) })
    scores.push({ key: `${NOTES[t]} minor`, tonic: NOTES[t], mode: 'minor', score: pearson(norm, rot(KK_MINOR)) })
  }
  scores.sort((a, b) => b.score - a.score)
  const best = scores[0], second = scores[1]
  const margin = best.score - second.score
  let reliability: Reliability = 'moderate'
  if (best.score < 0.55 || margin < 0.04) reliability = 'low'
  else if (best.score > 0.8 && margin > 0.12 && fluxRatio < 0.5) reliability = 'high'
  if (fluxRatio > 0.9 || peakiness < 0.5) {
    reliability = 'low'
    limitations.push('Signal looks percussive or weakly tonal; the key reading is shaky.')
  }
  if (margin < 0.04) limitations.push('The top two keys scored almost the same.')
  if (best.score < 0.55 && margin < 0.04 && peakiness < 0.5) {
    return { ok: false, reason: 'No key stands out from the others.' }
  }
  return {
    ok: true, key: best.key, tonic: best.tonic, mode: best.mode, score: best.score,
    alternatives: scores.slice(1, 4).map((s) => ({ key: s.key, score: s.score })),
    method, reliability, limitations,
  }
}

// ---------------------------------------------------------------- sections
export interface SectionEstimate {
  ok: true
  boundaries: { timeSec: number; label: 'boundary'; strength: number }[]
  method: string
  reliability: Reliability
  limitations: string[]
}

export function estimateSections(d: Decoded): SectionEstimate | Refused {
  if (!valid(d)) return { ok: false, reason: 'No audio to analyse.' }
  const dur = d.channels[0].length / d.sampleRate
  const MIN_GAP = 8
  if (dur < MIN_GAP * 2) return { ok: false, reason: 'Too short to contain two sections 8 seconds apart.' }
  const x = mono(d)
  const rate = d.sampleRate
  const hopS = 0.25
  const hop = Math.round(hopS * rate)
  const N = 1024
  const nFrames = Math.floor((x.length - N) / hop)
  if (nFrames < 40) return { ok: false, reason: 'Not enough frames to compare.' }
  const feat: number[][] = []
  const re = new Float64Array(N), im = new Float64Array(N)
  for (let f = 0; f < nFrames; f++) {
    const s = f * hop
    let e = 0
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
      re[i] = x[s + i] * w; im[i] = 0; e += re[i] * re[i]
    }
    fft(re, im)
    let num = 0, den = 0
    for (let k = 1; k < N / 2; k++) {
      const a = Math.hypot(re[k], im[k])
      num += k * a; den += a
    }
    const centroid = den > 0 ? num / den / (N / 2) : 0
    feat.push([Math.log10(e / N + 1e-10), Math.log10(centroid + 1e-3)])
  }
  for (let j = 0; j < 2; j++) {
    const col = feat.map((r) => r[j])
    const mu = col.reduce((a, b) => a + b, 0) / col.length
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - mu) ** 2, 0) / col.length) || 1
    feat.forEach((r) => { r[j] = (r[j] - mu) / sd })
  }
  const L = Math.round(3 / hopS)
  const nov = new Array(nFrames).fill(0)
  // Checkerboard-style novelty: how different the next L frames are from the previous L frames.
  for (let t = L; t + L <= nFrames; t++) {
    let a0 = 0, a1 = 0, b0 = 0, b1 = 0
    for (let i = 0; i < L; i++) {
      a0 += feat[t - 1 - i][0]; a1 += feat[t - 1 - i][1]
      b0 += feat[t + i][0]; b1 += feat[t + i][1]
    }
    nov[t] = Math.hypot((b0 - a0) / L, (b1 - a1) / L)
  }
  const vals: number[] = []
  for (let t = L; t + L <= nFrames; t++) vals.push(nov[t])
  const mu = vals.reduce((a, b) => a + b, 0) / vals.length
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) ** 2, 0) / vals.length)
  const thr = Math.max(0.8, mu + 1.5 * sd)
  const peaks: { t: number; v: number }[] = []
  for (let t = L; t + L <= nFrames; t++) {
    let isPeak = nov[t] >= thr
    for (let i = Math.max(0, t - L); isPeak && i <= Math.min(nFrames - 1, t + L); i++) if (nov[i] > nov[t]) isPeak = false
    if (isPeak) peaks.push({ t, v: nov[t] })
  }
  peaks.sort((a, b) => b.v - a.v)
  const chosen: { t: number; v: number }[] = []
  for (const p of peaks) {
    const ts = p.t * hopS + N / 2 / rate
    if (ts < MIN_GAP || dur - ts < MIN_GAP) continue
    if (chosen.every((c) => Math.abs(c.t - p.t) * hopS >= MIN_GAP)) chosen.push(p)
  }
  chosen.sort((a, b) => a.t - b.t)
  const boundaries = chosen.map((c) => ({
    timeSec: Math.round((c.t * hopS + N / 2 / rate) * 100) / 100,
    label: 'boundary' as const,
    strength: Math.round(c.v * 100) / 100,
  }))
  return {
    ok: true, boundaries,
    method: 'Novelty of short-time energy and spectral centroid (3 s before vs 3 s after), peak-picked with 8 s minimum spacing',
    reliability: 'low',
    limitations: [
      'Finds points where loudness or brightness changes; it does not know what a verse or chorus is, so no section is named.',
      'Changes in melody or harmony at constant loudness and timbre are missed.',
      'Within-song dynamics (a drum fill, a quiet bridge) can appear as a boundary that a listener would not call one.',
    ],
  }
}

// ---------------------------------------------------------------- true peak
export interface TruePeak {
  ok: true
  samplePeakDb: number
  truePeakDb: number
  overSamplePeakDb: number
  oversample: 4
  method: string
  reliability: Reliability
  limitations: string[]
}
const toDb = (v: number): number => (v > 0 ? 20 * Math.log10(v) : -Infinity)

export function truePeakDb(d: Decoded): TruePeak | Refused {
  if (!valid(d)) return { ok: false, reason: 'No audio to analyse.' }
  const TAPS = 12
  const phases: Float64Array[] = []
  for (let p = 1; p < 4; p++) {
    const frac = p / 4
    const h = new Float64Array(TAPS * 2)
    let sum = 0
    for (let k = -TAPS + 1; k <= TAPS; k++) {
      const x = k - frac
      const sinc = Math.sin(Math.PI * x) / (Math.PI * x)
      const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / TAPS)
      h[k + TAPS - 1] = sinc * w
      sum += sinc * w
    }
    for (let i = 0; i < h.length; i++) h[i] /= sum
    phases.push(h)
  }
  let sp = 0, tp = 0
  for (const ch of d.channels) {
    const n = ch.length
    for (let i = 0; i < n; i++) {
      const a = Math.abs(ch[i])
      if (a > sp) sp = a
      if (a > tp) tp = a
    }
    for (let i = TAPS; i < n - TAPS; i++) {
      for (const h of phases) {
        let s = 0
        for (let k = 0; k < TAPS * 2; k++) s += h[k] * ch[i - TAPS + 1 + k]
        const a = Math.abs(s)
        if (a > tp) tp = a
      }
    }
  }
  return {
    ok: true,
    samplePeakDb: toDb(sp), truePeakDb: toDb(tp), overSamplePeakDb: toDb(tp) - toDb(sp),
    oversample: 4,
    method: '4x oversampling with a 24-tap Hann-windowed sinc interpolator',
    reliability: 'moderate',
    limitations: [
      'Short interpolator: close to, not identical to, the ITU-R BS.1770 reference filter.',
      'Inter-sample peaks are for the decoded file; a lossy encode or a different converter can reach slightly different values.',
    ],
  }
}

// ---------------------------------------------------------------- loudness
export interface LoudnessApprox {
  ok: true
  lufs: number
  approximate: true
  gatedBlocks: number
  totalBlocks: number
  method: string
  reliability: Reliability
  limitations: string[]
}

function biquad(b: number[], a: number[], x: ArrayLike<number>): Float64Array {
  const y = new Float64Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v
    y[i] = v
  }
  return y
}

export function loudnessLufsApprox(d: Decoded): LoudnessApprox | Refused {
  if (!valid(d)) return { ok: false, reason: 'No audio to analyse.' }
  const fs = d.sampleRate
  if (d.channels[0].length < fs * 0.4) return { ok: false, reason: 'Under 0.4 seconds: no loudness block fits.' }
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196
  const K = Math.tan((Math.PI * f0) / fs)
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416)
  const a0 = 1 + K / Q + K * K
  const sh = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  }
  const f1 = 38.13547087602444, Q1 = 0.5003270373238773
  const K1 = Math.tan((Math.PI * f1) / fs)
  const a1 = 1 + K1 / Q1 + K1 * K1
  const hp = { b: [1, -2, 1], a: [1, (2 * (K1 * K1 - 1)) / a1, (1 - K1 / Q1 + K1 * K1) / a1] }
  const filtered = d.channels.slice(0, 2).map((c) => biquad(hp.b, hp.a, biquad(sh.b, sh.a, c)))
  const n = filtered[0].length
  const block = Math.round(0.4 * fs), step = Math.round(0.1 * fs)
  const ms: number[] = []
  for (let s = 0; s + block <= n; s += step) {
    let sum = 0
    for (const c of filtered) {
      let e = 0
      for (let i = s; i < s + block; i++) e += c[i] * c[i]
      sum += e / block
    }
    ms.push(sum)
  }
  const lk = (e: number) => -0.691 + 10 * Math.log10(e)
  const abs = ms.filter((e) => e > 0 && lk(e) > -70)
  if (abs.length === 0) return { ok: false, reason: 'Everything is below the -70 LUFS absolute gate; the file is effectively silent.' }
  const relThr = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10
  const kept = abs.filter((e) => lk(e) > relThr)
  const lufs = lk(kept.reduce((a, b) => a + b, 0) / kept.length)
  return {
    ok: true, lufs, approximate: true, gatedBlocks: ms.length - kept.length, totalBlocks: ms.length,
    method: 'K-weighting (shelf + high-pass) with 400 ms blocks at 75% overlap, -70 LUFS absolute and -10 LU relative gates',
    reliability: 'moderate',
    limitations: [
      'Approximation: first two channels only, no surround weighting, filter derived for this sample rate rather than the reference table.',
      'Not certified; do not use as a delivery-compliance figure.',
      'Integrated over the whole file; says nothing about short-term loudness range.',
    ],
  }
}

// ---------------------------------------------------------------- ending
export type EndingClass = 'fade' | 'abrupt' | 'sustained-silence' | 'natural'
export interface EndingKind {
  ok: true
  kind: EndingClass
  slopeDbPerSec: number
  finalLevelDb: number
  method: string
  reliability: Reliability
  limitations: string[]
}

export function endingKind(d: Decoded): EndingKind | Refused {
  if (!valid(d)) return { ok: false, reason: 'No audio to analyse.' }
  const m = mono(d)
  const rate = d.sampleRate
  const win = Math.max(1, Math.round(0.05 * rate))
  const span = Math.min(m.length, Math.round(3 * rate))
  if (span < rate) return { ok: false, reason: 'Under 1 second of audio: cannot classify an ending.' }
  const start = m.length - span
  const levels: number[] = []
  for (let s = start; s + win <= m.length; s += win) {
    let e = 0
    for (let i = s; i < s + win; i++) e += m[i] * m[i]
    levels.push(10 * Math.log10(e / win + 1e-12))
  }
  const dt = 0.05
  const nL = levels.length
  const ys = levels.map((v) => Math.max(v, -90))
  const mx = ((nL - 1) * dt) / 2
  const my = ys.reduce((a, b) => a + b, 0) / nL
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < nL; i++) {
    sxy += (i * dt - mx) * (ys[i] - my); sxx += (i * dt - mx) ** 2; syy += (ys[i] - my) ** 2
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 0
  const lastSec = levels.slice(-Math.round(1 / dt))
  const finalLevel = levels[nL - 1]
  const head = levels.slice(0, Math.round(0.5 / dt))
  const headMean = head.reduce((a, b) => a + b, 0) / head.length
  const lastMean = lastSec.reduce((a, b) => a + b, 0) / lastSec.length
  const limitations = [
    'Looks only at the loudness envelope of the last 3 seconds; it cannot tell a deliberate cut from a truncated file.',
    'A reverb tail that dies naturally and a fade-out are both shown as falling levels; the threshold between them is a judgement.',
  ]
  const method = 'Linear regression of 50 ms RMS levels (dB) over the last 3 seconds'
  const base = { ok: true as const, slopeDbPerSec: slope, finalLevelDb: finalLevel, method, limitations }
  if (Math.max(...lastSec) < -60) return { ...base, kind: 'sustained-silence', reliability: 'high' }
  if (headMean - lastMean > 12 && slope <= -4 && r2 >= 0.6 && span >= 2 * rate) {
    return { ...base, kind: 'fade', reliability: r2 > 0.85 ? 'high' : 'moderate' }
  }
  if (finalLevel > -40 && finalLevel > lastMean - 6 && slope > -3) {
    return { ...base, kind: 'abrupt', reliability: finalLevel > -25 ? 'moderate' : 'low' }
  }
  return { ...base, kind: 'natural', reliability: 'low' }
}

// ---------------------------------------------------------------- caching
export interface CacheKeyInput { sha256: string; analyzer: string; version: number | string; params?: Record<string, unknown> }
export interface CacheRecord { sha256: string; analyzer: string; version: number | string; params?: Record<string, unknown> }

function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v)
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}'
}

export function cacheKey(i: CacheKeyInput): string {
  return `${i.analyzer}@${i.version}:${i.sha256}:${stable(i.params ?? {})}`
}

/** A record is stale when it was made for different audio or by a different analyzer version. */
export function isStale(record: CacheRecord | null | undefined, sha256: string, version: number | string): boolean {
  if (!record) return true
  return record.sha256 !== sha256 || String(record.version) !== String(version)
}
