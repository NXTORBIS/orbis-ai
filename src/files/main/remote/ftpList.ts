/**
 * Parsing of FTP directory listings: MLSD/MLST facts (RFC 3659), Unix-style
 * LIST output (ls -l, including the variants of vsftpd, ProFTPD, Pure-FTPd and
 * long-iso dates) and DOS/IIS-style LIST output. Pure functions: names are
 * returned as the server sent them and validated by the caller.
 */

export interface ParsedFtpEntry {
  name: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size?: number;
  modifiedMs?: number;
  /** Unix mode bits when the server reported them (type + permissions). */
  mode?: number;
  /** Where a link points ("name -> target" in Unix listings, OS.unix=slink:… in MLSD). */
  linkTarget?: string;
}

export interface ParsedFtpListing {
  entries: ParsedFtpEntry[];
  /** Lines that could not be understood (shortened), never guessed at. */
  unparsed: string[];
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "YYYYMMDDHHMMSS[.sss]" (MLSD "modify", MDTM answers): always UTC. */
export function parseMlsxTime(v: string): number | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?$/.exec(v.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return undefined;
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  return Date.UTC(y, mo - 1, d, h, mi, Math.min(s, 59), ms);
}

/** One MLSD/MLST line: "fact=value;fact=value; name". Undefined when it is not in that format. */
export function parseMlsdLine(line: string): (ParsedFtpEntry & { type: string }) | undefined {
  const sp = line.indexOf(' ');
  if (sp <= 0) return undefined;
  const factsPart = line.slice(0, sp);
  const name = line.slice(sp + 1);
  if (!factsPart.includes('=') || !factsPart.endsWith(';') || !name) return undefined;
  const facts = new Map<string, string>();
  for (const f of factsPart.split(';')) {
    if (!f) continue;
    const eq = f.indexOf('=');
    if (eq <= 0) return undefined;
    facts.set(f.slice(0, eq).toLowerCase(), f.slice(eq + 1));
  }
  const type = (facts.get('type') ?? '').toLowerCase();
  if (!type) return undefined;
  let kind: ParsedFtpEntry['kind'] = 'other';
  let linkTarget: string | undefined;
  if (type === 'file') kind = 'file';
  else if (type === 'dir' || type === 'cdir' || type === 'pdir') kind = 'directory';
  else if (type.startsWith('os.unix=slink') || type.startsWith('os.unix=symlink')) {
    kind = 'symlink';
    const raw = facts.get('type') ?? '';
    const c = raw.indexOf(':');
    if (c > 0) linkTarget = raw.slice(c + 1) || undefined;
  }
  const sizeRaw = facts.get('size') ?? facts.get('sizd');
  const size = sizeRaw && /^\d{1,16}$/.test(sizeRaw) ? Number(sizeRaw) : undefined;
  const modifiedMs = facts.get('modify') ? parseMlsxTime(facts.get('modify')!) : undefined;
  const modeRaw = facts.get('unix.mode');
  let mode: number | undefined;
  if (modeRaw && /^0?[0-7]{3,4}$/.test(modeRaw)) {
    const perm = parseInt(modeRaw, 8) & 0o7777;
    mode = perm | (kind === 'directory' ? 0o040000 : kind === 'symlink' ? 0o120000 : kind === 'file' ? 0o100000 : 0);
  }
  return { name, kind, type, size: kind === 'file' ? size : undefined, modifiedMs, mode, linkTarget };
}

const UNIX_TYPE: Record<string, { kind: ParsedFtpEntry['kind']; bits: number }> = {
  '-': { kind: 'file', bits: 0o100000 },
  d: { kind: 'directory', bits: 0o040000 },
  l: { kind: 'symlink', bits: 0o120000 },
  c: { kind: 'other', bits: 0o020000 },
  b: { kind: 'other', bits: 0o060000 },
  p: { kind: 'other', bits: 0o010000 },
  s: { kind: 'other', bits: 0o140000 },
  D: { kind: 'other', bits: 0 }, // Solaris doors
};

function permBits(p: string): number | undefined {
  if (!/^[-rwxsStTlL]{9}$/.test(p)) return undefined;
  let m = 0;
  const bit = (i: number, v: number) => {
    if (p[i] !== '-' && p[i] !== 'S' && p[i] !== 'T' && p[i] !== 'L' && p[i] !== 'l') m |= v;
  };
  bit(0, 0o400); bit(1, 0o200); bit(2, 0o100);
  bit(3, 0o040); bit(4, 0o020); bit(5, 0o010);
  bit(6, 0o004); bit(7, 0o002); bit(8, 0o001);
  if ('sS'.includes(p[2]!)) m |= 0o4000;
  if ('sSlL'.includes(p[5]!)) m |= 0o2000;
  if ('tT'.includes(p[8]!)) m |= 0o1000;
  return m;
}

/** Date of a Unix listing: "Jan 15 10:30" (within the last ~6 months), "Mar  1  2023", "2023-03-01 12:00", "2023-03-01". */
function unixDate(mon: string, day: string, yearOrTime: string, now: number): number | undefined {
  const mo = MONTHS[mon.toLowerCase().slice(0, 3)];
  const d = Number(day);
  if (mo === undefined || !(d >= 1 && d <= 31)) return undefined;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(yearOrTime);
  if (t) {
    // "Jan 15 10:30" has no year: the most recent such date that is not in the future (allowing a day of clock skew).
    const nowYear = new Date(now).getUTCFullYear();
    let ms = Date.UTC(nowYear, mo, d, Number(t[1]), Number(t[2]), Number(t[3] ?? 0));
    if (ms > now + 86_400_000) ms = Date.UTC(nowYear - 1, mo, d, Number(t[1]), Number(t[2]), Number(t[3] ?? 0));
    return ms;
  }
  if (/^\d{4}$/.test(yearOrTime)) return Date.UTC(Number(yearOrTime), mo, d);
  return undefined;
}

// type+perms, links, owner, [group], size, date, name. Owner/group may contain spaces only in exotic
// servers (not supported); the size is the last number before the date, which anchors the parse.
const UNIX_RE = /^([-dlcbpsD])([-rwxsStTlL]{9})[+.@]?\s+(?:\d+\s+)?(?:\S+\s+){0,2}?(\d+|\d+,\s*\d+)\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?|\d{4})\s(.*)$/;
const UNIX_ISO_RE = /^([-dlcbpsD])([-rwxsStTlL]{9})[+.@]?\s+(?:\d+\s+)?(?:\S+\s+){0,2}?(\d+)\s+(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?\s(.*)$/;

/** One Unix-style LIST line, or undefined. */
export function parseUnixLine(line: string, now = Date.now()): ParsedFtpEntry | undefined {
  let typeCh: string;
  let perms: string;
  let sizeRaw: string;
  let modifiedMs: number | undefined;
  let rest: string;
  const m = UNIX_RE.exec(line);
  if (m) {
    [, typeCh, perms, sizeRaw] = m as unknown as [string, string, string, string];
    modifiedMs = unixDate(m[4]!, m[5]!, m[6]!, now);
    rest = m[7]!;
  } else {
    const i = UNIX_ISO_RE.exec(line);
    if (!i) return undefined;
    [, typeCh, perms, sizeRaw] = i as unknown as [string, string, string, string];
    modifiedMs = Date.UTC(Number(i[4]), Number(i[5]) - 1, Number(i[6]), Number(i[7] ?? 0), Number(i[8] ?? 0), Number(i[9] ?? 0));
    rest = i[10]!;
  }
  const t = UNIX_TYPE[typeCh];
  if (!t) return undefined;
  // Exactly one space separates the date from the name: leading spaces belong to the name.
  let name = rest;
  let linkTarget: string | undefined;
  if (t.kind === 'symlink') {
    const arrow = name.indexOf(' -> ');
    if (arrow >= 0) {
      linkTarget = name.slice(arrow + 4);
      name = name.slice(0, arrow);
    }
  }
  if (!name || name === '.' || name === '..') return name ? { name, kind: t.kind } : undefined;
  const bits = permBits(perms);
  const size = /^\d{1,16}$/.test(sizeRaw) ? Number(sizeRaw) : undefined;
  return { name, kind: t.kind, size: t.kind === 'file' ? size : undefined, modifiedMs, mode: bits === undefined ? undefined : bits | t.bits, linkTarget };
}

// "01-15-24  10:30AM  <DIR>  name", "01-15-2024  10:30PM  12345 name", "2024-01-15  22:30  12345 name"
const DOS_RE = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(<DIR>|<JUNCTION>|\d+)\s+(.+)$/;
const DOS_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(<DIR>|<JUNCTION>|\d+)\s+(.+)$/;

/** One DOS/IIS-style LIST line, or undefined. */
export function parseDosLine(line: string): ParsedFtpEntry | undefined {
  let y: number;
  let mo: number;
  let d: number;
  let h: number;
  let mi: number;
  let ampm: string | undefined;
  let what: string;
  let name: string;
  const m = DOS_RE.exec(line);
  if (m) {
    mo = Number(m[1]);
    d = Number(m[2]);
    y = Number(m[3]);
    if (m[3]!.length === 2) y += y < 70 ? 2000 : 1900;
    [h, mi, ampm, what, name] = [Number(m[4]), Number(m[5]), m[6], m[7]!, m[8]!];
  } else {
    const i = DOS_ISO_RE.exec(line);
    if (!i) return undefined;
    [y, mo, d, h, mi, ampm, what, name] = [Number(i[1]), Number(i[2]), Number(i[3]), Number(i[4]), Number(i[5]), i[6], i[7]!, i[8]!];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return undefined;
  if (ampm) {
    const pm = ampm.toLowerCase() === 'pm';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  const modifiedMs = Date.UTC(y, mo - 1, d, h, mi);
  if (what === '<DIR>') return { name, kind: 'directory', modifiedMs };
  if (what === '<JUNCTION>') return { name, kind: 'symlink', modifiedMs };
  return { name, kind: 'file', size: /^\d{1,16}$/.test(what) ? Number(what) : undefined, modifiedMs };
}

/**
 * Parse a whole listing (MLSD or LIST). "." / ".." and MLSD cdir/pdir entries
 * are dropped; "total N" headers and empty lines are ignored; anything else
 * that matches no format is reported in `unparsed`.
 */
export function parseFtpListing(text: string, now = Date.now()): ParsedFtpListing {
  const entries: ParsedFtpEntry[] = [];
  const unparsed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || /^total\s+\d+$/i.test(line.trim())) continue;
    const ml = parseMlsdLine(line);
    if (ml) {
      if (ml.type === 'cdir' || ml.type === 'pdir' || ml.name === '.' || ml.name === '..') continue;
      const { type: _type, ...e } = ml;
      void _type;
      entries.push(e);
      continue;
    }
    const e = parseUnixLine(line, now) ?? parseDosLine(line);
    if (!e) {
      unparsed.push(line.slice(0, 200));
      continue;
    }
    if (e.name === '.' || e.name === '..') continue;
    entries.push(e);
  }
  return { entries, unparsed };
}
