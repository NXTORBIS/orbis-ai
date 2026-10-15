/**
 * Checksum files (SHA256SUMS, *.sha256, *.sha1, *.md5, …): reading and
 * writing the two formats GNU coreutils uses.
 *
 *   GNU:  <hex digest><space><space or *><path>     ("*" = binary mode, same digest)
 *   BSD:  <ALGO> (<path>) = <hex digest>            (`sha256sum --tag`, macOS `shasum`, OpenBSD)
 *
 * A line starting with "\" has an escaped path ("\\" = backslash, "\n" =
 * new line, "\r" = carriage return), as coreutils writes for such names.
 * Blank lines and lines starting with "#" are ignored. CRC-32 (.sfv) and
 * BLAKE2 (b2sum) files are not supported.
 *
 * Paths in a checksum file are relative to the folder the file is in; an
 * entry that is absolute or climbs out with ".." is refused, never read.
 */

export type ChecksumAlgorithm = 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';

export const HEX_LENGTH: Record<ChecksumAlgorithm, number> = { md5: 32, sha1: 40, sha224: 56, sha256: 64, sha384: 96, sha512: 128 };

const BY_LENGTH = new Map<number, ChecksumAlgorithm>(Object.entries(HEX_LENGTH).map(([a, n]) => [n, a as ChecksumAlgorithm]));

const BSD_NAMES: Record<string, ChecksumAlgorithm> = { MD5: 'md5', SHA1: 'sha1', SHA224: 'sha224', SHA256: 'sha256', SHA384: 'sha384', SHA512: 'sha512', 'SHA-1': 'sha1', 'SHA-224': 'sha224', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512', 'SHA2-256': 'sha256', 'SHA2-512': 'sha512' };

export interface ChecksumEntry {
  /** 1-based line number in the file. */
  line: number;
  /** The path as written (unescaped), relative to the checksum file's folder. */
  path: string;
  digest: string;
  algorithm: ChecksumAlgorithm;
  style: 'gnu' | 'bsd';
}

export interface ChecksumLineProblem {
  line: number;
  text: string;
  reason: string;
}

export interface ParsedChecksumFile {
  entries: ChecksumEntry[];
  /** Lines that could not be read as checksums (shown to the user; never guessed). */
  problems: ChecksumLineProblem[];
}

/** The algorithm a checksum file's name stands for (SHA256SUMS, x.sha256, x.sha256sum, MD5SUMS, x.md5…). */
export function algorithmFromFileName(name: string): ChecksumAlgorithm | undefined {
  const n = name.toLowerCase();
  const m = /(?:^|\.)(md5|sha1|sha224|sha256|sha384|sha512)(?:sums?)?$/.exec(n);
  return m ? (m[1] as ChecksumAlgorithm) : undefined;
}

/** Whether a file looks like a checksum file Orbis Files can verify. */
export function isChecksumFileName(name: string): boolean {
  return algorithmFromFileName(name) !== undefined;
}

function unescapeName(s: string): string | undefined {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n === '\\') out += '\\';
    else if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else return undefined;
  }
  return out;
}

function escapeName(s: string): { text: string; escaped: boolean } {
  if (!/[\\\n\r]/.test(s)) return { text: s, escaped: false };
  return { text: s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r'), escaped: true };
}

/**
 * Read a checksum file's text. `expected` (from the file name) is used to
 * reject digests of another length rather than silently treating them as a
 * different algorithm.
 */
export function parseChecksumFile(text: string, expected?: ChecksumAlgorithm): ParsedChecksumFile {
  const entries: ChecksumEntry[] = [];
  const problems: ChecksumLineProblem[] = [];
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.forEach((raw, i) => {
    const line = i + 1;
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!l.trim() || l.startsWith('#')) return;
    const escaped = l.startsWith('\\');
    const body = escaped ? l.slice(1) : l;
    const problem = (reason: string) => problems.push({ line, text: l.length > 300 ? `${l.slice(0, 300)}…` : l, reason });
    const bsd = /^([A-Za-z0-9-]+) ?\((.*)\) ?= ?([0-9A-Fa-f]+)$/.exec(body);
    const gnu = bsd ? null : /^([0-9A-Fa-f]+) [ *](.*)$/.exec(body);
    if (!bsd && !gnu) return problem('Not a checksum line (expected "digest  name" or "SHA256 (name) = digest").');
    let algorithm: ChecksumAlgorithm | undefined;
    let digest: string;
    let rawPath: string;
    if (bsd) {
      algorithm = BSD_NAMES[bsd[1]!.toUpperCase()];
      if (!algorithm) return problem(`The algorithm "${bsd[1]}" is not supported (MD5, SHA-1, SHA-224, SHA-256, SHA-384 and SHA-512 are).`);
      rawPath = bsd[2]!;
      digest = bsd[3]!;
      if (digest.length !== HEX_LENGTH[algorithm]) return problem(`A ${algorithm.toUpperCase()} checksum has ${HEX_LENGTH[algorithm]} hexadecimal digits; this one has ${digest.length}.`);
    } else {
      digest = gnu![1]!;
      rawPath = gnu![2]!;
      algorithm = BY_LENGTH.get(digest.length);
      if (!algorithm) return problem(`A checksum with ${digest.length} hexadecimal digits does not match a supported algorithm.`);
    }
    if (expected && algorithm !== expected) return problem(`The file name says ${expected.toUpperCase()}, but this line has a ${algorithm.toUpperCase()} checksum.`);
    const p = escaped ? unescapeName(rawPath) : rawPath;
    if (p === undefined) return problem('The file name uses an escape sequence that is not understood.');
    if (!p) return problem('The line has no file name.');
    entries.push({ line, path: p, digest: digest.toLowerCase(), algorithm, style: bsd ? 'bsd' : 'gnu' });
  });
  return { entries, problems };
}

/**
 * Check a path from a checksum file. Only plain relative paths inside the
 * checksum file's folder are accepted. Backslashes count as separators too, so
 * a file written on Windows cannot climb out with "..\".
 */
export function checkEntryPath(p: string): { ok: true; segments: string[] } | { ok: false; reason: string } {
  if (p.includes('\0')) return { ok: false, reason: 'The name contains a null character.' };
  if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) return { ok: false, reason: 'Absolute paths are not followed; entries must be relative to the checksum file’s folder.' };
  const segments = p.split(/[\\/]/).filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) return { ok: false, reason: 'Paths with ".." would leave the checksum file’s folder and are not followed.' };
  if (!segments.length) return { ok: false, reason: 'The path does not name a file.' };
  return { ok: true, segments };
}

/** One GNU coreutils line (text mode, two spaces), with escaping for names containing \, new line or carriage return. */
export function formatChecksumLine(digest: string, relPath: string): string {
  const { text, escaped } = escapeName(relPath);
  return `${escaped ? '\\' : ''}${digest.toLowerCase()}  ${text}`;
}

export type VerifyStatus = 'ok' | 'mismatch' | 'missing' | 'unreadable' | 'refused';

export interface VerifyItem {
  line: number;
  path: string;
  status: VerifyStatus;
  algorithm: ChecksumAlgorithm;
  expected: string;
  actual?: string;
  reason?: string;
}

export interface VerifySummary {
  ok: number;
  mismatch: number;
  missing: number;
  unreadable: number;
  refused: number;
  problems: number;
  total: number;
}

export function summarizeVerify(items: VerifyItem[], problems: number): VerifySummary {
  const s: VerifySummary = { ok: 0, mismatch: 0, missing: 0, unreadable: 0, refused: 0, problems, total: items.length };
  for (const i of items) s[i.status]++;
  return s;
}
