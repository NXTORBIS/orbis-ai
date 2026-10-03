import { crc32, deflateSync, inflateSync } from 'node:zlib'
import type { PageImage } from '../pageHandle.ts'

/**
 * A screenshot from Chromium, as the picture Orion works with. Chromium hands over PNG; Orion needs to read its pixels
 * (to tell whether a page really changed), shrink it, and send it to a vision model. This decodes and encodes just
 * enough PNG for that, with no dependency: 8-bit RGB or RGBA, not interlaced, which is what Chromium produces.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface Raster {
  width: number
  height: number
  /** Pixels as Electron's `toBitmap()` gives them: 4 bytes each, blue, green, red, alpha. */
  bgra: Buffer
}

export function decodePng(png: Buffer): Raster {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG image.')
  let width = 0
  let height = 0
  let channels = 0
  const idat: Buffer[] = []
  for (let pos = 8; pos + 12 <= png.length; ) {
    const length = png.readUInt32BE(pos)
    const type = png.toString('latin1', pos + 4, pos + 8)
    const data = png.subarray(pos + 8, pos + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const depth = data[8]
      const colorType = data[9]
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) throw new Error('Unsupported PNG (need 8-bit RGB or RGBA, not interlaced).')
      channels = colorType === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + length
  }
  if (!width || !height) throw new Error('The PNG has no size.')
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  if (raw.length < (stride + 1) * height) throw new Error('The PNG data is cut short.')
  const out = Buffer.alloc(width * height * 4)
  const prev = Buffer.alloc(stride)
  const line = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1)
    const filter = raw[start]
    for (let i = 0; i < stride; i++) {
      const x = raw[start + 1 + i]
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v: number
      if (filter === 0) v = x
      else if (filter === 1) v = x + a
      else if (filter === 2) v = x + b
      else if (filter === 3) v = x + ((a + b) >> 1)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      } else throw new Error(`Unknown PNG filter ${filter}.`)
      line[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      out[d] = line[s + 2]
      out[d + 1] = line[s + 1]
      out[d + 2] = line[s]
      out[d + 3] = channels === 4 ? line[s + 3] : 255
    }
    line.copy(prev)
  }
  return { width, height, bgra: out }
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

export function encodePng(r: Raster): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(r.width, 0)
  ihdr.writeUInt32BE(r.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = r.width * 4
  const raw = Buffer.alloc((stride + 1) * r.height)
  for (let y = 0; y < r.height; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < r.width; x++) {
      const s = (y * r.width + x) * 4
      const d = y * (stride + 1) + 1 + x * 4
      raw[d] = r.bgra[s + 2]
      raw[d + 1] = r.bgra[s + 1]
      raw[d + 2] = r.bgra[s]
      raw[d + 3] = r.bgra[s + 3]
    }
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

/** Averages the source pixels under each destination pixel, so a shrunk picture is a true, smooth reduction. */
export function scaleRaster(r: Raster, width: number, height: number): Raster {
  width = Math.max(1, Math.round(width))
  height = Math.max(1, Math.round(height))
  if (width === r.width && height === r.height) return r
  const out = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * r.height) / height)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * r.height) / height))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * r.width) / width)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * r.width) / width))
      let b = 0
      let g = 0
      let rr = 0
      let a = 0
      let n = 0
      for (let yy = y0; yy < y1 && yy < r.height; yy++) {
        for (let xx = x0; xx < x1 && xx < r.width; xx++) {
          const s = (yy * r.width + xx) * 4
          b += r.bgra[s]
          g += r.bgra[s + 1]
          rr += r.bgra[s + 2]
          a += r.bgra[s + 3]
          n++
        }
      }
      const d = (y * width + x) * 4
      out[d] = Math.round(b / n)
      out[d + 1] = Math.round(g / n)
      out[d + 2] = Math.round(rr / n)
      out[d + 3] = Math.round(a / n)
    }
  }
  return { width, height, bgra: out }
}

/** The screenshot as Orion holds it: the same picture interface the Electron build gave, over Chromium's real pixels. */
export class ChromiumImage implements PageImage {
  private readonly raster: Raster

  private constructor(raster: Raster) {
    this.raster = raster
  }

  static fromPng(png: Buffer): ChromiumImage {
    return new ChromiumImage(decodePng(png))
  }

  static fromRaster(raster: Raster): ChromiumImage {
    return new ChromiumImage(raster)
  }

  toPNG(): Buffer {
    return encodePng(this.raster)
  }
  toDataURL(): string {
    return `data:image/png;base64,${this.toPNG().toString('base64')}`
  }
  toBitmap(): Buffer {
    return this.raster.bgra
  }
  isEmpty(): boolean {
    return this.raster.width === 0 || this.raster.height === 0
  }
  getSize(): { width: number; height: number } {
    return { width: this.raster.width, height: this.raster.height }
  }
  crop(area: { x: number; y: number; width: number; height: number }): PageImage {
    const { width: w, height: h, bgra } = this.raster
    const x = Math.max(0, Math.min(w, Math.round(area.x)))
    const y = Math.max(0, Math.min(h, Math.round(area.y)))
    const width = Math.max(0, Math.min(w - x, Math.round(area.width)))
    const height = Math.max(0, Math.min(h - y, Math.round(area.height)))
    const out = Buffer.alloc(width * height * 4)
    for (let row = 0; row < height; row++) {
      // One row at a time: the source rows are not contiguous once a rectangle is taken out of the middle.
      bgra.copy(out, row * width * 4, ((y + row) * w + x) * 4, ((y + row) * w + x + width) * 4)
    }
    return ChromiumImage.fromRaster({ width, height, bgra: out })
  }

  resize(options: { width?: number; height?: number }): PageImage {
    const { width: w, height: h } = this.raster
    const width = options.width ?? (options.height ? (options.height * w) / h : w)
    const height = options.height ?? (options.width ? (options.width * h) / w : h)
    return ChromiumImage.fromRaster(scaleRaster(this.raster, width, height))
  }
}
