// Measured spectral band energy. These are numbers read from the signal's FFT and nothing more: they are NOT
// vocal detection and NOT instrument detection. Energy in the speech range can come from any sound.
import type { Decoded } from './wav.ts'
import { fft } from './analysis.ts'

export interface BandEnergy { name: string; lowHz: number; highHz: number; energyDb: number }
export interface BandReport {
  ok: true
  method: 'measured-band-energy'
  /** Mean-square level per band, dB relative to a full-scale (amplitude 1) signal's mean square. */
  bands: BandEnergy[]
  /** Share (0..1) of 20 Hz to Nyquist energy that lies in 300-3400 Hz. A measured ratio, not speech detection. */
  speechBandShare: number
  caveat: string
}

const EDGES: Array<[string, number, number]> = [
  ['sub-bass', 20, 60], ['bass', 60, 250], ['low-mid', 250, 500], ['mid', 500, 2000], ['presence', 2000, 6000], ['air', 6000, 20000]
]
const N = 4096

export function bandEnergy(d: Decoded): BandReport | { ok: false; reason: string } {
  if (!d || !d.channels.length || !d.channels[0].length || d.sampleRate <= 0) return { ok: false, reason: 'No audio to measure.' }
  const len = d.channels[0].length
  if (len < N) return { ok: false, reason: 'The clip is too short to measure band energy.' }
  const nyq = d.sampleRate / 2
  const win = new Float64Array(N)
  let w2 = 0
  for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); w2 += win[i] * win[i] }
  const power = new Float64Array(N / 2 + 1)
  let frames = 0
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  const cc = d.channels.length
  for (let s = 0; s + N <= len; s += N / 2) {
    for (let i = 0; i < N; i++) {
      let m = 0
      for (let c = 0; c < cc; c++) m += d.channels[c][s + i]
      re[i] = (m / cc) * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k <= N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k]
    frames++
  }
  const sumRange = (lo: number, hi: number): number => {
    let t = 0
    for (let k = 1; k < N / 2; k++) {
      const f = (k * d.sampleRate) / N
      if (f >= lo && f < hi) t += power[k]
    }
    return (2 * t) / frames / N / w2
  }
  const db = (v: number): number => Math.max(-120, 10 * Math.log10(Math.max(v, 1e-12)))
  const bands = EDGES.filter(([, lo]) => lo < nyq).map(([name, lo, hi]) => ({ name, lowHz: lo, highHz: Math.min(hi, nyq), energyDb: db(sumRange(lo, hi)) }))
  const all = sumRange(20, nyq + 1)
  const speech = sumRange(300, 3400)
  return {
    ok: true,
    method: 'measured-band-energy',
    bands,
    speechBandShare: all > 0 ? Math.min(1, speech / all) : 0,
    caveat: 'Measured band energy only. This does not detect vocals or instruments.'
  }
}
