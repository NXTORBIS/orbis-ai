// Real WAV inspection. Every number comes from the decoded samples; nothing is guessed from a filename.

export interface AudioInfo {
  container: 'wav'
  sampleRate: number
  channels: number
  bitDepth: number
  float: boolean
  frames: number
  durationSec: number
  /** Largest absolute sample, 0..1. A sample peak, not a true peak. */
  peak: number
  /** Whole-file RMS across all channels, 0..1. Not loudness. */
  rms: number
  /** Samples at or above 0.999 of full scale. */
  clippedSamples: number
  /** Stretches under the threshold for at least `minSilenceSec`. Quiet music is not necessarily a fault. */
  lowEnergy: { startSec: number; endSec: number }[]
  lowEnergyThresholdDb: number
  warnings: string[]
}

export type Inspection = { ok: true; info: AudioInfo } | { ok: false; reason: string }

export const MAX_WAV_BYTES = 400 * 1024 * 1024
const SILENCE_DB = -60
const MIN_SILENCE_SEC = 1

const tag = (b: Uint8Array, at: number): string => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

export function inspectWav(bytes: Uint8Array): Inspection {
  if (bytes.length < 44) return { ok: false, reason: 'The file is too small to be audio.' }
  if (bytes.length > MAX_WAV_BYTES) return { ok: false, reason: 'The file is larger than NEUROVA will analyse.' }
  if (tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') return { ok: false, reason: 'This is not a WAV file.' }
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null
  let dataAt = -1
  let dataLen = 0
  const warnings: string[] = []
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(bytes, at)
    let size = v.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      let format = v.getUint16(body, true)
      const bits = v.getUint16(body + 14, true)
      if (format === 0xfffe && size >= 40 && body + 26 <= bytes.length) format = v.getUint16(body + 24, true)
      fmt = { format, channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits }
    } else if (id === 'data') {
      dataAt = body
      if (body + size > bytes.length) {
        warnings.push('The file ends before its declared length: it looks truncated.')
        size = bytes.length - body
      }
      dataLen = size
      break
    }
    at = body + size + (size & 1)
  }
  if (!fmt) return { ok: false, reason: 'The file has no format description.' }
  if (dataAt < 0) return { ok: false, reason: 'The file has no audio data.' }
  const float = fmt.format === 3
  if (fmt.format !== 1 && !float) return { ok: false, reason: 'Only uncompressed WAV can be analysed.' }
  if (!float && ![8, 16, 24, 32].includes(fmt.bits)) return { ok: false, reason: `${fmt.bits}-bit audio is not supported.` }
  if (float && fmt.bits !== 32) return { ok: false, reason: 'Only 32-bit float is supported.' }
  if (fmt.channels < 1 || fmt.channels > 8 || fmt.rate < 800 || fmt.rate > 768000) return { ok: false, reason: 'The audio format is not plausible.' }
  const step = fmt.bits / 8
  const frameBytes = step * fmt.channels
  const frames = Math.floor(dataLen / frameBytes)
  if (frames === 0) return { ok: false, reason: 'The file holds no audio.' }

  let peak = 0
  let sumSq = 0
  let clipped = 0
  let nonFinite = 0
  const win = Math.max(1, Math.floor(fmt.rate * 0.05))
  const thr = 10 ** (SILENCE_DB / 20)
  const quiet: boolean[] = []
  let wSum = 0
  let wN = 0
  const sample = (p: number): number => {
    if (float) return v.getFloat32(p, true)
    if (fmt!.bits === 16) return v.getInt16(p, true) / 32768
    if (fmt!.bits === 8) return (bytes[p] - 128) / 128
    if (fmt!.bits === 24) {
      let n = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)
      if (n & 0x800000) n -= 0x1000000
      return n / 8388608
    }
    return v.getInt32(p, true) / 2147483648
  }
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < fmt.channels; c++) {
      let s = sample(dataAt + f * frameBytes + c * step)
      if (!Number.isFinite(s)) { nonFinite++; s = 0 }
      const a = Math.abs(s)
      if (a > peak) peak = a
      if (a >= 0.999) clipped++
      sumSq += s * s
      wSum += s * s
      wN++
    }
    if ((f + 1) % win === 0 || f === frames - 1) {
      quiet.push(Math.sqrt(wSum / wN) < thr)
      wSum = 0
      wN = 0
    }
  }
  const lowEnergy: AudioInfo['lowEnergy'] = []
  const winSec = win / fmt.rate
  for (let i = 0; i < quiet.length; ) {
    if (!quiet[i]) { i++; continue }
    let j = i
    while (j < quiet.length && quiet[j]) j++
    const start = i * winSec
    const end = Math.min(j * winSec, frames / fmt.rate)
    if (end - start >= MIN_SILENCE_SEC) lowEnergy.push({ startSec: +start.toFixed(2), endSec: +end.toFixed(2) })
    i = j
  }
  if (nonFinite) warnings.push(`${nonFinite} samples were not valid numbers.`)
  if (peak === 0) warnings.push('Every sample is zero: the file is silent.')
  if (clipped > 0) warnings.push(`${clipped} samples reach full scale.`)
  return {
    ok: true,
    info: {
      container: 'wav',
      sampleRate: fmt.rate,
      channels: fmt.channels,
      bitDepth: fmt.bits,
      float,
      frames,
      durationSec: frames / fmt.rate,
      peak,
      rms: Math.sqrt(sumSq / (frames * fmt.channels)),
      clippedSamples: clipped,
      lowEnergy,
      lowEnergyThresholdDb: SILENCE_DB,
      warnings
    }
  }
}
