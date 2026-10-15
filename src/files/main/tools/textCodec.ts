import { makeError } from '../../shared/errors';
import type { TextEncodingName } from '../../shared/docTools';
import { detectEncoding, looksBinary } from '../fs/FileSystemService';

/**
 * Text decoding and encoding for the document tools (find & replace, text
 * fixes). Detection reuses the text preview's reader (BOM, UTF-16 without a
 * BOM, binary check); invalid UTF-8 is read as Windows-1252 when it uses the
 * 0x80–0x9F range (smart quotes, €…), else as Latin-1. Every decode/encode
 * pair is byte-exact: re-encoding unchanged text gives the original bytes.
 */

/** Windows-1252 characters for bytes 0x80–0x9F (undefined bytes map to the C1 control, as browsers do). */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];
const CP1252_REVERSE = new Map<number, number>(CP1252_HIGH.map((cp, i) => [cp, 0x80 + i]));

export interface DetectedText {
  encoding: TextEncodingName;
  /** Length of the byte-order mark in bytes (0 when none). */
  bom: number;
  source: 'bom' | 'detected';
  binary: boolean;
}

export function isValidUtf8(buf: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Decide how a file's bytes are text (or that they are not). */
export function detectText(buf: Buffer): DetectedText {
  const d = detectEncoding(buf.subarray(0, 4096));
  if (d.encoding === 'utf16le' || d.encoding === 'utf16be') return { encoding: d.encoding, bom: d.bom, source: d.bom ? 'bom' : 'detected', binary: false };
  const body = buf.subarray(d.bom);
  if (looksBinary(body)) return { encoding: 'utf8', bom: d.bom, source: d.bom ? 'bom' : 'detected', binary: true };
  if (d.bom || isValidUtf8(body)) return { encoding: 'utf8', bom: d.bom, source: d.bom ? 'bom' : 'detected', binary: false };
  let high = false;
  for (const b of body) if (b >= 0x80 && b <= 0x9f) { high = true; break; }
  return { encoding: high ? 'windows1252' : 'latin1', bom: 0, source: 'detected', binary: false };
}

/** Byte-order mark length of `buf` for `encoding` (0 when it does not start with one). */
export function bomLength(buf: Uint8Array, encoding: TextEncodingName): number {
  if (encoding === 'utf8' && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 3;
  if (encoding === 'utf16le' && buf[0] === 0xff && buf[1] === 0xfe) return 2;
  if (encoding === 'utf16be' && buf[0] === 0xfe && buf[1] === 0xff) return 2;
  return 0;
}

/** Decode bytes (without their BOM). Throws a validation error when they are not valid in that encoding. */
export function decodeText(bytes: Buffer, encoding: TextEncodingName, op = 'text.decode'): string {
  switch (encoding) {
    case 'utf8':
      try {
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw makeError('validation', op, { message: 'The file is not valid UTF-8. Choose the encoding it was written in.' });
      }
    case 'utf16le':
    case 'utf16be': {
      if (bytes.length % 2) throw makeError('validation', op, { message: `The file has an odd number of bytes, so it is not ${encoding === 'utf16le' ? 'UTF-16 LE' : 'UTF-16 BE'}.` });
      const b = Buffer.from(bytes);
      if (encoding === 'utf16be') b.swap16();
      return b.toString('utf16le');
    }
    case 'latin1':
      return bytes.toString('latin1');
    case 'windows1252': {
      let s = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = bytes.subarray(i, i + CHUNK);
        const codes = new Array<number>(part.length);
        for (let j = 0; j < part.length; j++) {
          const b = part[j]!;
          codes[j] = b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80]! : b;
        }
        s += String.fromCharCode(...codes);
      }
      return s;
    }
  }
}

/**
 * Encode text (without a BOM). Throws a validation error naming the first
 * character the encoding cannot hold, rather than writing a replacement.
 */
export function encodeText(text: string, encoding: TextEncodingName, op = 'text.encode'): Buffer {
  switch (encoding) {
    case 'utf8':
      return Buffer.from(text, 'utf8');
    case 'utf16le':
      return Buffer.from(text, 'utf16le');
    case 'utf16be': {
      const b = Buffer.from(text, 'utf16le');
      b.swap16();
      return b;
    }
    case 'latin1':
    case 'windows1252': {
      const out = Buffer.alloc(text.length);
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        let byte: number | undefined;
        if (encoding === 'latin1') byte = c <= 0xff ? c : undefined;
        else byte = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252_REVERSE.get(c);
        if (byte === undefined) {
          const ch = String.fromCodePoint(text.codePointAt(i)!);
          throw makeError('validation', op, { message: `“${ch}” cannot be written in ${encoding === 'latin1' ? 'Latin-1' : 'Windows-1252'}, the file's encoding. Nothing was changed.` });
        }
        out[i] = byte;
      }
      return out;
    }
  }
}

export function bomBytes(encoding: TextEncodingName): Buffer {
  if (encoding === 'utf8') return Buffer.from([0xef, 0xbb, 0xbf]);
  if (encoding === 'utf16le') return Buffer.from([0xff, 0xfe]);
  if (encoding === 'utf16be') return Buffer.from([0xfe, 0xff]);
  return Buffer.alloc(0);
}
