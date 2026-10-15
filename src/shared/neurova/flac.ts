// Pure TypeScript lossless FLAC encoder (own implementation, no dependencies). MP3 is deliberately not offered.
// Conversion note: float samples are mapped to signed integers with plain rounding (no dither) as
// round(s * 2^(bits-1)), clamped to the integer range. WAV sources that were 16 or 24 bit decode to exact
// multiples of 1/2^15 or 1/2^23, so converting them back at 24 bit (or 16 bit) is bit-exact.
import type { Decoded } from './wav.ts'

export interface FlacResult {
  bytes: Uint8Array
  bitsPerSample: 16 | 24
  /** Samples that fell outside -1..1 and were clamped. */
  clamped: number
  /** MD5 of the interleaved little-endian PCM, as stored in STREAMINFO. */
  md5: string
}

const BLOCK = 4096

const CRC8 = (() => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; t[i] = c } return t })()
const CRC16 = (() => { const t = new Uint16Array(256); for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; t[i] = c } return t })()
export function crc8(b: Uint8Array): number { let c = 0; for (const x of b) c = CRC8[c ^ x]; return c }
export function crc16(b: Uint8Array): number { let c = 0; for (const x of b) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ x]; return c }

/** MD5, implemented here so the module has no dependencies. */
export function md5(data: Uint8Array): Uint8Array {
  const K = new Uint32Array(64)
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0
  const len = data.length
  const padded = new Uint8Array((((len + 8) >> 6) << 6) + 64)
  padded.set(data); padded[len] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, (len * 8) % 4294967296, true)
  dv.setUint32(padded.length - 4, Math.floor((len * 8) / 4294967296), true)
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const M = new Uint32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true)
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15 }
      else { F = C ^ (B | ~D); g = (7 * i) & 15 }
      F = (F + A + K[i] + M[g]) >>> 0
      A = D; D = C; C = B
      const s = S[(i >> 4) * 4 + (i & 3)]
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16)
  const o = new DataView(out.buffer)
  o.setUint32(0, a0, true); o.setUint32(4, b0, true); o.setUint32(8, c0, true); o.setUint32(12, d0, true)
  return out
}

class BitWriter {
  bytes: number[] = []
  private acc = 0
  private n = 0
  /** Writes up to 32 bits of an unsigned value. */
  bits(value: number, count: number): void {
    while (count > 0) {
      const take = Math.min(count, 8 - this.n)
      const part = Math.floor(value / 2 ** (count - take)) % 2 ** take
      this.acc = (this.acc << take) | part
      this.n += take
      count -= take
      if (this.n === 8) { this.bytes.push(this.acc & 0xff); this.acc = 0; this.n = 0 }
    }
  }
  signed(value: number, count: number): void { this.bits(value < 0 ? value + 2 ** count : value, count) }
  align(): void { if (this.n) this.bits(0, 8 - this.n) }
}

const zig = (v: number): number => (v >= 0 ? v * 2 : -v * 2 - 1)

function riceCost(res: number[], start: number, end: number, k: number): number {
  let bits = 0
  for (let i = start; i < end; i++) bits += Math.floor(zig(res[i]) / 2 ** k) + 1 + k
  return bits
}

interface RicePlan { po: number; params: number[]; bits: number }

function bestRice(res: number[], order: number, n: number): RicePlan | null {
  let best: RicePlan | null = null
  for (let po = 0; po <= 6; po++) {
    const parts = 1 << po
    if (n % parts !== 0 || n / parts <= order) continue
    const size = n / parts
    const params: number[] = []
    let total = 0
    for (let p = 0; p < parts; p++) {
      const s = p === 0 ? order : p * size
      const e = (p + 1) * size
      let bk = 0, bb = Infinity
      for (let k = 0; k <= 14; k++) { const c = riceCost(res, s, e, k); if (c < bb) { bb = c; bk = k } }
      params.push(bk)
      total += bb + 4
    }
    if (!best || total < best.bits) best = { po, params, bits: total }
  }
  return best
}

function writeSubframe(w: BitWriter, x: Int32Array, bps: number): void {
  const n = x.length
  let constant = true
  for (let i = 1; i < n; i++) if (x[i] !== x[0]) { constant = false; break }
  if (constant) { w.bits(0, 1); w.bits(0, 6); w.bits(0, 1); w.signed(x[0], bps); return }
  let best: { order: number; res: number[]; rice: RicePlan } | null = null
  let bestBits = n * bps
  for (let order = 0; order <= 4 && order < n; order++) {
    const res: number[] = new Array(n)
    for (let i = order; i < n; i++) {
      let p = 0
      if (order === 1) p = x[i - 1]
      else if (order === 2) p = 2 * x[i - 1] - x[i - 2]
      else if (order === 3) p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3]
      else if (order === 4) p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4]
      res[i] = x[i] - p
    }
    const rice = bestRice(res, order, n)
    if (!rice) continue
    const bits = order * bps + 2 + 4 + rice.bits
    if (bits < bestBits) { bestBits = bits; best = { order, res, rice } }
  }
  if (!best) { w.bits(0, 1); w.bits(1, 6); w.bits(0, 1); for (let i = 0; i < n; i++) w.signed(x[i], bps); return }
  w.bits(0, 1); w.bits(8 + best.order, 6); w.bits(0, 1)
  for (let i = 0; i < best.order; i++) w.signed(x[i], bps)
  w.bits(0, 2); w.bits(best.rice.po, 4)
  const parts = 1 << best.rice.po
  const size = n / parts
  for (let p = 0; p < parts; p++) {
    const k = best.rice.params[p]
    w.bits(k, 4)
    for (let i = p === 0 ? best.order : p * size; i < (p + 1) * size; i++) {
      const u = zig(best.res[i])
      const q = Math.floor(u / 2 ** k)
      for (let z = 0; z < q; z++) w.bits(0, 1)
      w.bits(1, 1)
      if (k) w.bits(u % 2 ** k, k)
    }
  }
}

function utf8Number(n: number): number[] {
  if (n < 0x80) return [n]
  const out: number[] = []
  let first = 0xc0, limit = 0x20, v = n
  while (v >= limit) { out.unshift(0x80 | (v & 0x3f)); v = Math.floor(v / 64); first = (first >> 1) | 0x80; limit >>= 1 }
  out.unshift(first | v)
  return out
}

/** Encodes integer PCM (one Int32Array per channel, already within the signed range of `bits`). */
export function encodeFlacPcm(channels: Int32Array[], sampleRate: number, bits: 16 | 24): { bytes: Uint8Array; md5: Uint8Array } {
  const ch = channels.length
  if (ch < 1 || ch > 2) throw new Error('FLAC export supports mono and stereo.')
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 655350) throw new Error('Unsupported sample rate for FLAC.')
  const total = channels[0].length
  const per = bits / 8
  const pcm = new Uint8Array(total * ch * per)
  let o = 0
  for (let f = 0; f < total; f++) {
    for (let c = 0; c < ch; c++) {
      let v = channels[c][f]
      if (v < 0) v += 2 ** bits
      for (let b = 0; b < per; b++) pcm[o++] = Math.floor(v / 2 ** (8 * b)) & 0xff
    }
  }
  const sum = md5(pcm)
  const frames: number[][] = []
  let minF = Infinity, maxF = 0
  for (let start = 0, no = 0; start < total; start += BLOCK, no++) {
    const n = Math.min(BLOCK, total - start)
    const w = new BitWriter()
    w.bits(0xfff8, 16)
    w.bits(n === BLOCK ? 12 : 7, 4); w.bits(0, 4)
    w.bits(ch - 1, 4); w.bits(0, 3); w.bits(0, 1)
    for (const b of utf8Number(no)) w.bits(b, 8)
    if (n !== BLOCK) w.bits(n - 1, 16)
    w.align()
    w.bits(crc8(Uint8Array.from(w.bytes)), 8)
    for (let c = 0; c < ch; c++) writeSubframe(w, channels[c].subarray(start, start + n), bits)
    w.align()
    w.bits(crc16(Uint8Array.from(w.bytes)), 16)
    frames.push(w.bytes)
    minF = Math.min(minF, w.bytes.length)
    maxF = Math.max(maxF, w.bytes.length)
  }
  const h = new BitWriter()
  for (const c of 'fLaC') h.bits(c.charCodeAt(0), 8)
  h.bits(1, 1); h.bits(0, 7); h.bits(34, 24)
  h.bits(BLOCK, 16); h.bits(BLOCK, 16)
  h.bits(frames.length ? minF : 0, 24); h.bits(maxF, 24)
  h.bits(sampleRate, 20); h.bits(ch - 1, 3); h.bits(bits - 1, 5)
  h.bits(Math.floor(total / 2 ** 32), 4); h.bits(total % 2 ** 32, 32)
  for (const b of sum) h.bits(b, 8)
  let size = h.bytes.length
  for (const f of frames) size += f.length
  const out = new Uint8Array(size)
  out.set(h.bytes, 0)
  let at = h.bytes.length
  for (const f of frames) { out.set(f, at); at += f.length }
  return { bytes: out, md5: sum }
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** Float input to lossless FLAC. Default 24 bit; see the conversion note at the top of this file. */
export function encodeFlac(d: Decoded, bitDepth: 16 | 24 = 24): FlacResult {
  const scale = 2 ** (bitDepth - 1)
  let clamped = 0
  const chans = d.channels.map((src) => {
    const out = new Int32Array(src.length)
    for (let i = 0; i < src.length; i++) {
      const raw = src[i]
      let v = Math.round(raw * scale)
      if (v > scale - 1) { v = scale - 1; if (raw > 1) clamped++ } else if (v < -scale) { v = -scale; if (raw < -1) clamped++ }
      out[i] = v
    }
    return out
  })
  const r = encodeFlacPcm(chans, d.sampleRate, bitDepth)
  return { bytes: r.bytes, bitsPerSample: bitDepth, clamped, md5: hex(r.md5) }
}

/** Small decoder for tests: handles the subframe types this encoder writes, and verifies CRCs and MD5. */
export function decodeFlacForTest(b: Uint8Array): { sampleRate: number; bits: number; channels: Int32Array[]; md5Ok: boolean } {
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'fLaC') throw new Error('not flac')
  let pos = 4
  let sr = 0, ch = 0, bits = 0, total = 0
  let want = new Uint8Array(16)
  for (let last = false; !last;) {
    last = (b[pos] & 0x80) !== 0
    const type = b[pos] & 0x7f
    const len = (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]
    if (type === 0) {
      const s = pos + 4
      sr = (b[s + 10] << 12) | (b[s + 11] << 4) | (b[s + 12] >> 4)
      ch = ((b[s + 12] >> 1) & 7) + 1
      bits = (((b[s + 12] & 1) << 4) | (b[s + 13] >> 4)) + 1
      total = (b[s + 13] & 15) * 2 ** 32 + b[s + 14] * 2 ** 24 + (b[s + 15] << 16) + (b[s + 16] << 8) + b[s + 17]
      want = b.slice(s + 18, s + 34)
    }
    pos += 4 + len
  }
  const out = Array.from({ length: ch }, () => new Int32Array(total))
  let done = 0
  while (pos < b.length) {
    const fs = pos
    if (b[pos] !== 0xff || b[pos + 1] !== 0xf8) throw new Error('bad sync')
    const bsCode = b[pos + 2] >> 4
    pos += 4
    const lead = b[pos]
    pos++
    if (lead >= 0xc0) pos += lead >= 0xfe ? 6 : lead >= 0xfc ? 5 : lead >= 0xf8 ? 4 : lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : 1
    let n = 4096
    if (bsCode === 7) { n = ((b[pos] << 8) | b[pos + 1]) + 1; pos += 2 } else if (bsCode !== 12) throw new Error('block size')
    if (crc8(b.subarray(fs, pos)) !== b[pos]) throw new Error('header crc')
    pos++
    let bp = 0
    const read = (c: number): number => { let v = 0; for (let i = 0; i < c; i++) { v = v * 2 + ((b[pos + (bp >> 3)] >> (7 - (bp & 7))) & 1); bp++ } return v }
    const rs = (c: number): number => { const v = read(c); return v >= 2 ** (c - 1) ? v - 2 ** c : v }
    for (let c = 0; c < ch; c++) {
      read(1)
      const t = read(6)
      read(1)
      const x = out[c]
      if (t === 0) { const v = rs(bits); for (let i = 0; i < n; i++) x[done + i] = v }
      else if (t === 1) { for (let i = 0; i < n; i++) x[done + i] = rs(bits) }
      else if (t >= 8 && t <= 12) {
        const order = t - 8
        for (let i = 0; i < order; i++) x[done + i] = rs(bits)
        if (read(2) !== 0) throw new Error('rice method')
        const parts = 1 << read(4)
        const size = n / parts
        for (let p = 0; p < parts; p++) {
          const k = read(4)
          const first = p === 0 ? order : p * size
          for (let idx = first; idx < (p + 1) * size; idx++) {
            let q = 0
            while (read(1) === 0) q++
            const u = q * 2 ** k + (k ? read(k) : 0)
            const r = u % 2 === 0 ? u / 2 : -(u + 1) / 2
            const g = (j: number): number => x[done + idx - j]
            let pr = 0
            if (order === 1) pr = g(1)
            else if (order === 2) pr = 2 * g(1) - g(2)
            else if (order === 3) pr = 3 * g(1) - 3 * g(2) + g(3)
            else if (order === 4) pr = 4 * g(1) - 6 * g(2) + 4 * g(3) - g(4)
            x[done + idx] = r + pr
          }
        }
      } else throw new Error('subframe type ' + t)
    }
    pos += (bp + 7) >> 3
    if (crc16(b.subarray(fs, pos)) !== ((b[pos] << 8) | b[pos + 1])) throw new Error('frame crc')
    pos += 2
    done += n
  }
  const per = bits / 8
  const pcm = new Uint8Array(total * ch * per)
  let o = 0
  for (let f = 0; f < total; f++) {
    for (let c = 0; c < ch; c++) {
      let v = out[c][f]
      if (v < 0) v += 2 ** bits
      for (let k = 0; k < per; k++) pcm[o++] = Math.floor(v / 2 ** (8 * k)) & 0xff
    }
  }
  const got = md5(pcm)
  return { sampleRate: sr, bits, channels: out, md5Ok: got.every((v, i) => v === want[i]) }
}
