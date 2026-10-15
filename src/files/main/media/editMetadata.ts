import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { z } from 'zod';
import { makeError, toOrbisError } from '../../shared/errors';
import { PNG_TEXT_KEYWORDS, type AudioTags, type DocumentProps, type ImageText } from '../../shared/media';
import type { ExternalRunner } from '../ops/OperationManager';
import { decodePngText, parseId3v2, readMetadata, ID3_GENRES } from './metadata';

/**
 * Edits metadata stored inside files, for formats where the edit is well
 * defined: ID3 tags in MP3 files, Vorbis comments in FLAC files, core
 * properties in Word/Excel/PowerPoint files, text chunks in PNG images, and
 * removal of EXIF/location data from JPEG and PNG images.
 *
 * Every edit builds the complete new file in memory, checks that the audio or
 * image data is byte-identical to the original, writes it to a temporary
 * sibling, re-reads it to verify the change, and only then atomically replaces
 * the original. The caller snapshots the original first so it can be restored.
 */

export type MetadataEdit =
  | { kind: 'audioTags'; tags: AudioTags }
  | { kind: 'removeAudioTags' }
  | { kind: 'documentProps'; props: Pick<DocumentProps, 'title' | 'subject' | 'creator' | 'keywords' | 'description'> }
  | { kind: 'imageText'; text: ImageText }
  | { kind: 'removeImageText' }
  | { kind: 'removeLocation' }
  | { kind: 'removeExif' };

const MAX_EDIT_BYTES = 1024 * 1024 * 1024;

const text = z.string().max(10000).optional();
export const EditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('audioTags'), tags: z.object({ title: text, artist: text, album: text, albumArtist: text, year: text, track: text, genre: text, comment: text }).strict() }),
  z.object({ kind: z.literal('removeAudioTags') }),
  z.object({ kind: z.literal('documentProps'), props: z.object({ title: text, subject: text, creator: text, keywords: text, description: text }).strict() }),
  z.object({ kind: z.literal('imageText'), text: z.object({ title: text, author: text, description: text, copyright: text, comment: text, software: text }).strict() }),
  z.object({ kind: z.literal('removeImageText') }),
  z.object({ kind: z.literal('removeLocation') }),
  z.object({ kind: z.literal('removeExif') }),
]);

const damaged = (what: string) => makeError('unsupported', 'meta.edit', { message: `The ${what} structure is damaged or unusual, so it was not changed.` });

/** Same rules for every audio format, so MP3 and FLAC accept exactly the same values. */
function checkAudioTag(key: keyof AudioTags, v: string): void {
  if (key === 'year' && v && !/^\d{4}$/.test(v)) throw makeError('validation', 'meta.edit', { message: 'Year must be four digits.' });
  if (key === 'track' && v && !/^\d{1,4}(\/\d{1,4})?$/.test(v)) throw makeError('validation', 'meta.edit', { message: 'Track must be a number, optionally "n/total".' });
  if (v.length > 2000) throw makeError('validation', 'meta.edit', { message: `${key} is too long.` });
}

/* ------------------------------------------------------------------ ID3 */

interface RawFrame { id: string; flags: Buffer; data: Buffer }

function syncsafe(n: number): Buffer {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function readFrames(tag: Buffer, version: number): RawFrame[] {
  const frames: RawFrame[] = [];
  const flags = tag[5]!;
  const size = ((tag[6]! & 0x7f) << 21) | ((tag[7]! & 0x7f) << 14) | ((tag[8]! & 0x7f) << 7) | (tag[9]! & 0x7f);
  let off = 10;
  if (flags & 0x40) off += version === 4 ? ((tag[10]! & 0x7f) << 21) | ((tag[11]! & 0x7f) << 14) | ((tag[12]! & 0x7f) << 7) | (tag[13]! & 0x7f) : tag.readUInt32BE(10) + 4;
  const end = Math.min(tag.length, 10 + size);
  while (off + 10 <= end) {
    const id = tag.toString('latin1', off, off + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = version === 4 ? ((tag[off + 4]! & 0x7f) << 21) | ((tag[off + 5]! & 0x7f) << 14) | ((tag[off + 6]! & 0x7f) << 7) | (tag[off + 7]! & 0x7f) : tag.readUInt32BE(off + 4);
    if (len <= 0 || off + 10 + len > end) break;
    frames.push({ id, flags: Buffer.from(tag.subarray(off + 8, off + 10)), data: Buffer.from(tag.subarray(off + 10, off + 10 + len)) });
    off += 10 + len;
  }
  return frames;
}

function encodeText(text: string, version: number): Buffer {
  const latin1 = /^[\x00-\xff]*$/.test(text);
  if (latin1) return Buffer.concat([Buffer.from([0]), Buffer.from(text, 'latin1')]);
  if (version === 4) return Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
  return Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
}

function encodeComment(text: string, version: number): Buffer {
  const t = encodeText(text, version);
  const enc = t[0]!;
  const empty = enc === 1 ? Buffer.from([0xff, 0xfe, 0, 0]) : enc === 2 ? Buffer.from([0, 0]) : Buffer.from([0]);
  return Buffer.concat([Buffer.from([enc]), Buffer.from('eng', 'latin1'), empty, t.subarray(1)]);
}

export function buildId3(original: Buffer, tags: AudioTags): Buffer {
  const existing = parseId3v2(original);
  if (existing.unsynchronised) throw makeError('unsupported', 'meta.edit', { message: 'This file uses ID3 unsynchronisation, which Orbis Files does not rewrite.' });
  const version = existing.size && existing.version === 4 ? 4 : 3;
  if (existing.size && existing.version !== 3 && existing.version !== 4) throw makeError('unsupported', 'meta.edit', { message: `ID3v2.${existing.version} tags are not edited.` });
  const frames = existing.size ? readFrames(original.subarray(0, existing.size), version) : [];
  const ids: Record<keyof AudioTags, string> = { title: 'TIT2', artist: 'TPE1', album: 'TALB', albumArtist: 'TPE2', year: version === 4 ? 'TDRC' : 'TYER', track: 'TRCK', genre: 'TCON', comment: 'COMM' };
  for (const [key, value] of Object.entries(tags) as Array<[keyof AudioTags, string | undefined]>) {
    if (value === undefined) continue;
    const id = ids[key];
    const v = value.trim();
    checkAudioTag(key, v);
    // Remove every frame that carries this field (including the other year frame name).
    const drop = key === 'year' ? ['TYER', 'TDRC', 'TDAT'] : key === 'comment' ? ['COMM'] : [id];
    for (let i = frames.length - 1; i >= 0; i--) if (drop.includes(frames[i]!.id)) frames.splice(i, 1);
    if (v) frames.push({ id, flags: Buffer.alloc(2), data: key === 'comment' ? encodeComment(v, version) : encodeText(v, version) });
  }
  const body = Buffer.concat(frames.map((f) => {
    const h = Buffer.alloc(10);
    h.write(f.id, 0, 'latin1');
    if (version === 4) syncsafe(f.data.length).copy(h, 4);
    else h.writeUInt32BE(f.data.length, 4);
    f.flags.copy(h, 8);
    return Buffer.concat([h, f.data]);
  }));
  const padding = Buffer.alloc(1024);
  const header = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, version, 0, 0]), syncsafe(body.length + padding.length)]);
  let audio = original.subarray(existing.size);
  // Keep an existing ID3v1 tag consistent with the new values.
  if (audio.length >= 128 && audio.toString('latin1', audio.length - 128, audio.length - 125) === 'TAG') {
    const v1 = Buffer.from(audio.subarray(audio.length - 128));
    const put = (s: string | undefined, at: number, len: number) => {
      if (s === undefined) return;
      v1.fill(0, at, at + len);
      v1.write(s.replace(/[^\x20-\xff]/g, '?').slice(0, len), at, 'latin1');
    };
    put(tags.title, 3, 30);
    put(tags.artist, 33, 30);
    put(tags.album, 63, 30);
    put(tags.year, 93, 4);
    if (tags.genre !== undefined) {
      const g = ID3_GENRES.findIndex((x) => x.toLowerCase() === tags.genre!.trim().toLowerCase());
      v1[127] = g >= 0 ? g : 255;
    }
    audio = Buffer.concat([audio.subarray(0, audio.length - 128), v1]);
  }
  return Buffer.concat([header, body, padding, audio]);
}

/* ------------------------------------------------------------------ Office core properties */

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function updateCoreXml(xml: string, props: Record<string, string | undefined>): string {
  const names: Record<string, string> = { title: 'dc:title', subject: 'dc:subject', creator: 'dc:creator', keywords: 'cp:keywords', description: 'dc:description' };
  let out = xml;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    const tag = names[key];
    if (!tag) continue;
    const [prefix, local] = tag.split(':') as [string, string];
    const re = new RegExp(`<(\\w+):${local}\\b[^>]*?(?:/>|>[\\s\\S]*?</\\1:${local}>)`);
    const v = value.trim();
    if (v.length > 10000) throw makeError('validation', 'meta.edit', { message: `${key} is too long.` });
    const element = `<${prefix}:${local}>${escapeXml(v)}</${prefix}:${local}>`;
    if (re.test(out)) out = out.replace(re, v ? element : '');
    else if (v) {
      if (!new RegExp(`xmlns:${prefix}=`).test(out)) throw makeError('unsupported', 'meta.edit', { message: 'The document properties use an unexpected structure.' });
      out = out.replace(/<\/(\w+):coreProperties>/, `${element}</$1:coreProperties>`);
    }
  }
  return out;
}

async function rewriteZip(src: string, replace: Record<string, (old: string) => string>): Promise<Buffer> {
  const entries: Array<{ name: string; data: Buffer; mtime: Date; dir: boolean; mode?: number }> = [];
  await new Promise<void>((resolve, reject) => {
    yauzl.open(src, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Not a ZIP container'));
      let total = 0;
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entries.length > 50000) return reject(makeError('unsupported', 'meta.edit', { message: 'This document has too many parts to rewrite safely.' }));
        const dir = entry.fileName.endsWith('/');
        if (dir) {
          entries.push({ name: entry.fileName, data: Buffer.alloc(0), mtime: entry.getLastModDate(), dir });
          return zip.readEntry();
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return reject(e2 ?? new Error('Unreadable entry'));
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => {
            total += c.length;
            if (total > MAX_EDIT_BYTES) stream.destroy(new Error('Document too large to rewrite.'));
            else chunks.push(c);
          });
          stream.on('error', reject);
          stream.on('end', () => {
            entries.push({ name: entry.fileName, data: Buffer.concat(chunks), mtime: entry.getLastModDate(), dir, mode: (entry.externalFileAttributes >>> 16) || undefined });
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve());
      zip.on('error', reject);
      zip.readEntry();
    });
  });
  for (const name of Object.keys(replace)) {
    const e = entries.find((x) => x.name === name);
    if (!e) throw makeError('unsupported', 'meta.edit', { message: 'This document has no stored properties part, so its properties cannot be edited here.' });
    e.data = Buffer.from(replace[name]!(e.data.toString('utf8')), 'utf8');
  }
  return new Promise<Buffer>((resolve, reject) => {
    const z = new yazl.ZipFile();
    for (const e of entries) {
      if (e.dir) z.addEmptyDirectory(e.name, { mtime: e.mtime });
      // Office requires [Content_Types].xml first; preserving the original order keeps that true.
      else z.addBuffer(e.data, e.name, { mtime: e.mtime, mode: e.mode, compress: e.name !== 'mimetype' });
    }
    z.end();
    const chunks: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => chunks.push(c));
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    z.outputStream.on('error', reject);
  });
}

/* ------------------------------------------------------------------ JPEG EXIF */

export function stripJpeg(original: Buffer, mode: 'location' | 'all'): { data: Buffer; removed: string[] } {
  if (original[0] !== 0xff || original[1] !== 0xd8) throw makeError('unsupported', 'meta.edit', { message: 'Not a JPEG file.' });
  const parts: Buffer[] = [original.subarray(0, 2)];
  const removed: string[] = [];
  let off = 2;
  while (off + 4 <= original.length) {
    if (original[off] !== 0xff) throw makeError('io', 'meta.edit', { message: 'The JPEG structure is damaged; it was not changed.' });
    const marker = original[off + 1]!;
    if (marker === 0xda || marker === 0xd9) {
      parts.push(original.subarray(off));
      off = original.length;
      break;
    }
    if (marker === 0xff) {
      off += 1;
      continue;
    }
    const len = original.readUInt16BE(off + 2);
    const seg = original.subarray(off, off + 2 + len);
    const isExif = marker === 0xe1 && seg.toString('latin1', 4, 10) === 'Exif\0\0';
    const isXmp = marker === 0xe1 && seg.toString('latin1', 4, 33) === 'http://ns.adobe.com/xap/1.0/\0';
    if (isExif && mode === 'all') removed.push('EXIF');
    else if (isXmp && mode === 'all') removed.push('XMP');
    else if (isXmp && mode === 'location' && /GPS(Latitude|Longitude|Altitude)/.test(seg.toString('latin1'))) removed.push('XMP (contained location)');
    else if (isExif && mode === 'location') {
      const copy = Buffer.from(seg);
      if (zeroGps(copy, 10)) removed.push('GPS');
      parts.push(copy);
    } else parts.push(seg);
    off += 2 + len;
  }
  return { data: Buffer.concat(parts), removed };
}

/** Empties the GPS IFD in place (same size, data bytes zeroed). Returns whether one existed. */
function zeroGps(buf: Buffer, base: number): boolean {
  const le = buf.toString('latin1', base, base + 2) === 'II';
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  const ifd0 = base + u32(base + 4);
  if (ifd0 + 2 > buf.length) return false;
  const n = u16(ifd0);
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > buf.length || u16(e) !== 0x8825) continue;
    const gps = base + u32(e + 8);
    if (gps + 2 > buf.length) return false;
    const count = u16(gps);
    if (count === 0) return false;
    for (let k = 0; k < count; k++) {
      const ge = gps + 2 + k * 12;
      if (ge + 12 > buf.length) break;
      const size = (sizes[u16(ge + 2)] ?? 0) * u32(ge + 4);
      if (size > 4) {
        const at = base + u32(ge + 8);
        if (at + size <= buf.length) buf.fill(0, at, at + size);
      }
      buf.fill(0, ge, ge + 12);
    }
    buf.fill(0, gps, gps + 2);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ FLAC Vorbis comments */

export interface FlacBlock { type: number; data: Buffer }

const isFlac = (b: Buffer) => b.length >= 4 && b.toString('latin1', 0, 4) === 'fLaC';

/** Splits a FLAC file into its metadata blocks and the offset where audio frames begin. */
export function parseFlac(buf: Buffer): { blocks: FlacBlock[]; audioOffset: number } {
  if (!isFlac(buf)) throw makeError('unsupported', 'meta.edit', { message: 'Not a FLAC file.' });
  const blocks: FlacBlock[] = [];
  let off = 4;
  for (;;) {
    if (off + 4 > buf.length || blocks.length >= 4096) throw damaged('FLAC metadata');
    const last = (buf[off]! & 0x80) !== 0;
    const type = buf[off]! & 0x7f;
    const len = buf.readUIntBE(off + 1, 3);
    if (type === 127 || off + 4 + len > buf.length) throw damaged('FLAC metadata');
    blocks.push({ type, data: buf.subarray(off + 4, off + 4 + len) });
    off += 4 + len;
    if (last) break;
  }
  // STREAMINFO must come first and appear once; a second VORBIS_COMMENT block is invalid.
  if (blocks[0]?.type !== 0 || blocks[0].data.length !== 34 || blocks.filter((b) => b.type === 0).length !== 1 || blocks.filter((b) => b.type === 4).length > 1) throw damaged('FLAC metadata');
  return { blocks, audioOffset: off };
}

function u32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

/** Vendor string and raw comments ("NAME=value", UTF-8) of a VORBIS_COMMENT block. Unknown comments are kept byte for byte. */
export function parseVorbisBlock(d: Buffer): { vendor: Buffer; comments: Buffer[] } {
  if (d.length < 8) throw damaged('FLAC tag');
  const vendorLen = d.readUInt32LE(0);
  if (8 + vendorLen > d.length) throw damaged('FLAC tag');
  const vendor = d.subarray(4, 4 + vendorLen);
  let p = 4 + vendorLen;
  const n = d.readUInt32LE(p);
  p += 4;
  const comments: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    if (p + 4 > d.length) throw damaged('FLAC tag');
    const len = d.readUInt32LE(p);
    if (p + 4 + len > d.length) throw damaged('FLAC tag');
    comments.push(d.subarray(p + 4, p + 4 + len));
    p += 4 + len;
  }
  return { vendor, comments };
}

function buildVorbisBlock(vendor: Buffer, comments: Buffer[]): Buffer {
  return Buffer.concat([u32le(vendor.length), vendor, u32le(comments.length), ...comments.flatMap((c) => [u32le(c.length), c])]);
}

/** Field written for each tag, and every field name that carries the same value (all are replaced). */
const VORBIS_FIELDS: Record<keyof AudioTags, { name: string; aliases: string[] }> = {
  title: { name: 'TITLE', aliases: ['TITLE'] },
  artist: { name: 'ARTIST', aliases: ['ARTIST'] },
  album: { name: 'ALBUM', aliases: ['ALBUM'] },
  albumArtist: { name: 'ALBUMARTIST', aliases: ['ALBUMARTIST', 'ALBUM ARTIST', 'ALBUM_ARTIST'] },
  year: { name: 'DATE', aliases: ['DATE', 'YEAR'] },
  track: { name: 'TRACKNUMBER', aliases: ['TRACKNUMBER'] },
  genre: { name: 'GENRE', aliases: ['GENRE'] },
  comment: { name: 'COMMENT', aliases: ['COMMENT', 'DESCRIPTION'] },
};

function fieldName(c: Buffer): string {
  const eq = c.indexOf(0x3d);
  return eq > 0 ? c.toString('latin1', 0, eq).toUpperCase() : '';
}

/** Applies tag changes to a comment list: an edited field replaces the first matching comment in place; clearing removes it. */
export function editVorbisComments(comments: Buffer[], tags: AudioTags): Buffer[] {
  let out = [...comments];
  for (const [key, value] of Object.entries(tags) as Array<[keyof AudioTags, string | undefined]>) {
    if (value === undefined) continue;
    const field = VORBIS_FIELDS[key];
    if (!field) continue;
    const v = value.trim();
    checkAudioTag(key, v);
    const drop = new Set(field.aliases);
    // "n/total" carries the total itself; separate total fields would contradict it.
    if (key === 'track' && v.includes('/')) ['TRACKTOTAL', 'TOTALTRACKS'].forEach((x) => drop.add(x));
    const fresh = v ? Buffer.from(`${field.name}=${v}`, 'utf8') : undefined;
    const next: Buffer[] = [];
    let placed = false;
    for (const c of out) {
      if (!drop.has(fieldName(c))) next.push(c);
      else if (fresh && !placed) {
        next.push(fresh);
        placed = true;
      }
    }
    if (fresh && !placed) next.push(fresh);
    out = next;
  }
  return out;
}

/**
 * Rebuilds a FLAC file with new tags (or none, when `tags` is null). Every
 * other metadata block (STREAMINFO, SEEKTABLE, PICTURE, APPLICATION, CUESHEET…)
 * is kept byte for byte and in order; PADDING is resized so the audio frames
 * stay at the same offset whenever the new tags fit.
 */
export function buildFlac(original: Buffer, tags: AudioTags | null): Buffer {
  const { blocks, audioOffset } = parseFlac(original);
  const vc = blocks.find((b) => b.type === 4);
  const parsed = vc ? parseVorbisBlock(vc.data) : { vendor: Buffer.from('Orbis Files', 'utf8'), comments: [] };
  const comments = tags === null ? [] : editVorbisComments(parsed.comments, tags);
  const vcData = buildVorbisBlock(parsed.vendor, comments);
  if (vcData.length > 0xffffff) throw makeError('validation', 'meta.edit', { message: 'The tags are too large for a FLAC metadata block.' });
  const out: FlacBlock[] = [];
  for (const b of blocks) {
    if (b.type === 1) continue; // padding is rebuilt below
    out.push(b.type === 4 ? { type: 4, data: vcData } : b);
  }
  if (!vc) out.splice(1, 0, { type: 4, data: vcData });
  const used = out.reduce((a, b) => a + 4 + b.data.length, 0);
  const available = audioOffset - 4;
  if (used !== available) {
    const fits = used + 4 <= available && available - used - 4 <= 0xffffff;
    out.push({ type: 1, data: Buffer.alloc(fits ? available - used - 4 : 8192) });
  }
  const parts: Buffer[] = [Buffer.from('fLaC', 'latin1')];
  out.forEach((b, i) => {
    const h = Buffer.alloc(4);
    h[0] = (i === out.length - 1 ? 0x80 : 0) | b.type;
    h.writeUIntBE(b.data.length, 1, 3);
    parts.push(h, b.data);
  });
  parts.push(original.subarray(audioOffset));
  return Buffer.concat(parts);
}

/** Confirms the rebuilt FLAC kept the audio frames and every non-tag block exactly. */
function checkFlacPreserved(original: Buffer, data: Buffer): void {
  const a = parseFlac(original);
  const b = parseFlac(data);
  const keep = (x: FlacBlock[]) => x.filter((k) => k.type !== 1 && k.type !== 4);
  const ka = keep(a.blocks);
  const kb = keep(b.blocks);
  const same = ka.length === kb.length && ka.every((k, i) => k.type === kb[i]!.type && k.data.equals(kb[i]!.data)) && original.subarray(a.audioOffset).equals(data.subarray(b.audioOffset));
  if (!same) throw makeError('internal', 'meta.edit', { message: 'The rebuilt FLAC file did not keep the audio unchanged; the original was not changed.' });
}

/* ------------------------------------------------------------------ PNG text and EXIF */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 as used by PNG (over chunk type and data). */
export function crc32(...bufs: Buffer[]): number {
  let c = 0xffffffff;
  for (const b of bufs) for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface PngChunk { type: string; data: Buffer; raw: Buffer }

/** Splits a PNG into chunks, checking lengths and every CRC. Bytes after IEND are returned as `tail` and kept. */
export function parsePng(buf: Buffer): { chunks: PngChunk[]; tail: Buffer } {
  if (!isPng(buf)) throw makeError('unsupported', 'meta.edit', { message: 'Not a PNG file.' });
  const chunks: PngChunk[] = [];
  let off = 8;
  for (;;) {
    if (off + 12 > buf.length) throw damaged('PNG');
    const len = buf.readUInt32BE(off);
    if (len > 0x7fffffff || off + 12 + len > buf.length) throw damaged('PNG');
    const type = buf.toString('latin1', off + 4, off + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw damaged('PNG');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8), data) !== buf.readUInt32BE(off + 8 + len)) throw makeError('unsupported', 'meta.edit', { message: `The PNG chunk “${type}” has a wrong checksum, so the file was not changed.` });
    chunks.push({ type, data, raw: buf.subarray(off, off + 12 + len) });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  if (chunks[0]?.type !== 'IHDR') throw damaged('PNG');
  return { chunks, tail: buf.subarray(off) };
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(head.subarray(4, 8), data), 0);
  return Buffer.concat([head, data, crc]);
}

const isTextChunk = (type: string) => type === 'tEXt' || type === 'zTXt' || type === 'iTXt';
const keywordOf = (data: Buffer) => data.toString('latin1', 0, Math.max(0, data.indexOf(0)));

/** A text chunk for one keyword: tEXt when the value is Latin-1, otherwise uncompressed UTF-8 iTXt. */
export function pngTextChunk(keyword: string, value: string): Buffer {
  const key = Buffer.from(keyword, 'latin1');
  if (/^[\x01-\xff]*$/.test(value)) return pngChunk('tEXt', Buffer.concat([key, Buffer.from([0]), Buffer.from(value, 'latin1')]));
  // keyword NUL, compression flag 0, method 0, empty language tag NUL, empty translated keyword NUL, text
  return pngChunk('iTXt', Buffer.concat([key, Buffer.from([0, 0, 0, 0, 0]), Buffer.from(value, 'utf8')]));
}

/** Replaces the text stored under the standard keywords; all other chunks are kept byte for byte. */
export function buildPngText(original: Buffer, text: ImageText): Buffer {
  const { chunks, tail } = parsePng(original);
  let list = chunks;
  const fresh: Buffer[] = [];
  for (const [key, value] of Object.entries(text) as Array<[keyof ImageText, string | undefined]>) {
    if (value === undefined) continue;
    const keyword = PNG_TEXT_KEYWORDS[key];
    if (!keyword) continue;
    const v = value.trim();
    if (v.includes('\0')) throw makeError('validation', 'meta.edit', { message: `${keyword} cannot contain NUL characters.` });
    if (v.length > 10000) throw makeError('validation', 'meta.edit', { message: `${keyword} is too long.` });
    // Replace every existing chunk with this keyword (any of the three text chunk types).
    list = list.filter((c) => !(isTextChunk(c.type) && keywordOf(c.data).toLowerCase() === keyword.toLowerCase()));
    if (v) fresh.push(pngTextChunk(keyword, v));
  }
  // New text goes before the image data, where every reader looks for it.
  let at = list.findIndex((c) => c.type === 'IDAT');
  if (at < 0) at = list.length - 1;
  return Buffer.concat([PNG_SIG, ...list.slice(0, at).map((c) => c.raw), ...fresh, ...list.slice(at).map((c) => c.raw), tail]);
}

/** Removes text chunks, EXIF (and XMP), or only location data from a PNG. */
export function stripPng(original: Buffer, mode: 'text' | 'exif' | 'location'): { data: Buffer; removed: string[] } {
  const { chunks, tail } = parsePng(original);
  const out: Buffer[] = [PNG_SIG];
  const removed = new Set<string>();
  let textCount = 0;
  for (const c of chunks) {
    const text = isTextChunk(c.type);
    const xmp = text && keywordOf(c.data) === 'XML:com.adobe.xmp';
    if (mode === 'text' && text) {
      textCount++;
      continue;
    }
    if (mode === 'exif' && c.type === 'eXIf') {
      removed.add('EXIF');
      continue;
    }
    if (mode === 'exif' && xmp) {
      removed.add('XMP');
      continue;
    }
    if (mode === 'location' && xmp && /GPS(Latitude|Longitude|Altitude)/.test(decodePngText(c.type, c.data)?.text ?? '')) {
      removed.add('XMP (contained location)');
      continue;
    }
    if (mode === 'location' && c.type === 'eXIf') {
      const copy = Buffer.from(c.data);
      let zeroed: boolean;
      try {
        zeroed = zeroGps(copy, 0);
      } catch {
        throw damaged('PNG EXIF');
      }
      if (zeroed) {
        removed.add('GPS');
        out.push(pngChunk('eXIf', copy));
        continue;
      }
    }
    out.push(c.raw);
  }
  if (textCount) removed.add(`${textCount} text chunk${textCount === 1 ? '' : 's'}`);
  out.push(tail);
  return { data: Buffer.concat(out), removed: [...removed] };
}

/** Confirms the rebuilt PNG is valid (every CRC) and kept the image and every non-metadata chunk exactly, in order. */
function checkPngPreserved(original: Buffer, data: Buffer): void {
  const meta = (t: string) => isTextChunk(t) || t === 'eXIf';
  const a = parsePng(original).chunks.filter((c) => !meta(c.type));
  const b = parsePng(data).chunks.filter((c) => !meta(c.type));
  if (a.length !== b.length || !a.every((c, i) => c.raw.equals(b[i]!.raw))) throw makeError('internal', 'meta.edit', { message: 'The rebuilt PNG did not keep the image data unchanged; the original was not changed.' });
}

/* ------------------------------------------------------------------ apply */

export async function buildEdited(p: string, edit: MetadataEdit): Promise<{ data: Buffer; summary: string }> {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw makeError('validation', 'meta.edit', { target: p, message: 'Only files can be edited.' });
  if (st.size > MAX_EDIT_BYTES) throw makeError('unsupported', 'meta.edit', { target: p, message: 'Files over 1 GB are not rewritten.' });
  const meta = await readMetadata(p);
  if (!meta.editable?.includes(edit.kind)) throw makeError('unsupported', 'meta.edit', { target: p, message: 'This kind of metadata cannot be edited for this file.' });
  const nothing = () => makeError('validation', 'meta.edit', { target: p, message: 'There was nothing to remove.' });
  switch (edit.kind) {
    case 'audioTags': {
      const original = await fsp.readFile(p);
      if (!isFlac(original)) return { data: buildId3(original, edit.tags), summary: 'Audio tags updated' };
      const data = buildFlac(original, edit.tags);
      checkFlacPreserved(original, data);
      return { data, summary: 'Audio tags updated' };
    }
    case 'removeAudioTags': {
      const original = await fsp.readFile(p);
      if (!isFlac(original)) throw makeError('unsupported', 'meta.edit', { target: p, message: 'Removing all tags is offered for FLAC files only.' });
      const data = buildFlac(original, null);
      checkFlacPreserved(original, data);
      return { data, summary: 'All tags removed (the vendor string, cover art and audio are unchanged)' };
    }
    case 'documentProps':
      return { data: await rewriteZip(p, { 'docProps/core.xml': (x) => updateCoreXml(x, edit.props) }), summary: 'Document properties updated' };
    case 'imageText': {
      const original = await fsp.readFile(p);
      const data = buildPngText(original, edit.text);
      checkPngPreserved(original, data);
      return { data, summary: 'Image text updated' };
    }
    case 'removeImageText': {
      const original = await fsp.readFile(p);
      const r = stripPng(original, 'text');
      if (!r.removed.length) throw nothing();
      checkPngPreserved(original, r.data);
      return { data: r.data, summary: `Removed ${r.removed.join(', ')}` };
    }
    case 'removeLocation':
    case 'removeExif': {
      const original = await fsp.readFile(p);
      const png = isPng(original);
      const r = png ? stripPng(original, edit.kind === 'removeLocation' ? 'location' : 'exif') : stripJpeg(original, edit.kind === 'removeLocation' ? 'location' : 'all');
      if (!r.removed.length) throw nothing();
      if (png) checkPngPreserved(original, r.data);
      return { data: r.data, summary: `Removed ${r.removed.join(', ')}` };
    }
  }
}

/** Confirms the rewritten file has the requested change and is still readable. */
export async function verifyEdited(tmp: string, edit: MetadataEdit): Promise<void> {
  const m = await readMetadata(tmp, { includeLocation: true });
  const fail = (why: string) => {
    throw makeError('io', 'meta.edit', { message: `The edited file did not verify (${why}); the original was not changed.` });
  };
  if (edit.kind === 'audioTags') {
    for (const [k, v] of Object.entries(edit.tags)) {
      if (v === undefined) continue;
      const got = (m.tags as Record<string, string | undefined> | undefined)?.[k] ?? '';
      if (got !== v.trim() && !(k === 'genre' && v.trim() === '')) fail(`${k} reads back as "${got}"`);
    }
  } else if (edit.kind === 'removeAudioTags') {
    if (m.kind !== 'audio') fail('not readable as audio');
    if (m.tags && Object.keys(m.tags).length) fail('tags are still present');
  } else if (edit.kind === 'documentProps') {
    if (m.kind !== 'document') fail('not readable as a document');
    for (const [k, v] of Object.entries(edit.props)) {
      if (v === undefined) continue;
      if (((m.doc as Record<string, unknown> | undefined)?.[k] ?? '') !== v.trim()) fail(`${k} did not change`);
    }
  } else if (edit.kind === 'imageText') {
    if (m.kind !== 'image') fail('not readable as an image');
    for (const [k, v] of Object.entries(edit.text)) {
      if (v === undefined) continue;
      const got = (m.imageText as Record<string, string | undefined> | undefined)?.[k] ?? '';
      if (got !== v.trim()) fail(`${k} reads back as "${got}"`);
    }
  } else if (edit.kind === 'removeImageText') {
    if (m.kind !== 'image') fail('not readable as an image');
    if (parsePng(await fsp.readFile(tmp)).chunks.some((c) => isTextChunk(c.type))) fail('text chunks are still present');
  } else {
    if (m.kind !== 'image') fail('not readable as an image');
    if (m.gps || m.hasLocation) fail('location data is still present');
    if (edit.kind === 'removeExif' && m.exif) fail('EXIF is still present');
  }
}

/**
 * Operation runner for metadata edits: snapshot the original (restorable),
 * write a verified temporary copy, then atomically replace the original.
 */
export function makeMetadataEditRunner(deps: { snapshot: (p: string) => Promise<{ id: string }>; markRunning: (rec: Parameters<ExternalRunner>[0]) => void; onChanged: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const parsed = EditSchema.safeParse((req.params as { edit?: unknown } | undefined)?.edit);
    if (!parsed.success) throw makeError('validation', 'meta.edit', { message: 'The requested metadata change is not valid.' });
    const edit = parsed.data as MetadataEdit;
    rec.progress = { totalItems: rec.sources.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    for (const p of rec.sources) {
      await ctx.gate();
      try {
        const before = await fsp.stat(p);
        const { data, summary } = await buildEdited(p, edit);
        const snap = await deps.snapshot(p);
        const tmp = path.join(path.dirname(p), `.orbis-part-${crypto.randomUUID()}${path.extname(p)}`);
        helpers.temp(tmp);
        const fh = await fsp.open(tmp, 'wx', before.mode & 0o7777);
        try {
          await fh.writeFile(data);
          await fh.sync();
        } finally {
          await fh.close();
        }
        await verifyEdited(tmp, edit);
        // Re-check that the original did not change while we worked.
        const now = await fsp.stat(p);
        if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) throw makeError('busy', 'meta.edit', { target: p, message: 'The file changed while it was being edited; nothing was replaced.' });
        await fsp.rename(tmp, p);
        helpers.committed(tmp);
        await fsp.utimes(p, before.atime, new Date()).catch(() => undefined);
        deps.onChanged(p);
        rec.results.push({ source: p, destination: p, status: 'done' });
        rec.notes = [...(rec.notes ?? []), `${path.basename(p)}: ${summary}. The original is kept as a restorable snapshot (Properties → Snapshots).`];
        void snap;
      } catch (err) {
        if ((err as { category?: string }).category === 'cancelled') throw err;
        rec.results.push({ source: p, status: 'failed', error: toOrbisError(err, 'meta.edit', p, 'no') });
      }
      helpers.tick(0, 1, path.basename(p));
    }
  };
}
