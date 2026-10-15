import fsp from 'node:fs/promises';
import zlib from 'node:zlib';
import { makeError } from '../../shared/errors';
import { FONT_MAX_BYTES, parseFont } from './fontInfo';

/**
 * Reads the cmap table from a font file to extract the Unicode code points
 * that have glyphs. Returns a paginated list of { codePoint, char } entries.
 */

export interface GlyphEntry {
  /** Unicode code point. */
  cp: number;
  /** The character itself. */
  char: string;
}

export interface FontGlyphsResult {
  glyphs: GlyphEntry[];
  total: number;
  offset: number;
  hasMore: boolean;
}

function parseCmap(buf: Buffer): number[] {
  // Read the sfnt/woff/woff2 to get the cmap table
  // We'll reuse the parseFont infrastructure but read cmap ourselves
  const sig = buf.toString('latin1', 0, 4);

  if (sig === 'wOFF' || sig === 'wOF2') {
    // For WOFF/WOFF2, we need the full parse - use a simpler approach:
    // call parseFont to validate, then extract cmap from tables
    // Instead, just collect all printable Unicode chars from format 4 & 12 cmap subtables
    // We'll use a simplified extraction
    try {
      const info = parseFont(buf);
      // If parseFont works, the font is valid. But we need cmap data directly.
      // For woff/woff2, we rely on the subset from the tables.
      void info;
    } catch {
      return [];
    }
  }

  // Try to find cmap table directly for sfnt fonts
  const tables = new Map();
  try {
    if (sig === 'wOFF') {
      // WOFF: decompress cmap table
      const numTables = buf.readUInt16BE(12);
      for (let i = 0; i < numTables && 44 + i * 20 + 20 <= buf.length; i++) {
        const o = 44 + i * 20;
        const tag = buf.toString('latin1', o, o + 4);
        const off = buf.readUInt32BE(o + 4);
        const comp = buf.readUInt32BE(o + 8);
        const orig = buf.readUInt32BE(o + 12);
        if (tag === 'cmap' && off + comp <= buf.length) {
          const raw = buf.subarray(off, off + comp);
          if (comp === orig) {
            tables.set('cmap', raw);
          } else {
            try {
              tables.set('cmap', zlib.inflateSync(raw, { maxOutputLength: orig }));
            } catch { /* ignore */ }
          }
        }
      }
    } else if (sig === 'wOF2') {
      // WOFF2: decompress all tables via Brotli, find cmap
      const WOFF2_KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];
      const n = buf.readUInt16BE(12);
      const totalCompressed = buf.readUInt32BE(20);
      const o = { pos: 48 };
      const base128 = (b: Buffer, oo: { pos: number }): number => {
        let v = 0;
        for (let j = 0; j < 5; j++) {
          const byte = b[oo.pos++];
          if (byte === undefined) return 0;
          v = v * 128 + (byte & 0x7f);
          if (!(byte & 0x80)) return v;
        }
        return 0;
      };
      const entries: Array<{ tag: string; length: number }> = [];
      for (let i = 0; i < n; i++) {
        const flags = buf[o.pos++];
        if (flags === undefined) break;
        let tag: string;
        if ((flags & 0x3f) === 0x3f) { tag = buf.toString('latin1', o.pos, o.pos + 4); o.pos += 4; }
        else tag = WOFF2_KNOWN[flags & 0x3f] ?? '????';
        const origLength = base128(buf, o);
        const transformed = tag === 'glyf' || tag === 'loca' ? (flags >> 6) !== 3 : (flags >> 6) !== 0;
        const length = transformed ? base128(buf, o) : origLength;
        entries.push({ tag, length });
      }
      if (o.pos + totalCompressed <= buf.length) {
        try {
          const stream = zlib.brotliDecompressSync(buf.subarray(o.pos, o.pos + totalCompressed), { maxOutputLength: 64 * 1024 * 1024 });
          let off = 0;
          for (const e of entries) {
            if (e.tag === 'cmap' && off + e.length <= stream.length) {
              tables.set('cmap', stream.subarray(off, off + e.length));
            }
            off += e.length;
          }
        } catch { /* ignore */ }
      }
    } else {
      // Plain sfnt
      let base = 0;
      if (buf.toString('latin1', 0, 4) === 'ttcf' && buf.length >= 16) {
        base = buf.readUInt32BE(12);
      }
      const n = buf.readUInt16BE(base + 4);
      for (let i = 0; i < n && base + 12 + i * 16 + 16 <= buf.length; i++) {
        const oo = base + 12 + i * 16;
        const tag = buf.toString('latin1', oo, oo + 4);
        const off = buf.readUInt32BE(oo + 8);
        const len = buf.readUInt32BE(oo + 12);
        if (tag === 'cmap' && off + len <= buf.length) {
          tables.set('cmap', buf.subarray(off, off + len));
        }
      }
    }
  } catch {
    return [];
  }

  const cmap = tables.get('cmap');
  if (!cmap || cmap.length < 4) return [];

  const codePoints = new Set<number>();
  const numSubtables = cmap.readUInt16BE(2);

  for (let i = 0; i < numSubtables && 4 + i * 8 + 8 <= cmap.length; i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4);
    if (offset + 2 > cmap.length) continue;
    const format = cmap.readUInt16BE(offset);

    if (format === 4) {
      // Format 4: Segment mapping to delta values
      if (offset + 14 > cmap.length) continue;
      const segCount = cmap.readUInt16BE(offset + 6) / 2;
      const endOff = offset + 14;
      const startOff = endOff + segCount * 2 + 2;
      const deltaOff = startOff + segCount * 2;
      const rangeOff = deltaOff + segCount * 2;
      if (rangeOff + segCount * 2 > cmap.length) continue;
      for (let j = 0; j < segCount; j++) {
        const end = cmap.readUInt16BE(endOff + j * 2);
        const start = cmap.readUInt16BE(startOff + j * 2);
        if (end === 0xFFFF && start === 0xFFFF) continue;
        for (let cp = start; cp <= end && cp <= 0xFFFF; cp++) {
          if (cp >= 0x20) codePoints.add(cp); // skip control chars
        }
      }
    } else if (format === 12) {
      // Format 12: Segmented coverage (32-bit)
      if (offset + 16 > cmap.length) continue;
      const nGroups = cmap.readUInt32BE(offset + 12);
      for (let j = 0; j < nGroups && offset + 16 + j * 12 + 12 <= cmap.length; j++) {
        const start = cmap.readUInt32BE(offset + 16 + j * 12);
        const end = cmap.readUInt32BE(offset + 16 + j * 12 + 4);
        for (let cp = start; cp <= end && cp - start < 10000; cp++) {
          if (cp >= 0x20) codePoints.add(cp);
        }
      }
    }
  }

  return [...codePoints].sort((a, b) => a - b);
}

export async function readFontGlyphs(filePath: string, offset: number, limit: number): Promise<FontGlyphsResult> {
  const st = await fsp.stat(filePath);
  if (!st.isFile()) throw makeError('unsupported', 'font.glyphs', { target: filePath, message: 'Not a file.' });
  if (st.size > FONT_MAX_BYTES) throw makeError('unsupported', 'font.glyphs', { target: filePath, message: 'Font file too large.' });

  const buf = await fsp.readFile(filePath);
  const allCodePoints = parseCmap(buf);
  const total = allCodePoints.length;
  const slice = allCodePoints.slice(offset, offset + limit);

  return {
    glyphs: slice.map((cp) => ({ cp, char: String.fromCodePoint(cp) })),
    total,
    offset,
    hasMore: offset + limit < total,
  };
}
