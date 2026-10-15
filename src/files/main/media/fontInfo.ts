import fsp from 'node:fs/promises';
import zlib from 'node:zlib';
import { makeError } from '../../shared/errors';

/**
 * Font facts for the preview pane: names from the `name` table and the glyph
 * count from `maxp`, read from TrueType/OpenType (.ttf/.otf), WOFF (zlib per
 * table) and WOFF2 (one Brotli stream; `name` and `maxp` are never
 * transformed). Only these two tables are decoded; nothing is installed and
 * no font code (hinting, glyph programs) is run here.
 */

export interface FontInfo {
  format: 'TrueType' | 'OpenType (CFF)' | 'WOFF' | 'WOFF2';
  /** Outlines inside a WOFF/WOFF2 wrapper. */
  outlines?: 'TrueType' | 'CFF';
  family?: string;
  subfamily?: string;
  fullName?: string;
  postscriptName?: string;
  version?: string;
  designer?: string;
  manufacturer?: string;
  copyright?: string;
  license?: string;
  /** Typographic family/subfamily (name IDs 16/17), when different. */
  typographicFamily?: string;
  typographicSubfamily?: string;
  glyphCount?: number;
  tableCount: number;
  warnings: string[];
}

export const FONT_MAX_BYTES = 30 * 1024 * 1024;
const FONT_EXTS = new Set(['ttf', 'otf', 'woff', 'woff2']);
export const isFontExt = (ext: string) => FONT_EXTS.has(ext.toLowerCase());

const tag = (b: Buffer, o: number) => b.toString('latin1', o, o + 4);

interface Tables { get(name: string): Buffer | undefined; count: number }

/** Table directory of a plain sfnt (TrueType/OpenType) at offset `base`. */
function sfntTables(b: Buffer, base = 0): Tables {
  if (b.length < base + 12) throw new Error('The font header is truncated.');
  const n = b.readUInt16BE(base + 4);
  if (n === 0 || n > 512 || base + 12 + n * 16 > b.length) throw new Error('The table directory is damaged.');
  const map = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    const o = base + 12 + i * 16;
    const off = b.readUInt32BE(o + 8);
    const len = b.readUInt32BE(o + 12);
    if (off + len <= b.length) map.set(tag(b, o), b.subarray(off, off + len));
  }
  return { get: (t) => map.get(t), count: n };
}

function woffTables(b: Buffer): Tables {
  if (b.length < 44) throw new Error('The WOFF header is truncated.');
  const n = b.readUInt16BE(12);
  if (n === 0 || n > 512 || 44 + n * 20 > b.length) throw new Error('The WOFF table directory is damaged.');
  const dir = new Map<string, { off: number; comp: number; orig: number }>();
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    dir.set(tag(b, o), { off: b.readUInt32BE(o + 4), comp: b.readUInt32BE(o + 8), orig: b.readUInt32BE(o + 12) });
  }
  return {
    count: n,
    get(t) {
      const e = dir.get(t);
      if (!e || e.off + e.comp > b.length || e.orig > 16 * 1024 * 1024) return undefined;
      const raw = b.subarray(e.off, e.off + e.comp);
      if (e.comp === e.orig) return raw;
      const out = zlib.inflateSync(raw, { maxOutputLength: e.orig });
      return out.length === e.orig ? out : undefined;
    },
  };
}

const WOFF2_KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function base128(b: Buffer, o: { pos: number }): number {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const byte = b[o.pos++];
    if (byte === undefined) throw new Error('The WOFF2 table directory is truncated.');
    if (i === 0 && byte === 0x80) throw new Error('The WOFF2 table directory is damaged.');
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return v;
  }
  throw new Error('The WOFF2 table directory is damaged.');
}

function woff2Tables(b: Buffer): Tables {
  if (b.length < 48) throw new Error('The WOFF2 header is truncated.');
  if (tag(b, 4) === 'ttcf') throw new Error('Font collections in WOFF2 are not read.');
  const n = b.readUInt16BE(12);
  const totalCompressed = b.readUInt32BE(20);
  if (n === 0 || n > 512) throw new Error('The WOFF2 table directory is damaged.');
  const o = { pos: 48 };
  const entries: Array<{ tag: string; length: number }> = [];
  for (let i = 0; i < n; i++) {
    const flags = b[o.pos++];
    if (flags === undefined) throw new Error('The WOFF2 table directory is truncated.');
    let t: string;
    if ((flags & 0x3f) === 0x3f) {
      t = tag(b, o.pos);
      o.pos += 4;
    } else t = WOFF2_KNOWN[flags & 0x3f] ?? '????';
    const version = flags >> 6;
    const origLength = base128(b, o);
    // glyf/loca are transformed unless version 3; hmtx is transformed with version 1; every other table is stored as is.
    const transformed = t === 'glyf' || t === 'loca' ? version !== 3 : version !== 0;
    const length = transformed ? base128(b, o) : origLength;
    entries.push({ tag: t, length });
  }
  if (o.pos + totalCompressed > b.length) throw new Error('The WOFF2 data is truncated.');
  const stream = zlib.brotliDecompressSync(b.subarray(o.pos, o.pos + totalCompressed), { maxOutputLength: 64 * 1024 * 1024 });
  const map = new Map<string, Buffer>();
  let off = 0;
  for (const e of entries) {
    if (off + e.length > stream.length) throw new Error('The WOFF2 data is shorter than its table directory says.');
    map.set(e.tag, stream.subarray(off, off + e.length));
    off += e.length;
  }
  return { get: (t) => map.get(t), count: n };
}

const MAC_ROMAN_HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

function decodeName(platform: number, encoding: number, data: Buffer): string | undefined {
  if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10 || encoding === 0))) {
    let s = '';
    for (let i = 0; i + 1 < data.length; i += 2) s += String.fromCharCode(data.readUInt16BE(i));
    return s;
  }
  if (platform === 1 && encoding === 0) return [...data].map((c) => (c < 128 ? String.fromCharCode(c) : MAC_ROMAN_HIGH[c - 128] ?? '?')).join('');
  return undefined;
}

/** Names from a `name` table: English (US) Windows names first, then any Unicode/Windows name, then Macintosh Roman. */
export function parseNameTable(t: Buffer): Map<number, string> {
  const out = new Map<number, string>();
  if (t.length < 6) return out;
  const count = t.readUInt16BE(2);
  const strings = t.readUInt16BE(4);
  const rank = (p: number, l: number) => (p === 3 && l === 0x409 ? 0 : p === 3 || p === 0 ? 1 : 2);
  const best = new Map<number, number>();
  for (let i = 0; i < count && 6 + i * 12 + 12 <= t.length; i++) {
    const o = 6 + i * 12;
    const platform = t.readUInt16BE(o);
    const encoding = t.readUInt16BE(o + 2);
    const language = t.readUInt16BE(o + 4);
    const id = t.readUInt16BE(o + 6);
    const len = t.readUInt16BE(o + 8);
    const off = t.readUInt16BE(o + 10);
    if (strings + off + len > t.length) continue;
    const r = rank(platform, language);
    if (best.has(id) && best.get(id)! <= r) continue;
    const text = decodeName(platform, encoding, t.subarray(strings + off, strings + off + len));
    const clean = text?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!clean) continue;
    out.set(id, clean.slice(0, 1000));
    best.set(id, r);
  }
  return out;
}

/** Parse font bytes (sfnt, WOFF or WOFF2). Throws a readable Error when the file is not a font this reader understands. */
export function parseFont(b: Buffer): FontInfo {
  const sig = tag(b, 0);
  let tables: Tables;
  let format: FontInfo['format'];
  let outlines: FontInfo['outlines'];
  if (sig === 'wOFF') {
    tables = woffTables(b);
    format = 'WOFF';
    outlines = tag(b, 4) === 'OTTO' ? 'CFF' : 'TrueType';
  } else if (sig === 'wOF2') {
    tables = woff2Tables(b);
    format = 'WOFF2';
    outlines = tag(b, 4) === 'OTTO' ? 'CFF' : 'TrueType';
  } else if (sig === 'OTTO') {
    tables = sfntTables(b);
    format = 'OpenType (CFF)';
  } else if (b.length >= 4 && (b.readUInt32BE(0) === 0x00010000 || sig === 'true')) {
    tables = sfntTables(b);
    format = 'TrueType';
  } else if (sig === 'ttcf') {
    // A collection: describe the first font.
    if (b.length < 16) throw new Error('The font collection header is truncated.');
    tables = sfntTables(b, b.readUInt32BE(12));
    format = 'TrueType';
  } else throw new Error('This is not a TrueType, OpenType, WOFF or WOFF2 font.');
  const info: FontInfo = { format, outlines, tableCount: tables.count, warnings: [] };
  const name = tables.get('name');
  if (name) {
    const n = parseNameTable(name);
    Object.assign(info, {
      copyright: n.get(0), family: n.get(1), subfamily: n.get(2), fullName: n.get(4), version: n.get(5), postscriptName: n.get(6),
      manufacturer: n.get(8), designer: n.get(9), license: n.get(13),
    });
    if (n.get(16) && n.get(16) !== info.family) info.typographicFamily = n.get(16);
    if (n.get(17) && n.get(17) !== info.subfamily) info.typographicSubfamily = n.get(17);
  } else info.warnings.push('The font has no name table.');
  const maxp = tables.get('maxp');
  if (maxp && maxp.length >= 6) info.glyphCount = maxp.readUInt16BE(4);
  else info.warnings.push('The glyph count is not recorded (no maxp table).');
  return info;
}

export async function readFontInfo(p: string): Promise<FontInfo> {
  const st = await fsp.stat(p);
  if (!st.isFile()) throw makeError('unsupported', 'font.info', { target: p, message: 'Only font files can be described.' });
  if (st.size > FONT_MAX_BYTES) throw makeError('unsupported', 'font.info', { target: p, message: 'This font file is too large to describe (30 MB at most).' });
  const b = await fsp.readFile(p);
  try {
    return parseFont(b);
  } catch (err) {
    throw makeError('unsupported', 'font.info', { target: p, message: (err as Error).message });
  }
}
