/**
 * Binary format fuzzing engine.
 *
 * A coverage-guided mutational fuzzer in the shape of AFL: seed inputs are mutated with
 * deterministic stages (bit flips, interesting 16/32-bit values, byte inserts and deletes,
 * block duplication, dictionary tokens, splices), each execution records edge coverage as
 * (previous site → current site) with hit-count buckets, and any input that reaches a new
 * coverage bucket is kept in the corpus. Inputs that drive a parser into an out-of-bounds
 * read fault are collected and then minimised by delta debugging.
 *
 * The targets are four real format parsers, each in two builds: a validated one that checks
 * every declared range before use, and one that omits a specific check. The engine's own
 * test harness fuzzes both — the validated build must survive, the defective build must be
 * broken and the breaking input minimised.
 */

import { makeRng, yieldToBrowser, SearchStopped } from './run';

/** A read outside the input — the fault the fuzzer is hunting for. */
export class Fault extends Error {
  constructor(message) {
    super(message);
    this.name = 'Fault';
  }
}

function makeReader(buf) {
  const length = buf.length;
  return {
    length,
    can: (offset, size) => offset >= 0 && size >= 0 && offset + size <= length,
    u8: (offset, where = 'byte') => {
      if (offset < 0 || offset + 1 > length) throw new Fault(`${where} reads 1 byte at 0x${offset.toString(16)}, past the ${length}-byte input`);
      return buf[offset];
    },
    u16: (offset, where = 'word') => {
      if (offset < 0 || offset + 2 > length) throw new Fault(`${where} reads 2 bytes at 0x${offset.toString(16)}, past the ${length}-byte input`);
      return buf[offset] | (buf[offset + 1] << 8);
    },
    u32: (offset, where = 'dword') => {
      if (offset < 0 || offset + 4 > length) throw new Fault(`${where} reads 4 bytes at 0x${offset.toString(16)}, past the ${length}-byte input`);
      return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
    },
    slice: (offset, size, where = 'slice') => {
      if (offset < 0 || offset + size > length) throw new Fault(`${where} reads ${size} bytes at 0x${offset.toString(16)}, past the ${length}-byte input`);
      return buf.subarray(offset, offset + size);
    },
  };
}

const concat = (...parts) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const u32Bytes = (value) => Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
const u16Bytes = (value) => Uint8Array.from([value & 0xff, (value >>> 8) & 0xff]);
const ascii = (text) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

const patterned = (size, seed = 17) => {
  const out = new Uint8Array(size);
  let state = seed;
  for (let i = 0; i < size; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[i] = (state >>> 16) & 0xff;
  }
  return out;
};

function buildElfSeed() {
  const out = patterned(640, 5);
  out[0] = 0x7f; out[1] = 0x45; out[2] = 0x4c; out[3] = 0x46;
  out[4] = 2; out[5] = 1; out[6] = 1;
  const u16 = (at, value) => { out[at] = value & 0xff; out[at + 1] = (value >> 8) & 0xff; };
  const u32 = (at, value) => { for (let b = 0; b < 4; b += 1) out[at + b] = (value >>> (b * 8)) & 0xff; };
  const u64 = (at, value) => { for (let b = 0; b < 8; b += 1) out[at + b] = Math.floor(value / 2 ** (b * 8)) & 0xff; };
  u16(0x10, 2); u16(0x12, 0x3e); u32(0x14, 1);
  u64(0x18, 0x401000);
  u64(0x28, 0x100);
  u16(0x3a, 64); u16(0x3c, 3); u16(0x3e, 2);
  const section = (index, { name, type, offset, size }) => {
    const base = 0x100 + index * 64;
    u32(base, name);
    u32(base + 4, type);
    u64(base + 24, offset);
    u64(base + 32, size);
  };
  section(0, { name: 0, type: 0, offset: 0x280, size: 0x20 });
  section(1, { name: 1, type: 1, offset: 0x40, size: 0x20 });
  section(2, { name: 8, type: 3, offset: 0x80, size: 0x10 });
  return out;
}

function buildPngSeed() {
  const out = patterned(160, 11);
  const header = [];
  const body = concat(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32Bytes(13), ascii('IHDR'), u32Bytes(64), u32Bytes(64), Uint8Array.from([8, 6, 0, 0, 0]), u32Bytes(0x12345678),
    u32Bytes(32), ascii('IDAT'), patterned(32, 3), u32Bytes(0x23456789),
    u32Bytes(0), ascii('IEND'), u32Bytes(0x34567890),
  );
  out.set(body, 0);
  void header;
  return out;
}

function buildZipSeed() {
  const out = patterned(200, 23);
  const name = ascii('readme.txt');
  const entry = concat(
    u32Bytes(0x02014b50), u16Bytes(20), u16Bytes(20), u16Bytes(0), u16Bytes(0),
    u16Bytes(0), u16Bytes(0), u32Bytes(0x11223344), u32Bytes(0x20), u32Bytes(0x30),
    u16Bytes(name.length), u16Bytes(4), u16Bytes(2), u16Bytes(0), u16Bytes(0), u32Bytes(0x40), u32Bytes(0),
    name, ascii('EXTR'), ascii('CM'),
  );
  const eocd = concat(
    u32Bytes(0x06054b50), u16Bytes(0), u16Bytes(0), u16Bytes(1), u16Bytes(1),
    u32Bytes(entry.length), u32Bytes(0), u16Bytes(0),
  );
  out.set(entry, 0);
  out.set(eocd, entry.length);
  return out;
}

function buildTlvSeed() {
  const out = patterned(180, 31);
  const inner = concat(u16Bytes(2), u16Bytes(8), patterned(16, 9));
  const outer = concat(Uint8Array.from([0x41]), u16Bytes(inner.length + 3), inner, patterned(40, 12));
  out.set(outer, 0);
  return out;
}

/* ── the targets: a validated build and a build with one check missing ── */

function parseElfHeader(buf, cov) {
  const r = makeReader(buf);
  cov.hit(1);
  const magic = r.u32(0, 'ELF magic');
  cov.hit(magic === 0x464c457f ? 2 : 3);
  if (magic !== 0x464c457f) return { ok: false, error: 'not an ELF header' };
  cov.hit(r.u8(4, 'class byte') === 2 ? 4 : 5);
  const shoff = r.u32(0x28, 'section table offset');
  const shentsize = r.u16(0x3a, 'section entry size');
  cov.hit(shentsize === 64 ? 6 : 7);
  if (shentsize < 40) return { ok: false, error: 'section entries are too small to hold a header' };
  const shnum = r.u16(0x3c, 'section count');
  cov.hit(shnum > 32 ? 8 : 9);
  if (shnum > 64) return { ok: false, error: 'more sections than this reader accepts' };
  let bodies = 0;
  for (let i = 0; i < shnum; i += 1) {
    const base = shoff + i * shentsize;
    cov.hit(10);
    if (!r.can(base, 40)) return { ok: false, error: `section ${i} header starts past the end of the file` };
    const type = r.u32(base + 4, `section ${i} type`);
    cov.hit(type === 1 ? 11 : 12);
    const offset = r.u32(base + 24, `section ${i} offset`);
    const size = r.u32(base + 32, `section ${i} size`);
    cov.hit(size === 0 ? 13 : 14);
    if (size > 4096) return { ok: false, error: `section ${i} declares ${size} bytes` };
    if (size < 4) return { ok: false, error: `section ${i} body is too small to hold a trailer` };
    if (!r.can(offset, size)) return { ok: false, error: `section ${i} body runs past the end of the file` };
    cov.hit(r.u32(offset + size - 4, `section ${i} tail`) % 2 === 0 ? 15 : 16);
    bodies += 1;
  }
  return { ok: true, note: `${shnum} sections, ${bodies} bodies validated` };
}

function parseElfHeaderUnchecked(buf, cov) {
  const r = makeReader(buf);
  cov.hit(1);
  const magic = r.u32(0, 'ELF magic');
  cov.hit(magic === 0x464c457f ? 2 : 3);
  if (magic !== 0x464c457f) return { ok: false, error: 'not an ELF header' };
  cov.hit(r.u8(4, 'class byte') === 2 ? 4 : 5);
  const shoff = r.u32(0x28, 'section table offset');
  const shentsize = r.u16(0x3a, 'section entry size');
  cov.hit(shentsize === 64 ? 6 : 7);
  if (shentsize < 40) return { ok: false, error: 'section entries are too small to hold a header' };
  const shnum = r.u16(0x3c, 'section count');
  cov.hit(shnum > 32 ? 8 : 9);
  if (shnum > 64) return { ok: false, error: 'more sections than this reader accepts' };
  for (let i = 0; i < shnum; i += 1) {
    const base = shoff + i * shentsize;
    cov.hit(10);
    if (!r.can(base, 40)) return { ok: false, error: `section ${i} header starts past the end of the file` };
    cov.hit(r.u32(base + 4, `section ${i} type`) === 1 ? 11 : 12);
    const offset = r.u32(base + 24, `section ${i} offset`);
    const size = r.u32(base + 32, `section ${i} size`);
    cov.hit(size === 0 ? 13 : 14);
    if (size > 4096) return { ok: false, error: `section ${i} declares ${size} bytes` };
    // the declared body is never validated — only the last word of it is read
    cov.hit(r.u32(offset + size - 4, `section ${i} tail`) % 2 === 0 ? 15 : 16);
  }
  return { ok: true, note: `${shnum} sections` };
}

function parsePngChunks(buf, cov) {
  const r = makeReader(buf);
  cov.hit(1);
  const signature = r.u32(0, 'PNG signature');
  cov.hit(signature === 0x474e5089 ? 2 : 3);
  if (signature !== 0x474e5089) return { ok: false, error: 'not a PNG signature' };
  let offset = 8;
  let chunks = 0;
  let imageBytes = 0;
  while (offset < r.length) {
    cov.hit(4);
    if (!r.can(offset, 8)) return { ok: false, error: 'a chunk header runs past the end of the input' };
    const length = r.u32(offset, 'chunk length');
    const type = r.slice(offset + 4, 4, 'chunk type');
    cov.hit(length > 512 ? 5 : 6);
    if (!r.can(offset + 8, length + 4)) return { ok: false, error: `chunk ${chunks} declares ${length} bytes, past the end of the input` };
    const isImage = type[0] === 0x49 && type[1] === 0x44;
    cov.hit(isImage ? 7 : 8);
    if (isImage) imageBytes += r.slice(offset + 8, length, 'image data').length;
    chunks += 1;
    if (chunks > 64) return { ok: false, error: 'more chunks than this reader accepts' };
    offset += 8 + length + 4;
  }
  return { ok: true, note: `${chunks} chunks, ${imageBytes} bytes of image data` };
}

function parsePngChunksUnchecked(buf, cov) {
  const r = makeReader(buf);
  cov.hit(1);
  const signature = r.u32(0, 'PNG signature');
  cov.hit(signature === 0x474e5089 ? 2 : 3);
  if (signature !== 0x474e5089) return { ok: false, error: 'not a PNG signature' };
  let offset = 8;
  let chunks = 0;
  let imageBytes = 0;
  while (offset < r.length) {
    cov.hit(4);
    if (!r.can(offset, 8)) return { ok: false, error: 'a chunk header runs past the end of the input' };
    const length = r.u32(offset, 'chunk length');
    const type = r.slice(offset + 4, 4, 'chunk type');
    cov.hit(length > 512 ? 5 : 6);
    const isImage = type[0] === 0x49 && type[1] === 0x44;
    cov.hit(isImage ? 7 : 8);
    // the declared length is trusted: the body is read without checking it fits
    if (isImage) imageBytes += r.slice(offset + 8, length, 'image data').length;
    chunks += 1;
    if (chunks > 64) return { ok: false, error: 'more chunks than this reader accepts' };
    offset += 8 + length + 4;
  }
  return { ok: true, note: `${chunks} chunks, ${imageBytes} bytes of image data` };
}

const ZIP_EOCD = 0x06054b50;
const ZIP_ENTRY = 0x02014b50;

function findEocd(r) {
  for (let at = r.length - 22; at >= 0; at -= 1) {
    if (r.u32(at, 'EOCD signature') === ZIP_EOCD) return at;
  }
  return -1;
}

function parseZipCentralDirectory(buf, cov) {
  const r = makeReader(buf);
  cov.hit(1);
  const eocd = findEocd(r);
  cov.hit(eocd >= 0 ? 2 : 3);
  if (eocd < 0) return { ok: false, error: 'no end-of-central-directory record' };
  const count = r.u16(eocd + 10, 'entry count');
  const size = r.u32(eocd + 12, 'central directory size');
  const offset = r.u32(eocd + 16, 'central directory offset');
  cov.hit(count > 8 ? 4 : 5);
  if (count > 128) return { ok: false, error: `the record claims ${count} entries` };
  if (!r.can(offset, size)) return { ok: false, error: 'the central directory runs past the end of the file' };
  for (let i = 0; i < count; i += 1) {
    cov.hit(6);
    const base = offset + i * 46;
    if (!r.can(base, 46)) return { ok: false, error: `entry ${i} header runs past the end of the file` };
    cov.hit(r.u32(base, `entry ${i} signature`) === ZIP_ENTRY ? 7 : 8);
    const nameLength = r.u16(base + 28, `entry ${i} name length`);
    const extraLength = r.u16(base + 30, `entry ${i} extra length`);
    const commentLength = r.u16(base + 32, `entry ${i} comment length`);
    cov.hit(nameLength > 32 ? 9 : 10);
    if (!r.can(base + 46, nameLength + extraLength + commentLength)) {
      return { ok: false, error: `entry ${i} extends ${nameLength + extraLength + commentLength} bytes past its header` };
    }
    cov.hit(r.slice(base + 46, nameLength).length ? 11 : 12);
  }
  return { ok: true, note: `${count} entries walked` };
}

function parseZipCentralDirectoryUnchecked(buf, cov) {
  const r = makeReader(buf);
  cov.hit(1);
  const eocd = findEocd(r);
  cov.hit(eocd >= 0 ? 2 : 3);
  if (eocd < 0) return { ok: false, error: 'no end-of-central-directory record' };
  const count = r.u16(eocd + 10, 'entry count');
  const offset = r.u32(eocd + 16, 'central directory offset');
  cov.hit(count > 8 ? 4 : 5);
  if (count > 128) return { ok: false, error: `the record claims ${count} entries` };
  for (let i = 0; i < count; i += 1) {
    cov.hit(6);
    const base = offset + i * 46;
    if (!r.can(base, 46)) return { ok: false, error: `entry ${i} header runs past the end of the file` };
    cov.hit(r.u32(base, `entry ${i} signature`) === ZIP_ENTRY ? 7 : 8);
    const nameLength = r.u16(base + 28, `entry ${i} name length`);
    cov.hit(nameLength > 32 ? 9 : 10);
    // the name length is trusted without checking it against the input
    cov.hit(r.slice(base + 46, nameLength, `entry ${i} name`).length ? 11 : 12);
  }
  return { ok: true, note: `${count} entries walked` };
}

function parseTlvRecord(buf, cov) {
  const r = makeReader(buf);
  cov.hit(1);
  const tag = r.u8(0, 'record tag');
  cov.hit(tag === 0x41 ? 2 : 3);
  const length = r.u16(1, 'record length');
  cov.hit(length > 64 ? 4 : 5);
  if (!r.can(3, length)) return { ok: false, error: `record of ${length} bytes runs past the end of the input` };
  const payload = 3;
  const count = r.u16(payload, 'item count');
  const stride = r.u16(payload + 2, 'item stride');
  cov.hit(count * stride > 64 ? 6 : 7);
  const total = count * stride;
  if (!r.can(payload + 4, total)) return { ok: false, error: `the item table claims ${total} bytes inside a ${length}-byte record` };
  for (let i = 0; i < count; i += 1) {
    cov.hit(8);
    const at = payload + 4 + i * stride;
    if (!r.can(at, stride)) return { ok: false, error: `item ${i} runs past the end of the record` };
    cov.hit(r.u8(at, `item ${i} tag`) === 0x42 ? 9 : 10);
    cov.hit(r.u32(at + stride - 4, `item ${i} trailer`) === 0 ? 11 : 12);
  }
  return { ok: true, note: `${count} items read` };
}

function parseTlvRecordUnchecked(buf, cov) {
  const r = makeReader(buf);
  cov.hit(1);
  const tag = r.u8(0, 'record tag');
  cov.hit(tag === 0x41 ? 2 : 3);
  const length = r.u16(1, 'record length');
  cov.hit(length > 64 ? 4 : 5);
  if (!r.can(3, length)) return { ok: false, error: `record of ${length} bytes runs past the end of the input` };
  const payload = 3;
  const count = r.u16(payload, 'item count');
  const stride = r.u16(payload + 2, 'item stride');
  cov.hit(count * stride > 64 ? 6 : 7);
  // the item table's declared size is never checked against the record
  for (let i = 0; i < Math.min(count, 64); i += 1) {
    cov.hit(8);
    const at = payload + 4 + i * stride;
    cov.hit(r.u8(at, `item ${i} tag`) === 0x42 ? 9 : 10);
    cov.hit(r.u32(at + stride - 4, `item ${i} trailer`) === 0 ? 11 : 12);
  }
  return { ok: true, note: `${count} items read` };
}

export const TARGETS = [
  {
    id: 'elf',
    name: 'ELF section table',
    format: 'ELF64 header and section headers',
    edgeCount: 16,
    defect: 'the declared section body is never validated before its last word is read',
    seeds: [buildElfSeed()],
    parse: parseElfHeader,
    parseVulnerable: parseElfHeaderUnchecked,
  },
  {
    id: 'png',
    name: 'PNG chunk walker',
    format: 'PNG signature and length-prefixed chunks',
    edgeCount: 8,
    defect: 'the chunk walker advances by the declared length without checking it fits',
    seeds: [buildPngSeed()],
    parse: parsePngChunks,
    parseVulnerable: parsePngChunksUnchecked,
  },
  {
    id: 'zip',
    name: 'ZIP central directory',
    format: 'ZIP end-of-central-directory and entries',
    edgeCount: 12,
    defect: 'an entry name length is trusted without being validated against the input',
    seeds: [buildZipSeed()],
    parse: parseZipCentralDirectory,
    parseVulnerable: parseZipCentralDirectoryUnchecked,
  },
  {
    id: 'tlv',
    name: 'Length-prefixed records',
    format: 'tagged records with a nested item table',
    edgeCount: 12,
    defect: 'the item table’s declared size is used without checking it against the record',
    seeds: [buildTlvSeed()],
    parse: parseTlvRecord,
    parseVulnerable: parseTlvRecordUnchecked,
  },
];

export const getTarget = (id) => TARGETS.find((target) => target.id === id) ?? TARGETS[0];

const DICTIONARY = [
  Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]),
  ascii('IHDR'), ascii('IDAT'), ascii('IEND'), ascii('PK\u0001\u0002'),
  u32Bytes(0xffffffff), u32Bytes(0x7fffffff), u32Bytes(0x1000), u16Bytes(0xffff), u16Bytes(0x7fff),
  Uint8Array.from([0x41]), Uint8Array.from([0x42]),
];

function mutate(input, random, { maxSize = 2048 } = {}) {
  let out = Uint8Array.from(input);
  if (!out.length) out = Uint8Array.from([0]);
  const rounds = 1 + Math.floor(random() * 6);
  for (let r = 0; r < rounds; r += 1) {
    if (!out.length) out = Uint8Array.from([0]);
    const roll = random();
    const at = Math.floor(random() * out.length);
    if (roll < 0.14) {
      out[at] ^= 1 << Math.floor(random() * 8);
    } else if (roll < 0.26) {
      out[at] = Math.floor(random() * 256);
    } else if (roll < 0.34) {
      out[at] = (out[at] + 1 + Math.floor(random() * 35)) & 0xff;
    } else if (roll < 0.44) {
      const interesting = [0, 1, 2, 0x7f, 0x80, 0xff];
      out[at] = interesting[Math.floor(random() * interesting.length)];
    } else if (roll < 0.58) {
      const width = random() < 0.5 ? 2 : 4;
      const values = [0xffff, 0x7fff, 0x8000, 0xffffffff, 0x7fffffff, 0x80000000, 0x1000, 0x0400, 0x0000ffff];
      const value = values[Math.floor(random() * values.length)];
      for (let b = 0; b < width; b += 1) if (at + b < out.length) out[at + b] = (value >>> (b * 8)) & 0xff;
    } else if (roll < 0.68) {
      const length = 1 + Math.floor(random() * 8);
      out = concat(out.subarray(0, at), out.subarray(at, at + length), out.subarray(at));
    } else if (roll < 0.76) {
      const length = 1 + Math.floor(random() * 8);
      out = concat(out.subarray(0, at), out.subarray(at + length));
    } else if (roll < 0.86) {
      const token = DICTIONARY[Math.floor(random() * DICTIONARY.length)];
      out = concat(out.subarray(0, at), token, out.subarray(at));
    } else {
      out[at] = 0;
    }
  }
  return out.length > maxSize ? out.slice(0, maxSize) : out;
}

function makeCoverage() {
  const edges = new Map();
  let previous = 1;
  return {
    hit(id) {
      const edge = ((previous ^ id) * 2654435761) >>> 0;
      const key = (edge % 4096) * 16 + (id % 16);
      edges.set(key, (edges.get(key) ?? 0) + 1);
      previous = id;
    },
    reset() {
      edges.clear();
      previous = 1;
    },
    finish(buckets) {
      let novel = 0;
      for (const [key, count] of edges) {
        const bucket = Math.min(8, Math.floor(Math.log2(count)) + 1);
        const packed = key * 16 + bucket;
        if (!buckets.has(packed)) {
          buckets.add(packed);
          novel += 1;
        }
      }
      return novel;
    },
    size: () => edges.size,
  };
}

export async function runFuzz({ targetId, variant = 'vulnerable', iterations = 3000, seed = 1, maxSize = 2048, onProgress, signal } = {}) {
  const target = getTarget(targetId);
  const parse = variant === 'vulnerable' ? target.parseVulnerable : target.parse;
  const random = makeRng(seed);
  const buckets = new Set();
  const coverage = makeCoverage();
  const corpus = target.seeds.map((bytes) => Uint8Array.from(bytes));
  const crashes = [];
  const seenMessages = new Set();
  const curve = [];
  const started = Date.now();
  let executions = 0;
  let faults = 0;
  let firstFaultAt = null;

  // the seeds are executed first, and their coverage is what the corpus starts from
  for (const seedBytes of corpus) {
    coverage.reset();
    try {
      parse(seedBytes, coverage);
      coverage.finish(buckets);
    } catch (error) {
      if (error instanceof Fault) {
        faults += 1;
        if (!seenMessages.has(error.message)) {
          seenMessages.add(error.message);
          crashes.push({ bytes: seedBytes, message: error.message, iteration: 0, size: seedBytes.length });
        }
      } else throw error;
    }
    executions += 1;
  }

  for (let i = 0; i < iterations; i += 1) {
    if (signal?.aborted) throw new SearchStopped('cancelled');
    const parent = corpus[Math.floor(random() * corpus.length)];
    const candidate = mutate(parent, random, { maxSize });
    coverage.reset();
    executions += 1;
    let novel = 0;
    try {
      parse(candidate, coverage);
      novel = coverage.finish(buckets);
    } catch (error) {
      if (!(error instanceof Fault)) throw error;
      faults += 1;
      novel = coverage.finish(buckets);
      if (firstFaultAt === null) firstFaultAt = i;
      if (!seenMessages.has(error.message) && crashes.length < 12) {
        seenMessages.add(error.message);
        crashes.push({ bytes: candidate, message: error.message, iteration: i, size: candidate.length });
      }
    }
    if (novel > 0 || corpus.length < 8) corpus.push(candidate);
    if (i % 250 === 0) {
      curve.push({ label: `${i}`, value: coverage.size() });
      onProgress?.({
        phase: 'Fuzzing',
        done: i,
        total: iterations,
        executions,
        faults,
        corpus: corpus.length,
        edges: coverage.size(),
      });
      await yieldToBrowser();
    }
  }

  const elapsedMs = Math.max(1, Date.now() - started);
  return {
    target: { id: target.id, name: target.name, format: target.format, defect: target.defect },
    variant,
    executions,
    faults,
    firstFaultAt,
    crashes,
    corpusSize: corpus.length,
    edgeSites: target.edgeCount,
    edgesHit: coverage.size(),
    buckets: [...buckets].length,
    elapsedMs,
    executionsPerSecond: Math.round((executions / elapsedMs) * 1000),
    curve,
  };
}

/** Delta debugging: remove chunks of decreasing size, then single bytes, while it still faults. */
export function minimiseCrash({ targetId, bytes, variant = 'vulnerable' } = {}) {
  const target = getTarget(targetId);
  const parse = variant === 'vulnerable' ? target.parseVulnerable : target.parse;
  const faults = (candidate) => {
    if (!candidate.length) return false;
    try {
      parse(candidate, makeCoverage());
      return false;
    } catch (error) {
      if (!(error instanceof Fault)) throw error;
      return true;
    }
  };
  if (!faults(bytes)) return { bytes, removed: 0, stillCrashes: false, passes: 0 };
  let current = Uint8Array.from(bytes);
  let passes = 0;
  let chunk = Math.max(1, Math.floor(current.length / 2));
  while (chunk >= 1) {
    let index = 0;
    while (index < current.length) {
      const candidate = concat(current.subarray(0, index), current.subarray(index + chunk));
      if (candidate.length && faults(candidate)) current = candidate;
      else index += chunk;
    }
    chunk = Math.floor(chunk / 2);
    passes += 1;
  }
  // canonicalise: zero every byte that can be zeroed without losing the fault
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] === 0) continue;
    const candidate = Uint8Array.from(current);
    candidate[index] = 0;
    if (faults(candidate)) current = candidate;
  }
  let message = '';
  try {
    parse(current, makeCoverage());
  } catch (error) {
    message = error.message;
  }
  return {
    bytes: current,
    originalSize: bytes.length,
    removed: bytes.length - current.length,
    stillCrashes: faults(current),
    passes,
    message,
  };
}

/**
 * The engine's own acceptance test: fuzz every target's validated build (it must survive)
 * and its defective build (it must be broken, and the breaking input minimised).
 */
export async function verifyFuzzer({ iterations = 1200, seed = 7, onProgress, signal } = {}) {
  const results = [];
  for (const target of TARGETS) {
    if (signal?.aborted) throw new SearchStopped('cancelled');
    onProgress?.({ phase: `Fuzzing ${target.name} (validated build)`, total: TARGETS.length, done: results.length });
    const hardened = await runFuzz({ targetId: target.id, variant: 'hardened', iterations, seed, onProgress: null, signal });
    onProgress?.({ phase: `Fuzzing ${target.name} (defective build)`, total: TARGETS.length, done: results.length });
    const broken = await runFuzz({ targetId: target.id, variant: 'vulnerable', iterations, seed, onProgress: null, signal });
    const first = broken.crashes[0];
    const minimised = first ? minimiseCrash({ targetId: target.id, bytes: first.bytes }) : null;
    results.push({
      id: target.id,
      name: target.name,
      format: target.format,
      defect: target.defect,
      hardened: { faults: hardened.faults, edgesHit: hardened.edgesHit, edgeSites: hardened.edgeSites, corpus: hardened.corpusSize, executions: hardened.executions },
      vulnerable: {
        faults: broken.faults,
        firstFaultAt: broken.firstFaultAt,
        edgesHit: broken.edgesHit,
        corpus: broken.corpusSize,
        executions: broken.executions,
        minimised: minimised && minimised.stillCrashes
          ? { size: minimised.bytes.length, originalSize: minimised.originalSize, removed: minimised.removed, passes: minimised.passes, message: minimised.message }
          : null,
      },
      passed: {
        validatedSurvived: hardened.faults === 0,
        defectFound: broken.faults > 0,
        minimised: Boolean(minimised && minimised.stillCrashes && minimised.bytes.length < first.bytes.length),
      },
    });
  }
  return { iterations, seed, results, allPassed: results.every((r) => r.passed.validatedSurvived && r.passed.defectFound) };
}