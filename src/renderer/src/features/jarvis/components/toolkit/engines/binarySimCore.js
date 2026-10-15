/**
 * Binary function similarity engine.
 *
 * Reads x86-64 and AArch64 machine code out of real binaries (ELF, PE, Mach-O or raw
 * bytes), recovers function boundaries by scanning for prologues and returns, then
 * decodes instructions into an address-oblivious token stream: branch and call targets,
 * RIP-relative displacements and absolute immediates are replaced by a canonical marker,
 * because those are exactly the things that move when a binary is rebuilt.
 *
 * Matching uses MinHash over k-grams of those tokens, which estimates Jaccard similarity
 * between functions without comparing them pairwise byte by byte. The benchmark builds
 * real ELF64 files from a small assembler, transforms one copy (reordered, rebased,
 * padded, re-registered, some functions genuinely rewritten) and measures precision and
 * recall against the ground truth it constructed.
 */

import { makeRng } from './run';

const MH_COUNT = 64;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const fnv = (text) => {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
};

const MH_A = [];
const MH_B = [];
{
  const random = makeRng(0x5eed);
  for (let i = 0; i < MH_COUNT; i += 1) {
    MH_A.push(Math.floor(random() * 0xfffffff0) + 1);
    MH_B.push(Math.floor(random() * 0xfffffff0) + 1);
  }
}

const GROUP1 = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
const GROUP3 = ['test', 'test', 'not', 'neg', 'mul', 'imul', 'div', 'idiv'];
const GROUP5 = ['inc', 'dec', 'call', 'callf', 'jmp', 'jmpf', 'push', null];
/** The eight arithmetic/logic opcode families, keyed by the base opcode. */
const ALU_NAMES = { 0x00: 'add', 0x08: 'or', 0x10: 'adc', 0x18: 'sbb', 0x20: 'and', 0x28: 'sub', 0x30: 'xor', 0x38: 'cmp' };

/** Immediate values large enough to be addresses get folded away; small constants stay. */
const ABSOLUTE = 0x1000;
const immToken = (value, size) => (size > 1 && Math.abs(value) >= ABSOLUTE ? 'i.abs' : `i=${value}`);

function readModrm(bytes, i) {
  const modrm = bytes[i];
  const mod = modrm >> 6;
  const reg = (modrm >> 3) & 7;
  const rm = modrm & 7;
  let j = i + 1;
  let rip = false;
  if (mod !== 3 && rm === 4) {
    const sib = bytes[i + 1];
    j += 1;
    if (mod === 0 && (sib & 7) === 5) j += 4;
  } else if (mod === 0 && rm === 5) {
    j += 4;
    rip = true;
  }
  if (mod === 1) j += 1;
  else if (mod === 2) j += 4;
  return { end: j, mod, reg, rm, rip, memory: mod !== 3 };
}

const memKind = (m) => (m.memory ? (m.rip ? 'm.rip' : 'm') : 'r');

function unknown(at) {
  return { length: 1, token: 'db', unknown: true };
}

/** Decodes one x86-64 instruction into a token; unknown bytes advance a single byte. */
export function decodeX86(bytes, at) {
  let i = at;
  let rex = 0;
  let size16 = false;
  for (let guard = 0; guard < 8 && i < bytes.length; guard += 1) {
    const b = bytes[i];
    if (b === 0x66) { size16 = true; i += 1; continue; }
    if (b === 0x67 || b === 0xf0 || b === 0xf2 || b === 0xf3 || b === 0x2e || b === 0x36 || b === 0x3e || b === 0x26 || b === 0x64 || b === 0x65) { i += 1; continue; }
    if (b >= 0x40 && b <= 0x4f) { rex = b; i += 1; continue; }
    break;
  }
  if (i >= bytes.length) return unknown(at);
  const op = bytes[i];
  i += 1;
  const imm = (offset, size) => {
    let value = 0;
    for (let k = size - 1; k >= 0; k -= 1) value = value * 256 + (bytes[offset + k] ?? 0);
    return value;
  };
  const done = (token, extra = {}) => ({ length: i - at, token, ...extra });

  if (op === 0x90) return done('nop');
  if (op === 0xc3) return done('ret');
  if (op === 0xcb) return done('retf');
  if (op === 0xc9) return done('leave');
  if (op === 0xcc) return done('int3');
  if (op === 0xf4) return done('hlt');
  if (op >= 0x50 && op <= 0x57) return done('push.r');
  if (op >= 0x58 && op <= 0x5f) return done('pop.r');
  if (op >= 0x91 && op <= 0x97) return done('xchg.r');
  if (op === 0x68) return done('push.i.abs');
  if (op === 0x6a) return done(`push.${immToken(bytes[i], 1)}`);
  if (op >= 0xb0 && op <= 0xb7) return done(`mov.r8.${immToken(bytes[i], 1)}`);
  if (op >= 0xb8 && op <= 0xbf) {
    const size = rex & 8 ? 8 : size16 ? 2 : 4;
    return done(`mov.r.${immToken(imm(i, size), size)}`, { length: i - at + size });
  }
  if (op === 0xe8) return done('call.rel', { call: true, branch: true });
  if (op === 0xe9) return done('jmp.rel', { branch: true, unconditional: true });
  if (op === 0xeb) return done('jmp.rel8', { branch: true, unconditional: true });
  if (op >= 0x70 && op <= 0x7f) return done('jcc.rel8', { branch: true });
  if (op === 0xc2) return done('ret.i');
  if (op === 0xcd) return done(`int.${immToken(bytes[i], 1)}`);
  if (op >= 0xe0 && op <= 0xe3) return done('loop.rel8', { branch: true });
  if (op === 0x98 || op === 0x99 || op === 0x9c || op === 0x9d) return done(`misc.${op.toString(16)}`);
  if (op === 0xc5 || op === 0xc4) return unknown(at);

  if (op === 0x0f) {
    if (i >= bytes.length) return unknown(at);
    const op2 = bytes[i];
    i += 1;
    if (op2 === 0x05) return done('syscall');
    if (op2 === 0x0b) return done('ud2');
    if (op2 === 0x31) return done('rdtsc');
    if (op2 === 0xa2) return done('cpuid');
    if (op2 === 0x1e) {
      const modrm = bytes[i];
      i += 1;
      if (modrm === 0xfa) return done('endbr64');
      if (modrm === 0xfb) return done('endbr32');
      return unknown(at);
    }
    if (op2 >= 0x80 && op2 <= 0x8f) return done('jcc.rel', { branch: true });
    if (op2 === 0x1f) {
      const m = readModrm(bytes, i);
      return { length: m.end - at, token: 'nop.m' };
    }
    if (op2 === 0xaf) {
      const m = readModrm(bytes, i);
      return { length: m.end - at, token: `imul.r←${memKind(m)}` };
    }
    if (op2 === 0xb6 || op2 === 0xb7) {
      const m = readModrm(bytes, i);
      return { length: m.end - at, token: `movzx.r←${memKind(m)}` };
    }
    if (op2 === 0xbe || op2 === 0xbf) {
      const m = readModrm(bytes, i);
      return { length: m.end - at, token: `movsx.r←${memKind(m)}` };
    }
    if ([0x10, 0x11, 0x28, 0x29, 0x6e, 0x7e, 0x57, 0xd6, 0xef].includes(op2)) {
      const m = readModrm(bytes, i);
      return { length: m.end - at, token: `simd.${op2.toString(16)}${m.memory ? '.m' : ''}` };
    }
    return unknown(at);
  }

  const base = op & 0xf8;
  if (ALU_NAMES[base] !== undefined) {
    const slot = op & 7;
    const m = readModrm(bytes, i);
    // slots 0/1 and 4/5 write to the register/memory operand, the others read from it
    const rmIsDestination = ((slot >> 1) & 1) === 0;
    const shape = rmIsDestination ? `${memKind(m)}←r` : `r←${memKind(m)}`;
    return { length: m.end - at, token: `${ALU_NAMES[base]}${slot % 2 === 0 ? '8' : ''}.${shape}` };
  }
  if ([0x88, 0x89, 0x8a, 0x8b].includes(op)) {
    const m = readModrm(bytes, i);
    const store = op === 0x88 || op === 0x89;
    return { length: m.end - at, token: store ? `mov.${memKind(m)}←r` : `mov.r←${memKind(m)}` };
  }
  if (op === 0x84 || op === 0x85) {
    const m = readModrm(bytes, i);
    return { length: m.end - at, token: `test.${m.memory ? memKind(m) : 'r'}←r` };
  }
  if (op === 0x86 || op === 0x87) {
    const m = readModrm(bytes, i);
    return { length: m.end - at, token: `xchg.${m.memory ? memKind(m) : 'r'}↔r` };
  }
  if (op === 0x8d) {
    const m = readModrm(bytes, i);
    return { length: m.end - at, token: `lea.r←${m.memory ? memKind(m) : 'r'}` };
  }
  if (op === 0xb6 || op === 0xb7 || op === 0xbe || op === 0xbf) {
    const m = readModrm(bytes, i);
    const mnemonic = op === 0xb6 || op === 0xb7 ? 'movzx' : 'movsx';
    return { length: m.end - at, token: `${mnemonic}.r←${memKind(m)}` };
  }
  if (op === 0xc6 || op === 0xc7) {
    const m = readModrm(bytes, i);
    const size = op === 0xc6 ? 1 : rex & 8 ? 4 : 4;
    return { length: m.end - at + size, token: `mov.${memKind(m)}.${immToken(imm(m.end, size), size)}` };
  }
  if (op === 0x80 || op === 0x81 || op === 0x83) {
    const m = readModrm(bytes, i);
    const size = op === 0x83 || op === 0x80 ? 1 : 4;
    return { length: m.end - at + size, token: `${GROUP1[m.reg]}.${memKind(m)}.${immToken(imm(m.end, size), size)}` };
  }
  if (op === 0x69 || op === 0x6b) {
    const m = readModrm(bytes, i);
    const size = op === 0x6b ? 1 : 4;
    return { length: m.end - at + size, token: `imul.r.${memKind(m)}.${immToken(imm(m.end, size), size)}` };
  }
  if (op >= 0xc0 && op <= 0xc1) {
    const m = readModrm(bytes, i);
    return { length: m.end - at + 1, token: `shift.${memKind(m)}.${immToken(bytes[m.end], 1)}` };
  }
  if (op >= 0xd0 && op <= 0xd3) {
    const m = readModrm(bytes, i);
    return { length: m.end - at, token: `shift.${memKind(m)}.${op & 1 ? 'cl' : '1'}` };
  }
  if (op === 0xf6 || op === 0xf7) {
    const m = readModrm(bytes, i);
    const mnemonic = GROUP3[m.reg];
    const withImm = m.reg < 2;
    const size = op === 0xf6 ? 1 : 4;
    return {
      length: m.end - at + (withImm ? size : 0),
      token: withImm ? `${mnemonic}.${memKind(m)}.${immToken(imm(m.end, size), size)}` : `${mnemonic}.${memKind(m)}`,
    };
  }
  if (op === 0xfe) {
    const m = readModrm(bytes, i);
    return { length: m.end - at, token: `${m.reg === 0 ? 'inc' : 'dec'}.${memKind(m)}` };
  }
  if (op === 0xff) {
    const m = readModrm(bytes, i);
    const mnemonic = GROUP5[m.reg] ?? 'group5';
    return {
      length: m.end - at,
      token: `${mnemonic}.${memKind(m)}`,
      call: mnemonic === 'call' || mnemonic === 'callf',
      branch: mnemonic === 'jmp' || mnemonic === 'jmpf',
    };
  }
  if (op === 0x8f) {
    const m = readModrm(bytes, i);
    return { length: m.end - at, token: `pop.${memKind(m)}` };
  }
  return unknown(at);
}

/** AArch64 is fixed-width, so the decode is a classification of bit fields. */
export function decodeArm64(bytes, at) {
  const word = (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  const out = (token, extra = {}) => ({ length: 4, token, ...extra });
  if (word === 0xd503201f) return out('nop');
  if (word === 0xd65f03c0) return out('ret');
  if ((word & 0xfffffc1f) === 0xd65f0000) return out('ret.r');
  if ((word & 0xfffffc1f) === 0xd61f0000) return out('br.r', { branch: true });
  if ((word & 0xfffffc1f) === 0xd63f0000) return out('blr.r', { call: true, branch: true });
  if ((word & 0x7c000000) === 0x14000000) return out('b.rel', { branch: true, unconditional: true });
  if ((word & 0x7c000000) === 0x94000000) return out('bl.rel', { call: true, branch: true });
  if ((word & 0xff000010) === 0x54000000) return out('b.cond.rel', { branch: true });
  if ((word & 0x7e000000) === 0x34000000) return out('cbz.rel', { branch: true });
  if ((word & 0x7e000000) === 0x35000000) return out('cbnz.rel', { branch: true });
  if ((word & 0x7e000000) === 0x36000000) return out('tbz.rel', { branch: true });
  if ((word & 0x7e000000) === 0x37000000) return out('tbnz.rel', { branch: true });
  if ((word & 0x9f000000) === 0x90000000) return out('adrp.r.abs');
  if ((word & 0x9f000000) === 0x10000000) return out('adr.r.abs');
  if ((word & 0xff000000) === 0x91000000) return out('add.r←i');
  if ((word & 0xff000000) === 0xd1000000) return out('sub.r←i');
  if ((word & 0xff200000) === 0x8b000000) return out('add.r←r');
  if ((word & 0xff200000) === 0xcb000000) return out('sub.r←r');
  if ((word & 0x7f800000) === 0x52800000) return out('movz.r←i');
  if ((word & 0x7f800000) === 0x12800000) return out('movn.r←i');
  if ((word & 0x7f800000) === 0x72800000) return out('movk.r←i');
  if ((word & 0xffe00000) === 0x8a000000) return out('and.r←r');
  if ((word & 0xffe00000) === 0xaa000000) return out('orr.r←r');
  if ((word & 0xffe00000) === 0xca000000) return out('eor.r←r');
  if ((word & 0xff800000) === 0x4a000000) return out('eor.r←i');
  if ((word & 0x3b000000) === 0x39000000) return out('ldrstr.m←r');
  if ((word & 0x3b000000) === 0x38000000) return out('ldrstr.m←r.off');
  if ((word & 0x7c000000) === 0x28000000) return out('stp.m←rr');
  if ((word & 0x7c000000) === 0x2c000000) return out('stp.m←rr.pre');
  if ((word & 0x7c000000) === 0x29000000) return out('ldp.rr←m');
  if ((word & 0x7c000000) === 0x2d000000) return out('ldp.rr←m.post');
  if ((word & 0xffe0001f) === 0xd4000001) return out('svc');
  return out('db', { unknown: true });
}

/** Splits a code region into functions by prologue patterns and terminating returns. */
export function discoverFunctions(code, arch, { maxScan = 200000, minLength = 6 } = {}) {
  const isX86 = arch !== 'aarch64';
  const candidates = [];
  if (isX86) {
    for (let i = 0; i + 4 < code.length && i < maxScan; i += 1) {
      const prologue = code[i] === 0x55 && code[i + 1] === 0x48 && code[i + 2] === 0x89 && code[i + 3] === 0xe5;
      const frame = code[i] === 0x48 && code[i + 1] === 0x83 && code[i + 2] === 0xec;
      const endbr = code[i] === 0xf3 && code[i + 1] === 0x0f && code[i + 2] === 0x1e && code[i + 3] === 0xfa;
      if (prologue || frame || endbr) candidates.push(i);
    }
  } else {
    for (let i = 0; i + 4 <= code.length && i < maxScan; i += 4) {
      const word = (code[i] | (code[i + 1] << 8) | (code[i + 2] << 16) | (code[i + 3] << 24)) >>> 0;
      const stp = (word & 0x7fc00000) === 0x29000000 || (word & 0x7fc00000) === 0x2d000000;
      const endbr = word === 0xd503201f;
      if (stp && i % 16 === 0) candidates.push(i);
      if (endbr) candidates.push(i);
    }
  }
  const starts = [...new Set(candidates)].sort((a, b) => a - b);
  // keep the first of any run of candidates that sit within one instruction of each other
  const filtered = [];
  for (const start of starts) {
    const previous = filtered[filtered.length - 1];
    if (previous === undefined || start - previous > 8) filtered.push(start);
  }
  const functions = [];
  for (let index = 0; index < filtered.length; index += 1) {
    const start = filtered[index];
    const limit = index + 1 < filtered.length ? filtered[index + 1] : Math.min(code.length, start + maxScan);
    const slice = code.subarray(start, limit);
    const walked = walkFunction(slice, arch);
    if (walked.terminated && walked.tokens.length >= minLength) {
      functions.push({
        start,
        end: start + walked.consumed,
        declaredEnd: limit,
        bytes: slice.subarray(0, walked.consumed),
        tokens: walked.tokens,
        unknownBytes: walked.unknown,
        calls: walked.calls,
        branches: walked.branches,
        instructions: walked.tokens.length,
      });
    }
  }
  return functions;
}

/** Walks instructions until a return, tracking unknown bytes so coverage is honest. */
function walkFunction(code, arch) {
  const tokens = [];
  let at = 0;
  let unknown = 0;
  let calls = 0;
  let branches = 0;
  let terminated = false;
  const limit = Math.min(code.length, 40000);
  while (at < limit) {
    const step = arch === 'aarch64' ? decodeArm64(code, at) : decodeX86(code, at);
    if (!step || step.length <= 0) break;
    at += step.length;
    if (step.unknown) unknown += step.length;
    else tokens.push(step.token);
    if (step.call) calls += 1;
    if (step.branch) branches += 1;
    if (step.token === 'ret' || step.token === 'ret.i' || step.token === 'retf') {
      terminated = true;
      break;
    }
  }
  // alignment padding after a function is not part of it
  while (tokens.length && (tokens[tokens.length - 1] === 'nop' || tokens[tokens.length - 1] === 'nop.m')) tokens.pop();
  return { tokens, consumed: at, unknown, calls, branches, terminated: terminated || (arch === 'aarch64' && tokens.length > 0) };
}

/** MinHash signature over k-grams of the token stream. */
function minhashSignature(tokens, k) {
  const signature = new Uint32Array(MH_COUNT).fill(0xffffffff);
  if (tokens.length < k) return signature;
  for (let i = 0; i + k <= tokens.length; i += 1) {
    let hash = FNV_OFFSET;
    for (let g = 0; g < k; g += 1) {
      const token = tokens[i + g];
      for (let c = 0; c < token.length; c += 1) {
        hash ^= token.charCodeAt(c);
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
      }
      hash ^= 0xff;
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
    for (let m = 0; m < MH_COUNT; m += 1) {
      const value = (Math.imul(hash, MH_A[m]) + MH_B[m]) >>> 0;
      if (value < signature[m]) signature[m] = value;
    }
  }
  return signature;
}

const signatureSimilarity = (a, b) => {
  let equal = 0;
  for (let i = 0; i < MH_COUNT; i += 1) if (a[i] === b[i]) equal += 1;
  return equal / MH_COUNT;
};

/**
 * Two signatures: single tokens and three-token phrases. The single-token signature keeps
 * the score high when instructions are inserted or removed, while the trigram signature
 * keeps genuinely rewritten bodies apart — the pair is why both tolerate edits and still
 * discriminate.
 */
export function fingerprint(fn) {
  const tokens = fn.tokens;
  return {
    ...fn,
    signature: minhashSignature(tokens, 1),
    trigram: minhashSignature(tokens, 3),
    canonical: fnv(tokens.join(' ')),
    tokenCount: tokens.length,
  };
}

export function similarityOf(a, b) {
  if (!a.tokenCount || !b.tokenCount) return 0;
  const ratio = Math.min(a.tokenCount, b.tokenCount) / Math.max(a.tokenCount, b.tokenCount);
  if (ratio < 0.35) return 0;
  const score = 0.6 * signatureSimilarity(a.signature, b.signature) + 0.4 * signatureSimilarity(a.trigram, b.trigram);
  return score * ratio;
}

/** Parses a binary's container and returns the code regions worth scanning. */
export function parseBinary(bytes) {
  const sections = [];
  const warning = [];
  let format = 'raw';
  let arch = 'unknown';
  if (bytes.length > 0x40 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    format = 'elf';
    const machine = bytes[0x12] | (bytes[0x13] << 8);
    arch = machine === 0x3e ? 'x86-64' : machine === 0xb7 ? 'aarch64' : machine === 0x03 ? 'x86' : 'unknown';
    const little = bytes[5] === 1;
    if (!little) warning.push('Big-endian ELF: only the header is read here.');
    const readU64 = (offset) => {
      let value = 0;
      for (let i = 7; i >= 0; i -= 1) value = value * 256 + (bytes[offset + i] ?? 0);
      return value;
    };
    const readU32 = (offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
    const readU16 = (offset) => bytes[offset] | (bytes[offset + 1] << 8);
    const shoff = Number(readU64(0x28));
    const shentsize = readU16(0x3a);
    const shnum = readU16(0x3c);
    const shstrndx = readU16(0x3e);
    for (let i = 0; i < shnum; i += 1) {
      const base = shoff + i * shentsize;
      if (base + shentsize > bytes.length) {
        warning.push('The section header table runs past the end of the file.');
        break;
      }
      const nameOffset = readU32(base);
      const type = readU32(base + 4);
      const flags = Number(readU64(base + 8));
      const address = Number(readU64(base + 16));
      const offset = Number(readU64(base + 24));
      const size = Number(readU64(base + 32));
      sections.push({ index: i, nameOffset, type, flags, address, offset, size });
    }
    const strSection = sections[shstrndx];
    for (const section of sections) {
      section.name = strSection && strSection.offset + section.nameOffset < bytes.length
        ? readCString(bytes, strSection.offset + section.nameOffset)
        : `section ${section.index}`;
      section.executable = (section.flags & 0x4) !== 0;
    }
    if (!sections.some((section) => section.executable)) {
      warning.push('No executable section — the whole file is scanned as code.');
      sections.push({ name: '.text (inferred)', executable: true, address: 0, offset: 0, size: bytes.length, inferred: true });
    }
  } else if (bytes.length > 0x40 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    format = 'pe';
    const peOffset = bytes[0x3c] | (bytes[0x3d] << 8) | (bytes[0x3e] << 16) | (bytes[0x3f] << 24);
    if (peOffset + 0x18 < bytes.length && bytes[peOffset] === 0x50 && bytes[peOffset + 1] === 0x45) {
      const machine = bytes[peOffset + 4] | (bytes[peOffset + 5] << 8);
      arch = machine === 0x8664 ? 'x86-64' : machine === 0xaa64 ? 'aarch64' : 'unknown';
      const sectionCount = bytes[peOffset + 6] | (bytes[peOffset + 7] << 8);
      const optionalSize = bytes[peOffset + 20] | (bytes[peOffset + 21] << 8);
      const table = peOffset + 24 + optionalSize;
      for (let i = 0; i < sectionCount; i += 1) {
        const base = table + i * 40;
        if (base + 40 > bytes.length) break;
        const name = readCString(bytes, base, 8);
        const size = bytes[base + 8] | (bytes[base + 9] << 8) | (bytes[base + 10] << 16) | (bytes[base + 11] << 24);
        const address = bytes[base + 12] | (bytes[base + 13] << 8) | (bytes[base + 14] << 16) | (bytes[base + 15] << 24);
        const offset = bytes[base + 20] | (bytes[base + 21] << 8) | (bytes[base + 22] << 16) | (bytes[base + 23] << 24);
        const flags = bytes[base + 36] | (bytes[base + 37] << 8) | (bytes[base + 38] << 16) | (bytes[base + 39] << 24);
        sections.push({ index: i, name, type: 1, flags, address, offset, size, executable: (flags & 0x20000000) !== 0 });
      }
    } else warning.push('The PE header offset does not land on a PE signature.');
  } else if (bytes.length > 8 && (bytes[0] === 0xcf || bytes[0] === 0xce) && bytes[bytes.length - 4] === 1) {
    format = 'macho';
    warning.push('Mach-O: the file is scanned as a single code region.');
  } else {
    warning.push('Not a recognised container — the input is treated as a raw code region.');
  }
  if (!sections.some((section) => section.executable)) {
    sections.push({ name: 'raw code', executable: true, address: 0, offset: 0, size: bytes.length, inferred: true });
  }
  return { format, arch, sections, warning };
}

const readCString = (bytes, offset, limit = 64) => {
  let text = '';
  for (let i = 0; i < limit; i += 1) {
    const byte = bytes[offset + i];
    if (!byte) break;
    text += String.fromCharCode(byte);
  }
  return text || 'unnamed';
};

/** The whole pipeline: container, boundaries, tokens, fingerprints, matching. */
export function analyseBinary(bytes, { minTokens = 6 } = {}) {
  const container = parseBinary(bytes);
  const functions = [];
  for (const section of container.sections.filter((s) => s.executable)) {
    const code = bytes.subarray(section.offset, Math.min(bytes.length, section.offset + section.size));
    for (const fn of discoverFunctions(code, container.arch)) {
      if (fn.tokens.length < minTokens) continue;
      functions.push(fingerprint({ ...fn, base: section.address, section: section.name, address: section.address + fn.start }));
    }
  }
  return { container, functions };
}

export function compareBinaries(bytesA, bytesB, { threshold = 0.35, minTokens = 6 } = {}) {
  const a = analyseBinary(bytesA, { minTokens });
  const b = analyseBinary(bytesB, { minTokens });
  const candidates = [];
  for (let i = 0; i < a.functions.length; i += 1) {
    for (let j = 0; j < b.functions.length; j += 1) {
      const score = similarityOf(a.functions[i], b.functions[j]);
      if (score >= threshold) candidates.push({ i, j, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  const usedA = new Set();
  const usedB = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (usedA.has(candidate.i) || usedB.has(candidate.j)) continue;
    usedA.add(candidate.i);
    usedB.add(candidate.j);
    const exact = a.functions[candidate.i].canonical === b.functions[candidate.j].canonical;
    matches.push({
      a: a.functions[candidate.i],
      b: b.functions[candidate.j],
      score: candidate.score,
      exact,
    });
  }
  matches.sort((x, y) => y.score - x.score);
  return {
    a,
    b,
    matches,
    unmatchedA: a.functions.filter((_, i) => !usedA.has(i)),
    unmatchedB: b.functions.filter((_, j) => !usedB.has(j)),
    stats: {
      functionsA: a.functions.length,
      functionsB: b.functions.length,
      matches: matches.length,
      exactRewrites: matches.filter((m) => m.exact).length,
      meanSimilarity: matches.length ? matches.reduce((sum, m) => sum + m.score, 0) / matches.length : 0,
      formats: `${a.container.format}/${a.container.arch} vs ${b.container.format}/${b.container.arch}`,
      threshold,
    },
  };
}

/* ── ground-truth benchmark: a small assembler, a real ELF64, and known transforms ── */

const instructionSize = (insn) => {
  switch (insn.op) {
    case 'push': return 1;
    case 'pop': return 1;
    case 'ret': return 1;
    case 'nop': return 1;
    case 'nopMem': return 3;
    case 'movRbp': return 3;
    case 'syscall': return 2;
    case 'call': return 5;
    case 'jmp': return 5;
    case 'jcc': return 6;
    case 'movRegImm': return 10;
    case 'movRegImm32': return 5;
    case 'aluImm': return insn.value < 256 ? 4 : 7;
    case 'loadLocal': return 4;
    case 'storeLocal': return 4;
    case 'leaRip': return 7;
    case 'testReg': return 3;
    case 'movRegReg': return 3;
    case 'xorReg': return 3;
    case 'imulImm': return 7;
    case 'movrm': return 7;
    default: return 1;
  }
};

const REGS = [0, 1, 2, 3, 6, 7];

function makeProgram({ seed = 1, count = 24 } = {}) {
  const random = makeRng(seed);
  const functions = [];
  for (let f = 0; f < count; f += 1) {
    const insns = [];
    if (random() < 0.5) insns.push({ op: 'endbr64' });
    insns.push({ op: 'push' });
    insns.push({ op: 'movRbp' });
    const length = 6 + Math.floor(random() * 16);
    for (let k = 0; k < length; k += 1) {
      const roll = random();
      const reg = REGS[Math.floor(random() * REGS.length)];
      if (roll < 0.16) insns.push({ op: 'aluImm', reg, kind: ['add', 'sub', 'cmp', 'xor'][Math.floor(random() * 4)], value: Math.floor(random() * 220) + 1 });
      else if (roll < 0.3) insns.push({ op: 'loadLocal', reg, disp: -8 * (1 + Math.floor(random() * 6)) });
      else if (roll < 0.42) insns.push({ op: 'storeLocal', reg, disp: -8 * (1 + Math.floor(random() * 6)) });
      else if (roll < 0.52) insns.push({ op: 'movRegImm', reg, value: 0x402000 + Math.floor(random() * 0x8000) });
      else if (roll < 0.6) insns.push({ op: 'leaRip', reg, target: 0x403000 + Math.floor(random() * 0x4000) });
      else if (roll < 0.68) insns.push({ op: 'testReg', reg });
      else if (roll < 0.74) insns.push({ op: 'movRegReg', dst: reg, src: REGS[Math.floor(random() * REGS.length)] });
      else if (roll < 0.79) insns.push({ op: 'xorReg', reg });
      else if (roll < 0.84) insns.push({ op: 'imulImm', reg, value: 3 + Math.floor(random() * 40) });
      else if (roll < 0.9) insns.push({ op: 'nopMem' });
      else insns.push({ op: 'nop' });
      if (k === Math.floor(length / 2) && count > 1) {
        insns.push({ op: 'call', target: Math.floor(random() * count) });
        insns.push({ op: 'jcc', condition: Math.floor(random() * 6), label: 'tail' });
      }
    }
    insns.push({ op: 'label', name: 'tail' });
    insns.push({ op: 'xorReg', reg: 0 });
    insns.push({ op: 'pop' });
    insns.push({ op: 'ret' });
    functions.push({ name: `sub_${(f * 0x37 + 0x401000).toString(16)}`, index: f, insns });
  }
  return { functions };
}

/** Emits one function at a known address, resolving calls and branches. */
function emitFunction(fn, address, addresses, { fillers = 0, reregister = false } = {}) {
  const random = makeRng(0x1234 + fn.index);
  const map = reregister ? (reg) => (reg < 4 ? (reg + 1) % 4 : reg) : (reg) => reg;
  const sizes = fn.insns.map(instructionSize);
  const labelAt = new Map();
  let cursor = 0;
  fn.insns.forEach((insn, i) => {
    if (insn.op === 'label') labelAt.set(insn.name, cursor);
    cursor += sizes[i];
  });
  const bytes = [];
  const push = (...values) => values.forEach((value) => bytes.push(value & 0xff));
  const align = () => { while (bytes.length % 16 !== 0 && bytes.length) push(0x90); };
  let at = 0;
  fn.insns.forEach((insn, i) => {
    const here = address + at;
    switch (insn.op) {
      case 'endbr64': push(0xf3, 0x0f, 0x1e, 0xfa); break;
      case 'push': push(0x55); break;
      case 'movRbp': push(0x48, 0x89, 0xe5); break;
      case 'pop': push(0x5d); break;
      case 'ret': push(0xc3); break;
      case 'nop': push(0x90); break;
      case 'nopMem': push(0x0f, 0x1f, 0x00); break;
      case 'syscall': push(0x0f, 0x05); break;
      case 'movRbp2': push(0x48, 0x89, 0xe5); break;
      case 'aluImm': {
        const kind = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'].indexOf(insn.kind);
        if (insn.value < 256) push(0x48, 0x83, 0xc0 | (kind << 3) | map(insn.reg), insn.value & 0xff);
        else {
          push(0x48, 0x81, 0xc0 | (kind << 3) | map(insn.reg));
          for (let b = 0; b < 4; b += 1) push((insn.value >>> (b * 8)) & 0xff);
        }
        break;
      }
      case 'loadLocal': push(0x48, 0x8b, 0x45 | (map(insn.reg) << 3), ((insn.disp % 256) + 256) % 256); break;
      case 'storeLocal': push(0x48, 0x89, 0x45 | (map(insn.reg) << 3), ((insn.disp % 256) + 256) % 256); break;
      case 'movRegImm': {
        push(0x48, 0xb8 + map(insn.reg));
        const value = insn.value;
        for (let b = 0; b < 4; b += 1) push((value >>> (b * 8)) & 0xff);
        for (let b = 4; b < 8; b += 1) push(0);
        break;
      }
      case 'leaRip': push(0x48, 0x8d, 0x05 | (map(insn.reg) << 3)); {
        const displacement = insn.target - (here + 7);
        for (let b = 0; b < 4; b += 1) push(((displacement >> (b * 8)) & 0xff));
        break;
      }
      case 'testReg': push(0x48, 0x85, 0xc0 | (map(insn.reg) << 3) | map(insn.reg)); break;
      case 'movRegReg': push(0x48, 0x89, 0xc0 | (map(insn.src) << 3) | map(insn.dst)); break;
      case 'xorReg': push(0x48, 0x31, 0xc0 | (map(insn.reg) << 3) | map(insn.reg)); break;
      case 'imulImm': push(0x48, 0x69, 0xc0 | (map(insn.reg) << 3) | map(insn.reg)); {
        for (let b = 0; b < 4; b += 1) push((insn.value >>> (b * 8)) & 0xff);
        break;
      }
      case 'call': {
        const target = addresses[insn.target % addresses.length];
        const displacement = target - (here + 5);
        push(0xe8);
        for (let b = 0; b < 4; b += 1) push((displacement >> (b * 8)) & 0xff);
        break;
      }
      case 'jcc': {
        const target = address + labelAt.get(insn.label);
        const displacement = target - (here + 6);
        push(0x0f, 0x84 + insn.condition);
        for (let b = 0; b < 4; b += 1) push((displacement >> (b * 8)) & 0xff);
        break;
      }
      case 'label': break;
      default: push(0x90);
    }
    if (fillers && bytes.length >= 32 && random() < 0.25) push(0x48, 0x89, 0xff); // mov rdi,rdi filler
    at = bytes.length;
    if (insn.op === 'nop' && fillers) align();
  });
  return Uint8Array.from(bytes);
}

/** Writes a real ELF64 file: header, .text, .rodata, .shstrtab and the section table. */
function linkElf({ text, base, rodata = new Uint8Array(0) }) {
  const ehdrSize = 64;
  const textOffset = ehdrSize;
  const rodataOffset = textOffset + text.length;
  const shstr = '\u0000.text\u0000.rodata\u0000.shstrtab\u0000';
  const shstrBytes = Uint8Array.from([...shstr].map((c) => c.charCodeAt(0)));
  const shstrOffset = rodataOffset + rodata.length;
  const shoff = shstrOffset + shstrBytes.length;
  const total = shoff + 64 * 4;
  const out = new Uint8Array(total);
  const u16 = (at, value) => { out[at] = value & 0xff; out[at + 1] = (value >> 8) & 0xff; };
  const u32 = (at, value) => { for (let b = 0; b < 4; b += 1) out[at + b] = (value >>> (b * 8)) & 0xff; };
  const u64 = (at, value) => { for (let b = 0; b < 8; b += 1) out[at + b] = Math.floor(value / 2 ** (b * 8)) & 0xff; };
  out[0] = 0x7f; out[1] = 0x45; out[2] = 0x4c; out[3] = 0x46;
  out[4] = 2; out[5] = 1; out[6] = 1;
  u16(0x10, 2);
  u16(0x12, 0x3e);
  u32(0x14, 1);
  u64(0x18, base);
  u64(0x28, shoff);
  u16(0x34, ehdrSize);
  u16(0x36, 0);
  u16(0x38, 0);
  u16(0x3a, 64);
  u16(0x3c, 4);
  u16(0x3e, 3);
  out.set(text, textOffset);
  out.set(rodata, rodataOffset);
  out.set(shstrBytes, shstrOffset);
  const section = (index, { name, type, flags, addr, offset, size, align = 1 }) => {
    const at = shoff + index * 64;
    u32(at, name);
    u32(at + 4, type);
    u64(at + 8, flags);
    u64(at + 16, addr);
    u64(at + 24, offset);
    u64(at + 32, size);
    u32(at + 40, 0);
    u32(at + 44, 0);
    u64(at + 48, align);
    u64(at + 56, 0);
  };
  section(0, { name: 0, type: 0, flags: 0, addr: 0, offset: 0, size: 0 });
  section(1, { name: 1, type: 1, flags: 0x6, addr: base, offset: textOffset, size: text.length, align: 16 });
  section(2, { name: 7, type: 1, flags: 0x2, addr: base + text.length, offset: rodataOffset, size: rodata.length });
  section(3, { name: 15, type: 3, flags: 0, addr: 0, offset: shstrOffset, size: shstrBytes.length });
  return out;
}

/**
 * Builds a binary and a transformed copy, keeping the mapping between them, then measures
 * how well the engine recovers that mapping.
 */
export function runSimilarityBenchmark({ seed = 4, count = 28, replaced = 4, threshold = 0.35, fillers = true } = {}) {
  const programA = makeProgram({ seed, count });
  const random = makeRng(seed + 99);
  const baseA = 0x401000;

  const orderB = [...programA.functions.map((fn) => fn.index)].sort(() => (random() < 0.5 ? -1 : 1));
  const replaceSet = new Set();
  while (replaceSet.size < Math.min(replaced, programA.functions.length)) replaceSet.add(Math.floor(random() * programA.functions.length));
  const programB = makeProgram({ seed: seed + 5000, count });
  const baseB = 0x4a2000;
  const rodata = Uint8Array.from([...'mark37'].map((c) => c.charCodeAt(0)));
  const sizeOf = (fn, options = {}) => emitFunction(fn, 0, new Array(count).fill(0), options).length;

  // binary A: natural order, no transforms — the offsets recorded here are the truth
  const lengthsA = programA.functions.map((fn) => sizeOf(fn));
  const offsetsA = [];
  let at = 0;
  programA.functions.forEach((fn) => {
    offsetsA[fn.index] = at;
    at += lengthsA[fn.index] + 2;
  });
  const addressesA = offsetsA.map((offset) => baseA + offset);
  const textA = new Uint8Array(at);
  programA.functions.forEach((fn) => textA.set(emitFunction(fn, addressesA[fn.index], addressesA, {}), offsetsA[fn.index]));
  const bytesA = linkElf({ text: textA, base: baseA, rodata });

  // binary B: reordered, rebased, padded, partly re-registered and partly rewritten
  const plan = orderB.map((index) => ({
    index,
    padding: 1 + Math.floor(random() * 4),
    fillers: fillers && random() < 0.45 ? 2 : 0,
    reregister: random() < 0.55,
  }));
  const lengthsB = plan.map((entry) => sizeOf(
    replaceSet.has(entry.index) ? programB.functions[entry.index] : programA.functions[entry.index],
    { fillers: entry.fillers, reregister: entry.reregister },
  ));
  const offsetsB = [];
  let atB = 0;
  plan.forEach((entry, position) => {
    offsetsB[entry.index] = atB;
    atB += lengthsB[position] + 1 + entry.padding;
  });
  const addressesB = plan.map((entry) => baseB + offsetsB[entry.index]);
  const textB = new Uint8Array(atB);
  plan.forEach((entry, position) => {
    const source = replaceSet.has(entry.index) ? programB.functions[entry.index] : programA.functions[entry.index];
    textB.set(emitFunction(source, addressesB[position], addressesB, { fillers: entry.fillers, reregister: entry.reregister }), offsetsB[entry.index]);
  });
  const bytesB = linkElf({ text: textB, base: baseB, rodata });

  const result = compareBinaries(bytesA, bytesB, { threshold });
  const truth = new Map();
  programA.functions.forEach((fn) => {
    if (!replaceSet.has(fn.index)) truth.set(offsetsA[fn.index], offsetsB[fn.index]);
  });
  let truePositives = 0;
  let falsePositives = 0;
  let misplaced = 0;
  const correctScores = [];
  const strayScores = [];
  for (const match of result.matches) {
    const offsetA = match.a.address - baseA;
    const offsetB = match.b.address - baseB;
    const expected = truth.get(offsetA);
    if (expected !== undefined && expected === offsetB) {
      truePositives += 1;
      correctScores.push(match.score);
    } else {
      falsePositives += 1;
      strayScores.push(match.score);
      if (expected !== undefined) misplaced += 1;
    }
  }
  // what the engine scores a genuinely rewritten function against the one it replaced
  const rewrittenScores = [];
  for (const index of replaceSet) {
    const a = result.a.functions.find((fn) => fn.address - baseA === offsetsA[index]);
    const b = result.b.functions.find((fn) => fn.address - baseB === offsetsB[index]);
    if (a && b) rewrittenScores.push(similarityOf(a, b));
  }
  return {
    result,
    ground: {
      functions: count,
      replaced: replaceSet.size,
      expected: truth.size,
      truePositives,
      falsePositives,
      misplaced,
      missed: Math.max(0, truth.size - truePositives),
      precision: result.matches.length ? truePositives / result.matches.length : 1,
      recall: truth.size ? truePositives / truth.size : 1,
      meanCorrectSimilarity: mean(correctScores),
      meanStraySimilarity: mean(strayScores),
      meanRewrittenSimilarity: mean(rewrittenScores),
      maxRewrittenSimilarity: rewrittenScores.length ? Math.max(...rewrittenScores) : 0,
      baseA,
      baseB,
      bytesA: bytesA.length,
      bytesB: bytesB.length,
      threshold,
      tokenCoverage: tokenCoverage(result.a, result.b),
    },
  };
}

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

const tokenCoverage = (a, b) => {
  const total = a.functions.length + b.functions.length;
  if (!total) return 1;
  const unknown = a.functions.reduce((sum, fn) => sum + fn.unknownBytes, 0) + b.functions.reduce((sum, fn) => sum + fn.unknownBytes, 0);
  const bytes = a.functions.reduce((sum, fn) => sum + fn.bytes.length, 0) + b.functions.reduce((sum, fn) => sum + fn.bytes.length, 0);
  return bytes ? 1 - unknown / bytes : 1;
};