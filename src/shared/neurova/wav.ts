// Decode and encode uncompressed WAV so real operations (gain, fade, trim, tempo) work on actual samples.

export interface Decoded {
  sampleRate: number
  /** One Float32Array per channel, samples in -1..1. */
  channels: Float32Array[]
}

const tag = (b: Uint8Array, at: number): string => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

export function decodeWav(bytes: Uint8Array): Decoded | null {
  if (bytes.length < 44 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') return null
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let fmt: { format: number; ch: number; rate: number; bits: number } | null = null
  let at = 12
  let dataAt = -1
  let dataLen = 0
  while (at + 8 <= bytes.length) {
    const id = tag(bytes, at)
    const size = v.getUint32(at + 4, true)
    const body = at + 8
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      let format = v.getUint16(body, true)
      if (format === 0xfffe && body + 26 <= bytes.length) format = v.getUint16(body + 24, true)
      fmt = { format, ch: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) }
    } else if (id === 'data') {
      dataAt = body
      dataLen = Math.min(size, bytes.length - body)
      break
    }
    at = body + size + (size & 1)
  }
  if (!fmt || dataAt < 0 || fmt.ch < 1) return null
  const float = fmt.format === 3
  if (fmt.format !== 1 && !float) return null
  if (float ? fmt.bits !== 32 : ![8, 16, 24, 32].includes(fmt.bits)) return null
  const step = fmt.bits / 8
  const frames = Math.floor(dataLen / (step * fmt.ch))
  const channels = Array.from({ length: fmt.ch }, () => new Float32Array(frames))
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < fmt.ch; c++) {
      const p = dataAt + (f * fmt.ch + c) * step
      let s: number
      if (float) s = v.getFloat32(p, true)
      else if (fmt.bits === 16) s = v.getInt16(p, true) / 32768
      else if (fmt.bits === 8) s = (bytes[p] - 128) / 128
      else if (fmt.bits === 24) {
        let n = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)
        if (n & 0x800000) n -= 0x1000000
        s = n / 8388608
      } else s = v.getInt32(p, true) / 2147483648
      channels[c][f] = Number.isFinite(s) ? s : 0
    }
  }
  return { sampleRate: fmt.rate, channels }
}

/** 16-bit PCM. Samples outside -1..1 are clamped and counted so the caller can report clipping. */
export function encodeWav16(d: Decoded): { bytes: Uint8Array; clamped: number } {
  const ch = d.channels.length
  const frames = ch ? d.channels[0].length : 0
  const out = new Uint8Array(44 + frames * ch * 2)
  const v = new DataView(out.buffer)
  const w = (o: number, s: string): void => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i) }
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true)
  v.setUint32(24, d.sampleRate, true); v.setUint32(28, d.sampleRate * ch * 2, true)
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, frames * ch * 2, true)
  let clamped = 0
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < ch; c++) {
      let s = d.channels[c][f]
      if (s > 1) { s = 1; clamped++ } else if (s < -1) { s = -1; clamped++ }
      v.setInt16(44 + (f * ch + c) * 2, Math.round(s * 32767), true)
    }
  }
  return { bytes: out, clamped }
}
