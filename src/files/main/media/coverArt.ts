import fsp from 'node:fs/promises';

/**
 * Cover art embedded in audio files, read byte by byte like the rest of the
 * metadata reader (media/metadata.ts): ID3v2 APIC/PIC frames (MP3, also AAC
 * and WAV files with an ID3 tag), FLAC PICTURE blocks, Vorbis/Opus
 * METADATA_BLOCK_PICTURE comments (the comment packet reassembled from Ogg
 * pages) and MP4/M4A `covr` atoms. Only JPEG, PNG, GIF and WebP data is
 * returned (checked by its first bytes), at most COVER_MAX bytes.
 */

export const COVER_MAX = 8 * 1024 * 1024;
const READ_MAX = 24 * 1024 * 1024;

export interface CoverArt {
  mime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data: Buffer;
}

export function imageMime(b: Buffer): CoverArt['mime'] | undefined {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return 'image/gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

function picture(data: Buffer | undefined): CoverArt | undefined {
  if (!data || !data.length || data.length > COVER_MAX) return undefined;
  const mime = imageMime(data);
  return mime ? { mime, data: Buffer.from(data) } : undefined;
}

class Reader {
  private constructor(private readonly fh: fsp.FileHandle, readonly size: number) {}
  static async open(p: string): Promise<Reader> {
    const fh = await fsp.open(p, 'r');
    return new Reader(fh, (await fh.stat()).size);
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

const synchsafe = (b: Buffer, o: number) => ((b[o]! & 0x7f) << 21) | ((b[o + 1]! & 0x7f) << 14) | ((b[o + 2]! & 0x7f) << 7) | (b[o + 3]! & 0x7f);

/** Undo ID3 unsynchronisation (0xFF 0x00 → 0xFF). */
function unsync(b: Buffer): Buffer {
  const out = Buffer.alloc(b.length);
  let j = 0;
  for (let i = 0; i < b.length; i++) {
    out[j++] = b[i]!;
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, j);
}

/** Skip a text terminated by NUL (one byte for Latin-1/UTF-8, two aligned bytes for UTF-16). */
function skipTerminated(b: Buffer, o: number, wide: boolean): number {
  if (wide) {
    while (o + 1 < b.length && !(b[o] === 0 && b[o + 1] === 0)) o += 2;
    return o + 2;
  }
  while (o < b.length && b[o] !== 0) o++;
  return o + 1;
}

/** Pictures in an ID3v2 tag (whole tag in `b`); the front cover (type 3) is preferred. */
export function id3Pictures(b: Buffer): CoverArt | undefined {
  if (b.length < 10 || b.toString('latin1', 0, 3) !== 'ID3') return undefined;
  const ver = b[3]!;
  const flags = b[5]!;
  let tag = b.subarray(10, Math.min(b.length, 10 + synchsafe(b, 6)));
  if (flags & 0x80 && ver < 4) tag = unsync(tag);
  let off = 0;
  if (flags & 0x40 && ver >= 3) off += ver === 4 ? synchsafe(tag, 0) : tag.readUInt32BE(0) + 4;
  let fallback: CoverArt | undefined;
  const hdr = ver === 2 ? 6 : 10;
  while (off + hdr <= tag.length) {
    const id = tag.toString('latin1', off, off + (ver === 2 ? 3 : 4));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const len = ver === 2 ? tag.readUIntBE(off + 3, 3) : ver === 4 ? synchsafe(tag, off + 4) : tag.readUInt32BE(off + 4);
    if (len <= 0 || off + hdr + len > tag.length) break;
    let data = tag.subarray(off + hdr, off + hdr + len);
    if (ver === 4) {
      const fflags = tag.readUInt16BE(off + 8);
      if (fflags & 0x0001) data = data.subarray(4); // data length indicator
      if (fflags & 0x0002) data = unsync(data);
    }
    if ((id === 'APIC' || id === 'PIC') && data.length > 4) {
      const enc = data[0]!;
      const wide = enc === 1 || enc === 2;
      let o: number;
      if (id === 'PIC') o = 4; // 3-letter image format
      else o = skipTerminated(data, 1, false); // MIME type is always Latin-1
      const type = data[o]!;
      o = skipTerminated(data, o + 1, wide);
      const pic = picture(data.subarray(o));
      if (pic && type === 3) return pic;
      fallback ??= pic;
    }
    off += hdr + len;
  }
  return fallback;
}

/** A FLAC PICTURE block body (also the payload of Vorbis METADATA_BLOCK_PICTURE). */
export function flacPicture(d: Buffer): { type: number; art?: CoverArt } | undefined {
  if (d.length < 32) return undefined;
  const type = d.readUInt32BE(0);
  let o = 4;
  const mimeLen = d.readUInt32BE(o);
  o += 4 + mimeLen;
  if (o + 4 > d.length) return undefined;
  const descLen = d.readUInt32BE(o);
  o += 4 + descLen + 16;
  if (o + 4 > d.length) return undefined;
  const len = d.readUInt32BE(o);
  o += 4;
  if (o + len > d.length) return undefined;
  return { type, art: picture(d.subarray(o, o + len)) };
}

async function flac(r: Reader): Promise<CoverArt | undefined> {
  let off = 4;
  let fallback: CoverArt | undefined;
  for (let i = 0; i < 1024 && off + 4 <= r.size; i++) {
    const h = await r.read(off, 4);
    const last = (h[0]! & 0x80) !== 0;
    const type = h[0]! & 0x7f;
    const len = h.readUIntBE(1, 3);
    if (type === 6 && len <= READ_MAX) {
      const p = flacPicture(await r.read(off + 4, len));
      if (p?.art && p.type === 3) return p.art;
      fallback ??= p?.art;
    }
    off += 4 + len;
    if (last) break;
  }
  return fallback;
}

/** The second Ogg packet (Vorbis comments / OpusTags), reassembled across pages. */
async function oggCommentPacket(r: Reader): Promise<Buffer | undefined> {
  let off = 0;
  let packet = 0;
  const parts: Buffer[] = [];
  let total = 0;
  for (let pages = 0; pages < 4096 && off + 27 <= r.size; pages++) {
    const h = await r.read(off, 27);
    if (h.toString('latin1', 0, 4) !== 'OggS') return undefined;
    const nsegs = h[26]!;
    const table = await r.read(off + 27, nsegs);
    let dataOff = off + 27 + nsegs;
    let segStart = dataOff;
    let segLen = 0;
    for (let i = 0; i < nsegs; i++) {
      segLen += table[i]!;
      if (table[i]! < 255) {
        // A packet ends here.
        if (packet === 1) {
          parts.push(await r.read(segStart, segLen));
          return Buffer.concat(parts);
        }
        packet++;
        segStart += segLen;
        segLen = 0;
      }
    }
    if (packet === 1 && segLen) {
      parts.push(await r.read(segStart, segLen));
      total += segLen;
      if (total > READ_MAX) return undefined;
    }
    dataOff += table.reduce((a, b) => a + b, 0);
    off = dataOff;
  }
  return undefined;
}

async function ogg(r: Reader): Promise<CoverArt | undefined> {
  const pkt = await oggCommentPacket(r);
  if (!pkt) return undefined;
  let o = pkt.toString('latin1', 0, 8) === 'OpusTags' ? 8 : pkt.toString('latin1', 1, 7) === 'vorbis' ? 7 : -1;
  if (o < 0 || o + 4 > pkt.length) return undefined;
  o += 4 + pkt.readUInt32LE(o);
  if (o + 4 > pkt.length) return undefined;
  const n = Math.min(pkt.readUInt32LE(o), 10000);
  o += 4;
  let fallback: CoverArt | undefined;
  for (let i = 0; i < n && o + 4 <= pkt.length; i++) {
    const len = pkt.readUInt32LE(o);
    if (o + 4 + len > pkt.length) break;
    const c = pkt.subarray(o + 4, o + 4 + len);
    const eq = c.indexOf(0x3d);
    if (eq > 0 && c.toString('latin1', 0, eq).toUpperCase() === 'METADATA_BLOCK_PICTURE') {
      const p = flacPicture(Buffer.from(c.toString('latin1', eq + 1), 'base64'));
      if (p?.art && p.type === 3) return p.art;
      fallback ??= p?.art;
    }
    o += 4 + len;
  }
  return fallback;
}

async function mp4(r: Reader): Promise<CoverArt | undefined> {
  // moov may be at the start or the end; walk the top-level boxes.
  let off = 0;
  let moov: Buffer | undefined;
  for (let i = 0; i < 4096 && off + 8 <= r.size; i++) {
    const h = await r.read(off, 16);
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    let header = 8;
    if (size === 1) {
      size = Number(h.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) size = r.size - off;
    if (size < header) return undefined;
    if (type === 'moov') {
      if (size > READ_MAX) return undefined;
      moov = await r.read(off + header, size - header);
      break;
    }
    off += size;
  }
  if (!moov) return undefined;
  const child = (b: Buffer, name: string, from = 0): Buffer | undefined => {
    let o = from;
    while (o + 8 <= b.length) {
      const size = b.readUInt32BE(o);
      const type = b.toString('latin1', o + 4, o + 8);
      if (size < 8 || o + size > b.length) return undefined;
      if (type === name) return b.subarray(o + 8, o + size);
      o += size;
    }
    return undefined;
  };
  const udta = child(moov, 'udta');
  const meta = udta && child(udta, 'meta');
  // 'meta' is a full box (version + flags) in MP4; QuickTime files omit those 4 bytes.
  const ilst = meta && (child(meta, 'ilst', 4) ?? child(meta, 'ilst', 0));
  const covr = ilst && child(ilst, 'covr');
  if (!covr) return undefined;
  const data = child(covr, 'data');
  return data && data.length > 8 ? picture(data.subarray(8)) : undefined;
}

/** The embedded cover picture of an audio file, if there is one. */
export async function readCoverArt(p: string): Promise<CoverArt | undefined> {
  const r = await Reader.open(p);
  try {
    const head = await r.read(0, 16);
    const magic = head.toString('latin1', 0, 4);
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const size = synchsafe(head, 6) + 10;
      if (size > READ_MAX) return undefined;
      return id3Pictures(await r.read(0, size));
    }
    if (magic === 'fLaC') return await flac(r);
    if (magic === 'OggS') return await ogg(r);
    if (head.toString('latin1', 4, 8) === 'ftyp') return await mp4(r);
    if (magic === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE') {
      // WAV files may carry an ID3 tag in an "id3 " chunk.
      let off = 12;
      for (let i = 0; i < 64 && off + 8 <= r.size; i++) {
        const h = await r.read(off, 8);
        const len = h.readUInt32LE(4);
        if (/^id3 $/i.test(h.toString('latin1', 0, 4)) && len <= READ_MAX) return id3Pictures(await r.read(off + 8, len));
        off += 8 + len + (len % 2);
      }
    }
    return undefined;
  } finally {
    await r.close();
  }
}
