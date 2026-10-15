import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import yauzl from 'yauzl';
import { PNG_TEXT_KEYWORDS, type AudioTags, type DocumentProps, type ExifSummary, type GpsLocation, type ImageText, type MediaMeta } from '../../shared/media';

/**
 * Reads metadata embedded in files: image dimensions and EXIF, audio/video
 * duration and tags, PDF page counts and Office document properties.
 *
 * Every parser works from the actual bytes with bounded reads, never trusts
 * the extension alone, and reports a field only when it was found. Parsing
 * errors become warnings; they never throw for malformed content.
 */

const MAX_BOX_READ = 16 * 1024 * 1024;

class Source {
  private constructor(private readonly fh: fsp.FileHandle, readonly size: number) {}
  static async open(p: string): Promise<Source> {
    const fh = await fsp.open(p, 'r');
    const st = await fh.stat();
    return new Source(fh, st.size);
  }
  async read(offset: number, length: number): Promise<Buffer> {
    if (offset >= this.size || length <= 0) return Buffer.alloc(0);
    const len = Math.min(length, this.size - offset);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await this.fh.read(buf, 0, len, offset);
    return buf.subarray(0, bytesRead);
  }
  close(): Promise<void> {
    return this.fh.close();
  }
}

export interface ReadOptions {
  /** Include GPS coordinates in the result. Off by default: location is sensitive. */
  includeLocation?: boolean;
}

export async function readMetadata(p: string, opts: ReadOptions = {}): Promise<MediaMeta> {
  const src = await Source.open(p);
  try {
    const head = await src.read(0, 64 * 1024);
    const meta: MediaMeta = { kind: 'none', warnings: [] };
    const ext = path.extname(p).slice(1).toLowerCase();
    try {
      await dispatch(src, head, ext, meta, opts, p);
    } catch (err) {
      meta.warnings.push(`Metadata could not be read completely: ${(err as Error).message}`);
    }
    if (!opts.includeLocation) delete meta.gps;
    return meta;
  } finally {
    await src.close();
  }
}

async function dispatch(src: Source, b: Buffer, ext: string, m: MediaMeta, opts: ReadOptions, p: string): Promise<void> {
  const ascii = (o: number, n: number) => b.toString('latin1', o, o + n);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return png(src, b, m, ext);
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(src, m, ext);
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') {
    Object.assign(m, { kind: 'image', format: 'GIF', width: b.readUInt16LE(6), height: b.readUInt16LE(8) });
    return;
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return webp(src, m);
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return wav(src, m);
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'AVI ') return avi(b, m);
  if (ascii(0, 2) === 'BM' && b.length >= 30) {
    Object.assign(m, { kind: 'image', format: 'BMP', width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)), bitDepth: b.readUInt16LE(28) });
    return;
  }
  if ((ascii(0, 2) === 'II' && b[2] === 42) || (ascii(0, 2) === 'MM' && b[3] === 42)) {
    const whole = src.size <= MAX_BOX_READ ? await src.read(0, src.size) : b;
    const t = parseTiff(whole, 0);
    Object.assign(m, { kind: 'image', format: 'TIFF', width: t.width, height: t.height, orientation: t.orientation, exif: t.exif, gps: t.gps, hasLocation: !!t.gps });
    return;
  }
  if (b.length >= 6 && b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1 && b.readUInt16LE(4) > 0 && ext === 'ico') {
    Object.assign(m, { kind: 'image', format: 'Icon', width: b[6] || 256, height: b[7] || 256 });
    return;
  }
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (/^(heic|heix|mif1|msf1|avif|avis)$/.test(brand)) return heif(src, m, brand);
    return mp4(src, m, brand);
  }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return matroska(src, m);
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && ext !== 'aac')) return mp3(src, b, m);
  if (ascii(0, 4) === 'fLaC') return flac(src, m);
  if (ascii(0, 4) === 'OggS') return ogg(src, b, m);
  if (ascii(0, 5) === '%PDF-') return pdf(src, m);
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) {
    if (['docx', 'xlsx', 'pptx', 'docm', 'xlsm', 'pptm', 'odt', 'ods', 'odp'].includes(ext)) return office(p, ext, m);
    return;
  }
  const text = b.toString('utf8', 0, Math.min(b.length, 4096)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg\b/i.test(text)) return svg(b, m);
  void opts;
}

/* ------------------------------------------------------------------ images */

/** Most chunks walked when reading a PNG (about 32 MB of image data in libpng's default 8 KB IDAT chunks). */
const PNG_MAX_CHUNKS = 4096;
const PNG_TEXT_BY_KEYWORD = new Map(Object.entries(PNG_TEXT_KEYWORDS).map(([k, v]) => [v.toLowerCase(), k as keyof ImageText]));

/** Decodes the body of a PNG tEXt, zTXt or iTXt chunk. Returns undefined for malformed chunks. */
export function decodePngText(type: string, d: Buffer): { keyword: string; text: string } | undefined {
  const nul = d.indexOf(0);
  if (nul < 1 || nul > 79) return undefined;
  const keyword = d.toString('latin1', 0, nul);
  const inflate = (b: Buffer) => zlib.inflateSync(b, { maxOutputLength: 4 * 1024 * 1024 });
  try {
    if (type === 'tEXt') return { keyword, text: d.toString('latin1', nul + 1) };
    if (type === 'zTXt') return d[nul + 1] === 0 ? { keyword, text: inflate(d.subarray(nul + 2)).toString('latin1') } : undefined;
    if (type === 'iTXt') {
      const compressed = d[nul + 1] === 1;
      if (compressed && d[nul + 2] !== 0) return undefined;
      const langEnd = d.indexOf(0, nul + 3);
      const transEnd = langEnd < 0 ? -1 : d.indexOf(0, langEnd + 1);
      if (transEnd < 0) return undefined;
      const body = d.subarray(transEnd + 1);
      return { keyword, text: (compressed ? inflate(body) : body).toString('utf8') };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function png(src: Source, b: Buffer, m: MediaMeta, ext: string): Promise<void> {
  const colorTypes: Record<number, string> = { 0: 'Greyscale', 2: 'RGB', 3: 'Indexed', 4: 'Greyscale + alpha', 6: 'RGBA' };
  Object.assign(m, { kind: 'image', format: 'PNG', width: b.readUInt32BE(16), height: b.readUInt32BE(20), bitDepth: b[24], colorType: colorTypes[b[25]!] });
  // Walk the chunks looking for EXIF (eXIf), animation (acTL) and text (tEXt, zTXt, iTXt).
  let off = 8;
  let complete = false;
  let textChunks = 0;
  let hasExif = false;
  const text: ImageText = {};
  for (let i = 0; i < PNG_MAX_CHUNKS && off + 8 <= src.size; i++) {
    const h = await src.read(off, 8);
    if (h.length < 8) break;
    const len = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    if (type === 'IEND') {
      complete = true;
      break;
    }
    if (type === 'acTL') m.format = 'Animated PNG';
    if (type === 'eXIf' && len < MAX_BOX_READ) {
      hasExif = true;
      const t = parseTiff(await src.read(off + 8, len), 0);
      Object.assign(m, { exif: t.exif, gps: t.gps, hasLocation: !!t.gps, orientation: t.orientation });
    }
    if ((type === 'tEXt' || type === 'zTXt' || type === 'iTXt') && len < MAX_BOX_READ) {
      textChunks++;
      const t = decodePngText(type, await src.read(off + 8, len));
      const key = t ? PNG_TEXT_BY_KEYWORD.get(t.keyword.toLowerCase()) : undefined;
      if (key && t && text[key] === undefined && t.text.trim()) text[key] = t.text.trim();
    }
    off += 12 + len;
  }
  if (Object.keys(text).length) m.imageText = text;
  if (!complete && off + 8 <= src.size) m.warnings.push('Only the first part of this PNG was examined; text stored after the image data may not be shown.');
  if (ext === 'png' || ext === 'apng') {
    const editable: NonNullable<MediaMeta['editable']> = ['imageText'];
    if (textChunks) editable.push('removeImageText');
    if (m.hasLocation) editable.push('removeLocation');
    if (hasExif) editable.push('removeExif');
    m.editable = editable;
  }
}

async function jpeg(src: Source, m: MediaMeta, ext: string): Promise<void> {
  m.kind = 'image';
  m.format = 'JPEG';
  let off = 2;
  let hasExif = false;
  for (let i = 0; i < 400 && off + 4 <= src.size; i++) {
    const h = await src.read(off, 4);
    if (h[0] !== 0xff) {
      m.warnings.push('The JPEG structure is damaged; some details may be missing.');
      break;
    }
    const marker = h[1]!;
    if (marker === 0xff) {
      off += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = h.readUInt16BE(2);
    if (marker === 0xe1) {
      const seg = await src.read(off + 4, len - 2);
      if (seg.toString('latin1', 0, 6) === 'Exif\0\0') {
        hasExif = true;
        const t = parseTiff(seg, 6);
        Object.assign(m, { exif: t.exif, gps: t.gps, hasLocation: !!t.gps, orientation: t.orientation });
      }
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const seg = await src.read(off + 4, 6);
      m.bitDepth = seg[0];
      m.height = seg.readUInt16BE(1);
      m.width = seg.readUInt16BE(3);
      m.colorType = seg[5] === 1 ? 'Greyscale' : seg[5] === 3 ? 'YCbCr' : seg[5] === 4 ? 'CMYK' : undefined;
      if (marker === 0xc2) m.format = 'JPEG (progressive)';
    }
    off += 2 + len;
  }
  if (['jpg', 'jpeg', 'jpe', 'jfif'].includes(ext) && hasExif) m.editable = m.hasLocation ? ['removeLocation', 'removeExif'] : ['removeExif'];
}

async function webp(src: Source, m: MediaMeta): Promise<void> {
  m.kind = 'image';
  m.format = 'WebP';
  let off = 12;
  for (let i = 0; i < 32 && off + 8 <= src.size; i++) {
    const h = await src.read(off, 8);
    const type = h.toString('latin1', 0, 4);
    const len = h.readUInt32LE(4);
    const d = await src.read(off + 8, Math.min(len, type === 'EXIF' ? MAX_BOX_READ : 32));
    if (type === 'VP8 ' && d.length >= 10) {
      m.width = d.readUInt16LE(6) & 0x3fff;
      m.height = d.readUInt16LE(8) & 0x3fff;
    } else if (type === 'VP8L' && d.length >= 5) {
      const [b0, b1, b2, b3] = [d[1]!, d[2]!, d[3]!, d[4]!];
      m.width = 1 + (((b1 & 0x3f) << 8) | b0);
      m.height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    } else if (type === 'VP8X' && d.length >= 10) {
      m.width = 1 + d.readUIntLE(4, 3);
      m.height = 1 + d.readUIntLE(7, 3);
      if (d[0]! & 0x02) m.format = 'Animated WebP';
    } else if (type === 'EXIF') {
      const start = d.toString('latin1', 0, 6) === 'Exif\0\0' ? 6 : 0;
      const t = parseTiff(d, start);
      Object.assign(m, { exif: t.exif, gps: t.gps, hasLocation: !!t.gps });
    }
    off += 8 + len + (len % 2);
  }
}

async function heif(src: Source, m: MediaMeta, brand: string): Promise<void> {
  m.kind = 'image';
  m.format = brand.startsWith('avi') ? 'AVIF' : 'HEIF/HEIC';
  const b = await src.read(0, 512 * 1024);
  const i = b.indexOf('ispe', 0, 'latin1');
  if (i > 0 && i + 16 <= b.length) {
    m.width = b.readUInt32BE(i + 8);
    m.height = b.readUInt32BE(i + 12);
  }
}

function svg(b: Buffer, m: MediaMeta): void {
  m.kind = 'image';
  m.format = 'SVG';
  const tagMatch = /<svg\b[^>]*>/i.exec(b.toString('utf8'));
  if (!tagMatch) return;
  const tag = tagMatch[0];
  const num = (name: string) => {
    const v = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag);
    return v ? Math.round(Number(v[1])) : undefined;
  };
  m.width = num('width');
  m.height = num('height');
  if (m.width === undefined || m.height === undefined) {
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
    if (vb) {
      m.width = Math.round(Number(vb[1]));
      m.height = Math.round(Number(vb[2]));
    }
  }
}

/* ------------------------------------------------------------------ TIFF / EXIF */

interface TiffResult {
  width?: number;
  height?: number;
  orientation?: number;
  exif?: ExifSummary;
  gps?: GpsLocation;
}

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

export function parseTiff(buf: Buffer, base: number): TiffResult {
  const out: TiffResult = {};
  if (buf.length < base + 8) return out;
  const le = buf.toString('latin1', base, base + 2) === 'II';
  const u16 = (o: number) => (o + 2 <= buf.length ? (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : 0);
  const u32 = (o: number) => (o + 4 <= buf.length ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : 0);
  const i32 = (o: number) => (o + 4 <= buf.length ? (le ? buf.readInt32LE(o) : buf.readInt32BE(o)) : 0);
  type Field = { type: number; count: number; at: number };
  const readIfd = (rel: number): Map<number, Field> => {
    const map = new Map<number, Field>();
    const o = base + rel;
    if (rel <= 0 || o + 2 > buf.length) return map;
    const n = Math.min(u16(o), 512);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      if (e + 12 > buf.length) break;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 0) * count;
      const at = size <= 4 ? e + 8 : base + u32(e + 8);
      if (size > 0 && at + size <= buf.length) map.set(u16(e), { type, count, at });
    }
    return map;
  };
  const num = (f?: Field, idx = 0): number | undefined => {
    if (!f) return undefined;
    const sz = TYPE_SIZE[f.type]!;
    const o = f.at + idx * sz;
    switch (f.type) {
      case 1: case 7: return buf[o];
      case 3: return u16(o);
      case 4: return u32(o);
      case 9: return i32(o);
      case 5: { const d = u32(o + 4); return d ? u32(o) / d : undefined; }
      case 10: { const d = i32(o + 4); return d ? i32(o) / d : undefined; }
      default: return undefined;
    }
  };
  const str = (f?: Field): string | undefined => {
    if (!f || f.type !== 2) return undefined;
    const s = buf.toString('latin1', f.at, f.at + f.count).replace(/\0.*$/s, '').trim();
    return s || undefined;
  };
  const ifd0 = readIfd(u32(base + 4));
  out.width = num(ifd0.get(0x100));
  out.height = num(ifd0.get(0x101));
  out.orientation = num(ifd0.get(0x112));
  const exif: ExifSummary = { make: str(ifd0.get(0x10f)), model: str(ifd0.get(0x110)), software: str(ifd0.get(0x131)) };
  let taken = str(ifd0.get(0x132));
  const sub = ifd0.get(0x8769);
  if (sub) {
    const e = readIfd(num(sub)!);
    taken = str(e.get(0x9003)) ?? str(e.get(0x9004)) ?? taken;
    const exp = num(e.get(0x829a));
    if (exp !== undefined) exif.exposureTime = exp >= 1 ? `${+exp.toFixed(1)} s` : `1/${Math.round(1 / exp)} s`;
    exif.fNumber = num(e.get(0x829d)) !== undefined ? +num(e.get(0x829d))!.toFixed(1) : undefined;
    exif.iso = num(e.get(0x8827));
    const fl = num(e.get(0x920a));
    exif.focalLengthMm = fl !== undefined ? +fl.toFixed(1) : undefined;
    const flash = num(e.get(0x9209));
    exif.flash = flash !== undefined ? (flash & 1) === 1 : undefined;
    exif.lens = str(e.get(0xa434));
    out.width ??= num(e.get(0xa002));
    out.height ??= num(e.get(0xa003));
  }
  if (taken) exif.takenAt = taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const gpsPtr = ifd0.get(0x8825);
  if (gpsPtr) {
    const g = readIfd(num(gpsPtr)!);
    const dms = (f?: Field) => (f && f.count >= 3 ? (num(f, 0) ?? 0) + (num(f, 1) ?? 0) / 60 + (num(f, 2) ?? 0) / 3600 : undefined);
    const lat = dms(g.get(2));
    const lon = dms(g.get(4));
    if (lat !== undefined && lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) {
      const latRef = str(g.get(1)) ?? 'N';
      const lonRef = str(g.get(3)) ?? 'E';
      const alt = num(g.get(6));
      out.gps = {
        latitude: +(latRef.startsWith('S') ? -lat : lat).toFixed(6),
        longitude: +(lonRef.startsWith('W') ? -lon : lon).toFixed(6),
        altitudeM: alt !== undefined ? +((num(g.get(5)) === 1 ? -alt : alt).toFixed(1)) : undefined,
      };
    }
  }
  const cleaned = Object.fromEntries(Object.entries(exif).filter(([, v]) => v !== undefined));
  if (Object.keys(cleaned).length) out.exif = cleaned as ExifSummary;
  return out;
}

/* ------------------------------------------------------------------ audio */

const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export const ID3_GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];

function decodeId3Text(enc: number, b: Buffer): string {
  let s: string;
  if (enc === 1) {
    if (b[0] === 0xfe && b[1] === 0xff) s = swap16(b.subarray(2)).toString('utf16le');
    else s = b.subarray(b[0] === 0xff && b[1] === 0xfe ? 2 : 0).toString('utf16le');
  } else if (enc === 2) s = swap16(b).toString('utf16le');
  else if (enc === 3) s = b.toString('utf8');
  else s = b.toString('latin1');
  return s.replace(/\0+$/g, '').split('\0')[0]!.trim();
}

function swap16(b: Buffer): Buffer {
  const c = Buffer.from(b.subarray(0, b.length - (b.length % 2)));
  c.swap16();
  return c;
}

export interface Id3Info {
  /** Bytes occupied by the tag including header (0 if none). */
  size: number;
  version?: number;
  unsynchronised?: boolean;
  tags: AudioTags;
}

export function parseId3v2(b: Buffer): Id3Info {
  if (b.toString('latin1', 0, 3) !== 'ID3' || b.length < 10) return { size: 0, tags: {} };
  const ver = b[3]!;
  const flags = b[5]!;
  const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
  const info: Id3Info = { size: size + 10 + (flags & 0x10 ? 10 : 0), version: ver, unsynchronised: !!(flags & 0x80), tags: {} };
  let off = 10;
  if (flags & 0x40 && ver >= 3) {
    const ext = ver === 4 ? ((b[10]! & 0x7f) << 21) | ((b[11]! & 0x7f) << 14) | ((b[12]! & 0x7f) << 7) | (b[13]! & 0x7f) : b.readUInt32BE(10) + 4;
    off += ext;
  }
  const end = Math.min(b.length, 10 + size);
  const map2: Record<string, keyof AudioTags> = { TT2: 'title', TP1: 'artist', TAL: 'album', TP2: 'albumArtist', TYE: 'year', TRK: 'track', TCO: 'genre' };
  const map3: Record<string, keyof AudioTags> = { TIT2: 'title', TPE1: 'artist', TALB: 'album', TPE2: 'albumArtist', TYER: 'year', TDRC: 'year', TRCK: 'track', TCON: 'genre' };
  while (off + (ver === 2 ? 6 : 10) <= end) {
    let id: string;
    let len: number;
    let hdr: number;
    if (ver === 2) {
      id = b.toString('latin1', off, off + 3);
      len = b.readUIntBE(off + 3, 3);
      hdr = 6;
    } else {
      id = b.toString('latin1', off, off + 4);
      len = ver === 4 ? ((b[off + 4]! & 0x7f) << 21) | ((b[off + 5]! & 0x7f) << 14) | ((b[off + 6]! & 0x7f) << 7) | (b[off + 7]! & 0x7f) : b.readUInt32BE(off + 4);
      hdr = 10;
    }
    if (!/^[A-Z0-9]{3,4}$/.test(id) || len <= 0 || off + hdr + len > end) break;
    const data = b.subarray(off + hdr, off + hdr + len);
    const key = ver === 2 ? map2[id] : map3[id];
    if (key && data.length > 1) {
      let v = decodeId3Text(data[0]!, data.subarray(1));
      if (key === 'genre') v = v.replace(/^\((\d+)\)$/, (_, n) => ID3_GENRES[Number(n)] ?? v).replace(/^(\d+)$/, (_, n) => ID3_GENRES[Number(n)] ?? n);
      if (key === 'year') v = v.slice(0, 4);
      if (v) info.tags[key] ??= v;
    } else if ((id === 'COMM' || id === 'COM') && data.length > 4) {
      const enc = data[0]!;
      const rest = data.subarray(4);
      const wide = enc === 1 || enc === 2;
      let i = 0;
      if (wide) {
        while (i + 1 < rest.length && !(rest[i] === 0 && rest[i + 1] === 0)) i += 2;
        i += 2;
      } else {
        while (i < rest.length && rest[i] !== 0) i++;
        i += 1;
      }
      const text = decodeId3Text(enc, rest.subarray(i));
      if (text) info.tags.comment ??= text;
    }
    off += hdr + len;
  }
  return info;
}

function parseId3v1(t: Buffer): AudioTags {
  if (t.length !== 128 || t.toString('latin1', 0, 3) !== 'TAG') return {};
  const s = (a: number, z: number) => t.toString('latin1', a, z).replace(/\0.*$/s, '').trim() || undefined;
  const tags: AudioTags = { title: s(3, 33), artist: s(33, 63), album: s(63, 93), year: s(93, 97), comment: s(97, t[125] === 0 ? 125 : 127) };
  if (t[125] === 0 && t[126]) tags.track = String(t[126]);
  if (t[127]! < ID3_GENRES.length) tags.genre = ID3_GENRES[t[127]!];
  return tags;
}

async function mp3(src: Source, head: Buffer, m: MediaMeta): Promise<void> {
  m.kind = 'audio';
  m.format = 'MP3';
  let tagBuf = head;
  const pre = parseId3v2(head);
  if (pre.size > head.length && pre.size < MAX_BOX_READ) tagBuf = await src.read(0, pre.size);
  const id3 = parseId3v2(tagBuf);
  const tail = src.size >= 128 ? await src.read(src.size - 128, 128) : Buffer.alloc(0);
  const v1 = parseId3v1(tail);
  const tags: AudioTags = { ...v1, ...Object.fromEntries(Object.entries(id3.tags).filter(([, v]) => v)) };
  if (Object.values(tags).some(Boolean)) m.tags = Object.fromEntries(Object.entries(tags).filter(([, v]) => v)) as AudioTags;
  if (id3.unsynchronised) m.warnings.push('This tag uses unsynchronisation; editing is not offered for it.');
  else if (id3.size === 0 || id3.version === 3 || id3.version === 4) m.editable = ['audioTags'];
  // First MPEG frame after the tag.
  const start = id3.size;
  const win = await src.read(start, 128 * 1024);
  let i = 0;
  while (i + 4 <= win.length && !(win[i] === 0xff && (win[i + 1]! & 0xe0) === 0xe0 && ((win[i + 1]! >> 1) & 3) !== 0 && (win[i + 2]! >> 4) !== 15 && (win[i + 2]! >> 4) !== 0 && ((win[i + 2]! >> 2) & 3) !== 3)) i++;
  if (i + 4 > win.length) {
    m.warnings.push('No MPEG audio frame was found.');
    return;
  }
  const h = win.subarray(i, i + 4);
  const verBits = (h[1]! >> 3) & 3;
  const layer = 4 - ((h[1]! >> 1) & 3);
  const mpeg = verBits === 3 ? 1 : 2;
  const kbps = BITRATES[`${mpeg}-${layer}`]![h[2]! >> 4]!;
  const sr = SAMPLE_RATES[verBits]![(h[2]! >> 2) & 3]!;
  const mono = h[3]! >> 6 === 3;
  const spf = layer === 1 ? 384 : layer === 2 ? 1152 : mpeg === 1 ? 1152 : 576;
  m.format = `MP3 (MPEG-${verBits === 0 ? '2.5' : mpeg} Layer ${['I', 'II', 'III'][layer - 1]})`;
  m.sampleRateHz = sr;
  m.channels = mono ? 1 : 2;
  const side = layer === 3 ? (mpeg === 1 ? (mono ? 17 : 32) : mono ? 9 : 17) : 0;
  const xo = i + 4 + side;
  const tagId = win.toString('latin1', xo, xo + 4);
  let frames: number | undefined;
  if ((tagId === 'Xing' || tagId === 'Info') && xo + 12 <= win.length) {
    const flags = win.readUInt32BE(xo + 4);
    if (flags & 1) frames = win.readUInt32BE(xo + 8);
  } else if (win.toString('latin1', i + 36, i + 40) === 'VBRI' && i + 54 <= win.length) {
    frames = win.readUInt32BE(i + 36 + 14);
  }
  const audioBytes = src.size - (start + i) - (tail.toString('latin1', 0, 3) === 'TAG' ? 128 : 0);
  if (frames) {
    m.durationSec = (frames * spf) / sr;
    m.bitrateKbps = Math.round((audioBytes * 8) / m.durationSec / 1000);
  } else if (kbps) {
    m.bitrateKbps = kbps;
    m.durationSec = (audioBytes * 8) / (kbps * 1000);
    m.durationEstimated = true;
  }
}

function parseVorbisComments(b: Buffer, o: number): AudioTags {
  const tags: AudioTags = {};
  const vendorLen = b.readUInt32LE(o);
  let p = o + 4 + vendorLen;
  const n = Math.min(b.readUInt32LE(p), 1000);
  p += 4;
  const map: Record<string, keyof AudioTags> = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', ALBUMARTIST: 'albumArtist', DATE: 'year', TRACKNUMBER: 'track', GENRE: 'genre', COMMENT: 'comment', DESCRIPTION: 'comment' };
  for (let i = 0; i < n && p + 4 <= b.length; i++) {
    const len = b.readUInt32LE(p);
    if (p + 4 + len > b.length) break;
    const s = b.toString('utf8', p + 4, p + 4 + len);
    const eq = s.indexOf('=');
    const key = map[s.slice(0, eq).toUpperCase()];
    if (eq > 0 && key) tags[key] ??= key === 'year' ? s.slice(eq + 1, eq + 5) : s.slice(eq + 1);
    p += 4 + len;
  }
  return tags;
}

async function flac(src: Source, m: MediaMeta): Promise<void> {
  m.kind = 'audio';
  m.format = 'FLAC';
  let off = 4;
  let complete = false;
  let comments = 0;
  for (let i = 0; i < 1024 && off + 4 <= src.size; i++) {
    const h = await src.read(off, 4);
    const last = (h[0]! & 0x80) !== 0;
    const type = h[0]! & 0x7f;
    const len = h.readUIntBE(1, 3);
    if (type === 127 || off + 4 + len > src.size) break;
    if (type === 0) {
      const d = await src.read(off + 4, 34);
      const o = 10;
      const sr = (d[o]! << 12) | (d[o + 1]! << 4) | (d[o + 2]! >> 4);
      const ch = ((d[o + 2]! >> 1) & 7) + 1;
      const bps = (((d[o + 2]! & 1) << 4) | (d[o + 3]! >> 4)) + 1;
      const total = (d[o + 3]! & 0xf) * 2 ** 32 + d.readUInt32BE(o + 4);
      Object.assign(m, { sampleRateHz: sr, channels: ch, bitDepth: bps });
      if (sr && total) {
        m.durationSec = total / sr;
        m.bitrateKbps = Math.round((src.size * 8) / m.durationSec / 1000);
      }
    } else if (type === 4 && len < MAX_BOX_READ) {
      const d = await src.read(off + 4, len);
      const t = parseVorbisComments(d, 0);
      if (Object.keys(t).length) m.tags = t;
      const countAt = d.length >= 4 ? 4 + d.readUInt32LE(0) : -1;
      if (countAt >= 4 && countAt + 4 <= d.length) comments = d.readUInt32LE(countAt);
    }
    off += 4 + len;
    if (last) {
      complete = true;
      break;
    }
  }
  // Tags are rewritten only when the whole metadata section could be walked.
  if (complete) m.editable = comments > 0 ? ['audioTags', 'removeAudioTags'] : ['audioTags'];
  else m.warnings.push('The FLAC metadata section could not be read completely, so tag editing is not offered.');
}

async function wav(src: Source, m: MediaMeta): Promise<void> {
  m.kind = 'audio';
  m.format = 'WAV';
  let off = 12;
  let byteRate = 0;
  for (let i = 0; i < 64 && off + 8 <= src.size; i++) {
    const h = await src.read(off, 8);
    const id = h.toString('latin1', 0, 4);
    const len = h.readUInt32LE(4);
    if (id === 'fmt ') {
      const d = await src.read(off + 8, 16);
      const fmt = d.readUInt16LE(0);
      m.format = fmt === 1 ? 'WAV (PCM)' : fmt === 3 ? 'WAV (float)' : `WAV (format ${fmt})`;
      m.channels = d.readUInt16LE(2);
      m.sampleRateHz = d.readUInt32LE(4);
      byteRate = d.readUInt32LE(8);
      m.bitDepth = d.readUInt16LE(14);
      m.bitrateKbps = Math.round((byteRate * 8) / 1000);
    } else if (id === 'data') {
      const size = Math.min(len, src.size - off - 8);
      if (byteRate) m.durationSec = size / byteRate;
    } else if (id === 'LIST' && len < 1024 * 1024) {
      const d = await src.read(off + 8, len);
      if (d.toString('latin1', 0, 4) === 'INFO') {
        const tags: AudioTags = {};
        const map: Record<string, keyof AudioTags> = { INAM: 'title', IART: 'artist', IPRD: 'album', ICRD: 'year', IGNR: 'genre', ICMT: 'comment', ITRK: 'track' };
        let p = 4;
        while (p + 8 <= d.length) {
          const k = d.toString('latin1', p, p + 4);
          const l = d.readUInt32LE(p + 4);
          const v = d.toString('utf8', p + 8, p + 8 + l).replace(/\0.*$/s, '').trim();
          if (map[k] && v) tags[map[k]!] = v;
          p += 8 + l + (l % 2);
        }
        if (Object.keys(tags).length) m.tags = tags;
      }
    }
    off += 8 + len + (len % 2);
  }
}

async function ogg(src: Source, head: Buffer, m: MediaMeta): Promise<void> {
  m.kind = 'audio';
  let rate = 0;
  let preSkip = 0;
  const v = head.indexOf('\x01vorbis', 0, 'latin1');
  const o = head.indexOf('OpusHead', 0, 'latin1');
  const th = head.indexOf('\x80theora', 0, 'latin1');
  if (th >= 0) {
    m.kind = 'video';
    m.format = 'Ogg Theora';
    m.width = head.readUIntBE(th + 14, 3);
    m.height = head.readUIntBE(th + 17, 3);
  }
  if (v >= 0) {
    if (th < 0) m.format = 'Ogg Vorbis';
    m.channels = head[v + 11];
    rate = head.readUInt32LE(v + 12);
    const c = head.indexOf('\x03vorbis', v, 'latin1');
    if (c >= 0) {
      try {
        const t = parseVorbisComments(head, c + 7);
        if (Object.keys(t).length) m.tags = t;
      } catch {
        /* comment packet spans pages */
      }
    }
  } else if (o >= 0) {
    m.format = 'Opus';
    m.channels = head[o + 9];
    preSkip = head.readUInt16LE(o + 10);
    rate = 48000;
    const c = head.indexOf('OpusTags', o, 'latin1');
    if (c >= 0) {
      try {
        const t = parseVorbisComments(head, c + 8);
        if (Object.keys(t).length) m.tags = t;
      } catch {
        /* comment packet spans pages */
      }
    }
  }
  if (rate && th < 0) {
    m.sampleRateHz = v >= 0 ? rate : head.readUInt32LE(o + 12) || 48000;
    const tail = await src.read(Math.max(0, src.size - 65536), 65536);
    const last = tail.lastIndexOf('OggS', tail.length, 'latin1');
    if (last >= 0 && last + 14 <= tail.length) {
      const granule = Number(tail.readBigUInt64LE(last + 6));
      if (granule > 0) {
        m.durationSec = Math.max(0, granule - preSkip) / rate;
        m.bitrateKbps = Math.round((src.size * 8) / m.durationSec / 1000);
      }
    }
  }
}

/* ------------------------------------------------------------------ video containers */

interface Box { type: string; start: number; size: number; header: number }

function boxesIn(b: Buffer, from: number, to: number): Box[] {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to && out.length < 4096) {
    let size = b.readUInt32BE(o);
    const type = b.toString('latin1', o + 4, o + 8);
    let header = 8;
    if (size === 1 && o + 16 <= to) {
      size = Number(b.readBigUInt64BE(o + 8));
      header = 16;
    } else if (size === 0) size = to - o;
    if (size < header || o + size > to) break;
    out.push({ type, start: o, size, header });
    o += size;
  }
  return out;
}

async function mp4(src: Source, m: MediaMeta, brand: string): Promise<void> {
  m.kind = brand.startsWith('M4A') || brand.startsWith('M4B') ? 'audio' : 'video';
  m.format = brand.startsWith('qt') ? 'QuickTime' : brand.startsWith('M4A') ? 'M4A' : 'MP4';
  // Locate moov at the top level (it may be at the end of the file).
  let off = 0;
  let moov: Buffer | undefined;
  for (let i = 0; i < 1024 && off + 8 <= src.size; i++) {
    const h = await src.read(off, 16);
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    if (size === 1) size = Number(h.readBigUInt64BE(8));
    else if (size === 0) size = src.size - off;
    if (size < 8) break;
    if (type === 'moov') {
      if (size > MAX_BOX_READ) {
        m.warnings.push('The movie header is unusually large; details were not read.');
        return;
      }
      moov = await src.read(off, size);
      break;
    }
    off += size;
  }
  if (!moov) {
    m.warnings.push('No movie header (moov) was found; the file may be incomplete or fragmented.');
    return;
  }
  const kids = (bx: Box, skip = 0) => boxesIn(moov!, bx.start + bx.header + skip, bx.start + bx.size);
  const root: Box = { type: 'moov', start: 0, size: moov.length, header: 8 };
  let hasVideo = false;
  let hasAudio = false;
  for (const bx of kids(root)) {
    const c = bx.start + bx.header;
    if (bx.type === 'mvhd') {
      const v = moov[c]!;
      // creation_time: seconds since 1904-01-01 UTC (0 = not recorded).
      const created = v === 1 ? Number(moov.readBigUInt64BE(c + 4)) : moov.readUInt32BE(c + 4);
      m.createdAt ??= containerTime(created * 1000 - MAC_EPOCH_OFFSET_MS);
      const ts = v === 1 ? moov.readUInt32BE(c + 20) : moov.readUInt32BE(c + 12);
      const dur = v === 1 ? Number(moov.readBigUInt64BE(c + 24)) : moov.readUInt32BE(c + 16);
      if (ts && dur) m.durationSec = dur / ts;
    } else if (bx.type === 'trak') {
      let handler = '';
      let w = 0;
      let h = 0;
      let samples = 0;
      let mdTs = 0;
      let mdDur = 0;
      let codec = '';
      let channels: number | undefined;
      let rate: number | undefined;
      const walk = (b: Box): void => {
        const cc = b.start + b.header;
        if (b.type === 'tkhd') {
          const v = moov![cc]!;
          const wo = v === 1 ? cc + 88 : cc + 76;
          if (wo + 8 <= b.start + b.size) {
            w = moov!.readUInt32BE(wo) >>> 16;
            h = moov!.readUInt32BE(wo + 4) >>> 16;
          }
        } else if (b.type === 'hdlr') handler = moov!.toString('latin1', cc + 8, cc + 12);
        else if (b.type === 'mdhd') {
          const v = moov![cc]!;
          mdTs = v === 1 ? moov!.readUInt32BE(cc + 20) : moov!.readUInt32BE(cc + 12);
          mdDur = v === 1 ? Number(moov!.readBigUInt64BE(cc + 24)) : moov!.readUInt32BE(cc + 16);
        } else if (b.type === 'stts') {
          const n = Math.min(moov!.readUInt32BE(cc + 4), 100000);
          for (let i = 0; i < n; i++) samples += moov!.readUInt32BE(cc + 8 + i * 8);
        } else if (b.type === 'stsd') {
          const e = cc + 8;
          codec = moov!.toString('latin1', e + 4, e + 8);
          if (e + 36 <= b.start + b.size) {
            channels = moov!.readUInt16BE(e + 24);
            rate = moov!.readUInt32BE(e + 32) >>> 16;
          }
        } else if (['mdia', 'minf', 'stbl'].includes(b.type)) kids(b).forEach(walk);
      };
      kids(bx).forEach(walk);
      if (handler === 'vide') {
        hasVideo = true;
        if (w && h) {
          m.width ??= w;
          m.height ??= h;
        }
        m.videoCodec ??= codec.trim();
        if (samples && mdTs && mdDur) m.frameRate ??= +((samples * mdTs) / mdDur).toFixed(2);
      } else if (handler === 'soun') {
        hasAudio = true;
        m.audioCodec ??= codec.trim();
        m.channels ??= channels;
        if (rate) m.sampleRateHz ??= rate;
      }
    } else if (bx.type === 'udta') {
      for (const u of kids(bx)) {
        if (u.type !== 'meta') continue;
        for (const il of kids(u, 4)) {
          if (il.type !== 'ilst') continue;
          const map: Record<string, keyof AudioTags> = { '©nam': 'title', '©ART': 'artist', '©alb': 'album', aART: 'albumArtist', '©day': 'year', '©gen': 'genre', '©cmt': 'comment' };
          const tags: AudioTags = {};
          for (const item of kids(il)) {
            const data = kids(item).find((d) => d.type === 'data');
            if (!data) continue;
            const vStart = data.start + data.header + 8;
            const vEnd = data.start + data.size;
            const key = map[moov.toString('latin1', item.start + 4, item.start + 8)];
            if (key) tags[key] = moov.toString('utf8', vStart, vEnd);
            else if (item.type === 'trkn' && vEnd - vStart >= 4) tags.track = String(moov.readUInt16BE(vStart + 2));
          }
          if (Object.keys(tags).length) m.tags = tags;
        }
      }
    }
  }
  if (hasVideo) m.kind = 'video';
  else if (hasAudio) m.kind = 'audio';
  if (m.durationSec) m.bitrateKbps = Math.round((src.size * 8) / m.durationSec / 1000);
}

/** Milliseconds between 1904-01-01 (QuickTime epoch) and 1970-01-01. */
const MAC_EPOCH_OFFSET_MS = 2082844800000;
/** 2001-01-01T00:00:00Z (Matroska epoch) in Unix milliseconds. */
const MKV_EPOCH_MS = 978307200000;

/** A container timestamp as ISO text, or undefined for "not recorded" (epoch defaults) and absurd values. */
function containerTime(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms <= 86400000 || ms > Date.UTC(2200, 0, 1)) return undefined;
  if (ms === -MAC_EPOCH_OFFSET_MS || ms === MKV_EPOCH_MS) return undefined;
  return new Date(ms).toISOString();
}

function readVint(b: Buffer, o: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | undefined {
  const first = b[o];
  if (first === undefined || first === 0) return undefined;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || o + len > b.length) return undefined;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = (first & (0xff >> len)) === 0xff >> len;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[o + i]!;
    if (b[o + i] !== 0xff) allOnes = false;
  }
  return { value, length: len, unknown: !keepMarker && allOnes };
}

async function matroska(src: Source, m: MediaMeta): Promise<void> {
  const b = await src.read(0, 2 * 1024 * 1024);
  m.kind = 'video';
  m.format = 'Matroska';
  let scale = 1000000;
  let duration: number | undefined;
  let hasVideo = false;
  const walk = (from: number, to: number, depth: number): boolean => {
    let o = from;
    while (o < to) {
      const id = readVint(b, o, true);
      if (!id) return false;
      const sz = readVint(b, o + id.length, false);
      if (!sz) return false;
      const dStart = o + id.length + sz.length;
      const dEnd = sz.unknown ? to : Math.min(to, dStart + sz.value);
      switch (id.value) {
        case 0x1a45dfa3: walk(dStart, dEnd, depth + 1); break; // EBML header
        case 0x4282: if (b.toString('latin1', dStart, dEnd) === 'webm') m.format = 'WebM'; break;
        case 0x18538067: case 0x1549a966: case 0x1654ae6b: case 0xae: case 0xe0: case 0xe1:
          if (walk(dStart, dEnd, depth + 1) === false && dEnd >= b.length) return false;
          break;
        case 0x2ad7b1: scale = b.readUIntBE(dStart, Math.min(6, dEnd - dStart)); break;
        // DateUTC: signed nanoseconds since 2001-01-01T00:00:00Z.
        case 0x4461: if (dEnd - dStart === 8) m.createdAt ??= containerTime(Number(b.readBigInt64BE(dStart) / 1000000n) + MKV_EPOCH_MS); break;
        case 0x4489: duration = dEnd - dStart === 8 ? b.readDoubleBE(dStart) : b.readFloatBE(dStart); break;
        case 0x83: if (b[dStart] === 1) hasVideo = true; break;
        case 0x86: {
          const codec = b.toString('latin1', dStart, dEnd);
          if (codec.startsWith('V_')) m.videoCodec ??= codec.slice(2);
          else if (codec.startsWith('A_')) m.audioCodec ??= codec.slice(2);
          break;
        }
        case 0xb0: m.width ??= b.readUIntBE(dStart, Math.min(6, dEnd - dStart)); break;
        case 0xba: m.height ??= b.readUIntBE(dStart, Math.min(6, dEnd - dStart)); break;
        case 0xb5: m.sampleRateHz ??= Math.round(dEnd - dStart === 8 ? b.readDoubleBE(dStart) : b.readFloatBE(dStart)); break;
        case 0x9f: m.channels ??= b[dStart]; break;
        case 0x1f43b675: return true; // Cluster: media data begins
        default: break;
      }
      if (sz.unknown) return true;
      o = dEnd;
    }
    void depth;
    return true;
  };
  walk(0, b.length, 0);
  if (!hasVideo) m.kind = 'audio';
  if (duration !== undefined) m.durationSec = (duration * scale) / 1e9;
  if (m.durationSec) m.bitrateKbps = Math.round((src.size * 8) / m.durationSec / 1000);
}

function avi(b: Buffer, m: MediaMeta): void {
  m.kind = 'video';
  m.format = 'AVI';
  const i = b.indexOf('avih', 0, 'latin1');
  if (i < 0 || i + 48 > b.length) return;
  const d = i + 8;
  const usPerFrame = b.readUInt32LE(d);
  const frames = b.readUInt32LE(d + 16);
  m.width = b.readUInt32LE(d + 32);
  m.height = b.readUInt32LE(d + 36);
  if (usPerFrame && frames) {
    m.durationSec = (frames * usPerFrame) / 1e6;
    m.frameRate = +(1e6 / usPerFrame).toFixed(2);
  }
}

/* ------------------------------------------------------------------ documents */

async function pdf(src: Source, m: MediaMeta): Promise<void> {
  m.kind = 'document';
  m.format = 'PDF';
  const cap = 32 * 1024 * 1024;
  const text = (src.size <= cap ? await src.read(0, src.size) : Buffer.concat([await src.read(0, cap / 2), await src.read(src.size - cap / 2, cap / 2)])).toString('latin1');
  const ver = /^%PDF-(\d\.\d)/.exec(text);
  if (ver) m.format = `PDF ${ver[1]}`;
  let pages: number | undefined;
  const re = /<<((?:(?!<<|>>)[\s\S]){0,4000})>>/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text))) {
    const dict = mm[1]!;
    if (/\/Type\s*\/Pages\b/.test(dict)) {
      const c = /\/Count\s+(\d+)/.exec(dict);
      if (c) pages = Math.max(pages ?? 0, Number(c[1]));
    }
  }
  if (pages !== undefined) m.pages = pages;
  else m.warnings.push('The page count is stored in a compressed section and was not read.');
  const info = /\/Title\s*\(((?:\\.|[^\\)]){1,500})\)/.exec(text);
  if (info) m.doc = { title: info[1]!.replace(/\\(.)/g, '$1') };
  if (src.size > cap) m.warnings.push('Only the start and end of this large PDF were examined.');
}

export function readZipEntries(p: string, wanted: Set<string> | ((name: string) => boolean), maxBytes = 2 * 1024 * 1024): Promise<Map<string, string>> {
  const want = typeof wanted === 'function' ? wanted : (n: string) => wanted.has(n);
  return new Promise((resolve, reject) => {
    yauzl.open(p, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Not a ZIP container'));
      const out = new Map<string, string>();
      let count = 0;
      zip.on('entry', (entry: yauzl.Entry) => {
        if (++count > 20000) {
          zip.close();
          return resolve(out);
        }
        if (!want(entry.fileName) || entry.uncompressedSize > maxBytes) return zip.readEntry();
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return zip.readEntry();
          const chunks: Buffer[] = [];
          let n = 0;
          stream.on('data', (c: Buffer) => {
            n += c.length;
            if (n > maxBytes) stream.destroy();
            else chunks.push(c);
          });
          stream.on('error', () => zip.readEntry());
          stream.on('close', () => {
            out.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

export function xmlTag(xml: string, name: string): string | undefined {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`);
  const mm = re.exec(xml);
  if (!mm || mm[1] === undefined) return undefined;
  const v = decodeXml(mm[1].replace(/<[^>]+>/g, '')).trim();
  return v || undefined;
}

async function office(p: string, ext: string, m: MediaMeta): Promise<void> {
  m.kind = 'document';
  const odf = ext.startsWith('od');
  m.format = { docx: 'Word document', docm: 'Word document (macros)', xlsx: 'Excel workbook', xlsm: 'Excel workbook (macros)', pptx: 'PowerPoint presentation', pptm: 'PowerPoint presentation (macros)', odt: 'OpenDocument text', ods: 'OpenDocument spreadsheet', odp: 'OpenDocument presentation' }[ext];
  const files = await readZipEntries(p, new Set(odf ? ['meta.xml'] : ['docProps/core.xml', 'docProps/app.xml']));
  const doc: DocumentProps = {};
  if (odf) {
    const meta = files.get('meta.xml');
    if (meta) {
      doc.title = xmlTag(meta, 'title');
      doc.subject = xmlTag(meta, 'subject');
      doc.creator = xmlTag(meta, 'initial-creator') ?? xmlTag(meta, 'creator');
      doc.keywords = xmlTag(meta, 'keyword');
      doc.description = xmlTag(meta, 'description');
      doc.created = xmlTag(meta, 'creation-date');
      doc.modified = xmlTag(meta, 'date');
      doc.application = xmlTag(meta, 'generator');
      const pc = /meta:page-count="(\d+)"/.exec(meta);
      const wc = /meta:word-count="(\d+)"/.exec(meta);
      if (pc) doc.pages = Number(pc[1]);
      if (wc) doc.words = Number(wc[1]);
    }
  } else {
    const core = files.get('docProps/core.xml');
    const app = files.get('docProps/app.xml');
    if (core) {
      doc.title = xmlTag(core, 'title');
      doc.subject = xmlTag(core, 'subject');
      doc.creator = xmlTag(core, 'creator');
      doc.keywords = xmlTag(core, 'keywords');
      doc.description = xmlTag(core, 'description');
      doc.lastModifiedBy = xmlTag(core, 'lastModifiedBy');
      doc.created = xmlTag(core, 'created');
      doc.modified = xmlTag(core, 'modified');
    }
    if (app) {
      doc.application = xmlTag(app, 'Application');
      const pages = xmlTag(app, 'Pages');
      const words = xmlTag(app, 'Words');
      const slides = xmlTag(app, 'Slides');
      if (pages) doc.pages = Number(pages);
      if (words) doc.words = Number(words);
      if (slides) doc.slides = Number(slides);
    }
    if (['docx', 'xlsx', 'pptx'].includes(ext)) m.editable = ['documentProps'];
    if (!core && !app) m.warnings.push('This document has no stored properties.');
  }
  const cleaned = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined && v !== ''));
  if (Object.keys(cleaned).length) m.doc = cleaned as DocumentProps;
  if (doc.pages) m.pages = doc.pages;
}
